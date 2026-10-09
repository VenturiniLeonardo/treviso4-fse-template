import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * `lib/registro-store.ts` su SQLite — passo 2B.2.
 *
 * Due contratti da non rompere, e sono la ragione di metà di questi test:
 *
 *  - `registra` **non solleva mai**. Un'operazione riuscita non deve fallire
 *    perché il registro non si è scritto.
 *  - `esito` compare nella `Voce` **solo** quando vale `rifiutato`. Con il JSON
 *    la chiave veniva scritta solo in quel caso, quindi restituire `'ok'`
 *    cambierebbe la forma di ogni voce.
 */

let cartella;
let percorso;
let store;
let VOCI_MAX;
let chiudiPerTest;
let raw;

const SESSIONE = { u: "gestori", n: "Nome Cognome", r: "gestore", i: "CG", exp: 0 };

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-registro-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/registro-store");
  ({ VOCI_MAX } = await import("@/lib/registro"));
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

beforeEach(() => {
  raw.prepare("DELETE FROM registro").run();
});

/** Inserisce una voce con un istante scelto, per provare l'ordinamento. */
function vociFinte(quante, quandoBase = "2026-08-22T18:00:00Z") {
  const base = Date.parse(quandoBase);
  const ins = raw.prepare(
    "INSERT INTO registro (quando, utente, nome, ruolo, tipo, operazione, origine, esito) VALUES (?,?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < quante; i++) {
    const q = new Date(base + i * 1000).toISOString().slice(0, 19) + "Z";
    ins.run(q, "gestori", "Nome Cognome", "gestore", "contenuto", `Operazione ${i}`, "album", "ok");
  }
}

// --------------------------------------------------------------------------

describe("scrittura", () => {
  it("registra scrive una voce che si rilegge", async () => {
    await store.registra(SESSIONE, "contenuto", "Creato l’album «Prova»", "album");
    const voci = await store.leggiRegistro();
    assert.equal(voci.length, 1);
    assert.equal(voci[0].utente, "gestori");
    assert.equal(voci[0].nome, "Nome Cognome");
    assert.equal(voci[0].ruolo, "gestore");
    assert.equal(voci[0].tipo, "contenuto");
    assert.equal(voci[0].operazione, "Creato l’album «Prova»");
    assert.equal(voci[0].origine, "album");
  });

  it("«quando» è un numero in millisecondi, come l'applicazione si aspetta", async () => {
    const prima = Date.now();
    await store.registra(SESSIONE, "contenuto", "X", "album");
    const v = (await store.leggiRegistro())[0];
    assert.equal(typeof v.quando, "number");
    // entro il secondo: il formato del database ha la precisione al secondo
    assert.ok(Math.abs(v.quando - prima) < 5000, `quando=${v.quando} prima=${prima}`);
  });

  it("un esito riuscito NON porta la chiave «esito»", async () => {
    await store.registra(SESSIONE, "contenuto", "X", "album");
    const v = (await store.leggiRegistro())[0];
    assert.ok(!("esito" in v), `la chiave non deve esserci: ${JSON.stringify(v)}`);
  });

  it("un rifiuto porta esito: «rifiutato»", async () => {
    await store.registra(SESSIONE, "permessi", "Tentativo", "permessi", "rifiutato");
    const v = (await store.leggiRegistro())[0];
    assert.equal(v.esito, "rifiutato");
  });

  it("nel database l'esito riuscito è comunque 'ok', non nullo", async () => {
    await store.registra(SESSIONE, "contenuto", "X", "album");
    const r = raw.prepare("SELECT esito FROM registro").get();
    assert.equal(r.esito, "ok");
  });

  it("registraAccesso scrive accesso, uscita e tentativo rifiutato", async () => {
    await store.registraAccesso("ref1", "Ref1", "referente", "accesso");
    await store.registraAccesso("ref1", "Ref1", "referente", "uscita");
    await store.registraAccesso("ignoto", "ignoto", "sconosciuto", "accesso", "rifiutato");

    const voci = await store.leggiRegistro();
    assert.equal(voci.length, 3);
    const rifiutato = voci.find((v) => v.esito === "rifiutato");
    assert.equal(rifiutato.ruolo, "sconosciuto", "il registro conserva un ruolo che non esiste");
    assert.equal(rifiutato.operazione, "Tentativo di accesso rifiutato");
  });
});

