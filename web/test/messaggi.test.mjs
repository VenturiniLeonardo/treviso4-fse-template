import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * I messaggi dal modulo contatti, e il contatore di frequenza. Fase 8.
 *
 * Le prove che contano sono due: che la cancellazione cancelli davvero — §15
 * del piano, e chi chiede che i propri dati spariscano non deve ritrovarseli in
 * una riga marcata — e che il limite per indirizzo IP non si possa aggirare
 * insistendo.
 */

let cartella;
let percorso;
let raw;
let store, limiti;
let chiudiPerTest;

const MESSAGGIO = {
  nome: "Maria Rossi",
  email: "maria@esempio.it",
  telefono: "333 1234567",
  motivo: "iscrizione",
  messaggio: "Buongiorno, vorrei iscrivere mia figlia di otto anni. Come si fa?",
};

/** Sposta indietro nel tempo una colonna. */
function indietro(tabella, id, colonna, quanto) {
  raw
    .prepare(
      `update ${tabella} set ${colonna} = strftime('%Y-%m-%dT%H:%M:%SZ','now', ?) where id = ?`,
    )
    .run(quanto, id);
}

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-messaggi-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/messaggi-store");
  limiti = await import("@/lib/limiti");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

beforeEach(() => {
  raw.prepare("delete from messaggi").run();
  raw.prepare("delete from limiti").run();
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  rmSync(cartella, { recursive: true, force: true });
});

// =========================================================================

describe("salvare un messaggio", () => {
  it("lo conserva per intero, con l'indirizzo di chi l'ha mandato", () => {
    const id = store.salva(MESSAGGIO, "10.0.0.7");
    const m = store.elenco()[0];
    assert.equal(m.id, id);
    assert.equal(m.nome, "Maria Rossi");
    assert.equal(m.messaggio, MESSAGGIO.messaggio);
    assert.equal(m.ip, "10.0.0.7");
    assert.equal(m.stato, "da_leggere", "nasce da leggere");
  });

  it("senza indirizzo va bene lo stesso: dietro un proxy mal configurato capita", () => {
    store.salva(MESSAGGIO, null);
    assert.equal(store.elenco()[0].ip, null);
  });

  it("un motivo che non esiste lo rifiuta lo schema, non passa in silenzio", () => {
    assert.throws(() => store.salva({ ...MESSAGGIO, motivo: "inventato" }, null));
  });

  it("i più recenti vengono per primi", () => {
    const a = store.salva({ ...MESSAGGIO, nome: "Primo" }, null);
    const b = store.salva({ ...MESSAGGIO, nome: "Secondo" }, null);
    indietro("messaggi", a, "quando", "-2 days");
    assert.deepEqual(
      store.elenco().map((m) => m.nome),
      ["Secondo", "Primo"],
    );
    assert.equal(store.elenco()[0].id, b);
  });
});

describe("gli stati", () => {
  it("si passa da «da leggere» a «letto» a «risposto»", () => {
    const id = store.salva(MESSAGGIO, null);
    assert.equal(store.cambiaStato(id, "letto"), true);
    assert.equal(store.elenco()[0].stato, "letto");
    assert.equal(store.cambiaStato(id, "risposto"), true);
    assert.equal(store.elenco()[0].stato, "risposto");
  });

  it("il filtro per stato restituisce solo quelli", () => {
    const a = store.salva({ ...MESSAGGIO, nome: "A" }, null);
    store.salva({ ...MESSAGGIO, nome: "B" }, null);
    store.cambiaStato(a, "risposto");

    assert.deepEqual(store.elenco("risposto").map((m) => m.nome), ["A"]);
    assert.deepEqual(store.elenco("da_leggere").map((m) => m.nome), ["B"]);
  });

  it("i conteggi tornano, e valgono zero quando non c'è niente", () => {
    assert.deepEqual(store.conteggi(), { da_leggere: 0, letto: 0, risposto: 0 });
    const a = store.salva(MESSAGGIO, null);
    store.salva(MESSAGGIO, null);
    store.cambiaStato(a, "letto");
    assert.deepEqual(store.conteggi(), { da_leggere: 1, letto: 1, risposto: 0 });
  });

  it("su un messaggio che non c'è restituisce false invece di sollevare", () => {
    assert.equal(store.cambiaStato(9999, "letto"), false);
  });

  it("uno stato inventato lo rifiuta lo schema", () => {
    const id = store.salva(MESSAGGIO, null);
    assert.throws(() => store.cambiaStato(id, "cestinato"));
  });
});

