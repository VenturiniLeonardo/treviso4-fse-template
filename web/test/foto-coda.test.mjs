import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import sharp from "sharp";

/**
 * La coda delle derivate — §8 del piano.
 *
 * Le prove che contano sono quelle sui guasti: che cosa resta nella tabella
 * quando il processo muore a metà, e che cosa succede a una fotografia che non
 * si riesce a convertire. La parte che funziona è la parte facile.
 */

let cartella;
let cartellaDati;
let percorso;
let raw;
let album, coda, riferimenti;
let chiudiPerTest;
let LATI, nomeDerivata;

/** Una fotografia vera, con dentro dei metadati da togliere. */
function foto(larghezza = 900, altezza = 600) {
  return sharp({
    create: { width: larghezza, height: altezza, channels: 3, background: "#4a7d55" },
  })
    .withExif({ IFD0: { Model: "telefono di prova" } })
    .jpeg()
    .toBuffer();
}

const suDisco = () => readdirSync(cartellaDati).sort();

const nuovoAlbum = (titolo) => ({
  titolo,
  anno: "2026 – 2027",
  unita: "u1",
  data: "Marzo 2027",
  sottotitolo: "",
  tag: "",
});

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-coda-"));
  cartellaDati = join(cartella, "dati");
  // la crea anche l'archivio alla prima scrittura, ma le prove la leggono prima
  mkdirSync(cartellaDati, { recursive: true });
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = cartellaDati;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  album = await import("@/lib/album");
  coda = await import("@/lib/foto/coda");
  riferimenti = await import("@/lib/db/riferimenti");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  ({ LATI, nomeDerivata } = await import("@/lib/foto/derivate"));

  raw = new Database(percorso);
  riferimenti.assicuraRiferimenti();
});

beforeEach(async () => {
  await coda.attendiCoda(); // nessun residuo fra una prova e l'altra
  for (const t of ["lavori", "foto", "album"]) raw.prepare(`delete from ${t}`).run();
  for (const f of readdirSync(cartellaDati, { withFileTypes: true })) {
    if (f.isFile()) unlinkSync(join(cartellaDati, f.name));
  }
});

