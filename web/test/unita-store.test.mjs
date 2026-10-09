import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * `lib/unita-store.ts` — fase 14.3.
 *
 * La proprietà da non perdere è la stessa di `gruppo-store.test.mjs`: si
 * conservano **solo le differenze** dai valori predefiniti. Una colonna nulla,
 * una riga assente in `pagine_testi`, nessuna persona in `unita_persone` — tutte
 * e tre significano «usa quello di `lib/data.ts`».
 *
 * Conta più qui che per il gruppo, perché i testi delle unità sono in gran parte
 * i segnaposto del mockup e verranno corretti **nel codice** mano a mano che il
 * gruppo scrive quelli veri. Se lo store ne facesse una copia, quelle correzioni
 * non arriverebbero più in pagina e nessuno capirebbe perché.
 */

let cartella;
let percorso;
let store;
let UNITA, unitaPerChiave;
let inParagrafi, daParagrafi;
let chiudiPerTest;
let raw;

/** L'unità di prova: l'unità 1, che nel seme ha il testo più completo. */
const CHIAVE = "u1";

const predefinita = () => unitaPerChiave(CHIAVE);

/** Svuota tutto ciò che lo store legge, per tornare al punto di partenza. */
function azzera() {
  raw.prepare("DELETE FROM unita_persone").run();
  raw.prepare("DELETE FROM pagine_testi WHERE chiave LIKE 'unita.%'").run();
  raw
    .prepare(
      `UPDATE unita SET occhiello=NULL, motto=NULL, ritrovo=NULL, fondazione=NULL,
       referente=NULL, ruolo_referente=NULL, sigla=NULL, iscritti=NULL,
       storia_titolo=NULL, nota_storico=NULL`,
    )
    .run();
  chiudiPerTest?.();
}

const idDi = (chiave) =>
  raw.prepare("SELECT id FROM unita WHERE chiave = ?").get(chiave).id;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-unita-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  ({ UNITA, unitaPerChiave } = await import("@/lib/data"));
  ({ inParagrafi, daParagrafi } = await import("@/lib/unita-contenuti"));
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  store = await import("@/lib/unita-store");

  // le sei unità e i quattro anni: `unita_persone` ha una chiave esterna
  const { assicuraRiferimenti } = await import("@/lib/db/riferimenti");
  assicuraRiferimenti();
  raw = new Database(percorso);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

// `cache` di React lega la lettura alla richiesta, e fuori da una richiesta
// tiene il primo risultato: senza chiudere la connessione fra un caso e l'altro
// si proverebbe sempre la prima lettura.
beforeEach(() => azzera());

describe("senza niente di salvato, si vedono i testi del codice", () => {
  it("le sei unità sono quelle di lib/data.ts, campo per campo", async () => {
    const lette = await store.leggiUnita();
    assert.equal(lette.length, UNITA.length);
    for (const [i, u] of lette.entries()) {
      // il confronto è sull'oggetto intero: se lo store aggiunge o perde un
      // campo, questa riga lo dice invece di lasciarlo scoprire in pagina
      assert.deepEqual(u, UNITA[i], `unità «${UNITA[i].chiave}»`);
    }
  });

  it("l'ordine è quello in cui il sito le presenta", async () => {
    const lette = await store.leggiUnita();
    assert.deepEqual(
      lette.map((u) => u.chiave),
      UNITA.map((u) => u.chiave),
    );
  });
});

describe("una colonna salvata copre il predefinito, e solo quella", () => {
  it("il motto salvato si vede, il resto non si muove", async () => {
    raw.prepare("UPDATE unita SET motto = ? WHERE chiave = ?").run("Sempre pronti", CHIAVE);
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.motto, "Sempre pronti");
    // tutto il resto è ancora quello del codice
    const atteso = { ...predefinita(), motto: "Sempre pronti" };
    assert.deepEqual(u, atteso);
  });

  it("una colonna svuotata torna al predefinito, non a una riga vuota", async () => {
    // Un referente che cancella il contenuto di una casella e salva vuole tornare a
    // come era, non pubblicare uno spazio bianco.
    raw.prepare("UPDATE unita SET ritrovo = ? WHERE chiave = ?").run("   ", CHIAVE);
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.ritrovo, predefinita().ritrovo);
  });

  it("i tre campi facoltativi restano assenti quando non sono salvati", async () => {
    /*
     * `sigla`, `storiaTitolo` e `notaStorico` sono `?:` in `Unita`, e la pagina
     * controlla `undefined` per decidere se mostrare il proprio segnaposto. Una
     * stringa vuota passerebbe quel controllo e stamperebbe una riga vuota —
     * che è il difetto che questo caso protegge.
     */
    raw.prepare("UPDATE unita SET nota_storico = '' WHERE chiave = ?").run("u4");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave("u4");
    assert.equal("notaStorico" in u, "notaStorico" in unitaPerChiave("u4"));
  });
});

