import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Fase 11: il registro delle richieste, e il buco della revoca.
 *
 * La prova che conta è quella sulla revoca. Il trigger impedisce di pubblicare
 * mentre un consenso manca; fino a questa fase non diceva niente su quello che
 * era **già online** quando il consenso veniva revocato — e quello era il buco
 * dichiarato in consensi.md §6.
 */

let cartella;
let percorso;
let raw;
let gdpr, iscritti, album, riferimenti, utenti;
let chiudiPerTest;
let idUtente;

const ANNO = "2026-2027";

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-gdpr-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = join(cartella, "dati");

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  gdpr = await import("@/lib/gdpr-store");
  iscritti = await import("@/lib/iscritti-store");
  album = await import("@/lib/album");
  riferimenti = await import("@/lib/db/riferimenti");
  utenti = await import("@/lib/utenti");
  ({ chiudiPerTest } = await import("@/lib/db/db"));

  raw = new Database(percorso);
  riferimenti.assicuraRiferimenti();
  idUtente = utenti.creaUtente({
    utente: "sviluppatore",
    ruolo: "sviluppatore",
    nome: "Sviluppatore",
    iniziali: "SV",
  });
});

beforeEach(() => {
  for (const t of ["richieste_gdpr", "album_assenze", "foto", "album", "iscrizioni", "ragazzi"]) {
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

/*
 * Nota sul seme: `creaAlbum` materializza i tredici album dimostrativi, che
 * nascono **già pubblicati**. Sono nello stesso anno delle iscrizioni di prova,
 * quindi una revoca li ritira insieme a quello sotto esame — correttamente, ed è
 * la ragione per cui queste prove guardano *il proprio* album invece di
 * confrontare l'elenco intero.
 */

/** Un album, già pubblicato: si arriva con l'UPDATE, come fa l'applicazione. */
async function unAlbumPubblicato(unita = "u1") {
  const slug = await album.creaAlbum(
    { titolo: `Uscita ${unita} ${Math.random()}`, anno: "2026 – 2027", unita, data: "Ottobre 2026", sottotitolo: "", tag: "" },
    1,
    "ref1",
  );
  const id = await album.idAlbumPerIndirizzo(slug);
  raw.prepare("update album set stato='pubblicato' where id=?").run(id);
  return { slug, id };
}

function conConsenso(nome, cognome, unita = "u1") {
  const id = iscritti.registraIscrizione({ nome, cognome, natoIl: "2017-01-01", unita, anno: ANNO });
  iscritti.registraConsenso(id, true, "2026-09-15");
  return id;
}

const statoDi = (id) => raw.prepare("select stato from album where id=?").get(id).stato;

// =========================================================================

describe("revocare un consenso ritira gli album già online", () => {
  it("l'album pubblicato torna in bozza, e lo dice", async () => {
    const a = await unAlbumPubblicato();
    const giulia = conConsenso("Giulia", "Rossi");
    assert.equal(statoDi(a.id), "pubblicato");

    const esito = iscritti.revocaConsenso(giulia);
    assert.equal(esito.ok, true);
    assert.ok(esito.ritirati.includes(a.slug), esito.ritirati.join(", "));
    assert.equal(statoDi(a.id), "bozza", "non resta online");
    assert.equal(iscritti.iscrittoPerId(giulia).consenso, false);
  });

  it("la revoca e il ritiro stanno o cadono insieme", async () => {
    /*
     * Non si può far fallire il ritiro a metà da un test, ma si può verificare
     * l'invariante che rende quel caso innocuo: dopo la revoca **non esiste**
     * uno stato in cui il consenso è a zero e l'album è ancora pubblicato.
     */
    await unAlbumPubblicato();
    const giulia = conConsenso("Giulia", "Rossi");
    iscritti.revocaConsenso(giulia);

    const storti = raw
      .prepare(
        `select count(*) n from album al
           join iscrizioni i on i.anno_id = al.anno_id
                            and (al.unita_id is null or i.unita_id = al.unita_id)
          where al.stato = 'pubblicato' and i.consenso_immagini = 0
            and i.id not in (select iscrizione_id from album_assenze where album_id = al.id)`,
      )
      .get().n;
    assert.equal(storti, 0);
  });

  it("non ritira quelli da cui la persona è dichiarata assente", async () => {
    const a = await unAlbumPubblicato();
    const giulia = conConsenso("Giulia", "Rossi");
    iscritti.dichiaraAssenza(a.id, giulia, idUtente);

    const esito = iscritti.revocaConsenso(giulia);
    assert.equal(esito.ritirati.includes(a.slug), false, "era già dichiarata assente");
    assert.equal(statoDi(a.id), "pubblicato", "resta online, ed è corretto");
  });

  it("non ritira quelli di un'altra unità", async () => {
    const u1 = await unAlbumPubblicato("u1");
    const u4 = await unAlbumPubblicato("u4");
    const giulia = conConsenso("Giulia", "Rossi", "u1");

    const esito = iscritti.revocaConsenso(giulia);
    assert.ok(esito.ritirati.includes(u1.slug));
    assert.equal(esito.ritirati.includes(u4.slug), false, "l'unità 4 non c'entra");
    assert.equal(statoDi(u4.id), "pubblicato");
  });

  it("ritira anche quelli di gruppo: comprendono tutte le unità", async () => {
    const gruppo = await unAlbumPubblicato("gruppo");
    const giulia = conConsenso("Giulia", "Rossi", "u1");

    assert.ok(iscritti.revocaConsenso(giulia).ritirati.includes(gruppo.slug));
    assert.equal(statoDi(gruppo.id), "bozza");
  });

  it("non ritira quelli di un altro anno", async () => {
    const a = await unAlbumPubblicato();
    // l'iscrizione è dell'anno scorso: l'album di quest'anno non la riguarda
    const id = iscritti.registraIscrizione({
      nome: "Giulia", cognome: "Rossi", natoIl: "2017-01-01",
      unita: "u1", anno: "2025-2026",
    });
    iscritti.registraConsenso(id, true, "2025-09-15");

    assert.equal(iscritti.revocaConsenso(id).ritirati.includes(a.slug), false);
    assert.equal(statoDi(a.id), "pubblicato", "l'album di quest'anno non la riguarda");
  });

  it("non ritira le bozze e le revisioni: non sono online", async () => {
    const slug = await album.creaAlbum(
      { titolo: "Bozza", anno: "2026 – 2027", unita: "u1", data: "Ottobre 2026", sottotitolo: "", tag: "" },
      1, "ref1",
    );
    await album.cambiaStatoAlbum(slug, "in-revisione", 0, "ref1");
    const giulia = conConsenso("Giulia", "Rossi");

    assert.equal(iscritti.revocaConsenso(giulia).ritirati.includes(slug), false);
    assert.equal((await album.albumPerIndirizzo(slug)).stato, "in-revisione");
  });

  it("su un'iscrizione che non esiste non fa niente", () => {
    assert.deepEqual(iscritti.revocaConsenso(999999), { ok: false, ritirati: [] });
  });
});

describe("il controllo di conformità non si fida di nessun percorso", () => {
  it("trova un album pubblicato con SQL a mano che viola la regola", async () => {
    const a = await unAlbumPubblicato();
    const giulia = conConsenso("Giulia", "Rossi");

    assert.deepEqual(iscritti.albumNonConformi(), [], "adesso è conforme");


    // si revoca **a mano**, saltando `revocaConsenso`: è il caso che il ritiro
    // automatico non può coprire, e la ragione per cui questo controllo esiste
    raw.prepare("update iscrizioni set consenso_immagini=0, consenso_data=null where id=?").run(giulia);

    const fuori = iscritti.albumNonConformi();
    const mio = fuori.find((x) => x.slug === a.slug);
    assert.ok(mio, `non trovato fra ${fuori.length} non conformi`);
    assert.deepEqual(mio.nomi, ["Rossi Giulia"]);
    assert.equal(statoDi(a.id), "pubblicato", "è ancora online: il controllo segnala, non ritira");
  });

  it("una dichiarazione di assenza lo rende conforme di nuovo", async () => {
    const a = await unAlbumPubblicato();
    const giulia = conConsenso("Giulia", "Rossi");
    raw.prepare("update iscrizioni set consenso_immagini=0, consenso_data=null where id=?").run(giulia);
    const prima = iscritti.albumNonConformi();
    assert.ok(prima.some((x) => x.slug === a.slug));

    iscritti.dichiaraAssenza(a.id, giulia, idUtente);
    assert.equal(
      iscritti.albumNonConformi().some((x) => x.slug === a.slug),
      false,
      "dichiarata assente: quest'album è di nuovo conforme",
    );
  });

  it("con tutto in ordine dice zero, ed è quello che deve dire quasi sempre", async () => {
    await unAlbumPubblicato();
    conConsenso("Giulia", "Rossi");
    assert.deepEqual(iscritti.albumNonConformi(), []);
  });
});

describe("il registro delle richieste", () => {
  it("una richiesta nasce «ricevuta», con la data di arrivo", () => {
    const id = gdpr.apri("2026-11-05", "cancellazione", "Chiedono di cancellare le foto.", idUtente);
    const r = gdpr.perId(id);
    assert.equal(r.stato, "ricevuta");
    assert.equal(r.arrivataIl, "2026-11-05");
    assert.equal(r.apertaDa, "sviluppatore");
    assert.equal(r.chiusaIl, null);
  });

  it("i giorni si contano dall'arrivo, non dalla registrazione", () => {
    const vecchia = gdpr.apri("2026-01-01", "accesso", "Vogliono sapere che dati abbiamo.", idUtente);
    // la riga è stata scritta adesso, ma la richiesta è arrivata a gennaio: è
    // quella la data da cui decorre il mese dell'art. 12
    assert.ok(gdpr.perId(vecchia).giorni > 200, gdpr.perId(vecchia).giorni);
  });

  it("chiudere valorizza la data, riaprire la azzera", () => {
    const id = gdpr.apri("2026-11-05", "rettifica", "Cognome sbagliato.", idUtente);
    assert.equal(gdpr.cambiaStato(id, "eseguita"), true);
    assert.ok(gdpr.perId(id).chiusaIl);

    assert.equal(gdpr.cambiaStato(id, "in_corso"), true);
    assert.equal(gdpr.perId(id).chiusaIl, null, "una riaperta non ha una data di chiusura");
  });

  it("un diritto o uno stato inventati si rifiutano", () => {
    assert.throws(() => gdpr.apri("2026-11-05", "telepatia", "x", idUtente), /Diritto non valido/);
    const id = gdpr.apri("2026-11-05", "accesso", "x", idUtente);
    assert.throws(() => gdpr.cambiaStato(id, "archiviata"), /Stato non valido/);
    // e lo rifiuta anche il database, non solo il codice
    assert.throws(() =>
      raw.prepare("update richieste_gdpr set stato='archiviata' where id=?").run(id),
    );
  });

  it("una data mal scritta si rifiuta", () => {
    assert.throws(() => gdpr.apri("05/11/2026", "accesso", "x", idUtente), /Data non valida/);
  });

  it("una data che non esiste nel calendario si rifiuta (report QA, BUG-009)", () => {
    assert.throws(() => gdpr.apri("2026-02-31", "accesso", "x", idUtente), /Data non valida/);
    assert.throws(() => gdpr.apri("2026-13-01", "accesso", "x", idUtente), /Data non valida/);
    assert.equal(gdpr.elenco().length, 0);
  });

  it("una descrizione oltre il tetto si rifiuta (report QA, BUG-008)", async () => {
    const { DESCRIZIONE_GDPR_MAX } = await import("@/lib/contenuti");
    assert.throws(
      () => gdpr.apri("2026-10-06", "accesso", "S".repeat(DESCRIZIONE_GDPR_MAX + 1), idUtente),
      /troppo lunga/,
    );
    gdpr.apri("2026-10-06", "accesso", "S".repeat(DESCRIZIONE_GDPR_MAX), idUtente);
    assert.equal(gdpr.elenco().length, 1);
  });

  it("i conteggi separano aperte, in ritardo ed eseguite", () => {
    gdpr.apri("2026-11-05", "accesso", "Recente.", idUtente);
    gdpr.apri("2026-01-01", "cancellazione", "Vecchia e aperta.", idUtente);
    const fatta = gdpr.apri("2026-02-01", "rettifica", "Fatta.", idUtente);
    gdpr.cambiaStato(fatta, "eseguita");

    const c = gdpr.conteggi();
    assert.equal(c.totale, 3);
    assert.equal(c.aperte, 2);
    assert.equal(c.eseguite, 1);
    assert.equal(c.inRitardo, 1, "solo quella di gennaio è oltre il mese");
  });

  it("le più recenti vengono per prime", () => {
    gdpr.apri("2026-01-01", "accesso", "Vecchia.", idUtente);
    gdpr.apri("2026-11-05", "accesso", "Nuova.", idUtente);
    assert.deepEqual(
      gdpr.elenco().map((r) => r.descrizione),
      ["Nuova.", "Vecchia."],
    );
  });

  it("`soloAperte` lascia fuori le chiuse", () => {
    const a = gdpr.apri("2026-11-05", "accesso", "Aperta.", idUtente);
    const b = gdpr.apri("2026-11-05", "accesso", "Chiusa.", idUtente);
    gdpr.cambiaStato(b, "respinta");
    assert.deepEqual(gdpr.elenco(true).map((r) => r.id), [a]);
  });

  it("cancellare una riga la cancella davvero", () => {
    const id = gdpr.apri("2026-11-05", "accesso", "Sbagliata.", idUtente);
    assert.equal(gdpr.elimina(id), true);
    assert.equal(raw.prepare("select count(*) n from richieste_gdpr").get().n, 0);
    assert.equal(gdpr.elimina(id), false);
  });

  it("cancellato l'account, la richiesta resta senza autore invece di sparire", () => {
    const id = gdpr.apri("2026-11-05", "accesso", "Da conservare.", idUtente);
    const altro = utenti.creaUtente({
      utente: "temporaneo", ruolo: "sviluppatore", nome: "T", iniziali: "TT",
    });
    const secondo = gdpr.apri("2026-11-06", "accesso", "Aperta dal temporaneo.", altro);

    raw.prepare("delete from utenti where id=?").run(altro);
    assert.equal(gdpr.perId(secondo).apertaDa, null, "ON DELETE SET NULL");
    assert.ok(gdpr.perId(secondo), "la richiesta però c'è ancora");
    assert.equal(gdpr.perId(id).apertaDa, "sviluppatore");
  });

  it("ogni diritto ha un'etichetta, e ogni stato pure", () => {
    for (const d of gdpr.DIRITTI) assert.ok(gdpr.ETICHETTA_DIRITTO[d], d);
    for (const s of gdpr.STATI) assert.ok(gdpr.ETICHETTA_STATO[s], s);
  });
});
