import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * `lib/permessi-store.ts` su SQLite — passo 2B.1.
 *
 * La prova che conta non è «le query funzionano» ma **il contratto è lo stesso**:
 * ciò che i tre consumer ricevevano dal JSON devono continuare a riceverlo dalla
 * tabella, forma e ordine compresi. Per questo il riferimento di ogni lettura è
 * `FUNZIONI_INIZIALI`, che era il seme dell'archivio su file.
 */

let cartella;
let percorso;
let store;
let FUNZIONI_INIZIALI, RUOLI_MATRICE;
let ErroreDatabase;
let chiudiPerTest;
let raw;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-permessi-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/permessi-store");
  ({ FUNZIONI_INIZIALI, RUOLI_MATRICE } = await import("@/lib/permessi"));
  ({ ErroreDatabase } = await import("@/lib/db/errori"));
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

/** Ogni prova parte dalla tabella vuota: è lo stato di un'installazione nuova. */
beforeEach(() => {
  raw.prepare("DELETE FROM permessi").run();
});

const RUOLI = () => RUOLI_MATRICE.map((r) => r.chiave);
const conteggio = () => raw.prepare("SELECT count(*) n FROM permessi").get().n;

// --------------------------------------------------------------------------

describe("lettura — stesso risultato del JSON", () => {
  it("a tabella vuota restituisce il seme, come faceva il file assente", async () => {
    const m = await store.leggiMatrice();
    assert.deepEqual(m, FUNZIONI_INIZIALI);
  });

  it("leggere NON scrive: il seme si materializza solo alla prima modifica", async () => {
    await store.leggiMatrice();
    assert.equal(conteggio(), 0, "una lettura che scrive non funzionerebbe in compilazione");
  });

  it("dopo la materializzazione il risultato è identico al seme", async () => {
    // una modifica qualunque materializza le trenta righe
    await store.impostaLivello("album-carica", "sviluppatore", "completo");
    assert.equal(conteggio(), FUNZIONI_INIZIALI.length * RUOLI().length);

    const m = await store.leggiMatrice();
    assert.equal(m.length, FUNZIONI_INIZIALI.length);
    assert.deepEqual(
      m.map((f) => f.id),
      FUNZIONI_INIZIALI.map((f) => f.id),
      "l'ordine è quello di FUNZIONI_INIZIALI, non alfabetico",
    );
    for (const atteso of FUNZIONI_INIZIALI) {
      const trovata = m.find((f) => f.id === atteso.id);
      assert.equal(trovata.nome, atteso.nome);
      for (const r of RUOLI()) {
        assert.equal(trovata.livelli[r], atteso.livelli[r], `${atteso.id}/${r}`);
      }
    }
  });

  it("l'ordine è stabile fra letture successive", async () => {
    await store.ripristinaMatrice();
    const a = (await store.leggiMatrice()).map((f) => f.id);
    const b = (await store.leggiMatrice()).map((f) => f.id);
    assert.deepEqual(a, b);
    assert.deepEqual(a, FUNZIONI_INIZIALI.map((f) => f.id));
  });

  it("un ruolo senza riga vale «nessuno», non un permesso aperto", async () => {
    await store.ripristinaMatrice();
    raw.prepare("DELETE FROM permessi WHERE funzione = ? AND ruolo = ?").run("documenti", "gestore");
    const f = (await store.leggiMatrice()).find((x) => x.id === "documenti");
    assert.equal(f.livelli["gestore"], "nessuno");
  });
});

describe("impostaLivello", () => {
  it("scrive e si rilegge", async () => {
    // una cella che il tetto del ruolo lascia aprire: `album-pubblica` per il
    // referente di unità non lo è più (pubblica chi controlla i consensi, `tetto()`)
    assert.equal(await store.impostaLivello("unita-anagrafica", "referente", "limitato"), true);
    const f = (await store.leggiMatrice()).find((x) => x.id === "unita-anagrafica");
    assert.equal(f.livelli["referente"], "limitato");
  });

  it("tocca una cella sola", async () => {
    await store.impostaLivello("album-pubblica", "referente", "limitato");
    const m = await store.leggiMatrice();
    const f = m.find((x) => x.id === "album-pubblica");
    const atteso = FUNZIONI_INIZIALI.find((x) => x.id === "album-pubblica");
    assert.equal(f.livelli["sviluppatore"], atteso.livelli["sviluppatore"]);
    assert.equal(f.livelli["gestore"], atteso.livelli["gestore"]);
  });

  it("su una funzione che non esiste restituisce false, senza sollevare", async () => {
    assert.equal(await store.impostaLivello("non-esiste", "sviluppatore", "completo"), false);
  });

  it("un livello fuori elenco è rifiutato dal CHECK e arriva come ErroreDatabase", async () => {
    await store.ripristinaMatrice();
    await assert.rejects(
      () => store.impostaLivello("documenti", "sviluppatore", "quasi-completo"),
      (e) => {
        assert.ok(e instanceof ErroreDatabase);
        assert.equal(e.codice, "DATI_NON_VALIDI");
        return true;
      },
    );
  });
});

