import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * La cifratura a riposo del segreto TOTP — dall'audit di produzione (SEC-03).
 *
 * Due cose da provare, diverse fra loro:
 *
 *  - la cifratura in sé: che quello che esce non sia il testo, che si riapra, e
 *    che una manomissione venga rilevata invece di restituire un segreto storto;
 *  - la retrocompatibilità: che un segreto scritto **in chiaro** prima della
 *    cifratura continui a funzionare, perché è la proprietà che tiene dentro chi
 *    aveva già attivato il secondo fattore.
 *
 * La chiave si accende e si spegne con `SITO_TOTP_SEGRETO`: il modulo la
 * rilegge dall'ambiente a ogni chiamata, quindi le prove la cambiano di caso in
 * caso.
 */

const CHIAVE = "chiave-di-prova-lunga-abbastanza-per-un-audit-000";

let cartella;
let percorso;
let raw;
let cifraturaMod, utentiStore, totp, chiudiPerTest;
let codiceAlPasso, passoDi, nuovoSegreto;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-cifratura-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  cifraturaMod = await import("@/lib/auth/cifratura");
  utentiStore = await import("@/lib/utenti");
  totp = await import("@/lib/auth/totp");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  ({ codiceAlPasso, passoDi, nuovoSegreto } = totp);

  const riferimenti = await import("@/lib/db/riferimenti");
  raw = new Database(percorso);
  riferimenti.assicuraRiferimenti();
});

beforeEach(() => {
  raw.prepare("delete from utenti").run();
  delete process.env.SITO_TOTP_SEGRETO;
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  delete process.env.SITO_TOTP_SEGRETO;
  rmSync(cartella, { recursive: true, force: true });
});

describe("cifra e decifra", () => {
  it("con chiave: quello che esce non è il testo, e si riapre", () => {
    process.env.SITO_TOTP_SEGRETO = CHIAVE;
    const { cifra, decifra, cifraturaAttiva } = cifraturaMod;
    assert.equal(cifraturaAttiva(), true);

    const segreto = "JBSWY3DPEHPK3PXP";
    const cifrato = cifra(segreto);
    assert.ok(cifrato.startsWith("g1:"), "il valore cifrato porta il prefisso di versione");
    assert.notEqual(cifrato, segreto, "il testo in chiaro non deve comparire");
    assert.equal(decifra(cifrato), segreto, "il round-trip riporta il segreto originale");
  });

  it("l'IV è casuale: due cifrature dello stesso testo differiscono", () => {
    process.env.SITO_TOTP_SEGRETO = CHIAVE;
    const { cifra, decifra } = cifraturaMod;
    const uno = cifra("STESSOSEGRETO");
    const due = cifra("STESSOSEGRETO");
    assert.notEqual(uno, due, "senza IV casuale due cifrature sarebbero identiche");
    assert.equal(decifra(uno), "STESSOSEGRETO");
    assert.equal(decifra(due), "STESSOSEGRETO");
  });

  it("una manomissione viene rilevata (tag GCM), non ignorata", () => {
    process.env.SITO_TOTP_SEGRETO = CHIAVE;
    const { cifra, decifra } = cifraturaMod;
    const cifrato = cifra("SEGRETODAPROTEGGERE");
    // si gira un carattere del corpo base64: il tag di autenticazione non torna
    const corpo = cifrato.slice("g1:".length);
    const guasto = "g1:" + (corpo[0] === "A" ? "B" : "A") + corpo.slice(1);
    assert.throws(() => decifra(guasto), "una decifratura manomessa deve fallire, non restituire dati");
  });

  it("senza chiave: comportamento storico (passa così com'è)", () => {
    delete process.env.SITO_TOTP_SEGRETO;
    const { cifra, decifra, cifraturaAttiva } = cifraturaMod;
    assert.equal(cifraturaAttiva(), false);
    assert.equal(cifra("JBSWY3DPEHPK3PXP"), "JBSWY3DPEHPK3PXP", "senza chiave non si cifra");
    assert.equal(decifra("JBSWY3DPEHPK3PXP"), "JBSWY3DPEHPK3PXP", "un valore in chiaro torna com'è");
  });

  it("un valore cifrato letto senza la chiave è un errore, non un segreto storto", () => {
    process.env.SITO_TOTP_SEGRETO = CHIAVE;
    const cifrato = cifraturaMod.cifra("JBSWY3DPEHPK3PXP");
    delete process.env.SITO_TOTP_SEGRETO;
    assert.throws(() => cifraturaMod.decifra(cifrato));
  });
});

describe("i segreti TOTP nel database", () => {
  const ORA = Date.parse("2026-09-01T12:00:00Z");

  function creaReferente() {
    return utentiStore.creaUtente({
      utente: "referente-prova",
      ruolo: "gestore",
      nome: "Referente Di Prova",
      iniziali: "CP",
    });
  }

  it("con chiave: nel database il segreto è cifrato, ma attivazione e verifica funzionano", () => {
    process.env.SITO_TOTP_SEGRETO = CHIAVE;
    const id = creaReferente();

    const segreto = utentiStore.iniziaTotp(id); // ritorna il segreto IN CHIARO, per il QR
    const memorizzato = raw.prepare("select totp_secret s from utenti where id = ?").get(id).s;
    assert.ok(memorizzato.startsWith("g1:"), "nel database il segreto dev'essere cifrato");
    assert.notEqual(memorizzato, segreto, "il segreto in chiaro non deve stare nel database");

    // e la schermata di attivazione riottiene il segreto in chiaro
    assert.equal(utentiStore.assicuraSegretoTotp(id), segreto);

    // attivazione e uso: il flusso completo passa dalla decifratura
    assert.equal(utentiStore.confermaTotp(id, codiceAlPasso(segreto, passoDi(ORA)), ORA), true);
    assert.equal(utentiStore.utentePerId(id).totpAttivo, true);

    const dopo = ORA + 120_000; // qualche passo più avanti, per non riusare il passo consumato
    assert.equal(utentiStore.verificaTotpDi(id, codiceAlPasso(segreto, passoDi(dopo)), dopo), true);
  });

  it("retrocompatibile: un segreto storico in chiaro funziona anche con la chiave accesa", () => {
    process.env.SITO_TOTP_SEGRETO = CHIAVE;
    const id = creaReferente();

    // si simula un segreto scritto prima della cifratura: in chiaro, senza prefisso
    const segreto = nuovoSegreto();
    raw.prepare("update utenti set totp_secret = ? where id = ?").run(segreto, id);

    // `decifra` vede che non ha il prefisso e lo lascia com'è: l'attivazione riesce
    assert.equal(utentiStore.confermaTotp(id, codiceAlPasso(segreto, passoDi(ORA)), ORA), true);
    assert.equal(utentiStore.utentePerId(id).totpAttivo, true);
  });
});
