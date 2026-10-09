import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * I lavori notturni di §16 — fase 12.
 *
 * La prova che conta è quella sulla conservazione del registro: §16 dice
 * «registro oltre 12» senza distinguere, e qui si distingue. Se un giorno
 * qualcuno togliesse l'eccezione, queste prove lo direbbero — che è tutto il
 * motivo per cui esistono, perché la differenza fra le due scelte si vede solo
 * tre anni dopo, quando la riga serve e non c'è più.
 */

let cartella;
let percorso;
let raw;
let registro, manutenzione;
let chiudiPerTest;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-notturno-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  registro = await import("@/lib/registro-store");
  manutenzione = await import("@/lib/db/manutenzione");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

beforeEach(() => {
  raw.prepare("delete from registro").run();
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  rmSync(cartella, { recursive: true, force: true });
});

/** Una voce di registro, di un tipo e di un'età dati. */
function voce(tipo, mesiFa = 0, operazione = "prova") {
  raw
    .prepare(
      `insert into registro (quando, utente, nome, ruolo, tipo, operazione, origine)
       values (strftime('%Y-%m-%dT%H:%M:%SZ','now', ?), 'x', 'X', 'gestore', ?, ?, 'prova')`,
    )
    .run(`-${mesiFa} months`, tipo, operazione);
}

const quante = (tipo) =>
  raw.prepare("select count(*) n from registro where tipo = ?").get(tipo).n;

// =========================================================================

describe("la conservazione del registro", () => {
  it("cancella le voci ordinarie oltre dodici mesi", () => {
    voce("contenuto", 13);
    voce("accesso", 24);
    voce("contenuto", 11);

    const esito = registro.conserva();
    assert.equal(esito.cancellate, 2);
    assert.equal(quante("contenuto"), 1, "quella di undici mesi resta");
    assert.equal(quante("accesso"), 0);
  });

  it("NON cancella consensi e pubblicazioni, e dice quante ne ha tenute", () => {
    /*
     * §16 dice «registro oltre 12» senza distinguere. Questa è la deviazione, ed
     * è deliberata: sono le due righe che documentano decisioni sulle immagini
     * di minori, e una contestazione può arrivare tre anni dopo. Cancellarle a
     * dodici mesi vorrebbe dire tenere il dato e buttare la prova di essere
     * stati diligenti.
     */
    voce("consenso", 40, "Consenso registrato per Rossi Giulia");
    voce("pubblicazione", 40, "Pubblicato l’album");
    voce("contenuto", 40);

    const esito = registro.conserva();
    assert.equal(esito.cancellate, 1, "solo quella ordinaria");
    assert.equal(esito.conservate, 2, "e dice che le altre due le ha tenute apposta");
    assert.equal(quante("consenso"), 1);
    assert.equal(quante("pubblicazione"), 1);
  });

  it("i tipi conservati sono dichiarati, non nascosti nel codice", () => {
    assert.deepEqual([...registro.TIPI_CONSERVATI].sort(), ["consenso", "pubblicazione"]);
  });

  it("«conservate» distingue «non c'era niente» da «c'era e l'ho tenuto»", () => {
    // registro vuoto: zero e zero
    assert.deepEqual(registro.conserva(), { cancellate: 0, conservate: 0 });

    // solo un consenso vecchio: zero cancellate, ma una conservata
    voce("consenso", 40);
    assert.deepEqual(registro.conserva(), { cancellate: 0, conservate: 1 });
  });

  it("la soglia si può cambiare, per provarla senza aspettare un anno", () => {
    voce("contenuto", 2);
    assert.equal(registro.conserva(12).cancellate, 0, "due mesi non bastano");
    assert.equal(registro.conserva(1).cancellate, 1, "con la soglia a un mese sì");
  });

  it("non tocca niente quando tutto è recente", () => {
    voce("contenuto", 0);
    voce("consenso", 1);
    assert.equal(registro.conserva().cancellate, 0);
    assert.equal(raw.prepare("select count(*) n from registro").get().n, 2);
  });
});

describe("la manutenzione del database", () => {
  it("«optimize» da solo non tocca lo spazio e non dice di averlo fatto", () => {
    const esito = manutenzione.manutenzione(false);
    assert.equal(esito.ottimizzato, true);
    assert.equal(esito.byteRecuperati, null, "non era il turno del VACUUM");
    assert.equal(esito.durataMs, null);
  });

  it("il VACUUM recupera lo spazio delle righe cancellate, e lo misura", () => {
    // qualche migliaio di righe, poi via: è il caso della conservazione
    const ins = raw.prepare(
      "insert into registro (utente,nome,ruolo,tipo,operazione,origine) values ('x','X','gestore','contenuto',?,'prova')",
    );
    raw.transaction(() => {
      for (let i = 0; i < 5000; i++) ins.run(`riga ${i} con abbastanza testo da occupare spazio`);
    })();
    raw.prepare("delete from registro").run();

    const libere = raw.pragma("freelist_count", { simple: true });
    assert.ok(libere > 0, `dopo la cancellazione ci devono essere pagine libere: ${libere}`);

    const esito = manutenzione.manutenzione(true);
    assert.ok(esito.byteRecuperati > 0, `recuperati: ${esito.byteRecuperati}`);
    assert.equal(raw.pragma("freelist_count", { simple: true }), 0, "la lista libera è vuota");
    assert.equal(esito.motivo, undefined);
  });

  it("la dimensione si legge, e cresce quando si scrive", () => {
    const prima = manutenzione.dimensioneDb();
    assert.ok(prima > 0);

    const ins = raw.prepare(
      "insert into registro (utente,nome,ruolo,tipo,operazione,origine) values ('x','X','gestore','contenuto',?,'prova')",
    );
    raw.transaction(() => {
      for (let i = 0; i < 5000; i++) ins.run(`riga ${i} con del testo`);
    })();

    assert.ok(manutenzione.dimensioneDb() > prima);
  });
});
