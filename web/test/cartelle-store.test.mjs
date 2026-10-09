import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * `lib/cartelle-store.ts` — le cartelle della pagina Documenti, dalla 0012.
 *
 * Le sei di partenza le scrive la migrazione; ogni prova riparte da lì,
 * togliendo quello che le prove precedenti hanno aggiunto.
 */

let cartella;
let store;
let documenti;
let titoloDaNomeFile;
let chiudiPerTest;
let raw;

const PARTENZA = ["iscrizioni", "autorizzazioni", "campi", "quote", "statuti", "circolari"];

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-cartelle-"));
  const percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = join(cartella, "dati");

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/cartelle-store");
  documenti = await import("@/lib/documenti-store");
  ({ titoloDaNomeFile } = await import("@/lib/contenuti"));
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
  raw.prepare("DELETE FROM documenti").run();
  raw
    .prepare(`DELETE FROM cartelle WHERE chiave NOT IN (${PARTENZA.map(() => "?").join(",")})`)
    .run(...PARTENZA);
  // l'ordine di partenza, anche dopo una prova che l'ha cambiato
  PARTENZA.forEach((c, i) => {
    raw.prepare("UPDATE cartelle SET ordine = ? WHERE chiave = ?").run(i + 1, c);
  });
});

const chiavi = async () => (await store.leggiCartelle()).map((c) => c.chiave);

// --------------------------------------------------------------------------

describe("lettura", () => {
  it("le sei di partenza, nell'ordine della migrazione e con i nomi di CATEGORIE_DOC", async () => {
    const c = await store.leggiCartelle();
    assert.deepEqual(
      c.map((x) => x.chiave),
      PARTENZA,
    );
    assert.equal(c.find((x) => x.chiave === "campi").titolo, "Label 3");
    assert.equal(c[0].descrizione, "");
  });

  it("cartellaPerChiave trova e restituisce undefined se manca", async () => {
    assert.equal((await store.cartellaPerChiave("quote")).titolo, "Label 4");
    assert.equal(await store.cartellaPerChiave("tesseramenti"), undefined);
  });
});

describe("creaCartella", () => {
  it("l'indirizzo viene dal nome, e la cartella va in fondo", async () => {
    const esito = await store.creaCartella(
      { titolo: "Campi estivi", descrizione: "Autorizzazioni e liste del campo." },
      "gestori",
    );
    assert.deepEqual(esito, { ok: true, chiave: "campi-estivi" });

    const c = await store.leggiCartelle();
    assert.equal(c.at(-1).chiave, "campi-estivi");
    assert.equal(c.at(-1).descrizione, "Autorizzazioni e liste del campo.");
  });

  it("accenti e apostrofi non finiscono nell'indirizzo", async () => {
    const esito = await store.creaCartella({ titolo: "Attività d’Unità", descrizione: "" }, "cg");
    assert.equal(esito.chiave, "attivita-dunita");
  });

  it("un nome che dà un indirizzo già preso è rifiutato, e il messaggio nomina l'altra", async () => {
    // «Campi» è /documenti/campi, l'indirizzo della cartella di partenza «Label 3»
    const esito = await store.creaCartella({ titolo: "Campi", descrizione: "" }, "cg");
    assert.equal(esito.ok, false);
    assert.equal(esito.campo, "titolo");
    assert.match(esito.errore, /Label 3/);
    assert.equal((await chiavi()).length, PARTENZA.length);
  });

  it("un nome senza lettere né cifre non dà un indirizzo, ed è rifiutato", async () => {
    const esito = await store.creaCartella({ titolo: "— !! —", descrizione: "" }, "cg");
    assert.equal(esito.ok, false);
    assert.equal(esito.campo, "titolo");
  });

  it("un nome lungo dà un indirizzo di cinquanta caratteri al più, senza trattino in coda", () => {
    const k = store.chiaveDaTitolo(
      "Documenti per il campo estivo di reparto e per le uscite di squadra dell'anno",
    );
    assert.ok(k.length <= 50, k);
    assert.ok(!k.endsWith("-"), k);
  });
});

