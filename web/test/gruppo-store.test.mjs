import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * `lib/gruppo.ts` su `pagine_testi` — passo 2B.3.
 *
 * La proprietà da non perdere è che si conservano **solo le differenze** dai
 * valori predefiniti: una chiave assente significa «usa quello di `lib/data.ts`».
 * È ciò che permette di correggere un recapito nel codice e vederlo comparire a
 * chi non l'ha personalizzato.
 */

let cartella;
let cartellaDati;
let percorso;
let store;
let IDENTITA_PREDEFINITA, MARCHIO_PREDEFINITO, CAMPI_RECAPITI;
let ErroreDatabase;
let chiudiPerTest;
let raw;

/** Un PNG minimo valido: firma + IHDR con misure vere. */
function pngFinto(larghezza, altezza) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(larghezza, 16);
  b.writeUInt32BE(altezza, 20);
  return b;
}

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-gruppo-"));
  cartellaDati = join(cartella, "dati");
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = cartellaDati;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/gruppo");
  ({ IDENTITA_PREDEFINITA, MARCHIO_PREDEFINITO, CAMPI_RECAPITI } = await import("@/lib/identita"));
  ({ ErroreDatabase } = await import("@/lib/db/errori"));
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

beforeEach(() => {
  raw.prepare("DELETE FROM pagine_testi").run();
});

const righe = () =>
  raw.prepare("SELECT chiave, valore FROM pagine_testi ORDER BY chiave").all();

const fileMarchioSuDisco = () => {
  try {
    return readdirSync(cartellaDati).filter((f) => f.startsWith("marchio-")).sort();
  } catch {
    return [];
  }
};

// --------------------------------------------------------------------------

describe("lettura", () => {
  it("a database vuoto restituisce esattamente i valori predefiniti", async () => {
    const i = await store.leggiIdentita();
    assert.deepEqual(i, IDENTITA_PREDEFINITA);
  });

  it("leggere non scrive niente", async () => {
    await store.leggiIdentita();
    assert.equal(righe().length, 0);
  });

  it("una chiave sconosciuta non disturba la lettura", async () => {
    raw
      .prepare("INSERT INTO pagine_testi (chiave, valore) VALUES (?,?)")
      .run("gruppo.chiave-che-non-conosciamo", "boh");
    const i = await store.leggiIdentita();
    assert.equal(i.nome, IDENTITA_PREDEFINITA.nome);
  });

  it("le chiavi di altre pagine non finiscono nell'identità", async () => {
    raw
      .prepare("INSERT INTO pagine_testi (chiave, valore) VALUES (?,?)")
      .run("chi-siamo.storia", "un testo lungo");
    const i = await store.leggiIdentita();
    assert.deepEqual(i, IDENTITA_PREDEFINITA);
  });
});

describe("salvaTesti", () => {
  it("scrive nome e sottotitolo, e si rileggono", async () => {
    await store.salvaTesti("Gruppo Esempio 9", "Un altro sottotitolo");
    const i = await store.leggiIdentita();
    assert.equal(i.nome, "Gruppo Esempio 9");
    assert.equal(i.sottotitolo, "Un altro sottotitolo");
  });

  it("scrive SOLO le differenze: due righe, non nove", async () => {
    await store.salvaTesti("Nome nuovo", "Sottotitolo nuovo");
    assert.equal(righe().length, 2);
    assert.deepEqual(
      righe().map((r) => r.chiave),
      ["gruppo.nome", "gruppo.sottotitolo"],
    );
  });

  it("i recapiti restano quelli predefiniti", async () => {
    await store.salvaTesti("Nome nuovo", "Sottotitolo nuovo");
    const i = await store.leggiIdentita();
    for (const { chiave } of CAMPI_RECAPITI) {
      assert.equal(i[chiave], IDENTITA_PREDEFINITA[chiave], chiave);
    }
  });

  it("un nome vuoto torna al predefinito; un sottotitolo vuoto resta vuoto", async () => {
    await store.salvaTesti("Nome nuovo", "Sottotitolo");
    await store.salvaTesti("", "");
    const i = await store.leggiIdentita();
    assert.equal(i.nome, IDENTITA_PREDEFINITA.nome);
    // il modulo dice «si può lasciare vuota»: tornare al predefinito non lo rispettava
    assert.equal(i.sottotitolo, "");
  });

  it("salvare due volte aggiorna la riga, non la duplica", async () => {
    await store.salvaTesti("Primo", "A");
    await store.salvaTesti("Secondo", "B");
    assert.equal(righe().length, 2);
    assert.equal((await store.leggiIdentita()).nome, "Secondo");
  });
});

