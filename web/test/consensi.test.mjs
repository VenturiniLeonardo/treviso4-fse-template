import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Il cancello dei consensi — §5 del piano, confermato il 31 agosto 2026.
 *
 * È il test che il piano stesso mette fra i tre che devono esistere: «il
 * cancello dei consensi, provato contro il trigger: si tenta la pubblicazione
 * con un consenso mancante e ci si aspetta l'interruzione».
 *
 * Le prove qui non passano dalle Server Action e non passano nemmeno sempre
 * dallo store: dove conta, l'`UPDATE` lo fa **SQL grezzo**. Un cancello che sta
 * nel database si prova nel database, se no si sta provando il codice che lo
 * chiama — e quello si può sempre aggirare.
 */

let cartella;
let percorso;
let raw;
let album, iscritti, riferimenti;
let chiudiPerTest;
let idUtente;

const ANNO = "2026-2027";

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-consensi-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = join(cartella, "dati");

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  album = await import("@/lib/album");
  iscritti = await import("@/lib/iscritti-store");
  riferimenti = await import("@/lib/db/riferimenti");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  const utenti = await import("@/lib/utenti");

  raw = new Database(percorso);
  riferimenti.assicuraRiferimenti();
  idUtente = utenti.creaUtente({
    utente: "ref1",
    ruolo: "referente",
    nome: "Ref1",
    iniziali: "AK",
    unita: "u1",
  });
});

beforeEach(() => {
  for (const t of ["album_assenze", "foto", "album", "iscrizioni", "ragazzi"]) {
    raw.prepare(`delete from ${t}`).run();
  }
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  rmSync(cartella, { recursive: true, force: true });
});

/** Un album dell'unità 1, in bozza. Restituisce slug e identificativo. */
async function unAlbum(unita = "u1") {
  const slug = await album.creaAlbum(
    { titolo: `Uscita ${unita} ${Math.random()}`, anno: "2026 – 2027", unita, data: "Ottobre 2026", sottotitolo: "", tag: "" },
    1,
    "ref1",
  );
  return { slug, id: await album.idAlbumPerIndirizzo(slug) };
}

function unIscritto(nome, cognome, consenso, unita = "u1") {
  const id = iscritti.registraIscrizione({ nome, cognome, natoIl: "2017-01-01", unita, anno: ANNO });
  if (consenso) iscritti.registraConsenso(id, true, "2026-09-15");
  return id;
}

/** L'`UPDATE` a mano, senza passare da nessuno store. */
function pubblicaConSql(id) {
  raw.prepare("update album set stato='pubblicato' where id=?").run(id);
}

// =========================================================================

describe("il trigger esiste, e sta nel database", () => {
  it("è installato", () => {
    const t = raw
      .prepare("select name from sqlite_master where type='trigger'")
      .all()
      .map((r) => r.name);
    assert.ok(t.includes("album_niente_pubblicazione_senza_consensi"), t.join(", "));
  });
});

describe("con un consenso mancante la pubblicazione si ferma", () => {
  it("l'UPDATE a mano viene rifiutato dal database", async () => {
    const a = await unAlbum();
    unIscritto("Anna", "Verdi", false);

    assert.throws(() => pubblicaConSql(a.id), /consensi immagini mancanti/);
    assert.equal(raw.prepare("select stato from album where id=?").get(a.id).stato, "bozza");
  });

  it("e anche quello che passa dallo store", async () => {
    const a = await unAlbum();
    unIscritto("Anna", "Verdi", false);

    // lo store lo traduce in `ErroreDatabase` di genere `trigger`
    const { ErroreDatabase } = await import("@/lib/db/errori");
    await assert.rejects(
      () => album.cambiaStatoAlbum(a.slug, "pubblicato", 0, "ref1"),
      (e) => e instanceof ErroreDatabase && e.genere === "trigger",
    );
    assert.equal((await album.albumPerIndirizzo(a.slug)).stato, "bozza");
  });

  it("«in revisione» invece passa: si blocca la pubblicazione, non il lavoro", async () => {
    const a = await unAlbum();
    unIscritto("Anna", "Verdi", false);

    assert.equal(await album.cambiaStatoAlbum(a.slug, "in-revisione", 0, "ref1"), true);
    assert.equal((await album.albumPerIndirizzo(a.slug)).stato, "in-revisione");
  });
});

