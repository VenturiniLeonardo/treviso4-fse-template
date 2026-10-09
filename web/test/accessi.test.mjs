import assert from "node:assert/strict";
import { createHash, randomBytes, scrypt } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * L'autenticazione su SQLite — fase 6.
 *
 * Le prove che contano sono quelle sulle **cose che prima non si potevano
 * fare**: revocare una sessione, impedire il riuso di un codice, contare i
 * tentativi attraverso un riavvio. Il resto — «l'utente si trova», «la password
 * si verifica» — è controllo di routine.
 *
 * Il tempo si muove scrivendo le colonne a mano con SQL grezzo. È l'unico modo
 * onesto: gli istanti li mette SQLite con `strftime('now')`, e una prova che
 * aspetta otto ore non è una prova.
 */

let cartella;
let percorso;
let raw;
let utentiStore, sessioni, tentativi, inviti, riferimenti;
let chiudiPerTest;
let codiceAlPasso, passoDi;

const scryptAsync = promisify(scrypt);

/** Un hash nel formato vecchio, come lo scriveva `utenti.json`. */
async function hashScrypt(password) {
  const salt = randomBytes(16);
  const derivata = await scryptAsync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return ["scrypt", 16384, 8, 1, salt.toString("base64"), derivata.toString("base64")].join("$");
}

/** Sposta indietro nel tempo una colonna di una riga. */
function indietro(tabella, id, colonna, secondi) {
  raw
    .prepare(
      `update ${tabella} set ${colonna} = strftime('%Y-%m-%dT%H:%M:%SZ','now', ?) where id = ?`,
    )
    .run(`-${secondi} seconds`, id);
}

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-accessi-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  utentiStore = await import("@/lib/utenti");
  sessioni = await import("@/lib/auth/sessioni");
  tentativi = await import("@/lib/auth/tentativi");
  inviti = await import("@/lib/auth/inviti");
  riferimenti = await import("@/lib/db/riferimenti");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  ({ codiceAlPasso, passoDi } = await import("@/lib/auth/totp"));

  raw = new Database(percorso);
  // le unità servono: un referente di unità senza `unita_id` lo rifiuta il CHECK
  riferimenti.assicuraRiferimenti();
});

const IP = "203.0.113.7";

beforeEach(() => {
  for (const t of ["sessioni", "inviti", "tentativi_accesso", "utenti"]) {
    raw.prepare(`delete from ${t}`).run();
  }
});

after(() => {
  chiudiPerTest();
  raw?.close();
  rmSync(cartella, { recursive: true, force: true });
});

/** Un gestore attivo con la password data. */
async function gestore(password = "password-di-prova") {
  const id = utentiStore.creaUtente({
    utente: "cg",
    ruolo: "gestore",
    nome: "Referente Gruppo",
    iniziali: "CG",
  });
  await utentiStore.impostaPassword(id, password);
  return id;
}

// =========================================================================

describe("gli account", () => {
  it("si creano invitati, senza password: non ci si entra", async () => {
    const id = utentiStore.creaUtente({
      utente: "Nuovo",
      ruolo: "gestore",
      nome: "Nome",
      iniziali: "NN",
    });
    const u = utentiStore.utentePerId(id);
    assert.equal(u.stato, "invitato");
    assert.equal(u.haPassword, false);
    assert.equal(await utentiStore.verificaCredenziali("nuovo", "qualunque"), null);
  });

  it("il nome utente si salva in minuscolo e si cerca senza distinzione", async () => {
    await gestore();
    assert.equal(utentiStore.trovaUtente("CG").utente, "cg");
    assert.equal(utentiStore.trovaUtente("  Cg  ").utente, "cg");
  });

  it("due account con lo stesso nome in maiuscole diverse non convivono", async () => {
    await gestore();
    assert.throws(() =>
      utentiStore.creaUtente({ utente: "CG", ruolo: "gestore", nome: "X", iniziali: "XX" }),
    );
  });

  it("un referente di unità porta la chiave dell'unità, non l'identificativo", () => {
    const id = utentiStore.creaUtente({
      utente: "ref1",
      ruolo: "referente",
      nome: "Ref1",
      iniziali: "AK",
      unita: "u1",
    });
    assert.equal(utentiStore.utentePerId(id).unita, "u1");
  });

  it("un referente di unità senza unità è rifiutato dallo schema, non accomodato", () => {
    assert.throws(() =>
      utentiStore.creaUtente({
        utente: "ref1",
        ruolo: "referente",
        nome: "Ref1",
        iniziali: "AK",
      }),
    );
  });

  it("un'unità che non esiste è un errore che dice quale", () => {
    assert.throws(
      () =>
        utentiStore.creaUtente({
          utente: "x",
          ruolo: "referente",
          nome: "X",
          iniziali: "XX",
          unita: "castorini",
        }),
      /castorini/,
    );
  });
});

