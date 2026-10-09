import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Il secondo fattore si sceglie per account (6 ottobre 2026).
 *
 * Lo sviluppatore lo toglie o lo rimette dalla schermata degli utenti. Il
 * predefinito resta «richiesto»: quello che c'è sempre stato, e quello che hanno
 * gli account già esistenti. Le prove sono tre: lo store (la colonna, e chi può
 * cambiarla), i conti della diagnostica (togliere il codice per scelta non è un
 * buco), e il sorgente delle due strade d'ingresso — la schermata dell'accesso e
 * l'invito — che sono gli unici posti in cui una sessione piena può nascere
 * senza il codice.
 */

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const leggi = (...p) => readFileSync(join(radice, ...p), "utf8");

let cartella, raw, utenti, diagnostica, chiudi;
let admin, altroAdmin, referente, ref1;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-mfa-"));
  process.env.SITO_DB = join(cartella, "test.db");
  process.env.SITO_TOTP_SEGRETO = randomBytes(48).toString("base64");
  raw = new Database(process.env.SITO_DB);
  migrate(drizzle(raw), { migrationsFolder: "./drizzle" });
  utenti = await import("@/lib/utenti");
  diagnostica = await import("@/lib/diagnostica");
  ({ chiudiPerTest: chiudi } = await import("@/lib/db/db"));
  (await import("@/lib/db/riferimenti")).assicuraRiferimenti();
});
after(() => {
  chiudi?.();
  raw?.close();
  rmSync(cartella, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const t of ["sessioni", "inviti", "utenti", "tentativi_accesso", "permessi"]) raw.prepare(`DELETE FROM ${t}`).run();
  admin = utenti.creaUtente({ utente: "admin", nome: "Admin", iniziali: "AD", ruolo: "sviluppatore" });
  altroAdmin = utenti.creaUtente({ utente: "admin2", nome: "Admin 2", iniziali: "A2", ruolo: "sviluppatore" });
  referente = utenti.creaUtente({ utente: "referente", nome: "Referente", iniziali: "CA", ruolo: "gestore" });
  ref1 = utenti.creaUtente({ utente: "ref1", nome: "Ref1", iniziali: "AK", ruolo: "referente", unita: "u1" });
  for (const id of [admin, altroAdmin, referente, ref1]) await utenti.impostaPassword(id, "password-sintetica-di-prova-2026");
});

const dati = (extra = {}) => ({ nome: "Nome", iniziali: "NO", email: "", ruolo: "referente", unita: "u1", ...extra });

describe("la colonna", () => {
  it("un account nuovo ha il secondo fattore richiesto, come chi esisteva già", () => {
    assert.equal(utenti.utentePerId(ref1).mfaRichiesto, true);
    // la migrazione lascia 1 a chi c'era: il predefinito è della colonna
    assert.equal(raw.prepare("SELECT mfa_richiesto AS m FROM utenti WHERE id = ?").get(ref1).m, 1);
  });

  it("alla creazione si può dire che non serve", () => {
    const id = utenti.creaUtente({ utente: "senza", nome: "Senza", iniziali: "SE", ruolo: "social", mfaRichiesto: false });
    assert.equal(utenti.utentePerId(id).mfaRichiesto, false);
    assert.equal(utenti.trovaUtente("senza").mfaRichiesto, false);
  });
});

describe("chi può cambiarla", () => {
  it("lo sviluppatore (completo) la toglie e la rimette", () => {
    assert.equal(utenti.modificaUtente(ref1, dati({ mfaRichiesto: false }), "admin", "completo", "referente"), "ok");
    assert.equal(utenti.utentePerId(ref1).mfaRichiesto, false);
    assert.equal(utenti.modificaUtente(ref1, dati({ mfaRichiesto: true }), "admin", "completo", "referente"), "ok");
    assert.equal(utenti.utentePerId(ref1).mfaRichiesto, true);
  });

  it("un campo assente non cambia niente", () => {
    utenti.modificaUtente(ref1, dati({ mfaRichiesto: false }), "admin", "completo", "referente");
    utenti.modificaUtente(ref1, dati({ nome: "Altro nome" }), "admin", "completo", "referente");
    assert.equal(utenti.utentePerId(ref1).mfaRichiesto, false, "salvare il nome non rimette il codice");
  });

  it("il gestore (limitato) salva l'account ma non tocca il secondo fattore", () => {
    assert.equal(utenti.modificaUtente(ref1, dati({ mfaRichiesto: false }), "referente", "limitato", "referente"), "ok");
    assert.equal(utenti.utentePerId(ref1).mfaRichiesto, true);
    assert.equal(utenti.utentePerId(ref1).nome, "Nome", "il resto del modulo è stato salvato");
  });
});