describe("il contratto di registra: non solleva mai", () => {
  it("un tipo fuori elenco viene rifiutato dal CHECK, ma registra non solleva", async () => {
    await assert.doesNotReject(() =>
      store.registra(SESSIONE, "tipo-inventato", "X", "album"),
    );
    // e la voce non c'è: il vincolo ha fatto il suo lavoro
    assert.equal((await store.leggiRegistro()).length, 0);
  });

  it("un esito fuori elenco non solleva", async () => {
    await assert.doesNotReject(() =>
      store.registra(SESSIONE, "contenuto", "X", "album", "quasi-ok"),
    );
  });

  it("senza database non solleva e non scrive", async () => {
    const { chiudiPerTest: chiudi } = await import("@/lib/db/db");
    const vero = process.env.SITO_DB;
    chiudi();
    process.env.SITO_DB = join(cartella, "non-esiste.db");
    try {
      await assert.doesNotReject(() => store.registra(SESSIONE, "contenuto", "X", "album"));
      assert.deepEqual(await store.leggiRegistro(), [], "la lettura senza database è vuota");
    } finally {
      chiudi();
      process.env.SITO_DB = vero;
    }
  });
});

describe("lettura e ordinamento", () => {
  it("le voci più recenti stanno in testa", async () => {
    vociFinte(5);
    const voci = await store.leggiRegistro();
    assert.equal(voci.length, 5);
    assert.equal(voci[0].operazione, "Operazione 4", "la più recente per prima");
    assert.equal(voci.at(-1).operazione, "Operazione 0");
    for (let i = 1; i < voci.length; i++) {
      assert.ok(voci[i - 1].quando >= voci[i].quando, "ordine decrescente");
    }
  });

  it("voci nello stesso secondo restano in ordine deterministico", async () => {
    const ins = raw.prepare(
      "INSERT INTO registro (quando, utente, nome, ruolo, tipo, operazione, origine) VALUES (?,?,?,?,?,?,?)",
    );
    for (const n of ["prima", "seconda", "terza"]) {
      ins.run("2026-08-22T18:00:00Z", "cg", "Nome", "gestore", "contenuto", n, "album");
    }
    const a = (await store.leggiRegistro()).map((v) => v.operazione);
    const b = (await store.leggiRegistro()).map((v) => v.operazione);
    assert.deepEqual(a, b, "due letture devono dare lo stesso ordine");
    assert.deepEqual(a, ["terza", "seconda", "prima"], "a pari secondo decide l'id, decrescente");
  });

  it("mostra al massimo VOCI_MAX voci, come la schermata di prima", async () => {
    vociFinte(VOCI_MAX + 20);
    const voci = await store.leggiRegistro();
    assert.equal(voci.length, VOCI_MAX);
    assert.equal(voci[0].operazione, `Operazione ${VOCI_MAX + 19}`, "sono le più recenti");
  });

  it("il limite NON cancella: le voci oltre le 500 restano nel database", async () => {
    vociFinte(VOCI_MAX + 20);
    await store.leggiRegistro();
    const nel = raw.prepare("SELECT count(*) n FROM registro").get().n;
    assert.equal(
      nel,
      VOCI_MAX + 20,
      "con il JSON le più vecchie sparivano a ogni scrittura; qui restano e le cancella il job notturno",
    );
  });

  it("scrivere non cancella niente", async () => {
    vociFinte(VOCI_MAX + 5);
    await store.registra(SESSIONE, "contenuto", "Una in più", "album");
    assert.equal(raw.prepare("SELECT count(*) n FROM registro").get().n, VOCI_MAX + 6);
  });
});

describe("registroDi", () => {
  it("restituisce solo le voci dell'utente chiesto", async () => {
    await store.registra(SESSIONE, "contenuto", "Del gestore", "album");
    await store.registra(
      { u: "ref1", n: "Ref1", r: "referente", i: "AK", exp: 0 },
      "contenuto",
      "Del referente di unità",
      "album",
    );

    const sue = await store.registroDi("ref1");
    assert.equal(sue.length, 1);
    assert.equal(sue[0].operazione, "Del referente di unità");
    assert.equal((await store.registroDi("gestori")).length, 1);
    assert.equal((await store.registroDi("nessuno")).length, 0);
  });
});