describe("il numero di iscritti, e la sua etichetta declinata", () => {
  it("il numero salvato si vede, e l'etichetta tiene le parole del codice", async () => {
    raw.prepare("UPDATE unita SET iscritti = 50 WHERE chiave = ?").run(CHIAVE);
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.iscritti, 50);
    assert.equal(u.iscrittiLabel, "50 iscritti");
  });

  it("il femminile non si perde: le Guide restano «iscritte»", async () => {
    // È la ragione per cui l'etichetta non si compone come `${n} iscritti`:
    // tre unità su sei sono al femminile, e il genere è lingua, non un dato che
    // qualcuno immette in un modulo.
    assert.match(unitaPerChiave("u4").iscrittiLabel, /iscritte$/);
    raw.prepare("UPDATE unita SET iscritti = 60 WHERE chiave = ?").run("u4");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave("u4");
    assert.equal(u.iscrittiLabel, "60 iscritte");
  });

  it("zero iscritti è un numero, non un campo vuoto", async () => {
    raw.prepare("UPDATE unita SET iscritti = 0 WHERE chiave = ?").run(CHIAVE);
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.iscritti, 0, "un'unità appena nata ne ha zero, e non è «non compilato»");
    assert.equal(u.iscrittiLabel, "0 iscritti");
  });
});

describe("la storia, come paragrafi in pagine_testi", () => {
  const scrivi = (testo) =>
    raw
      .prepare("INSERT INTO pagine_testi (chiave, valore) VALUES (?, ?)")
      .run(`unita.${CHIAVE}.storia`, testo);

  it("una riga vuota separa i paragrafi", async () => {
    scrivi("Primo paragrafo.\n\nSecondo paragrafo.\n\nTerzo.");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(u.storia, ["Primo paragrafo.", "Secondo paragrafo.", "Terzo."]);
  });

  it("un ritorno a capo singolo NON spezza il paragrafo", async () => {
    // Chi scrive in una casella di testo va a capo per leggibilità: quello non
    // è un paragrafo nuovo, ed è la differenza fra un testo e sei frammenti.
    scrivi("Una frase\nche continua sulla riga dopo.");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.storia.length, 1);
  });

  it("i ritorni a capo di Windows si comportano come gli altri", async () => {
    scrivi("Primo.\r\n\r\nSecondo.");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(u.storia, ["Primo.", "Secondo."]);
  });

  it("un testo di soli spazi torna ai paragrafi del codice", async () => {
    scrivi("   \n\n  \n\n ");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(u.storia, predefinita().storia);
  });

  it("andata e ritorno: daParagrafi e inParagrafi si annullano", () => {
    const paragrafi = ["Uno.", "Due, con una virgola.", "Tre."];
    assert.deepEqual(inParagrafi(daParagrafi(paragrafi)), paragrafi);
  });

  it("il testo esce come testo: niente HTML da nessuna parte", async () => {
    /*
     * Non c'è sanificazione perché non c'è niente da sanificare: il valore
     * attraversa lo store intatto e React lo scappa quando lo stampa. Questo
     * caso fissa quel patto — se un domani qualcuno introducesse un renderer,
     * la stringa qui sotto non uscirebbe più uguale e il test lo direbbe.
     */
    scrivi("<script>alert(1)</script> e <b>grassetto</b>");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(u.storia, ["<script>alert(1)</script> e <b>grassetto</b>"]);
  });
});

describe("la presentazione, in pagine_testi come la storia", () => {
  /*
   * Fino al 6 ottobre 2026 stava solo in `lib/data.ts`: il riquadro
   * «Presentazione» dell'area non aveva un campo per cambiarla, e chi
   * correggeva il motto o la storia non trovava il paragrafo in cima alla pagina.
   */
  it("salvata dall'area, si vede al posto di quella del codice", async () => {
    await store.salvaCampiUnita(CHIAVE, { presentazione: "Giochiamo nel bosco." }, "prova");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.presentazione, "Giochiamo nel bosco.");
    // il resto non si muove
    assert.deepEqual(u, { ...predefinita(), presentazione: "Giochiamo nel bosco." });
  });

  it("svuotata, torna quella del codice", async () => {
    await store.salvaCampiUnita(CHIAVE, { presentazione: "Provvisoria." }, "prova");
    await store.salvaCampiUnita(CHIAVE, { presentazione: "  " }, "prova");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.presentazione, predefinita().presentazione);
  });

  it("un'unità che non l'aveva può averne una", async () => {
    const senza = UNITA.find((u) => !u.presentazione);
    assert.ok(senza, "serve un'unità senza presentazione nel codice");
    await store.salvaCampiUnita(senza.chiave, { presentazione: "Nuova." }, "prova");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(senza.chiave);
    assert.equal(u.presentazione, "Nuova.");
  });

  it("gli a capo di Windows si normalizzano", async () => {
    await store.salvaCampiUnita(CHIAVE, { presentazione: "Primo.\r\n\r\nSecondo." }, "prova");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(inParagrafi(u.presentazione), ["Primo.", "Secondo."]);
  });

  it("proposta e approvata, va online", async () => {
    await store.proponiCampiUnita(CHIAVE, { presentazione: "Proposta." }, "prova");
    chiudiPerTest();
    assert.equal((await store.unitaSalvataPerChiave(CHIAVE)).presentazione, predefinita().presentazione);

    assert.equal(await store.approvaProposta(CHIAVE, "presentazione", "prova"), true);
    chiudiPerTest();
    assert.equal((await store.unitaSalvataPerChiave(CHIAVE)).presentazione, "Proposta.");
  });
});