describe("le credenziali", () => {
  it("passano quelle giuste e non dicono quale campo era sbagliato", async () => {
    await gestore("password-di-prova");
    assert.equal((await utentiStore.verificaCredenziali("cg", "password-di-prova")).utente, "cg");
    assert.equal(await utentiStore.verificaCredenziali("cg", "sbagliata-1234"), null);
    assert.equal(await utentiStore.verificaCredenziali("nessuno", "password-di-prova"), null);
  });

  it("un account revocato non entra, anche con la password giusta", async () => {
    const id = await gestore("password-di-prova");
    utentiStore.revoca(id);
    assert.equal(await utentiStore.verificaCredenziali("cg", "password-di-prova"), null);
  });

  it("un hash scrypt del file vecchio funziona ancora, e viene riscritto", async () => {
    const id = utentiStore.creaUtente({
      utente: "vecchio",
      ruolo: "gestore",
      nome: "Vecchio",
      iniziali: "VV",
    });
    raw
      .prepare("update utenti set password_hash = ?, stato = 'attivo' where id = ?")
      .run(await hashScrypt("password-del-2025"), id);

    // entra
    assert.ok(await utentiStore.verificaCredenziali("vecchio", "password-del-2025"));
    // e adesso l'hash è argon2id, senza che nessuno abbia fatto niente
    const dopo = raw.prepare("select password_hash h from utenti where id = ?").get(id).h;
    assert.match(dopo, /^\$argon2id\$/);
    // e la password è ancora quella
    assert.ok(await utentiStore.verificaCredenziali("vecchio", "password-del-2025"));
  });

  it("la configurazione manca finché non c'è un attivo con password", async () => {
    assert.equal(utentiStore.configurazioneMancante(), true);
    const id = utentiStore.creaUtente({
      utente: "solo-invitato",
      ruolo: "gestore",
      nome: "N",
      iniziali: "NN",
    });
    assert.equal(utentiStore.configurazioneMancante(), true, "un invitato non basta");
    await utentiStore.impostaPassword(id, "password-di-prova");
    assert.equal(utentiStore.configurazioneMancante(), false);
  });

  it("il cambio password vuole quella vecchia", async () => {
    await gestore("password-di-prova");
    assert.match(
      (await utentiStore.cambiaPassword("cg", "sbagliata-1234", "nuova-password-1", IP)).errore,
      /non è corretta/,
    );
    assert.equal((await utentiStore.cambiaPassword("cg", "password-di-prova", "corta", IP)).ok, false);
    assert.equal(
      (await utentiStore.cambiaPassword("cg", "password-di-prova", "nuova-password-1", IP)).ok,
      true,
    );
    assert.ok(await utentiStore.verificaCredenziali("cg", "nuova-password-1"));
    assert.equal(await utentiStore.verificaCredenziali("cg", "password-di-prova"), null);
  });

  it("la password attuale ha lo stesso limite dell'accesso (AUTH-03)", async () => {
    await gestore("password-di-prova");
    for (let i = 0; i < 5; i++) {
      assert.match(
        (await utentiStore.cambiaPassword("cg", `sbagliata-${i}-1234`, "nuova-password-1", IP)).errore,
        /non è corretta/,
      );
    }
    const bloccato = await utentiStore.cambiaPassword("cg", "password-di-prova", "nuova-password-1", IP);
    assert.equal(bloccato.ok, false, "al sesto tentativo neanche quella giusta passa");
    assert.match(bloccato.errore, /Troppi tentativi/);
    assert.ok(await utentiStore.verificaCredenziali("cg", "password-di-prova"), "la password non è cambiata");
  });
});

