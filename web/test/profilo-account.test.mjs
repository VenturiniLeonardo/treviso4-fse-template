import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
let cartella, raw, utenti, sessioni, sicurezza, totp, permessi, decisione, chiudi;
let admin, referente, target, token, sessioneId, segreto;
before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-profilo-account-"));
  process.env.SITO_DB = join(cartella, "test.db");
  process.env.SITO_TOTP_SEGRETO = randomBytes(48).toString("base64");
  raw = new Database(process.env.SITO_DB);
  migrate(drizzle(raw), { migrationsFolder: "./drizzle" });
  utenti = await import("@/lib/utenti"); sessioni = await import("@/lib/auth/sessioni");
  sicurezza = await import("@/lib/auth/profilo-sicurezza"); totp = await import("@/lib/auth/totp");
  permessi = await import("@/lib/permessi"); decisione = await import("@/lib/auth/decisione");
  ({ chiudiPerTest: chiudi } = await import("@/lib/db/db"));
  (await import("@/lib/db/riferimenti")).assicuraRiferimenti();
});
after(() => { chiudi?.(); raw?.close(); rmSync(cartella, { recursive: true, force: true }); });
beforeEach(async () => {
  for (const t of ["sessioni", "inviti", "utenti", "tentativi_accesso", "permessi"]) raw.prepare(`DELETE FROM ${t}`).run();
  admin = utenti.creaUtente({ utente: "admin", nome: "Admin", iniziali: "AD", ruolo: "sviluppatore" });
  referente = utenti.creaUtente({ utente: "referente", nome: "Referente", iniziali: "CA", ruolo: "gestore" });
  target = utenti.creaUtente({ utente: "ref1", nome: "Ref1", iniziali: "AK", ruolo: "referente", unita: "u1" });
  for (const id of [admin, referente, target]) await utenti.impostaPassword(id, "password-sintetica-di-prova-2026");
  segreto = utenti.iniziaTotp(admin);
  const prima = Date.now() - 60000;
  assert.ok(utenti.confermaTotp(admin, totp.codiceAlPasso(segreto, totp.passoDi(prima)), prima));
  token = sessioni.apri(admin, "203.0.113.1"); sessioneId = sessioni.leggi(token).id;
});
const dati = (ruolo = "referente", unita = "u1") => ({ nome: "Nome aggiornato", iniziali: "NA", email: "nome@example.invalid", ruolo, ...(unita ? { unita } : {}) });
describe("sessioni del profilo", () => {
  it("non elenca sessioni altrui, scadute o in attesa né restituisce credenziali", () => {
    sessioni.apri(referente, null); sessioni.apri(admin, null, "attesa_totp");
    const scaduta = sessioni.apri(admin, null);
    raw.prepare("UPDATE sessioni SET scade_il = '2000-01-01' WHERE impronta = ?").run(sessioni.improntaDi(scaduta));
    const lista = sessioni.elencoSessioniPerUtente(admin, token);
    assert.equal(lista.length, 1); assert.equal(lista[0].corrente, true);
    assert.ok(!("impronta" in lista[0]) && !("token" in lista[0]));
  });
  it("non chiude la sessione corrente o altrui, chiude quella propria scelta", () => {
    const altrui = sessioni.apri(referente, null), propria = sessioni.apri(admin, null);
    assert.equal(sessioni.chiudiSessionePerUtente(admin, sessioni.leggi(altrui).id, token), false);
    assert.equal(sessioni.chiudiSessionePerUtente(admin, sessioneId, token), false);
    assert.equal(sessioni.chiudiSessionePerUtente(admin, sessioni.leggi(propria).id, token), true);
    assert.equal(sessioni.leggi(propria), null); assert.ok(sessioni.leggi(token)); assert.ok(sessioni.leggi(altrui));
  });
});
describe("recupero e sostituzione del secondo fattore", () => {
  it("salva soltanto impronte e accetta ogni codice una sola volta", () => {
    const codici = sicurezza.generaCodiciRecupero(admin, sessioneId); assert.equal(codici.length, 8);
    const salvati = raw.prepare("SELECT codici_recupero FROM utenti WHERE id = ?").get(admin).codici_recupero;
    assert.ok(!salvati.includes(codici[0].replaceAll("-", "")));
    assert.equal(sicurezza.consumaCodiceRecupero(referente, codici[0]), false);
    assert.equal(sicurezza.consumaCodiceRecupero(admin, codici[0]), true);
    assert.equal(sicurezza.consumaCodiceRecupero(admin, codici[0]), false);
    assert.equal(sicurezza.numeroCodiciRecupero(admin), 7);
  });
  it("applica il limite tentativi e rifiuta account revocati", () => {
    const codici = sicurezza.generaCodiciRecupero(admin, sessioneId);
    for (let n = 0; n < 5; n++) assert.equal(utenti.verificaSecondoFattoreLimitato(admin, "203.0.113.5", "0".repeat(32)).esito, "codiceErrato");
    assert.equal(utenti.verificaSecondoFattoreLimitato(admin, "203.0.113.5", codici[0]).esito, "bloccato");
    assert.equal(sicurezza.numeroCodiciRecupero(admin), 8);
    raw.prepare("DELETE FROM tentativi_accesso").run();
    assert.deepEqual(utenti.verificaSecondoFattoreLimitato(admin, "203.0.113.5", codici[0]), { esito: "ok", recupero: true });
    utenti.revoca(admin); assert.equal(sicurezza.consumaCodiceRecupero(admin, codici[1]), false);
  });
  it("una nuova serie annulla la precedente", () => {
    const vecchi = sicurezza.generaCodiciRecupero(admin, sessioneId), nuovi = sicurezza.generaCodiciRecupero(admin, sessioneId);
    assert.equal(sicurezza.consumaCodiceRecupero(admin, vecchi[0]), false);
    assert.equal(sicurezza.consumaCodiceRecupero(admin, nuovi[0]), true);
  });
  it("richiede la sessione propria, attiva e non scaduta", () => {
    const altrui = sessioni.leggi(sessioni.apri(referente, null)).id;
    assert.equal(sicurezza.preparaAutenticatore(admin, altrui), null);
    assert.equal(sicurezza.generaCodiciRecupero(admin, altrui), null);
    raw.prepare("UPDATE sessioni SET scade_il = '2000-01-01' WHERE id = ?").run(sessioneId);
    assert.equal(sicurezza.preparaAutenticatore(admin, sessioneId), null);
  });
  it("conserva il vecchio autenticatore fino alla conferma corretta", () => {
    sicurezza.preparaAutenticatore(admin, sessioneId);
    assert.equal(sicurezza.confermaAutenticatore(admin, sessioneId, "errato"), null);
    const ora = Date.now(); assert.equal(utenti.verificaTotpDi(admin, totp.codiceAlPasso(segreto, totp.passoDi(ora)), ora), true);
  });
  it("la conferma è legata alla sessione di origine e scade dopo cinque minuti", () => {
    const nuovo = sicurezza.preparaAutenticatore(admin, sessioneId), altraId = sessioni.leggi(sessioni.apri(admin, null)).id;
    const codice = totp.codiceAlPasso(nuovo, totp.passoDi(Date.now()));
    assert.equal(sicurezza.confermaAutenticatore(admin, altraId, codice), null);
    raw.prepare("UPDATE utenti SET totp_in_attesa_scade_il = '2000-01-01' WHERE id = ?").run(admin);
    assert.equal(sicurezza.confermaAutenticatore(admin, sessioneId, codice), null);
  });
  it("sostituisce il segreto, chiude altre sessioni e invalida vecchi codici e replay", () => {
    const vecchi = sicurezza.generaCodiciRecupero(admin, sessioneId), altro = sessioni.apri(admin, null);
    const nuovo = sicurezza.preparaAutenticatore(admin, sessioneId), codice = totp.codiceAlPasso(nuovo, totp.passoDi(Date.now()));
    const codici = sicurezza.confermaAutenticatore(admin, sessioneId, codice);
    assert.equal(codici.length, 8); assert.equal(sessioni.leggi(altro), null); assert.ok(sessioni.leggi(token));
    assert.equal(sicurezza.consumaCodiceRecupero(admin, vecchi[0]), false);
    assert.equal(sicurezza.confermaAutenticatore(admin, sessioneId, codice), null);
    assert.equal(utenti.verificaTotpDi(admin, codice), false);
    assert.equal(sicurezza.consumaCodiceRecupero(admin, codici[0]), true);
  });
});
describe("account e autorizzazioni distinti", () => {
  it("gestire utenti non concede la matrice, anche con completo contraffatto", () => {
    const matrice = permessi.FUNZIONI_INIZIALI.map((f) => ({ ...f, livelli: { ...f.livelli, "gestore": "completo" } }));
    const sessione = { u: "referente", r: "gestore", n: "Referente", i: "CA", exp: 0 };
    assert.equal(decisione.decidi(matrice, sessione, "utenti").ok, true);
    assert.equal(decisione.decidi(matrice, sessione, "permessi").ok, false);
    assert.equal(decisione.decidi(matrice, sessione, "permessi-leggi").ok, true);
    assert.equal(permessi.ammesso("permessi", "sviluppatore", "nessuno"), false);
  });
  it("aggiorna nome, email e unità senza cambiare credenziali", () => {
    const prima = raw.prepare("SELECT password_hash FROM utenti WHERE id = ?").get(target).password_hash;
    assert.equal(utenti.modificaUtente(target, dati("referente", "u4"), "referente", "limitato", "referente"), "ok");
    assert.equal(utenti.utentePerId(target).unita, "u4");
    assert.equal(utenti.utentePerId(target).email, "nome@example.invalid");
    assert.equal(raw.prepare("SELECT password_hash FROM utenti WHERE id = ?").get(target).password_hash, prima);
  });
  it("non permette promozioni o modifiche a pari grado al gestore", () => {
    assert.equal(utenti.modificaUtente(target, dati("sviluppatore", ""), "referente", "limitato", "referente"), "negato");
    assert.equal(utenti.modificaUtente(admin, dati(), "referente", "limitato", "sviluppatore"), "negato");
  });
  it("non cambia il proprio ruolo e conserva l'ultimo amministratore utilizzabile", async () => {
    assert.equal(utenti.modificaUtente(admin, dati("gestore", ""), "admin", "completo", "sviluppatore"), "negato");
    assert.equal(utenti.modificaUtente(admin, dati("gestore", ""), "referente", "completo", "sviluppatore"), "negato");
    const altro = utenti.creaUtente({ utente: "altro-admin", nome: "Altro Admin", iniziali: "AA", ruolo: "sviluppatore" });
    await utenti.impostaPassword(altro, "password-sintetica-secondo-admin");
    assert.equal(utenti.modificaUtente(admin, dati("gestore", ""), "altro-admin", "completo", "sviluppatore"), "ultimoAdmin");
    assert.equal(utenti.revoca(admin, "altro-admin"), false);
  });
  it("rilegge il permesso chiuso dopo l'autorizzazione iniziale", () => {
    raw.prepare("INSERT INTO permessi (funzione,nome,ruolo,livello,ordine) VALUES ('utenti','Utenti','sviluppatore','nessuno',0)").run();
    assert.equal(utenti.modificaUtente(target, dati(), "admin", "completo", "referente"), "negato");
    assert.equal(utenti.revoca(target, "admin"), false);
    assert.equal(utenti.utentePerId(target).nome, "Ref1");
  });
  it("rifiuta ruoli cambiati dopo la lettura, bersagli o operatori revocati", () => {
    assert.equal(utenti.modificaUtente(target, dati(), "admin", "completo", "social"), "cambiato");
    utenti.revoca(admin); assert.equal(utenti.modificaUtente(target, dati(), "admin", "completo", "referente"), "negato");
    utenti.revoca(target); assert.equal(utenti.modificaUtente(target, dati(), "referente", "limitato", "referente"), "cambiato");
  });
});