after(async () => {
  await coda.attendiCoda();
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

/** Crea un album e ci mette dentro una fotografia. Restituisce il nome del file. */
async function caricaUna(dati) {
  const slug = await album.creaAlbum(nuovoAlbum("Uscita di prova"), 1, "cg");
  const esito = await album.aggiungiFoto(slug, dati ?? (await foto()), "", 1000, "cg");
  assert.equal(esito.ok, true, esito.errore);
  return { slug, file: esito.foto.file };
}

const lavoro = () => raw.prepare("select * from lavori order by id desc limit 1").get();
const rigaFoto = (file) => raw.prepare("select * from foto where file = ?").get(file);

// =========================================================================

describe("il caricamento mette in coda", () => {
  it("nasce un lavoro in attesa insieme alla fotografia", async () => {
    const { file } = await caricaUna();
    const l = lavoro();
    assert.equal(l.tipo, "foto");
    assert.equal(l.foto_id, rigaFoto(file).id);
    // può essere già stata presa: `aggiungiFoto` avvia la coda
    assert.ok(["in_attesa", "in_corso", "fatto"].includes(l.stato), l.stato);
  });

  it("se l'album non esiste non resta nessun lavoro orfano", async () => {
    const esito = await album.aggiungiFoto("mai-esistito", await foto(), "", 1, "cg");
    assert.equal(esito.ok, false);
    assert.equal(raw.prepare("select count(*) n from lavori").get().n, 0);
  });
});

describe("quello che viene rifiutato non lascia niente sul disco", () => {
  /*
   * Il difetto che questa prova blocca è stato trovato caricando davvero
   * un'immagine 9000×7000 dall'area riservata.
   *
   * `aggiungiFoto` scriveva l'originale, inseriva la riga e **metteva in coda
   * la conversione**; solo dopo chi chiamava guardava le misure e, trovandole
   * fuori limite, disfaceva con `togliFoto`. Ma la coda era già partita: riga e
   * originale sparivano, le tre derivate no. Restavano in archivio senza
   * nessuna riga che le nominasse — fotografie di minori fuori da ogni cancello
   * dei consensi, che `npm run db:orfani` avrebbe segnalato solo dopo sette
   * giorni di grazia. Tre file per ogni tentativo.
   *
   * Adesso il limite si applica prima di scrivere. La prova guarda il disco,
   * non il valore di ritorno: è l'unico modo di accorgersi di un file che
   * nessuno ha cancellato.
   */
  it("un'immagine oltre il lato massimo è respinta senza scrivere nulla", async () => {
    const { FOTO_LATO_MAX } = await import("@/lib/contenuti");
    const lato = FOTO_LATO_MAX + 200;
    const enorme = await sharp({
      create: { width: lato, height: 400, channels: 3, background: "#900" },
    })
      .jpeg()
      .toBuffer();

    const slug = await album.creaAlbum(nuovoAlbum("Uscita di prova"), 1, "cg");
    const prima = suDisco();

    const esito = await album.aggiungiFoto(slug, enorme, "", 1000, "cg");
    assert.equal(esito.ok, false, "deve essere rifiutata");
    assert.match(esito.errore, /lato massimo/i, esito.errore);

    // il momento in cui il difetto si vedeva: la coda aveva già lavorato
    await coda.attendiCoda();

    assert.deepEqual(suDisco(), prima, "in archivio non deve comparire nessun file");
    assert.equal(raw.prepare("select count(*) n from foto").get().n, 0, "nessuna riga foto");
    assert.equal(raw.prepare("select count(*) n from lavori").get().n, 0, "nessun lavoro in coda");
  });

  it("un file che non è un'immagine è respinto allo stesso modo", async () => {
    const slug = await album.creaAlbum(nuovoAlbum("Uscita di prova"), 1, "cg");
    const prima = suDisco();

    const esito = await album.aggiungiFoto(slug, Buffer.from("#!/bin/sh\necho ciao\n"), "", 1000, "cg");
    assert.equal(esito.ok, false);

    await coda.attendiCoda();
    assert.deepEqual(suDisco(), prima);
    assert.equal(raw.prepare("select count(*) n from lavori").get().n, 0);
  });
});

describe("lo smaltimento", () => {
  it("scrive le tre derivate e segna la fotografia", async () => {
    const { file } = await caricaUna();
    await coda.attendiCoda();

    for (const lato of LATI) {
      assert.ok(suDisco().includes(nomeDerivata(file, lato)), `manca la ${lato}`);
    }
    assert.ok(suDisco().includes(file), "l'originale resta sul disco");

    const r = rigaFoto(file);
    assert.ok(r.derivate_il, "derivate_il deve essere valorizzata");
    assert.equal(lavoro().stato, "fatto");
    assert.ok(lavoro().finito_il);
  });

  it("né le derivate né l'originale salvato portano i metadati", async () => {
    /*
     * Prima questa prova affermava il contrario sull'originale — «l'originale
     * li ha» — perché era vero: `aggiungiFoto` scriveva il file così come
     * arrivava, e la protezione stava tutta nelle derivate. Ma
     * `/foto-file/[file]` serve l'originale come ripiego quando una derivata
     * manca, e in quella finestra le coordinate del campo uscivano.
     *
     * L'affermazione che il fixture abbia davvero dei metadati serve ancora —
     * senza, la prova passerebbe anche se `sharp` non li avesse mai scritti —
     * ma va fatta sul buffer **prima** del caricamento, che è il solo posto in
     * cui devono esserci.
     */
    const caricato = await foto();
    assert.ok(
      caricato.includes(Buffer.from("telefono di prova")),
      "il fixture deve avere i metadati, altrimenti la prova non prova niente",
    );

    const { file } = await caricaUna(caricato);
    await coda.attendiCoda();

    const { readFileSync } = await import("node:fs");
    const originale = readFileSync(join(cartellaDati, file));
    assert.equal(
      originale.includes(Buffer.from("telefono di prova")),
      false,
      "l'originale salvato non deve portarli: lo serve il ripiego di /foto-file",
    );

    for (const lato of LATI) {
      const d = readFileSync(join(cartellaDati, nomeDerivata(file, lato)));
      assert.equal(d.includes(Buffer.from("telefono di prova")), false, `${lato}`);
      assert.equal((await sharp(d).metadata()).format, "webp");
    }
  });

  it("corregge le misure della fotografia girata di traverso", async () => {
    const piatta = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#4a7d55" },
    })
      .jpeg()
      .toBuffer();
    const girata = await sharp(piatta).withMetadata({ orientation: 6 }).jpeg().toBuffer();

    const { file } = await caricaUna(girata);
    // già al caricamento, non solo dopo la coda: le legge `sharp`
    assert.equal(rigaFoto(file).larghezza, 800);
    assert.equal(rigaFoto(file).altezza, 1200);

    await coda.attendiCoda();
    assert.equal(rigaFoto(file).larghezza, 800);
    assert.equal(rigaFoto(file).altezza, 1200);
  });

  it("ne smaltisce parecchie di fila senza perderne", async () => {
    const slug = await album.creaAlbum(nuovoAlbum("Campo estivo"), 1, "cg");
    const file = [];
    for (let i = 0; i < 6; i++) {
      const e = await album.aggiungiFoto(slug, await foto(400 + i * 10, 300), "", 2000 + i, "cg");
      file.push(e.foto.file);
    }
    await coda.attendiCoda();

    assert.equal(raw.prepare("select count(*) n from lavori where stato='fatto'").get().n, 6);
    for (const f of file) assert.ok(suDisco().includes(nomeDerivata(f, 400)), f);
  });
});