describe("la password provvisoria", () => {
  /** Un account preparato come fa `scripts/account-iniziali.mjs`. */
  async function provvisorio(password = "provv-2026!") {
    const id = utentiStore.creaUtente({ utente: "cg", ruolo: "gestore", nome: "CG", iniziali: "CG" });
    await utentiStore.impostaPasswordProvvisoria(id, password);
    return id;
  }

  it("attiva l'account anche sotto il minimo di dodici caratteri, e lo segna", async () => {
    const id = await provvisorio();
    const u = await utentiStore.verificaCredenziali("cg", "provv-2026!");
    assert.ok(u, "con la provvisoria si passa il primo passo dell'accesso");
    assert.equal(u.passwordDaCambiare, true);
    assert.equal(utentiStore.configurazioneMancante(), false);
    assert.deepEqual(utentiStore.contiInutilizzabili(), []);
    assert.equal(sessioni.leggi(sessioni.apri(id, null)).daCambiare, true);
  });

  it("finché resta, la sessione piena non apre l'area (sessioneCorrente)", async () => {
    const sorgente = (await import("node:fs")).readFileSync("lib/sessione-server.ts", "utf8");
    assert.match(sorgente, /viva\.stato === "attiva" && !viva\.daCambiare/);
    const proxy = (await import("node:fs")).readFileSync("proxy.ts", "utf8");
    assert.match(proxy, /if \(daCambiare\) return rimanda\(CAMBIO, req\)/);
  });

  it("il cambio la toglie, e la sessione aperta se ne accorge subito", async () => {
    const id = await provvisorio();
    const token = sessioni.apri(id, null);
    assert.match(
      (await utentiStore.cambiaPassword("cg", "provv-2026!", "provv-2026!", IP)).errore,
      /dodici|12/,
      "la provvisoria non si può tenere: è sotto il minimo",
    );
    const esito = await utentiStore.cambiaPassword("cg", "provv-2026!", "una-password-mia-2026", IP);
    assert.equal(esito.ok, true);
    assert.equal(sessioni.leggi(token).daCambiare, false);
    assert.equal(utentiStore.utentePerId(id).passwordDaCambiare, false);
    assert.equal(await utentiStore.verificaCredenziali("cg", "provv-2026!"), null);
  });

  it("una password nuova uguale a quella attuale è rifiutata", async () => {
    await provvisorio("provvisoria-lunga-2026");
    const esito = await utentiStore.cambiaPassword(
      "cg",
      "provvisoria-lunga-2026",
      "provvisoria-lunga-2026",
      IP,
    );
    assert.match(esito.errore, /diversa/);
    assert.equal(utentiStore.trovaUtente("cg").passwordDaCambiare, true);
  });

  it("anche un invito accettato la toglie", async () => {
    const id = await provvisorio();
    await utentiStore.impostaPassword(id, "scelta-con-invito-2026");
    assert.equal(utentiStore.utentePerId(id).passwordDaCambiare, false);
  });
});

describe("il secondo fattore", () => {
  it("non è attivo finché il primo codice non è stato confermato", async () => {
    const id = await gestore();
    assert.equal(utentiStore.utentePerId(id).totpAttivo, false);

    const segreto = utentiStore.iniziaTotp(id);
    assert.equal(utentiStore.utentePerId(id).totpAttivo, false, "il segreto non basta");

    const ora = Date.now();
    assert.equal(utentiStore.confermaTotp(id, codiceAlPasso(segreto, passoDi(ora)), ora), true);
    assert.equal(utentiStore.utentePerId(id).totpAttivo, true);
  });

  it("un codice sbagliato non attiva niente", async () => {
    const id = await gestore();
    utentiStore.iniziaTotp(id);
    assert.equal(utentiStore.confermaTotp(id, "000000"), false);
    assert.equal(utentiStore.utentePerId(id).totpAttivo, false);
  });

  it("un codice non si usa due volte — RFC 6238 §5.2", async () => {
    const id = await gestore();
    const segreto = utentiStore.iniziaTotp(id);
    const ora = Date.now();
    utentiStore.confermaTotp(id, codiceAlPasso(segreto, passoDi(ora)), ora);

    // il passo dopo va bene
    const dopo = ora + 30_000;
    const codice = codiceAlPasso(segreto, passoDi(dopo));
    assert.equal(utentiStore.verificaTotpDi(id, codice, dopo), true);
    // lo stesso, di nuovo, no
    assert.equal(utentiStore.verificaTotpDi(id, codice, dopo), false);
  });

  it("un segreto generato e mai confermato non chiude fuori nessuno", async () => {
    const id = await gestore();
    const primo = utentiStore.iniziaTotp(id);
    // attivazione lasciata a metà: si ricomincia, e il segreto è un altro
    const secondo = utentiStore.iniziaTotp(id);
    assert.notEqual(primo, secondo);
    assert.equal(utentiStore.utentePerId(id).totpAttivo, false);
  });

  it("azzerarlo riporta l'account alla schermata di attivazione", async () => {
    const id = await gestore();
    const segreto = utentiStore.iniziaTotp(id);
    const ora = Date.now();
    utentiStore.confermaTotp(id, codiceAlPasso(segreto, passoDi(ora)), ora);

    utentiStore.azzeraTotp(id);
    assert.equal(utentiStore.utentePerId(id).totpAttivo, false);
    assert.equal(utentiStore.verificaTotpDi(id, codiceAlPasso(segreto, passoDi(ora) + 5)), false);
  });
});