describe("la cancellazione", () => {
  it("cancella davvero: non resta nessuna riga marcata", () => {
    const id = store.salva(MESSAGGIO, null);
    assert.equal(store.elimina(id), true);

    // non `elenco()`, che potrebbe filtrare: si guarda la tabella
    assert.equal(raw.prepare("select count(*) n from messaggi").get().n, 0);
    // e il testo non è rimasto da nessuna parte
    const tutto = JSON.stringify(raw.prepare("select * from messaggi").all());
    assert.equal(tutto.includes("maria@esempio.it"), false);
  });

  it("cancellare per indirizzo porta via tutti i messaggi di quella persona", () => {
    store.salva(MESSAGGIO, null);
    store.salva({ ...MESSAGGIO, messaggio: "Un secondo messaggio, sempre mio." }, null);
    store.salva({ ...MESSAGGIO, email: "altro@esempio.it" }, null);

    // maiuscole diverse: chi scrive la richiesta di cancellazione non ricopia
    // l'indirizzo esattamente come l'aveva scritto la prima volta
    assert.equal(store.eliminaPerEmail("  MARIA@Esempio.IT "), 2);
    assert.equal(store.elenco().length, 1);
    assert.equal(store.elenco()[0].email, "altro@esempio.it");
  });

  it("su un messaggio che non c'è restituisce false", () => {
    assert.equal(store.elimina(9999), false);
    assert.equal(store.eliminaPerEmail("nessuno@esempio.it"), 0);
  });
});

describe("la conservazione", () => {
  it("toglie oltre ventiquattro mesi e lascia il resto", () => {
    const vecchio = store.salva({ ...MESSAGGIO, nome: "Vecchio" }, null);
    const quasi = store.salva({ ...MESSAGGIO, nome: "Quasi" }, null);
    store.salva({ ...MESSAGGIO, nome: "Recente" }, null);

    indietro("messaggi", vecchio, "quando", "-25 months");
    indietro("messaggi", quasi, "quando", "-23 months");

    assert.equal(store.pulisci(), 1);
    assert.deepEqual(
      store.elenco().map((m) => m.nome).sort(),
      ["Quasi", "Recente"],
    );
  });

  it("non tocca niente quando non c'è niente da togliere", () => {
    store.salva(MESSAGGIO, null);
    assert.equal(store.pulisci(), 0);
    assert.equal(store.elenco().length, 1);
  });
});

describe("il limite per indirizzo", () => {
  it("lascia passare fino al massimo, poi rifiuta", () => {
    for (let i = 0; i < 5; i++) {
      assert.equal(limiti.consuma("contatti", "10.0.0.1", 5, 60).ok, true, `invio ${i + 1}`);
    }
    const sesto = limiti.consuma("contatti", "10.0.0.1", 5, 60);
    assert.equal(sesto.ok, false);
    assert.ok(sesto.attesaMinuti >= 1 && sesto.attesaMinuti <= 60);
  });

  it("insistere non aiuta: il conteggio sale anche quando rifiuta", () => {
    for (let i = 0; i < 8; i++) limiti.consuma("contatti", "10.0.0.2", 5, 60);
    assert.equal(limiti.conteggio("contatti", "10.0.0.2"), 8);
    assert.equal(limiti.consuma("contatti", "10.0.0.2", 5, 60).ok, false);
  });

  it("due indirizzi diversi non si disturbano", () => {
    for (let i = 0; i < 6; i++) limiti.consuma("contatti", "10.0.0.3", 5, 60);
    assert.equal(limiti.consuma("contatti", "10.0.0.3", 5, 60).ok, false);
    assert.equal(limiti.consuma("contatti", "10.0.0.4", 5, 60).ok, true);
  });

  it("due ambiti diversi nemmeno: il modulo contatti non chiude l'accesso", () => {
    for (let i = 0; i < 6; i++) limiti.consuma("contatti", "10.0.0.5", 5, 60);
    assert.equal(limiti.consuma("contatti", "10.0.0.5", 5, 60).ok, false);
    assert.equal(limiti.consuma("altro", "10.0.0.5", 5, 60).ok, true);
  });

  it("sopravvive al riavvio: è su database, non in memoria", () => {
    for (let i = 0; i < 6; i++) limiti.consuma("contatti", "10.0.0.6", 5, 60);
    chiudiPerTest();
    assert.equal(limiti.consuma("contatti", "10.0.0.6", 5, 60).ok, false);
  });

  it("la finestra nuova riparte da zero", () => {
    for (let i = 0; i < 6; i++) limiti.consuma("contatti", "10.0.0.8", 5, 60);
    assert.equal(limiti.consuma("contatti", "10.0.0.8", 5, 60).ok, false);

    // si sposta indietro la finestra: è come se fosse passata un'ora
    raw.prepare("update limiti set finestra_da = '2020-01-01T00:00:00Z'").run();
    assert.equal(limiti.consuma("contatti", "10.0.0.8", 5, 60).ok, true);
  });

  it("la pulizia toglie le finestre vecchie e lascia quella in corso", () => {
    limiti.consuma("contatti", "10.0.0.9", 5, 60);
    raw
      .prepare("insert into limiti (ambito,chiave,finestra_da,conteggio) values (?,?,?,?)")
      .run("contatti", "10.0.0.9", "2020-01-01T00:00:00Z", 3);

    assert.equal(limiti.pulisci(), 1);
    assert.equal(raw.prepare("select count(*) n from limiti").get().n, 1);
  });
});