describe("quando qualcosa va storto", () => {
  it("tre tentativi, poi resta in errore con il motivo", async () => {
    const { file } = await caricaUna();
    await coda.attendiCoda();

    // si porta via l'originale sotto i piedi della coda e si riprova
    unlinkSync(join(cartellaDati, file));
    raw.prepare("update foto set derivate_il = null").run();
    raw.prepare("delete from lavori").run();
    coda.accodaMancanti();

    await coda.attendiCoda();
    const l = lavoro();
    assert.equal(l.stato, "errore");
    assert.equal(l.tentativi, 3, "esattamente tre tentativi, come dice §8");
    assert.match(l.motivo, /non si trova/);
  });

  it("un lavoro in errore non torna in coda da solo", async () => {
    const { file } = await caricaUna();
    await coda.attendiCoda();
    unlinkSync(join(cartellaDati, file));
    raw.prepare("update foto set derivate_il = null").run();
    raw.prepare("delete from lavori").run();
    coda.accodaMancanti();
    await coda.attendiCoda();
    assert.equal(lavoro().stato, "errore");

    // riavvio: `accodaMancanti` non deve riprovare all'infinito una foto rotta
    assert.equal(coda.accodaMancanti(), 0);
    await coda.attendiCoda();
    assert.equal(lavoro().stato, "errore");
  });

  it("riprovare a mano azzera i tentativi — ed è una persona a deciderlo", async () => {
    const { file } = await caricaUna();
    await coda.attendiCoda();
    unlinkSync(join(cartellaDati, file));
    raw.prepare("update foto set derivate_il = null").run();
    raw.prepare("delete from lavori").run();
    coda.accodaMancanti();
    await coda.attendiCoda();

    const falliti = coda.lavoriFalliti();
    assert.equal(falliti.length, 1);
    assert.equal(falliti[0].file, file);
    assert.match(falliti[0].motivo, /non si trova/);

    assert.equal(coda.riprova(falliti[0].id), true);
    await coda.attendiCoda();

    /*
     * Il file manca ancora, quindi rifallisce — ma ha rifatto **tre** tentativi
     * invece di rifiutarsi subito, e questo è già la prova che il contatore era
     * stato azzerato: senza l'azzeramento la prima presa avrebbe provato a
     * scrivere `tentativi = 4`, e il `CHECK` della tabella (0..3) l'avrebbe
     * rifiutata.
     *
     * Leggere il contatore appena dopo `riprova()` non si può: quella chiama
     * `avvia()`, e quando il controllo torna il lavoro può già essere stato
     * preso. Una prova che dipende da chi arriva primo non è una prova.
     */
    assert.equal(lavoro().tentativi, 3);
    assert.equal(lavoro().stato, "errore");
    // che si possa riprovare all'infinito va bene: ci vuole qualcuno che prema
    // il pulsante ogni volta
    assert.equal(coda.riprova(falliti[0].id), true);
  });

  it("con l'album, si riprova solo un lavoro di quell'album (AUTHZ-03)", async () => {
    const { file } = await caricaUna();
    await coda.attendiCoda();
    unlinkSync(join(cartellaDati, file));
    raw.prepare("update foto set derivate_il = null").run();
    raw.prepare("delete from lavori").run();
    coda.accodaMancanti();
    await coda.attendiCoda();

    const fallito = coda.lavoriFalliti()[0];
    const suo = raw
      .prepare("select f.album_id id from lavori l join foto f on f.id = l.foto_id where l.id = ?")
      .get(fallito.id).id;
    assert.equal(coda.riprova(fallito.id, suo + 1000), false, "l'id di un altro album non basta");
    assert.equal(lavoro().stato, "errore");
    assert.equal(coda.riprova(fallito.id, suo), true);
    await coda.attendiCoda();
  });

  it("riprovare un lavoro che non è in errore non fa niente", async () => {
    await caricaUna();
    await coda.attendiCoda();
    assert.equal(lavoro().stato, "fatto");
    assert.equal(coda.riprova(lavoro().id), false);
    assert.equal(coda.riprova(999999), false, "e nemmeno uno che non esiste");
  });

  it("una fotografia rotta non blocca quelle dopo", async () => {
    const slug = await album.creaAlbum(nuovoAlbum("Uscita"), 1, "cg");
    const buona = await album.aggiungiFoto(slug, await foto(), "", 3000, "cg");
    const altra = await album.aggiungiFoto(slug, await foto(500, 400), "", 3001, "cg");
    await coda.attendiCoda();

    // si rompe la prima e si rimettono tutte in coda
    unlinkSync(join(cartellaDati, buona.foto.file));
    raw.prepare("update foto set derivate_il = null").run();
    raw.prepare("delete from lavori").run();
    coda.accodaMancanti();
    await coda.attendiCoda();

    assert.equal(rigaFoto(buona.foto.file).derivate_il, null, "la rotta resta senza");
    assert.ok(rigaFoto(altra.foto.file).derivate_il, "l'altra è passata lo stesso");
  });
});