describe("le sessioni", () => {
  it("nel database c'è l'impronta, non il token", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, "10.0.0.1");
    const riga = raw.prepare("select impronta from sessioni").get();
    assert.equal(riga.impronta, createHash("sha256").update(token).digest("hex"));
    assert.notEqual(riga.impronta, token);
    // e il token non compare da nessuna parte nella tabella
    const tutto = JSON.stringify(raw.prepare("select * from sessioni").all());
    assert.equal(tutto.includes(token), false);
  });

  it("restituisce ruolo e unità presi da `utenti`, non dal cookie", () => {
    const id = utentiStore.creaUtente({
      utente: "ref1",
      ruolo: "referente",
      nome: "Ref1",
      iniziali: "AK",
      unita: "u1",
    });
    raw.prepare("update utenti set stato='attivo' where id = ?").run(id);
    const token = sessioni.apri(id, null);

    assert.deepEqual(sessioni.leggi(token).sessione.r, "referente");
    assert.equal(sessioni.leggi(token).sessione.un, "u1");

    // il ruolo cambia nel database: la sessione lo sa alla richiesta dopo, e
    // non fra otto ore come con il cookie firmato
    raw.prepare("update utenti set ruolo='gestore', unita_id=null where id = ?").run(id);
    assert.equal(sessioni.leggi(token).sessione.r, "gestore");
    assert.equal(sessioni.leggi(token).sessione.un, undefined);
  });

  it("un token sconosciuto o assente è `null`, senza distinzioni", () => {
    assert.equal(sessioni.leggi(undefined), null);
    assert.equal(sessioni.leggi(""), null);
    assert.equal(sessioni.leggi("token-inventato"), null);
  });

  it("cade dopo otto ore di inattività", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, null);
    const riga = raw.prepare("select id from sessioni").get();

    indietro("sessioni", riga.id, "ultimo_uso", 8 * 3600 - 60);
    assert.ok(sessioni.leggi(token), "sette ore e cinquantanove: ancora buona");

    indietro("sessioni", riga.id, "ultimo_uso", 8 * 3600 + 60);
    assert.equal(sessioni.leggi(token), null);
  });

  it("cade dopo dodici ore comunque, anche se usata di continuo", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, null);
    const riga = raw.prepare("select id from sessioni").get();

    // `ultimo_uso` è adesso — la sessione è in uso — ma il limite assoluto è passato
    raw
      .prepare(
        "update sessioni set scade_il = strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 minutes') where id = ?",
      )
      .run(riga.id);
    assert.equal(sessioni.leggi(token), null);
  });

  it("ogni lettura riporta avanti l'inattività, ma non il limite assoluto", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, null);
    const riga = raw.prepare("select id, scade_il from sessioni").get();

    indietro("sessioni", riga.id, "ultimo_uso", 3600);
    assert.ok(sessioni.leggi(token));

    const dopo = raw.prepare("select ultimo_uso, scade_il from sessioni where id = ?").get(riga.id);
    assert.ok(Date.parse(dopo.ultimo_uso) > Date.now() - 60_000, "l'inattività è ripartita");
    assert.equal(dopo.scade_il, riga.scade_il, "la scadenza assoluta è rimasta ferma");
  });

  it("una sessione morta non torna viva ricaricando la pagina", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, null);
    const riga = raw.prepare("select id from sessioni").get();

    indietro("sessioni", riga.id, "ultimo_uso", 9 * 3600);
    assert.equal(sessioni.leggi(token), null);
    // la seconda volta è ancora morta: la lettura fallita non ha toccato niente
    assert.equal(sessioni.leggi(token), null);
  });

  it("l'uscita cancella la riga; le altre sessioni restano", async () => {
    const id = await gestore();
    const a = sessioni.apri(id, null);
    const b = sessioni.apri(id, null);

    sessioni.chiudi(a);
    assert.equal(sessioni.leggi(a), null);
    assert.ok(sessioni.leggi(b), "l'altro dispositivo resta dentro");
  });

  it("la revoca butta fuori da tutti i dispositivi, subito", async () => {
    const id = await gestore();
    const a = sessioni.apri(id, null);
    const b = sessioni.apri(id, null);

    assert.equal(sessioni.chiudiTuttePerUtente(id), 2);
    assert.equal(sessioni.leggi(a), null);
    assert.equal(sessioni.leggi(b), null);
  });

  it("un utente revocato non ha sessioni valide neanche se la riga resta", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, null);
    // si revoca l'account **senza** cancellare le sessioni, apposta
    raw.prepare("update utenti set stato='revocato' where id = ?").run(id);
    assert.equal(sessioni.leggi(token), null);
  });

  it("cancellare l'utente porta via le sue sessioni — è il CASCADE", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, null);
    raw.prepare("delete from utenti where id = ?").run(id);
    assert.equal(raw.prepare("select count(*) n from sessioni").get().n, 0);
    assert.equal(sessioni.leggi(token), null);
  });

  it("la mezza sessione dura cinque minuti e non apre niente da sola", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, null, "attesa_totp");
    const viva = sessioni.leggi(token);
    assert.equal(viva.stato, "attesa_totp");

    const scade = Date.parse(raw.prepare("select scade_il s from sessioni").get().s);
    assert.ok(scade - Date.now() <= 5 * 60_000 + 2000, "cinque minuti, non dodici ore");
  });

  it("il secondo fattore la promuove, e allunga la scadenza", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, null, "attesa_totp");
    const viva = sessioni.leggi(token);

    assert.equal(sessioni.promuovi(viva.id), true);
    assert.equal(sessioni.leggi(token).stato, "attiva");
    // e non si promuove due volte
    assert.equal(sessioni.promuovi(viva.id), false);

    const scade = Date.parse(raw.prepare("select scade_il s from sessioni").get().s);
    assert.ok(scade - Date.now() > 11 * 3600_000);
  });

  it("una mezza sessione scaduta non può essere promossa", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, null, "attesa_totp");
    const viva = sessioni.leggi(token);
    raw.prepare("update sessioni set scade_il = strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 seconds') where id = ?")
      .run(viva.id);
    assert.equal(sessioni.promuovi(viva.id), false);
    assert.equal(sessioni.leggi(token), null);
  });

  it("una revoca tra lettura e secondo fattore impedisce la promozione", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, null, "attesa_totp");
    const viva = sessioni.leggi(token);
    raw.prepare("update utenti set stato = 'revocato' where id = ?").run(id);
    assert.equal(sessioni.promuovi(viva.id), false);
  });

  it("il token non cambia quando la sessione viene promossa", async () => {
    const id = await gestore();
    const token = sessioni.apri(id, null, "attesa_totp");
    sessioni.promuovi(sessioni.leggi(token).id);
    assert.ok(sessioni.leggi(token), "lo stesso cookie vale ancora");
  });

  it("la pulizia toglie le scadute e lascia le vive", async () => {
    const id = await gestore();
    const viva = sessioni.apri(id, null);
    const morta = sessioni.apri(id, null);
    const idMorta = raw
      .prepare("select id from sessioni where impronta = ?")
      .get(sessioni.improntaDi(morta)).id;
    indietro("sessioni", idMorta, "ultimo_uso", 9 * 3600);

    assert.equal(sessioni.pulisci(), 1);
    assert.ok(sessioni.leggi(viva));
  });
});

