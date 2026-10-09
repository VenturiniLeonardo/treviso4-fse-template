import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Il limite dei tentativi sul secondo fattore — dall'audit di produzione
 * (SEC-02).
 *
 * Prima il passo del codice non aveva alcun tetto: chi conosceva la password
 * poteva provare le sei cifre all'infinito, rinnovando la finestra da cinque
 * minuti. Adesso `verificaSecondoFattoreLimitato` riusa lo stesso conteggio del
 * primo passo (`lib/auth/tentativi.ts`), e queste prove verificano che:
 *
 *  - un codice sbagliato è «codiceErrato» e viene contato;
 *  - dopo cinque falliti si è «bloccato», e allora **nemmeno un codice giusto**
 *    entra — la difesa sta a monte della verifica;
 *  - un codice giusto entra e azzera il conteggio del nome utente;
 *  - una sessione senza utente è «nonValido».
 *
 * Il tempo del TOTP lo si passa a mano (`quandoMs`); il tempo del conteggio lo
 * mette SQLite con `now`, e i cinque tentativi cadono tutti nello stesso istante
 * di orologio, cioè dentro la finestra.
 */

const IP = "203.0.113.7";
const ORA = Date.parse("2026-09-01T12:00:00Z");

let cartella;
let percorso;
let raw;
let utentiStore, chiudiPerTest;
let codiceAlPasso, passoDi;

/** Un codice a sei cifre garantito **diverso** da quello giusto per quel passo. */
function codiceSbagliato(segreto, quandoMs) {
  const giusto = codiceAlPasso(segreto, passoDi(quandoMs));
  const primaCifra = giusto[0] === "0" ? "1" : "0";
  return primaCifra + giusto.slice(1);
}

/** Crea un referente con il secondo fattore già attivo. Restituisce {id, utente, segreto}. */
function referenteConTotp(utente = "ref1") {
  const id = utentiStore.creaUtente({
    utente,
    ruolo: "gestore",
    nome: "Referente Di Prova",
    iniziali: "CP",
  });
  raw.prepare("UPDATE utenti SET stato = 'attivo' WHERE id = ?").run(id);
  const segreto = utentiStore.iniziaTotp(id);
  const ok = utentiStore.confermaTotp(id, codiceAlPasso(segreto, passoDi(ORA)), ORA);
  assert.equal(ok, true, "presupposto: l'attivazione riesce");
  return { id, utente, segreto };
}

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-2fa-limite-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  utentiStore = await import("@/lib/utenti");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  ({ codiceAlPasso, passoDi } = await import("@/lib/auth/totp"));

  const riferimenti = await import("@/lib/db/riferimenti");
  raw = new Database(percorso);
  riferimenti.assicuraRiferimenti();
});

beforeEach(() => {
  raw.prepare("delete from tentativi_accesso").run();
  raw.prepare("delete from sessioni").run();
  raw.prepare("delete from utenti").run();
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  rmSync(cartella, { recursive: true, force: true });
});

describe("verificaSecondoFattoreLimitato", () => {
  it("un codice giusto entra", () => {
    const { id, segreto } = referenteConTotp();
    const dopo = ORA + 120_000; // un passo non ancora consumato
    const r = utentiStore.verificaSecondoFattoreLimitato(id, IP, codiceAlPasso(segreto, passoDi(dopo)), dopo);
    assert.deepEqual(r, { esito: "ok" });
  });

  it("un codice sbagliato è «codiceErrato» e viene contato", () => {
    const { id, utente, segreto } = referenteConTotp();
    const r = utentiStore.verificaSecondoFattoreLimitato(id, IP, codiceSbagliato(segreto, ORA), ORA);
    assert.equal(r.esito, "codiceErrato");

    const perUtente = raw
      .prepare("select count(*) c from tentativi_accesso where tipo='utente' and chiave=?")
      .get(utente).c;
    const perIp = raw
      .prepare("select count(*) c from tentativi_accesso where tipo='ip' and chiave=?")
      .get(IP).c;
    assert.equal(perUtente, 1, "il fallimento è contato sul nome utente");
    assert.equal(perIp, 1, "e sull'indirizzo IP");
  });

  it("dopo cinque codici sbagliati si è bloccati: neanche un codice giusto entra", () => {
    const { id, segreto } = referenteConTotp();

    for (let i = 0; i < 5; i++) {
      const r = utentiStore.verificaSecondoFattoreLimitato(id, IP, codiceSbagliato(segreto, ORA), ORA);
      assert.equal(r.esito, "codiceErrato", `tentativo ${i + 1} è ancora un codice errato`);
    }

    // il sesto tentativo porta un codice GIUSTO, ma si è già bloccati: la difesa
    // sta prima della verifica
    const dopo = ORA + 120_000;
    const r = utentiStore.verificaSecondoFattoreLimitato(id, IP, codiceAlPasso(segreto, passoDi(dopo)), dopo);
    assert.equal(r.esito, "bloccato", "dopo cinque falliti si aspetta");
    assert.ok(r.minuti >= 1, "e si dice per quanti minuti");
  });

  it("un codice giusto azzera il conteggio del nome utente", () => {
    const { id, utente, segreto } = referenteConTotp();

    // quattro falliti (sotto la soglia), poi uno giusto
    for (let i = 0; i < 4; i++) {
      utentiStore.verificaSecondoFattoreLimitato(id, IP, codiceSbagliato(segreto, ORA), ORA);
    }
    const dopo = ORA + 120_000;
    const ok = utentiStore.verificaSecondoFattoreLimitato(id, IP, codiceAlPasso(segreto, passoDi(dopo)), dopo);
    assert.deepEqual(ok, { esito: "ok" });

    const perUtente = raw
      .prepare("select count(*) c from tentativi_accesso where tipo='utente' and chiave=?")
      .get(utente).c;
    assert.equal(perUtente, 0, "l'accesso riuscito azzera il conteggio del nome utente");
  });

  it("una sessione senza un utente valido è «nonValido»", () => {
    const r = utentiStore.verificaSecondoFattoreLimitato(999999, IP, "123456", ORA);
    assert.deepEqual(r, { esito: "nonValido" });
  });
});
