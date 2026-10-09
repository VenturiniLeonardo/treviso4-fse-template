import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * `lib/pagine-store.ts` — fase 14.10.
 *
 * Terzo store sulla stessa tabella `pagine_testi`, e la proprietà da non perdere
 * è sempre quella: **si conservano solo le differenze.** Qui in una forma più
 * stretta che altrove — un valore uguale al predefinito **cancella la riga**,
 * invece di scriverla — perché un modulo di dieci caselle si salva anche quando
 * si è cambiata una parola, e senza quel passaggio ogni salvataggio avrebbe
 * congelato nove testi del codice in nove righe di tabella.
 */

let cartella;
let store;
let HOME, CHI_SIAMO;
let CAMPI_PAGINE, predefinitoDi, inRighe;
let chiudiPerTest;
let raw;

const salvate = () =>
  raw
    .prepare(
      "SELECT chiave, valore FROM pagine_testi WHERE chiave LIKE 'home.%' OR chiave LIKE 'chi-siamo.%' ORDER BY chiave",
    )
    .all();

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-pagine-"));
  process.env.SITO_DB = join(cartella, "prova.db");

  const iniziale = new Database(process.env.SITO_DB);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  ({ HOME, CHI_SIAMO } = await import("@/lib/data"));
  ({ CAMPI_PAGINE, predefinitoDi, inRighe } = await import("@/lib/pagine-contenuti"));
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  store = await import("@/lib/pagine-store");
  raw = new Database(process.env.SITO_DB);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

beforeEach(() => {
  raw.prepare("DELETE FROM pagine_testi").run();
  chiudiPerTest?.();
});

describe("senza niente di salvato si vedono i testi del codice", () => {
  it("la home è quella di lib/data.ts", async () => {
    const h = await store.leggiHome();
    assert.deepEqual(h, HOME, "campo per campo, compresi i blocchi non modificabili");
  });

  it("«Chi siamo» è quella di lib/data.ts", async () => {
    assert.deepEqual(await store.leggiChiSiamo(), CHI_SIAMO);
  });

  it("ogni campo del catalogo ha un predefinito non vuoto", () => {
    // Se un campo del catalogo non corrisponde a niente in `lib/data.ts`, la
    // casella si aprirebbe vuota e salvarla scriverebbe una riga: il modo di
    // scoprirlo è questa riga, non una pagina con un buco.
    for (const c of CAMPI_PAGINE) {
      assert.ok(predefinitoDi(c.chiave).trim().length > 0, c.chiave);
    }
  });
});