describe("le persone: tre elenchi in una tabella", () => {
  const inserisci = (tipo, nome, ruolo, periodo, nota, ordine, stato = "pubblicato") =>
    raw
      .prepare(
        `INSERT INTO unita_persone (unita_id, tipo, nome, ruolo, periodo, nota, ordine, stato)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(idDi(CHIAVE), tipo, nome, ruolo, periodo, nota, ordine, stato);

  it("i responsabili pubblicati sostituiscono quelli del codice", async () => {
    inserisci("responsabile", "Mario Rossi", "Ref1", "dal 2022", "", 1);
    inserisci("responsabile", "Chiara Rossi", "Vice", "dal 2024", "", 2);
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(u.responsabili, [
      ["Mario Rossi", "Ref1", "dal 2022"],
      ["Chiara Rossi", "Vice", "dal 2024"],
    ]);
  });

  it("l'ordine è quello della colonna «ordine», non quello d'inserimento", async () => {
    inserisci("responsabile", "Secondo", "R2", "", "", 2);
    inserisci("responsabile", "Primo", "R1", "", "", 1);
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(
      u.responsabili.map(([nome]) => nome),
      ["Primo", "Secondo"],
    );
  });

  it("lo storico ha le colonne nell'ordine della tabella in pagina: anni, nome, nota", async () => {
    inserisci("storico", "Paolo Bianchi", "", "dal 2000", "Primo referente dell’unità.", 1);
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(u.storico, [
      ["dal 2000", "Paolo Bianchi", "Primo referente dell’unità."],
    ]);
  });

  it("lo staff è una coppia: nome e ruolo tradizionale", async () => {
    inserisci("staff", "Anna Bianchi", "Aiuto", "", "", 1);
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(u.staff, [["Anna Bianchi", "Aiuto"]]);
  });

  it("una bozza NON compare: sul sito pubblico si vede solo il pubblicato", async () => {
    inserisci("responsabile", "Non ancora approvato", "X", "", "", 1, "bozza");
    inserisci("responsabile", "In coda", "Y", "", "", 2, "in_revisione");
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    // nessuna riga pubblicata ⇒ si torna al predefinito, e i due nomi non escono
    assert.deepEqual(u.responsabili, predefinita().responsabili);
    const nomi = JSON.stringify(u.responsabili);
    assert.ok(!nomi.includes("Non ancora approvato"));
    assert.ok(!nomi.includes("In coda"));
  });

  it("i tre elenchi sono indipendenti: riempirne uno non svuota gli altri", async () => {
    inserisci("staff", "Solo staff", "S", "", "", 1);
    chiudiPerTest();

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(u.staff, [["Solo staff", "S"]]);
    assert.deepEqual(u.responsabili, predefinita().responsabili);
    assert.deepEqual(u.storico, predefinita().storico);
  });

  it("le persone di un'unità non finiscono in un'altra", async () => {
    inserisci("responsabile", "Dei u1", "L", "", "", 1);
    chiudiPerTest();

    const u4 = await store.unitaSalvataPerChiave("u4");
    assert.deepEqual(u4.responsabili, unitaPerChiave("u4").responsabili);
  });
});

describe("senza database si servono i predefiniti", () => {
  it("la compilazione delle sei pagine unità non ha bisogno di SQLite", async () => {
    /*
     * Le pagine unità sono prerenderizzate (§04): al momento della
     * compilazione il database può non esserci, e devono uscire comunque con i
     * testi del codice. È lo stesso comportamento di `leggiIdentita`.
     */
    const vero = process.env.SITO_DB;
    process.env.SITO_DB = join(cartella, "non-esiste.db");
    chiudiPerTest();
    try {
      const lette = await store.leggiUnita();
      assert.deepEqual(lette, UNITA);
    } finally {
      process.env.SITO_DB = vero;
      chiudiPerTest();
    }
  });
});

describe("le due ricerche per chiave e per indirizzo", () => {
  it("per indirizzo trova l'unità giusta", async () => {
    const u = await store.unitaSalvataPerSlug(predefinita().slug);
    assert.equal(u.chiave, CHIAVE);
  });

  it("un indirizzo che non esiste dà undefined, non un errore", async () => {
    assert.equal(await store.unitaSalvataPerSlug("unita-inventata"), undefined);
  });

  it("una chiave che non esiste dà undefined", async () => {
    assert.equal(await store.unitaSalvataPerChiave("gruppo"), undefined);
  });
});