describe("filtri — funzioni pure, invariate dal porting", () => {
  it("filtra per utente, tipo e giorni", async () => {
    const adesso = Date.parse("2026-08-22T18:00:00Z");
    const voci = [
      { quando: adesso - 1000, utente: "a", nome: "A", ruolo: "gestore", tipo: "contenuto", operazione: "x", origine: "album" },
      { quando: adesso - 8 * 24 * 3600 * 1000, utente: "b", nome: "B", ruolo: "referente", tipo: "accesso", operazione: "y", origine: "accesso" },
    ];
    assert.equal(store.applicaFiltri(voci, { utente: "a" }, adesso).length, 1);
    assert.equal(store.applicaFiltri(voci, { tipo: "accesso" }, adesso).length, 1);
    assert.equal(store.applicaFiltri(voci, { giorni: 7 }, adesso).length, 1);
    assert.equal(store.applicaFiltri(voci, {}, adesso).length, 2);
  });

  it("utentiNelRegistro elenca ogni utente una volta sola", async () => {
    await store.registra(SESSIONE, "contenuto", "uno", "album");
    await store.registra(SESSIONE, "contenuto", "due", "album");
    await store.registra(
      { u: "ref1", n: "Ref1", r: "referente", i: "AK", exp: 0 },
      "contenuto",
      "tre",
      "album",
    );
    const utenti = store.utentiNelRegistro(await store.leggiRegistro());
    assert.equal(utenti.length, 2);
    assert.deepEqual(
      [...utenti].map((u) => u.utente).sort(),
      ["gestori", "ref1"],
    );
  });
});

describe("il registro sopravvive alla cancellazione dell'utente", () => {
  it("le colonne di testo restano anche senza l'account", async () => {
    // simula la fase 6: una voce collegata a un account vero
    raw.prepare(
      "INSERT INTO unita (id, chiave, slug, nome, fascia, ordine) VALUES (1,'u1','unita-1','Label 1','gialla',1)",
    ).run();
    raw.prepare(
      "INSERT INTO utenti (id, utente, nome, iniziali, ruolo, unita_id) VALUES (7,'ref1','Ref1','AK','referente',1)",
    ).run();
    raw.prepare(
      "INSERT INTO registro (utente_id, quando, utente, nome, ruolo, tipo, operazione, origine) VALUES (7,?,?,?,?,?,?,?)",
    ).run("2026-08-22T18:00:00Z", "ref1", "Ref1", "referente", "pubblicazione", "Pubblicato", "album");

    raw.prepare("DELETE FROM utenti WHERE id = 7").run();

    const voci = await store.leggiRegistro();
    assert.equal(voci.length, 1, "la voce non deve sparire con l'account");
    assert.equal(voci[0].utente, "ref1");
    assert.equal(voci[0].ruolo, "referente");
    assert.equal(raw.prepare("SELECT utente_id FROM registro").get().utente_id, null);

    raw.prepare("DELETE FROM utenti").run();
    raw.prepare("DELETE FROM unita").run();
  });
});