describe("modificaCartella", () => {
  it("cambia nome e descrizione, e l'indirizzo resta quello", async () => {
    assert.equal(
      await store.modificaCartella("campi", { titolo: "Campi estivi", descrizione: "Tutto il campo." }, "cg"),
      true,
    );
    const c = await store.cartellaPerChiave("campi");
    assert.equal(c.titolo, "Campi estivi");
    assert.equal(c.descrizione, "Tutto il campo.");
  });

  it("su una cartella che non esiste restituisce false", async () => {
    assert.equal(await store.modificaCartella("nessuna", { titolo: "x", descrizione: "" }, "cg"), false);
  });
});

describe("spostaCartella", () => {
  it("su e giù di un posto", async () => {
    await store.spostaCartella("quote", "su");
    assert.deepEqual((await chiavi()).slice(0, 4), ["iscrizioni", "autorizzazioni", "quote", "campi"]);
    await store.spostaCartella("iscrizioni", "giu");
    assert.deepEqual((await chiavi()).slice(0, 3), ["autorizzazioni", "iscrizioni", "quote"]);
  });

  it("in cima non sale e in fondo non scende, senza errori", async () => {
    assert.equal(await store.spostaCartella("iscrizioni", "su"), true);
    assert.equal(await store.spostaCartella("circolari", "giu"), true);
    assert.deepEqual(await chiavi(), PARTENZA);
  });

  it("rinumera: con due ordini uguali lo spostamento funziona lo stesso", async () => {
    raw.prepare("UPDATE cartelle SET ordine = 3").run();
    await store.spostaCartella("quote", "su");
    const ordini = raw.prepare("SELECT ordine FROM cartelle ORDER BY ordine").all().map((r) => r.ordine);
    assert.deepEqual(ordini, [1, 2, 3, 4, 5, 6], "di nuovo in fila");
  });

  it("su una cartella che non esiste restituisce false", async () => {
    assert.equal(await store.spostaCartella("nessuna", "su"), false);
  });
});

describe("eliminaCartella", () => {
  it("una cartella nuova e vuota si elimina", async () => {
    await store.creaCartella({ titolo: "Tesseramenti", descrizione: "" }, "cg");
    assert.deepEqual(await store.eliminaCartella("tesseramenti"), { ok: true });
    assert.equal(await store.cartellaPerChiave("tesseramenti"), undefined);
  });

  it("una cartella con dei documenti non si elimina, e il messaggio dice quanti", async () => {
    await store.creaCartella({ titolo: "Tesseramenti", descrizione: "" }, "cg");
    for (const titolo of ["Modulo", "Informativa"]) {
      await documenti.creaDocumento(
        { titolo, anno: null, unita: "gruppo", categoria: "tesseramenti", nota: "" },
        0,
        "cg",
      );
    }
    const esito = await store.eliminaCartella("tesseramenti");
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /2 documenti/);
    assert.ok(await store.cartellaPerChiave("tesseramenti"), "è ancora lì");
  });

  it("le sei di partenza non si eliminano, nemmeno vuote: il sito vi rimanda", async () => {
    for (const chiave of PARTENZA) {
      const esito = await store.eliminaCartella(chiave);
      assert.equal(esito.ok, false, chiave);
      assert.match(esito.errore, /rinominare/);
    }
    assert.deepEqual(await chiavi(), PARTENZA);
  });

  it("una cartella che non esiste è un errore detto", async () => {
    const esito = await store.eliminaCartella("nessuna");
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /non esiste più/);
  });
});

describe("titoloDaNomeFile — funzione pura", () => {
  it("toglie l'estensione e i trattini bassi, e mette la maiuscola", () => {
    assert.equal(titoloDaNomeFile("modulo_tesseramento.pdf"), "Modulo tesseramento");
    assert.equal(titoloDaNomeFile("Scheda sanitaria.PDF"), "Scheda sanitaria");
    assert.equal(titoloDaNomeFile("autorizzazione-campo-estivo.docx"), "Autorizzazione campo estivo");
  });

  it("il trattino di un anno sociale resta", () => {
    assert.equal(
      titoloDaNomeFile("quote-2026-2027.pdf"),
      "Quote 2026-2027",
    );
  });

  it("spazi doppi e trattini ai bordi spariscono", () => {
    assert.equal(titoloDaNomeFile("__lista   materiale--.pdf"), "Lista materiale");
  });

  it("non supera i novanta caratteri del titolo", () => {
    assert.ok(titoloDaNomeFile(`${"a".repeat(200)}.pdf`).length <= 90);
  });
});