describe("aggiungiFunzione", () => {
  it("crea le tre righe, tutte a «nessuno», in coda", async () => {
    await store.ripristinaMatrice();
    assert.equal(await store.aggiungiFunzione("Esportare i consensi", "esporta-consensi"), true);

    const m = await store.leggiMatrice();
    assert.equal(m.length, FUNZIONI_INIZIALI.length + 1);
    assert.equal(m.at(-1).id, "esporta-consensi", "in coda, non in mezzo");
    for (const r of RUOLI()) assert.equal(m.at(-1).livelli[r], "nessuno");
  });

  it("un id già preso restituisce false e non tocca niente", async () => {
    await store.ripristinaMatrice();
    const prima = conteggio();
    assert.equal(await store.aggiungiFunzione("Altro nome", "documenti"), false);
    assert.equal(conteggio(), prima);
  });

  it("su tabella vuota materializza il seme e poi aggiunge", async () => {
    assert.equal(conteggio(), 0);
    assert.equal(await store.aggiungiFunzione("Nuova", "nuova"), true);
    const m = await store.leggiMatrice();
    assert.equal(m.length, FUNZIONI_INIZIALI.length + 1);
  });
});

describe("togliFunzione", () => {
  it("porta via tutte e tre le righe", async () => {
    await store.ripristinaMatrice();
    assert.equal(await store.togliFunzione("backup"), true);
    const m = await store.leggiMatrice();
    assert.ok(!m.some((f) => f.id === "backup"));
    assert.equal(
      raw.prepare("SELECT count(*) n FROM permessi WHERE funzione = ?").get("backup").n,
      0,
    );
  });

  it("su una funzione che non esiste restituisce false", async () => {
    await store.ripristinaMatrice();
    assert.equal(await store.togliFunzione("mai-esistita"), false);
  });
});

describe("ripristinaMatrice", () => {
  it("riporta esattamente al seme, cancellando le aggiunte", async () => {
    await store.aggiungiFunzione("Da buttare", "da-buttare");
    await store.impostaLivello("documenti", "sviluppatore", "nessuno");

    await store.ripristinaMatrice();

    const m = await store.leggiMatrice();
    assert.deepEqual(m, FUNZIONI_INIZIALI);
    assert.equal(conteggio(), FUNZIONI_INIZIALI.length * RUOLI().length);
  });
});

describe("vincoli e integrità", () => {
  it("una coppia (funzione, ruolo) non può ripetersi", async () => {
    await store.ripristinaMatrice();
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO permessi (funzione, nome, ruolo, livello, ordine) VALUES (?,?,?,?,?)")
          .run("documenti", "Documenti", "sviluppatore", "completo", 0),
      /UNIQUE constraint failed/,
    );
  });

  it("un ruolo inventato è rifiutato dal database", async () => {
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO permessi (funzione, nome, ruolo, livello, ordine) VALUES (?,?,?,?,?)")
          .run("x", "X", "referente-supremo", "completo", 0),
      /CHECK constraint failed/,
    );
  });

  it("un ordine negativo è rifiutato", async () => {
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO permessi (funzione, nome, ruolo, livello, ordine) VALUES (?,?,?,?,?)")
          .run("y", "Y", "sviluppatore", "completo", -1),
      /CHECK constraint failed/,
    );
  });
});

describe("gli errori non portano SQL fuori dallo store", () => {
  it("il messaggio dell'ErroreDatabase è quello scritto da noi", async () => {
    await store.ripristinaMatrice();
    const e = await store
      .impostaLivello("documenti", "sviluppatore", "livello-inventato")
      .then(() => null, (err) => err);

    assert.ok(e instanceof ErroreDatabase);
    const testo = `${e.message} ${e.codice}`;
    for (const proibito of ["update", "insert", "select", "permessi", "livello-inventato", "SQLITE_", "constraint"]) {
      assert.ok(
        !testo.toLowerCase().includes(proibito.toLowerCase()),
        `«${proibito}» non deve comparire in ciò che esce dallo store: ${testo}`,
      );
    }
  });
});