describe("con tutti i consensi la pubblicazione passa", () => {
  it("nessun iscritto senza consenso", async () => {
    const a = await unAlbum();
    unIscritto("Giulia", "Rossi", true);
    unIscritto("Marco", "Bianchi", true);

    pubblicaConSql(a.id);
    assert.equal(raw.prepare("select stato from album where id=?").get(a.id).stato, "pubblicato");
  });

  it("nessun iscritto affatto: il trigger non ha niente da bloccare", async () => {
    const a = await unAlbum();
    pubblicaConSql(a.id);
    assert.equal(raw.prepare("select stato from album where id=?").get(a.id).stato, "pubblicato");
  });
});

describe("la dichiarazione di assenza sblocca, e solo quell'album", () => {
  it("dichiarato assente, l'album si pubblica", async () => {
    const a = await unAlbum();
    const anna = unIscritto("Anna", "Verdi", false);

    assert.throws(() => pubblicaConSql(a.id), /consensi immagini mancanti/);

    assert.equal(iscritti.dichiaraAssenza(a.id, anna, idUtente), true);
    pubblicaConSql(a.id);
    assert.equal(raw.prepare("select stato from album where id=?").get(a.id).stato, "pubblicato");
  });

  it("ma il consenso resta mancante, e il prossimo album resta bloccato", async () => {
    const primo = await unAlbum();
    const anna = unIscritto("Anna", "Verdi", false);
    iscritti.dichiaraAssenza(primo.id, anna, idUtente);
    pubblicaConSql(primo.id);

    /*
     * È il punto di tutta §5. Una dichiarazione vale per **un** album: non è
     * un interruttore che spegne il controllo, è una frase su delle fotografie
     * precise. Se valesse per tutti sarebbe il «pubblica comunque» che il piano
     * scarta chiamandolo «un aggiramento».
     */
    const secondo = await unAlbum();
    assert.throws(() => pubblicaConSql(secondo.id), /consensi immagini mancanti/);
    assert.equal(iscritti.iscrittoPerId(anna).consenso, false, "il consenso non è cambiato");
  });

  it("ritirare la dichiarazione riblocca lo stesso album", async () => {
    const a = await unAlbum();
    const anna = unIscritto("Anna", "Verdi", false);
    iscritti.dichiaraAssenza(a.id, anna, idUtente);
    pubblicaConSql(a.id);

    // si ritira e si riporta in bozza, poi si riprova
    assert.equal(iscritti.togliAssenza(a.id, anna), true);
    raw.prepare("update album set stato='bozza' where id=?").run(a.id);
    assert.throws(() => pubblicaConSql(a.id), /consensi immagini mancanti/);
  });

  it("registrare il consenso sblocca tutti gli album, la dichiarazione uno", async () => {
    const a = await unAlbum();
    const b = await unAlbum();
    const anna = unIscritto("Anna", "Verdi", false);

    iscritti.registraConsenso(anna, true, "2026-10-02");
    pubblicaConSql(a.id);
    pubblicaConSql(b.id);
    // solo i due di questa prova: il seme materializza tredici album già
    // pubblicati, e contarli tutti misurerebbe quelli invece di questi
    for (const id of [a.id, b.id]) {
      assert.equal(raw.prepare("select stato from album where id=?").get(id).stato, "pubblicato");
    }
  });

  it("dichiararla due volte non è un errore: la prima vale", async () => {
    const a = await unAlbum();
    const anna = unIscritto("Anna", "Verdi", false);
    assert.equal(iscritti.dichiaraAssenza(a.id, anna, idUtente), true);
    assert.equal(iscritti.dichiaraAssenza(a.id, anna, idUtente), false);
    assert.equal(raw.prepare("select count(*) n from album_assenze").get().n, 1);
  });
});