describe("i tentativi", () => {
  it("richieste nello stesso turno rispettano il limite anche con argon2", async () => {
    await gestore();
    const esiti = await Promise.all(Array.from({ length: 12 }, () =>
      utentiStore.verificaCredenzialiLimitate("cg", "password-sbagliata", IP)));
    assert.equal(esiti.filter((e) => e.esito === "errore").length, tentativi.TENTATIVI_MAX);
    assert.equal(esiti.filter((e) => e.esito === "bloccato").length, 7);
  });

  it("una password giusta conserva gli errori precedenti prima del TOTP", async () => {
    await gestore();
    tentativi.segnaFallimento("cg", IP);
    assert.equal((await utentiStore.verificaCredenzialiLimitate("cg", "password-di-prova", IP)).esito, "ok");
    for (const tipo of ["utente", "ip"]) {
      assert.equal(raw.prepare("select count(*) n from tentativi_accesso where tipo = ?").get(tipo).n, 1);
    }
  });

  it("il cambio password concorrente non offre tentativi aggiuntivi", async () => {
    const id = await gestore();
    raw.prepare("update utenti set password_hash = ? where id = ?")
      .run(await hashScrypt("password-del-2025"), id);
    const esiti = await Promise.all(Array.from({ length: 12 }, () =>
      utentiStore.cambiaPassword("cg", "password-sbagliata", "nuova-password-1", IP)));
    assert.equal(esiti.filter((e) => /non è corretta/.test(e.errore)).length, tentativi.TENTATIVI_MAX);
    assert.equal(esiti.filter((e) => /Troppi tentativi/.test(e.errore)).length, 7);
  });
  it("anche le password scrypt rispettano il limite con richieste concorrenti", async () => {
    const id = await gestore();
    raw.prepare("update utenti set password_hash = ? where id = ?")
      .run(await hashScrypt("password-del-2025"), id);
    const esiti = await Promise.all(Array.from({ length: 12 }, () =>
      new Promise((resolve, reject) => setImmediate(async () => {
        try {
          const esito = await utentiStore.verificaCredenzialiLimitate("cg", "password-sbagliata", IP);
          resolve(esito.esito === "bloccato" ? "bloccato" : "provato");
        } catch (e) { reject(e); }
      })),
    ));
    assert.equal(esiti.filter((e) => e === "provato").length, tentativi.TENTATIVI_MAX);
  });
  it("cinque in quindici minuti e poi si aspetta", () => {
    for (let i = 0; i < 4; i++) tentativi.segnaFallimento("cg", "10.0.0.1");
    assert.equal(tentativi.attesa("cg", "10.0.0.1"), null, "quattro non bastano");

    tentativi.segnaFallimento("cg", "10.0.0.1");
    const minuti = tentativi.attesa("cg", "10.0.0.1");
    assert.ok(minuti >= 1 && minuti <= 15, `attesa fuori scala: ${minuti}`);
  });

  it("il conteggio per nome e quello per indirizzo sono indipendenti", () => {
    // cinque tentativi sullo stesso nome da cinque indirizzi diversi
    for (let i = 0; i < 5; i++) tentativi.segnaFallimento("cg", `10.0.0.${i}`);
    assert.ok(tentativi.attesaMinuti("utente", "cg"), "il nome è bloccato");
    assert.equal(tentativi.attesaMinuti("ip", "10.0.0.0"), null, "un indirizzo solo no");
  });

  it("cinque nomi diversi dallo stesso indirizzo bloccano l'indirizzo", () => {
    for (let i = 0; i < 5; i++) tentativi.segnaFallimento(`referente${i}`, "10.0.0.9");
    assert.equal(tentativi.attesaMinuti("utente", "referente0"), null);
    assert.ok(tentativi.attesaMinuti("ip", "10.0.0.9"));
    // e chi ha le credenziali buone da quell'indirizzo aspetta comunque
    assert.ok(tentativi.attesa("altro-referente", "10.0.0.9"));
  });

  it("i tentativi vecchi escono dalla finestra da soli", () => {
    for (let i = 0; i < 5; i++) tentativi.segnaFallimento("cg", "10.0.0.1");
    assert.ok(tentativi.attesa("cg", "10.0.0.1"));

    for (const r of raw.prepare("select id from tentativi_accesso").all()) {
      indietro("tentativi_accesso", r.id, "quando", 16 * 60);
    }
    assert.equal(tentativi.attesa("cg", "10.0.0.1"), null);
  });

  it("l'accesso riuscito azzera il nome ma non l'indirizzo", () => {
    for (let i = 0; i < 5; i++) tentativi.segnaFallimento("cg", "10.0.0.1");
    tentativi.azzera("cg");
    assert.equal(tentativi.attesaMinuti("utente", "cg"), null);
    // se azzerasse anche l'IP, chi ha un account valido potrebbe ripulirsi il
    // contatore a ogni accesso e provare password sugli altri all'infinito
    assert.ok(tentativi.attesaMinuti("ip", "10.0.0.1"));
  });

  it("il conteggio sopravvive al riavvio: è il motivo per cui non è più una Map", () => {
    for (let i = 0; i < 5; i++) tentativi.segnaFallimento("cg", "10.0.0.1");
    chiudiPerTest(); // il processo riparte
    assert.ok(tentativi.attesa("cg", "10.0.0.1"));
  });

  it("la pulizia toglie i vecchi e lascia i recenti", () => {
    tentativi.segnaFallimento("cg", "10.0.0.1");
    const vecchi = raw.prepare("select id from tentativi_accesso").all();
    tentativi.segnaFallimento("cg", "10.0.0.1");
    for (const r of vecchi) indietro("tentativi_accesso", r.id, "quando", 16 * 60);

    assert.equal(tentativi.pulisci(), 2);
    assert.equal(raw.prepare("select count(*) n from tentativi_accesso").get().n, 2);
  });
});