describe("il riavvio", () => {
  it("i lavori rimasti in corso tornano in attesa", async () => {
    await caricaUna();
    await coda.attendiCoda();
    // si simula un processo morto a metà
    raw.prepare("update lavori set stato='in_corso', tentativi=1, finito_il=null").run();

    assert.equal(coda.riprendiInterrotti(), 1);
    assert.equal(lavoro().stato, "in_attesa");
    assert.equal(lavoro().iniziato_il, null);
  });

  it("senza azzerare i tentativi: una foto che uccide il processo non lo uccide per sempre", async () => {
    await caricaUna();
    await coda.attendiCoda();
    raw.prepare("update lavori set stato='in_corso', tentativi=2").run();

    coda.riprendiInterrotti();
    assert.equal(lavoro().tentativi, 2, "il contatore non riparte da zero");
  });

  it("un lavoro interrotto tre volte va in errore, e la coda non si ferma", async () => {
    // tre riavvii a metà conversione: il caso che fermava tutto sul CHECK
    const prima = await caricaUna();
    await coda.attendiCoda();
    raw.prepare("update lavori set stato='in_corso', tentativi=3, finito_il=null").run();
    raw.prepare("update foto set derivate_il = null").run();

    assert.equal(coda.riprendiInterrotti(), 0, "non torna in attesa");
    assert.equal(lavoro().stato, "errore");
    assert.match(lavoro().motivo, /fermato tre volte/);

    // e la fotografia dopo si converte lo stesso
    const dopo = await caricaUna();
    await coda.attendiCoda();
    assert.ok(rigaFoto(dopo.file).derivate_il, "la coda è andata avanti");
    assert.equal(rigaFoto(prima.file).derivate_il, null);
  });

  it("uno rimasto in attesa con i tentativi finiti si chiude, invece di bloccare", async () => {
    // i database in cui la versione di prima l'ha già rimesso in attesa
    await caricaUna();
    await coda.attendiCoda();
    raw.prepare("update lavori set stato='in_attesa', tentativi=3, finito_il=null").run();
    const bloccato = lavoro().id;

    const dopo = await caricaUna();
    await coda.attendiCoda();
    assert.ok(rigaFoto(dopo.file).derivate_il, "la coda è andata avanti");
    assert.equal(
      raw.prepare("select stato from lavori where id = ?").get(bloccato).stato,
      "errore",
    );
  });

  it("le fotografie senza derivate finiscono in coda da sole", async () => {
    const { file } = await caricaUna();
    await coda.attendiCoda();

    // si simula il caso vero: fotografie caricate prima della fase 7
    raw.prepare("update foto set derivate_il = null").run();
    raw.prepare("delete from lavori").run();
    for (const lato of LATI) unlinkSync(join(cartellaDati, nomeDerivata(file, lato)));

    assert.equal(coda.accodaMancanti(), 1);
    await coda.attendiCoda();
    assert.ok(rigaFoto(file).derivate_il);
    for (const lato of LATI) assert.ok(suDisco().includes(nomeDerivata(file, lato)));
  });

  it("quelle già convertite non ci tornano", async () => {
    await caricaUna();
    await coda.attendiCoda();
    assert.equal(coda.accodaMancanti(), 0);
  });
});