describe("l'ambito: un album di gruppo guarda tutte le unità", () => {
  it("un consenso mancante fra l'unità 2 blocca un album di gruppo", async () => {
    const a = await unAlbum("gruppo");
    unIscritto("Anna", "Verdi", false, "u2");
    assert.throws(() => pubblicaConSql(a.id), /consensi immagini mancanti/);
  });

  it("ma non blocca un album dell'unità 1", async () => {
    const a = await unAlbum("u1");
    unIscritto("Anna", "Verdi", false, "u2");
    pubblicaConSql(a.id);
    assert.equal(raw.prepare("select stato from album where id=?").get(a.id).stato, "pubblicato");
  });

  it("e un consenso mancante di un altro anno non blocca niente", async () => {
    const a = await unAlbum();
    const id = iscritti.registraIscrizione({
      nome: "Anna", cognome: "Verdi", natoIl: "2017-01-01",
      unita: "u1", anno: "2025-2026",
    });
    assert.ok(id);
    pubblicaConSql(a.id);
    assert.equal(raw.prepare("select stato from album where id=?").get(a.id).stato, "pubblicato");
  });
});

describe("`bloccantiPer` dice le stesse cose del trigger", () => {
  it("quando elenca qualcuno, il database rifiuta; quando è vuoto, accetta", async () => {
    const a = await unAlbum();
    const anna = unIscritto("Anna", "Verdi", false);
    unIscritto("Giulia", "Rossi", true);

    /*
     * La prova che le due liste non divergano.
     *
     * `bloccantiPer` è la domanda posta dal codice, il trigger è la stessa
     * domanda posta dal database. Sono scritte in due linguaggi e in due file:
     * se un giorno una cambia senza l'altra, la schermata direbbe «si può
     * pubblicare» e il pulsante darebbe errore — o peggio il contrario.
     */
    let bloccanti = iscritti.bloccantiPer(a.id, ANNO, "u1");
    assert.deepEqual(bloccanti.map((i) => i.cognome), ["Verdi"]);
    assert.throws(() => pubblicaConSql(a.id), /consensi immagini mancanti/);

    iscritti.dichiaraAssenza(a.id, anna, idUtente);
    bloccanti = iscritti.bloccantiPer(a.id, ANNO, "u1");
    assert.deepEqual(bloccanti, [], "adesso non blocca nessuno");
    pubblicaConSql(a.id);
    assert.equal(raw.prepare("select stato from album where id=?").get(a.id).stato, "pubblicato");
  });

  it("nessun iscritto è `null`, non lista vuota: non sapere non è «va bene»", async () => {
    const a = await unAlbum();
    assert.equal(iscritti.bloccantiPer(a.id, ANNO, "u1"), null);
  });
});

describe("che cosa succede alle dichiarazioni quando qualcosa sparisce", () => {
  it("cancellato l'album, le sue dichiarazioni cadono", async () => {
    const a = await unAlbum();
    const anna = unIscritto("Anna", "Verdi", false);
    iscritti.dichiaraAssenza(a.id, anna, idUtente);

    await album.eliminaAlbum(a.slug, "ref1");
    assert.equal(raw.prepare("select count(*) n from album_assenze").get().n, 0);
  });

  it("cancellato il ragazzo, la dichiarazione perde il soggetto e cade", async () => {
    const a = await unAlbum();
    const anna = unIscritto("Anna", "Verdi", false);
    iscritti.dichiaraAssenza(a.id, anna, idUtente);

    const ragazzoId = iscritti.iscrittoPerId(anna).ragazzoId;
    iscritti.cancellaRagazzo(ragazzoId);
    assert.equal(raw.prepare("select count(*) n from album_assenze").get().n, 0);
  });

  it("l'autore invece non si può cancellare: una dichiarazione senza autore non è una dichiarazione", async () => {
    const a = await unAlbum();
    const anna = unIscritto("Anna", "Verdi", false);
    iscritti.dichiaraAssenza(a.id, anna, idUtente);

    // `dichiarata_da` è NOT NULL senza ON DELETE SET NULL, al contrario di
    // `album.autore_id`: la cancellazione dell'account si ferma, ed è giusto
    // che qualcuno debba decidere cosa farne
    assert.throws(() => raw.prepare("delete from utenti where id=?").run(idUtente));
  });
});