describe("si conservano solo le differenze", () => {
  it("un testo cambiato si salva e si vede", async () => {
    await store.salvaTestiPagine({ "chi-siamo.titolo": "Un titolo nuovo." }, "gestori");
    chiudiPerTest();

    assert.deepEqual(salvate(), [{ chiave: "chi-siamo.titolo", valore: "Un titolo nuovo." }]);
    const c = await store.leggiChiSiamo();
    assert.equal(c.titolo, "Un titolo nuovo.");
    assert.deepEqual(c.testi, CHI_SIAMO.testi, "il resto non si muove");
  });

  it("salvare il valore predefinito NON scrive una riga", async () => {
    /*
     * È il caso normale, non un caso limite: il modulo manda tutte e dieci le
     * caselle a ogni salvataggio, e nove volte su dieci nove sono invariate.
     * Scriverle vorrebbe dire congelare i testi del codice — e da quel momento
     * correggere una virgola in `lib/data.ts` non cambierebbe più il sito.
     */
    const tutti = Object.fromEntries(CAMPI_PAGINE.map((c) => [c.chiave, predefinitoDi(c.chiave)]));
    await store.salvaTestiPagine(tutti, "gestori");
    chiudiPerTest();

    assert.deepEqual(salvate(), [], "nessuna riga: non c'è nessuna differenza da conservare");
  });

  it("rimettere il valore predefinito cancella la riga di prima", async () => {
    await store.salvaTestiPagine({ "home.citazione": "Qualcosa d’altro." }, "gestori");
    chiudiPerTest();
    assert.equal(salvate().length, 1);

    await store.salvaTestiPagine({ "home.citazione": HOME.citazione }, "gestori");
    chiudiPerTest();
    assert.deepEqual(salvate(), [], "chi torna indietro torna al codice, non a una copia");
  });

  it("svuotare una casella torna al predefinito", async () => {
    await store.salvaTestiPagine({ "home.citazione": "X" }, "gestori");
    chiudiPerTest();
    await store.salvaTestiPagine({ "home.citazione": "   " }, "gestori");
    chiudiPerTest();

    assert.deepEqual(salvate(), []);
    assert.equal((await store.leggiHome()).citazione, HOME.citazione);
  });

  it("una chiave che non è nel catalogo non si scrive", async () => {
    /*
     * Conta più che negli altri store: `pagine_testi` contiene anche le chiavi
     * `gruppo.*` — nome, marchio e recapiti — che stanno su un'**altra riga di
     * matrice**. Una scrittura per nome libero su questa tabella sarebbe una
     * porta laterale su `identita` per chi ha soltanto `pagine`.
     */
    await store.salvaTestiPagine(
      { "gruppo.nome": "Gruppo Rubato", "chi-siamo.inventato": "x" },
      "gestori",
    );
    chiudiPerTest();

    const tutte = raw.prepare("SELECT chiave FROM pagine_testi").all().map((r) => r.chiave);
    assert.deepEqual(tutte, [], "né la chiave del gruppo né quella inventata");
  });

  it("dice quali campi sono personalizzati", async () => {
    await store.salvaTestiPagine({ "home.intro": "Un’introduzione nuova." }, "gestori");
    chiudiPerTest();
    assert.deepEqual([...(await store.campiPersonalizzati())], ["home.intro"]);
  });
});

describe("il titolo della home è un testo a righe, non a paragrafi", () => {
  it("ogni ritorno a capo è una riga: l'interruzione è disegno", async () => {
    // «La strada comincia / dietro l'angolo.» va a capo in un punto preciso, e
    // quel punto fa parte del titolo. `inParagrafi` avrebbe unito le due righe.
    await store.salvaTestiPagine({ "home.titolo": "Prima riga\nSeconda riga" }, "cg");
    chiudiPerTest();

    const h = await store.leggiHome();
    assert.deepEqual(h.titolo, ["Prima riga", "Seconda riga"]);
  });

  it("`titoloTesto` si ricompone unendo le righe, e non si scrive due volte", async () => {
    await store.salvaTestiPagine({ "home.titolo": "Prima\nSeconda" }, "cg");
    chiudiPerTest();

    const h = await store.leggiHome();
    assert.equal(h.titoloTesto, "Prima Seconda", "serve al title e agli attributi");
  });

  it("le righe vuote si scartano: un invio di troppo non fa una riga bianca", () => {
    assert.deepEqual(inRighe("Una\n\n\nDue\n"), ["Una", "Due"]);
  });
});

describe("i paragrafi", () => {
  it("una riga vuota separa i paragrafi, un ritorno a capo singolo no", async () => {
    await store.salvaTestiPagine(
      { "chi-siamo.testi": "Primo.\ncontinua.\n\nSecondo." },
      "cg",
    );
    chiudiPerTest();

    const c = await store.leggiChiSiamo();
    assert.equal(c.testi.length, 2);
    assert.match(c.testi[0], /continua/);
  });

  it("il testo esce come testo: niente HTML", async () => {
    await store.salvaTestiPagine({ "chi-siamo.sommario": "<b>grassetto</b>" }, "cg");
    chiudiPerTest();
    assert.deepEqual((await store.leggiChiSiamo()).sommario, ["<b>grassetto</b>"].join(""));
  });
});

describe("senza database si servono i predefiniti", () => {
  it("la compilazione della home non ha bisogno di SQLite", async () => {
    const vero = process.env.SITO_DB;
    process.env.SITO_DB = join(cartella, "non-esiste.db");
    chiudiPerTest();
    try {
      assert.deepEqual(await store.leggiHome(), HOME);
      assert.deepEqual(await store.leggiChiSiamo(), CHI_SIAMO);
    } finally {
      process.env.SITO_DB = vero;
      chiudiPerTest();
    }
  });
});
