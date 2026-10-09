import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * `lib/faq-store.ts` — fase 14.12.
 *
 * Le FAQ erano l'ultimo contenuto editoriale del sito a stare nel codice. Lo
 * store si comporta come gli altri con una differenza dichiarata: **l'elenco si
 * sostituisce per intero**, quindi «si conservano solo le differenze» qui vuol
 * dire «tabella vuota = vale il codice», e basta.
 */

let cartella;
let store;
let FAQ;
let COLORI_FAQ, PAGINE_COLLEGABILI;
let chiudiPerTest;
let raw;

const righe = () =>
  raw
    .prepare("SELECT domanda, fascia, link_href AS href, ordine FROM faq ORDER BY ordine")
    .all();

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-faq-"));
  process.env.SITO_DB = join(cartella, "prova.db");

  const iniziale = new Database(process.env.SITO_DB);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  ({ FAQ } = await import("@/lib/data"));
  ({ COLORI_FAQ, PAGINE_COLLEGABILI } = await import("@/lib/faq-contenuti"));
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  store = await import("@/lib/faq-store");
  raw = new Database(process.env.SITO_DB);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

beforeEach(() => {
  raw.prepare("DELETE FROM faq").run();
  chiudiPerTest?.();
});

describe("con la tabella vuota valgono le domande del codice", () => {
  it("sono le cinque di lib/data.ts, nell'ordine", async () => {
    const v = await store.leggiFaq();
    assert.equal(v.length, FAQ.length);
    assert.deepEqual(
      v.map((x) => x.domanda),
      FAQ.map((x) => x.domanda),
    );
  });

  it("il colore diventa una fascia, e la fascia torna quel colore", async () => {
    /*
     * `FAQ` in `lib/data.ts` porta l'esadecimale, la tabella porta la fascia.
     * La traduzione deve chiudere il giro, altrimenti una domanda cambia colore
     * appena si apre la schermata — su una pagina approvata.
     */
    const v = await store.leggiFaq();
    for (const [i, x] of v.entries()) {
      assert.equal(COLORI_FAQ[x.fascia], FAQ[i].colore, FAQ[i].domanda);
    }
  });

  it("il collegamento della quarta domanda sopravvive alla traduzione", async () => {
    const v = await store.leggiFaq();
    const conLink = v.filter((x) => x.link);
    assert.equal(conLink.length, 1, "nel progetto ce n'è una sola");
    assert.equal(conLink[0].link.href, "/documenti");
  });

  it("`faqDalCodice` lo dichiara", async () => {
    assert.equal(await store.faqDalCodice(), true);
  });

  it("il navy delle FAQ non è quello di FASCE, ed è voluto", async () => {
    // `FASCE.gruppo.colore` è #003366, il mockup usa #002144 per la FAQ blu.
    // Allinearli avrebbe cambiato il colore di una domanda in una pagina
    // approvata. Se un domani si decide di unificarli, questa riga lo dice.
    const { FASCE } = await import("@/lib/data");
    assert.equal(COLORI_FAQ.gruppo, "#002144");
    assert.notEqual(COLORI_FAQ.gruppo, FASCE.gruppo.colore);
  });
});