describe("gli inviti", () => {
  it("nel database c'è l'impronta, non il token", () => {
    const id = utentiStore.creaUtente({
      utente: "nuovo",
      ruolo: "gestore",
      nome: "N",
      iniziali: "NN",
    });
    const token = inviti.crea(id);
    const riga = raw.prepare("select impronta from inviti").get();
    assert.equal(riga.impronta, createHash("sha256").update(token).digest("hex"));
    assert.notEqual(riga.impronta, token);
  });

  it("si legge una volta e si consuma una volta sola", () => {
    const id = utentiStore.creaUtente({
      utente: "nuovo",
      ruolo: "gestore",
      nome: "N",
      iniziali: "NN",
    });
    const token = inviti.crea(id);
    const invito = inviti.leggi(token);
    assert.equal(invito.utente, "nuovo");

    assert.equal(inviti.consuma(invito.id), true);
    assert.equal(inviti.consuma(invito.id), false, "monouso");
    assert.equal(inviti.leggi(token), null);
  });

  it("scade dopo settantadue ore", () => {
    const id = utentiStore.creaUtente({
      utente: "nuovo",
      ruolo: "gestore",
      nome: "N",
      iniziali: "NN",
    });
    const token = inviti.crea(id);
    const riga = raw.prepare("select id from inviti").get();
    raw
      .prepare(
        "update inviti set scade_il = strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 minutes') where id = ?",
      )
      .run(riga.id);
    assert.equal(inviti.leggi(token), null);
  });

  it("un invito nuovo cancella quello aperto di prima", () => {
    const id = utentiStore.creaUtente({
      utente: "nuovo",
      ruolo: "gestore",
      nome: "N",
      iniziali: "NN",
    });
    const primo = inviti.crea(id);
    const secondo = inviti.crea(id);
    assert.equal(inviti.leggi(primo), null, "il primo non vale più");
    assert.ok(inviti.leggi(secondo));
  });

  it("non vale più se l'account è stato revocato nel frattempo", () => {
    const id = utentiStore.creaUtente({
      utente: "nuovo",
      ruolo: "gestore",
      nome: "N",
      iniziali: "NN",
    });
    const token = inviti.crea(id);
    utentiStore.revoca(id);
    assert.equal(inviti.leggi(token), null);
  });

  it("consumarlo non basta a far entrare: serve anche la password", async () => {
    const id = utentiStore.creaUtente({
      utente: "nuovo",
      ruolo: "gestore",
      nome: "N",
      iniziali: "NN",
    });
    const token = inviti.crea(id);
    inviti.consuma(inviti.leggi(token).id);
    assert.equal(utentiStore.utentePerId(id).stato, "invitato");

    await utentiStore.impostaPassword(id, "password-scelta-1");
    assert.equal(utentiStore.utentePerId(id).stato, "attivo");
    assert.ok(await utentiStore.verificaCredenziali("nuovo", "password-scelta-1"));
  });
});