describe("la cancellazione", () => {
  it("cancellarla dal cestino porta via anche le sue derivate", async () => {
    const { slug, file } = await caricaUna();
    await coda.attendiCoda();
    assert.equal(suDisco().length, 4, "originale più tre derivate");

    // togliere la mette nel cestino: sul disco resta tutto (A-1)
    assert.equal(await album.togliFoto(slug, file, 0, "cg"), true);
    assert.equal(suDisco().length, 4, "nel cestino i file restano");

    assert.equal(await album.cancellaDalCestino(slug, file), true);
    assert.deepEqual(suDisco(), [], "non resta niente sul disco");
  });

  it("eliminare l'album porta via tutto", async () => {
    const { slug } = await caricaUna();
    await coda.attendiCoda();
    assert.equal(await album.eliminaAlbum(slug, "cg"), true);
    assert.deepEqual(suDisco(), []);
    // e i lavori cadono con la fotografia: è il CASCADE
    assert.equal(raw.prepare("select count(*) n from lavori").get().n, 0);
  });
});

describe("l'avanzamento a schermo", () => {
  it("conta i lavori per stato", async () => {
    await caricaUna();
    await coda.attendiCoda();
    const s = coda.statoCoda();
    assert.equal(s.inAttesa, 0);
    assert.equal(s.inCorso, 0);
    assert.equal(s.errore, 0);
  });
});