describe("salvaRecapiti", () => {
  it("scrive tutti e sette i campi e li rilegge", async () => {
    const recapiti = {};
    for (const { chiave } of CAMPI_RECAPITI) recapiti[chiave] = `valore-${chiave}`;
    await store.salvaRecapiti(recapiti);

    const i = await store.leggiIdentita();
    for (const { chiave } of CAMPI_RECAPITI) {
      assert.equal(i[chiave], `valore-${chiave}`, chiave);
    }
    assert.equal(righe().length, CAMPI_RECAPITI.length);
  });

  it("un recapito facoltativo salvato vuoto resta vuoto; l'email vuota torna al predefinito", async () => {
    const recapiti = {};
    for (const { chiave } of CAMPI_RECAPITI) recapiti[chiave] = `valore-${chiave}`;
    recapiti.indirizzo = "";
    recapiti.telefonoGestori = "";
    recapiti.email = "";
    await store.salvaRecapiti(recapiti);

    const i = await store.leggiIdentita();
    assert.equal(i.indirizzo, "", "togliere l'indirizzo lo toglie davvero");
    assert.equal(i.telefonoGestori, "");
    assert.equal(i.citta, "valore-citta");
    assert.equal(i.email, IDENTITA_PREDEFINITA.email, "è obbligatoria: mai vuota sul sito");
  });

  it("senza indirizzo e senza città la sede è una stringa vuota", async () => {
    const { sede } = await import("@/lib/identita");
    assert.equal(sede({ indirizzo: "", citta: "" }), "");
    assert.equal(sede({ indirizzo: "Via Roma 1", citta: "" }), "Via Roma 1");
    assert.equal(sede({ indirizzo: "", citta: "00100 Città di Esempio" }), "00100 Città di Esempio");
    assert.equal(sede({ indirizzo: "Via Roma 1", citta: "00100 Città di Esempio" }), "Via Roma 1, 00100 Città di Esempio");
  });

  it("nome e sottotitolo restano quelli predefiniti", async () => {
    const recapiti = {};
    for (const { chiave } of CAMPI_RECAPITI) recapiti[chiave] = "x@y.it";
    await store.salvaRecapiti(recapiti);
    const i = await store.leggiIdentita();
    assert.equal(i.nome, IDENTITA_PREDEFINITA.nome);
  });
});

describe("marchio", () => {
  it("a database vuoto è quello consegnato con il sito", async () => {
    assert.deepEqual((await store.leggiIdentita()).marchio, MARCHIO_PREDEFINITO);
  });

  it("salvaMarchio scrive il file, le quattro chiavi, e si rilegge", async () => {
    await store.salvaMarchio(pngFinto(277, 278), "image/png", { larghezza: 277, altezza: 278 }, 1234);

    const i = await store.leggiIdentita();
    assert.equal(i.marchio.src, "/marchio/marchio-1234.png");
    assert.equal(i.marchio.larghezza, 277);
    assert.equal(i.marchio.altezza, 278);
    assert.deepEqual(fileMarchioSuDisco(), ["marchio-1234.png"]);
  });

  it("le misure sono numeri e non «277.0»", async () => {
    await store.salvaMarchio(pngFinto(277, 278), "image/png", { larghezza: 277, altezza: 278 }, 1235);
    const salvata = raw
      .prepare("SELECT valore FROM pagine_testi WHERE chiave = 'gruppo.marchio.larghezza'")
      .get();
    assert.equal(salvata.valore, "277", "il driver lega i numeri come REAL: la stringa la costruiamo noi");
    assert.equal(typeof (await store.leggiIdentita()).marchio.larghezza, "number");
  });

  it("un secondo caricamento porta via il file precedente", async () => {
    await store.salvaMarchio(pngFinto(100, 100), "image/png", { larghezza: 100, altezza: 100 }, 1000);
    await store.salvaMarchio(pngFinto(200, 200), "image/png", { larghezza: 200, altezza: 200 }, 2000);
    assert.deepEqual(fileMarchioSuDisco(), ["marchio-2000.png"], "ne resta uno solo");
    assert.equal((await store.leggiIdentita()).marchio.src, "/marchio/marchio-2000.png");
  });

  it("fileMarchio serve solo il marchio registrato", async () => {
    await store.salvaMarchio(pngFinto(50, 60), "image/png", { larghezza: 50, altezza: 60 }, 3000);

    const buono = await store.fileMarchio("marchio-3000.png");
    assert.ok(buono);
    assert.equal(buono.tipo, "image/png");
    assert.ok(Buffer.isBuffer(buono.dati));

    // un altro file esiste sul disco ma non è il marchio: non va servito
    writeFileSync(join(cartellaDati, "altro-file.png"), pngFinto(10, 10));
    assert.equal(await store.fileMarchio("altro-file.png"), null);
    assert.equal(await store.fileMarchio("marchio-9999.png"), null);
  });

  it("rimuoviMarchio torna al predefinito e ripulisce il disco", async () => {
    await store.salvaMarchio(pngFinto(80, 80), "image/png", { larghezza: 80, altezza: 80 }, 4000);
    await store.rimuoviMarchio();

    assert.deepEqual((await store.leggiIdentita()).marchio, MARCHIO_PREDEFINITO);
    assert.deepEqual(fileMarchioSuDisco(), []);
    assert.equal(
      raw.prepare("SELECT count(*) n FROM pagine_testi WHERE chiave LIKE 'gruppo.marchio%'").get().n,
      0,
    );
  });

  it("un record di marchio incompleto non produce un'immagine senza misure", async () => {
    // solo il file, senza larghezza e altezza: è il caso che farebbe sobbalzare
    // la pagina al caricamento
    raw
      .prepare("INSERT INTO pagine_testi (chiave, valore) VALUES (?,?)")
      .run("gruppo.marchio.file", "marchio-orfano.png");
    assert.deepEqual((await store.leggiIdentita()).marchio, MARCHIO_PREDEFINITO);
  });
});

describe("gli errori non portano SQL fuori dallo store", () => {
  it("un guasto in scrittura arriva come ErroreDatabase con messaggio sicuro", async () => {
    // la colonna `valore` è NOT NULL: si forza il guasto passando undefined
    const recapiti = {};
    for (const { chiave } of CAMPI_RECAPITI) recapiti[chiave] = undefined;

    const e = await store.salvaRecapiti(recapiti).then(() => null, (err) => err);
    assert.ok(e instanceof ErroreDatabase, `atteso ErroreDatabase, ricevuto ${e}`);
    const testo = `${e.message} ${e.codice}`;
    for (const proibito of ["insert", "pagine_testi", "SQLITE_", "constraint", "valore"]) {
      assert.ok(
        !testo.toLowerCase().includes(proibito.toLowerCase()),
        `«${proibito}» non deve uscire dallo store: ${testo}`,
      );
    }
  });
});