describe("l'elenco si sostituisce per intero", () => {
  const tre = [
    { domanda: "Prima?", risposta: "Sì.", fascia: "gialla" },
    { domanda: "Seconda?", risposta: "Anche.", fascia: "verde" },
    { domanda: "Terza?", risposta: "Certo.", fascia: "gruppo" },
  ];

  it("salvare scrive l'ordine, e leggere lo rispetta", async () => {
    await store.salvaFaq(tre, "gestori");
    chiudiPerTest();

    assert.deepEqual(
      righe().map((r) => [r.domanda, r.ordine]),
      [["Prima?", 1], ["Seconda?", 2], ["Terza?", 3]],
    );
    const v = await store.leggiFaq();
    assert.deepEqual(v.map((x) => x.domanda), ["Prima?", "Seconda?", "Terza?"]);
    assert.equal(await store.faqDalCodice(), false);
  });

  it("togliere quella in mezzo non lascia buchi nell'ordine", async () => {
    // È la ragione per cui c'è una tabella e non chiave/valore: in
    // `faq.1.domanda` cancellare la seconda di tre vuol dire rinumerare la terza.
    await store.salvaFaq(tre, "cg");
    chiudiPerTest();
    await store.salvaFaq([tre[0], tre[2]], "cg");
    chiudiPerTest();

    assert.deepEqual(
      righe().map((r) => [r.domanda, r.ordine]),
      [["Prima?", 1], ["Terza?", 2]],
    );
  });

  it("riordinare è un salvataggio come un altro", async () => {
    await store.salvaFaq(tre, "cg");
    chiudiPerTest();
    await store.salvaFaq([tre[2], tre[0], tre[1]], "cg");
    chiudiPerTest();

    const v = await store.leggiFaq();
    assert.deepEqual(v.map((x) => x.domanda), ["Terza?", "Prima?", "Seconda?"]);
  });

  it("una voce senza domanda si scarta", async () => {
    await store.salvaFaq([tre[0], { domanda: "  ", risposta: "orfana", fascia: "verde" }], "cg");
    chiudiPerTest();
    assert.equal(righe().length, 1);
  });

  it("un elenco vuoto riporta alle domande del codice", async () => {
    await store.salvaFaq(tre, "cg");
    chiudiPerTest();
    await store.salvaFaq([], "cg");
    chiudiPerTest();

    assert.deepEqual(righe(), []);
    const v = await store.leggiFaq();
    assert.deepEqual(v.map((x) => x.domanda), FAQ.map((x) => x.domanda));
    assert.equal(await store.faqDalCodice(), true, "è l'unico modo di annullare");
  });

  it("il collegamento si salva e si rilegge intero", async () => {
    await store.salvaFaq(
      [
        {
          domanda: "Dove trovo i moduli?",
          risposta: "Nella pagina",
          fascia: "gruppo",
          link: { testo: "Documenti e modulistica", href: "/documenti", coda: "." },
        },
      ],
      "cg",
    );
    chiudiPerTest();

    const [v] = await store.leggiFaq();
    assert.deepEqual(v.link, {
      testo: "Documenti e modulistica",
      href: "/documenti",
      coda: ".",
    });
  });

  it("una domanda senza collegamento non ne ha uno vuoto", async () => {
    // La pagina controlla `f.link` per decidere se stampare il collegamento: un
    // oggetto con tre stringhe vuote stamperebbe un link senza parole.
    await store.salvaFaq([tre[0]], "cg");
    chiudiPerTest();
    const [v] = await store.leggiFaq();
    assert.equal("link" in v, false);
  });

  it("il testo esce come testo: niente HTML", async () => {
    await store.salvaFaq(
      [{ domanda: "<b>Grassetto?</b>", risposta: "<script>alert(1)</script>", fascia: "verde" }],
      "cg",
    );
    chiudiPerTest();
    const [v] = await store.leggiFaq();
    assert.equal(v.domanda, "<b>Grassetto?</b>");
    assert.equal(v.risposta, "<script>alert(1)</script>");
  });
});

describe("le pagine collegabili", () => {
  it("sono quelle di lib/nav.ts, non una seconda copia", async () => {
    const { scorciatoie } = await import("@/lib/nav");
    assert.deepEqual(
      PAGINE_COLLEGABILI.map((p) => p.href),
      scorciatoie(true).map((s) => s.href),
    );
  });

  it("sono tutte percorsi interni, e nessuna è una doppia barra", () => {
    // il `CHECK` del database dice la stessa cosa; questa riga garantisce che
    // il menù non offra mai qualcosa che il database rifiuterebbe
    for (const p of PAGINE_COLLEGABILI) {
      assert.match(p.href, /^\/[^/]/, p.href);
      assert.ok(!p.href.includes(".."), p.href);
    }
  });
});

describe("senza database valgono i predefiniti", () => {
  it("la compilazione della pagina Contatti non ha bisogno di SQLite", async () => {
    const vero = process.env.SITO_DB;
    process.env.SITO_DB = join(cartella, "non-esiste.db");
    chiudiPerTest();
    try {
      const v = await store.leggiFaq();
      assert.deepEqual(v.map((x) => x.domanda), FAQ.map((x) => x.domanda));
      assert.equal(await store.faqDalCodice(), true);
    } finally {
      process.env.SITO_DB = vero;
      chiudiPerTest();
    }
  });
});