describe("l'ultimo amministratore", () => {
  it("uno senza codice per scelta conta come amministratore utilizzabile", () => {
    // `admin` non ha il codice attivo e lo deve avere: non è un amministratore
    // su cui contare, quindi `admin2` non si può revocare
    assert.equal(utenti.revoca(altroAdmin, "admin"), false);
    // tolto il secondo fattore per scelta, `admin` accede con la sola password
    // ed è un amministratore a tutti gli effetti
    const soloLui = { nome: "Admin", iniziali: "AD", email: "", ruolo: "sviluppatore", mfaRichiesto: false };
    assert.equal(utenti.modificaUtente(admin, soloLui, "admin2", "completo", "sviluppatore"), "ok");
    assert.equal(utenti.revoca(altroAdmin, "admin"), true);
  });
});

describe("la diagnostica", () => {
  it("senza codice per scelta non è un account da sollecitare", () => {
    raw.prepare("UPDATE utenti SET stato = 'attivo'").run();
    const prima = diagnostica.contiAccount();
    assert.equal(prima.senzaTotp, 4);
    assert.equal(prima.senzaPerScelta, 0);

    utenti.modificaUtente(ref1, dati({ mfaRichiesto: false }), "admin", "completo", "referente");
    const dopo = diagnostica.contiAccount();
    assert.equal(dopo.senzaTotp, 3, "non conta più fra quelli che il codice lo devono ancora attivare");
    assert.equal(dopo.senzaPerScelta, 1);
  });
});

describe("le due strade d'ingresso senza codice", () => {
  const accedi = leggi("app", "(area)", "area-riservata", "accedi", "actions.ts");
  const invito = leggi("app", "(area)", "area-riservata", "invito", "[token]", "actions.ts");

  it("l'accesso apre la sessione piena solo se l'account non ha il segno, prima della mezza sessione", () => {
    const i = accedi.indexOf("if (!esito.utente.mfaRichiesto) return entraConLaSolaPassword(");
    const m = accedi.indexOf("return apriMezzaSessione(esito.utente.id, da);");
    assert.ok(i > 0 && m > i, "il ramo senza codice sta prima di quello con il codice");
    // quella funzione fa le stesse cose del secondo passo: azzera, registra, rispetta la password provvisoria
    const f = accedi.slice(accedi.indexOf("async function entraConLaSolaPassword"), accedi.indexOf("export async function accedi("));
    assert.match(f, /azzera\(utente\.utente\)/);
    assert.match(f, /registraAccesso\(/);
    assert.match(f, /passwordDaCambiare/);
  });

  it("questo ramo è la sola apertura di una sessione «attiva» senza codice", () => {
    const aperture = [...accedi.matchAll(/apri\([^;]*"attiva"\)/g)];
    assert.equal(aperture.length, 1);
  });

  it("l'invito va dritto dentro solo per chi non ha il secondo fattore", () => {
    assert.match(invito, /utente && !utente\.mfaRichiesto/);
    assert.match(invito, /"attesa_totp"/, "per tutti gli altri resta la mezza sessione");
  });

  it("la creazione dell'account ignora la richiesta di toglierlo, se chi invita non ha completo", () => {
    const azioni = leggi("app", "(area)", "area-riservata", "utenti", "actions.ts");
    assert.match(azioni, /const mfaRichiesto = !\(senzaMfa && ctx\.livello === "completo"\);/);
  });
});