describe("migrazione da una matrice già configurata", () => {
  it("aggiunge le autorizzazioni separate senza riaprire quelle chiuse", () => {
    const precedenti = join(cartella, "migrazioni-precedenti");
    cpSync("./drizzle", precedenti, { recursive: true });
    const percorsoJournal = join(precedenti, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(percorsoJournal, "utf8"));
    journal.entries = journal.entries.filter((e) => e.idx < 16);
    writeFileSync(percorsoJournal, JSON.stringify(journal));
    const vecchio = new Database(join(cartella, "vecchio.db"));
    try {
      migrate(drizzle(vecchio), { migrationsFolder: precedenti });
      vecchio.prepare("INSERT INTO permessi (funzione,nome,ruolo,livello,ordine) VALUES ('utenti','Vecchio nome','gestore','nessuno',0)").run();
      migrate(drizzle(vecchio), { migrationsFolder: "./drizzle" });
      assert.equal(vecchio.prepare("SELECT livello FROM permessi WHERE funzione='utenti'").get().livello, "nessuno");
      assert.equal(vecchio.prepare("SELECT count(*) n FROM permessi WHERE funzione IN ('permessi','permessi-leggi')").get().n, 8);
      assert.equal(vecchio.prepare("SELECT livello FROM permessi WHERE funzione='permessi' AND ruolo='gestore'").get().livello, "nessuno");
      assert.equal(vecchio.prepare("SELECT livello FROM permessi WHERE funzione='permessi' AND ruolo='sviluppatore'").get().livello, "completo");
    } finally { vecchio.close(); }
  });
  it("non crea una matrice parziale su una nuova installazione", () => {
    const nuova = new Database(join(cartella, "nuova.db"));
    try {
      migrate(drizzle(nuova), { migrationsFolder: "./drizzle" });
      assert.equal(nuova.prepare("SELECT count(*) n FROM permessi").get().n, 0);
    } finally { nuova.close(); }
  });
});