describe("tetti di lunghezza (DOS-02)", () => {
  /*
   * Dall'audit di sicurezza: il nome utente di un accesso fallito arrivava
   * intero nel registro, due volte, e le dashboard rileggono cinquecento voci
   * per volta. `registra()` adesso taglia: è la rete per ogni chiamante.
   */
  it("un nome utente da 10 000 caratteri si scrive tagliato al tetto", async () => {
    const enorme = "x".repeat(10_000);
    await store.registraAccesso(enorme, enorme, "sconosciuto", "accesso", "rifiutato");
    const riga = raw.prepare("SELECT utente, nome FROM registro").get();
    assert.equal(riga.utente.length, store.TETTI_REGISTRO.utente);
    assert.equal(riga.nome.length, store.TETTI_REGISTRO.nome);
    assert.ok(riga.utente.endsWith("…"), "una voce tagliata lo dice");
  });

  it("anche l'operazione si taglia, e una voce normale resta intera", async () => {
    await store.registra(SESSIONE, "contenuto", "o".repeat(5000), "album");
    await store.registra(SESSIONE, "contenuto", "Creato l’album «Prova»", "album");
    const operazioni = raw.prepare("SELECT operazione FROM registro ORDER BY id").all();
    assert.equal(operazioni[0].operazione.length, store.TETTI_REGISTRO.operazione);
    assert.equal(operazioni[1].operazione, "Creato l’album «Prova»");
  });

  it("accorciaFuoriMisura sistema le voci scritte prima dei tetti, e solo quelle", () => {
    raw
      .prepare(
        "INSERT INTO registro (quando, utente, nome, ruolo, tipo, operazione, origine, esito) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run("2026-09-01T10:00:00Z", "u".repeat(100_000), "n".repeat(300), "referente", "accesso", "Tentativo", "accesso", "rifiutato");
    vociFinte(3);
    assert.equal(store.accorciaFuoriMisura(), 2, "due colonne della riga lunga");
    const lunga = raw.prepare("SELECT utente, nome FROM registro WHERE ruolo = 'referente'").get();
    assert.equal(lunga.utente.length, store.TETTI_REGISTRO.utente);
    assert.equal(lunga.nome.length, store.TETTI_REGISTRO.nome);
    assert.equal(store.accorciaFuoriMisura(), 0, "la seconda notte non trova niente");
    assert.equal(raw.prepare("SELECT operazione FROM registro WHERE operazione = 'Operazione 0'").all().length, 1);
  });
});

describe("fuPubblicato (BIZ-03)", () => {
  it("trova una pubblicazione per uno dei segni, e solo fra le pubblicazioni", async () => {
    await store.registra(SESSIONE, "pubblicazione", "Approvato e pubblicato l’album «Uscita» (uscita)", "approvazioni");
    await store.registra(SESSIONE, "contenuto", "Creato l’album «Campo»", "album");
    assert.equal(store.fuPubblicato(["(uscita)"]), true);
    assert.equal(store.fuPubblicato(["l’album «Uscita»"]), true);
    assert.equal(store.fuPubblicato(["l’album «Campo»"]), false, "creato non è pubblicato");
    assert.equal(store.fuPubblicato(["(altro)", "l’album «Altro»"]), false);
    assert.equal(store.fuPubblicato([]), false);
  });

  it("un segno con «%» o «_» non diventa un modello", async () => {
    await store.registra(SESSIONE, "pubblicazione", "Album «abc» → pubblicato", "album");
    assert.equal(store.fuPubblicato(["Album «%» →"]), false);
    assert.equal(store.fuPubblicato(["Album «a_c» →"]), false);
  });
});

describe("indirizzo IP (0020): solo per lo sviluppatore", () => {
  function voceConIp(ip, quando = "2026-08-22T18:00:00Z", tipo = "contenuto") {
    raw
      .prepare(
        "INSERT INTO registro (quando, utente, nome, ruolo, tipo, operazione, origine, esito, indirizzo) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(quando, "gestori", "Nome Cognome", "gestore", tipo, "Operazione", "album", "ok", ip);
  }

  it("fuori da una richiesta la voce si scrive lo stesso, senza indirizzo", async () => {
    await store.registra(SESSIONE, "contenuto", "Da uno script", "album");
    const riga = raw.prepare("SELECT indirizzo FROM registro").get();
    assert.equal(riga.indirizzo, null);
  });

  it("di predefinito la voce NON porta la chiave «indirizzo»", async () => {
    voceConIp("203.0.113.7");
    const [v] = await store.leggiRegistro();
    assert.equal("indirizzo" in v, false);
  });

  it("con conIndirizzi la voce porta l'IP", async () => {
    voceConIp("203.0.113.7");
    const [v] = await store.leggiRegistro({ conIndirizzi: true });
    assert.equal(v.indirizzo, "203.0.113.7");
  });

  it("registroDi non porta l'IP", async () => {
    voceConIp("203.0.113.7");
    const [v] = await store.registroDi("gestori");
    assert.equal("indirizzo" in v, false);
  });

  it("la conservazione toglie l'IP alle voci tenute oltre i dodici mesi", () => {
    voceConIp("203.0.113.7", "2020-01-01T00:00:00Z", "consenso");
    voceConIp("198.51.100.4");
    const esito = store.conserva();
    assert.equal(esito.conservate, 1);
    const righe = raw.prepare("SELECT quando, indirizzo FROM registro ORDER BY quando").all();
    assert.equal(righe.length, 2);
    assert.equal(righe[0].indirizzo, null);
    assert.equal(righe[1].indirizzo, "198.51.100.4");
  });
});
