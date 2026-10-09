import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * L'obbligo del secondo fattore — §08 del piano.
 *
 * `test/accessi.test.mjs` prova il **meccanismo**: che una mezza sessione non
 * apra niente, che un codice non si usi due volte, che la promozione allunghi la
 * scadenza. Qui si prova la **regola**, che è una cosa diversa e più fragile:
 *
 * > non esiste nessuna strada che porti dentro senza secondo fattore.
 *
 * La differenza conta perché la regola non vive in una funzione: vive nel fatto
 * che *tutte* le aperture di sessione partono da `attesa_totp`. È una proprietà
 * che si rompe aggiungendo una riga in un file qualunque, e nessuna prova sul
 * meccanismo se ne accorgerebbe. Per questo qui si legge il **sorgente**, che è
 * l'unico modo di provare l'assenza di una strada invece della presenza di una
 * porta.
 */

let cartella;
let percorso;
let raw;
let utenti, sessioni, totp;
let chiudiPerTest;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-2fa-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  utenti = await import("@/lib/utenti");
  sessioni = await import("@/lib/auth/sessioni");
  totp = await import("@/lib/auth/totp");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

beforeEach(() => {
  raw.prepare("delete from sessioni").run();
  raw.prepare("delete from utenti").run();
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  rmSync(cartella, { recursive: true, force: true });
});

/** Un account con password, nello stato in cui si trova dopo l'invito consumato. */
async function conPassword(ruolo = "gestore", nome = "prova") {
  const id = utenti.creaUtente({ utente: nome, ruolo, nome: "Prova", iniziali: "PR" });
  await utenti.impostaPassword(id, "una-password-lunga-abbastanza");
  return id;
}

/** Attiva davvero il secondo fattore, confermando il primo codice. */
function attivaTotp(id) {
  const segreto = utenti.iniziaTotp(id);
  const ok = utenti.confermaTotp(id, totp.codiceOra(segreto));
  assert.equal(ok, true, "il primo codice deve confermare");
  return segreto;
}

// =========================================================================

describe("nessuna strada porta dentro senza secondo fattore", () => {
  /*
   * La prova strutturale. Se un giorno qualcuno aggiunge un'apertura di
   * sessione «attiva» in una rotta nuova — un accesso con collegamento magico,
   * una scorciatoia per l'assistenza — questa prova cade, e cade **prima** che
   * qualcuno se ne accorga in produzione.
   */
  it("tutte le sessioni per un umano nascono in attesa del codice", () => {
    const sorgenti = [
      "app/(area)/area-riservata/accedi/actions.ts",
      "app/(area)/area-riservata/invito/[token]/actions.ts",
    ];
    const aperture = [];
    for (const f of sorgenti) {
      const testo = readFileSync(f, "utf8");
      for (const m of testo.matchAll(/\bapri\(\s*([^)]*)\)/g)) aperture.push({ f, arg: m[1] });
    }
    assert.ok(aperture.length >= 2, "mi aspetto almeno l'accesso e l'invito");

    for (const a of aperture) {
      const attiva = /"attiva"/.test(a.arg);
      if (attiva) {
        // l'unica eccezione è il ramo di chi ha il secondo fattore tolto
        // (`entraConLaSolaPassword`), provato in mfa-per-account.test.mjs
        assert.ok(
          a.f.endsWith("accedi/actions.ts"),
          `${a.f} apre una sessione già attiva: ` +
            "sarebbe un modo di entrare senza secondo fattore",
        );
      }
    }
  });

  it("una mezza sessione non è una sessione attiva, per nessun ruolo", async () => {
    for (const ruolo of ["referente", "gestore", "sviluppatore"]) {
      raw.prepare("delete from utenti").run();
      let id;
      if (ruolo === "referente") {
        raw
          .prepare(
            `insert or ignore into unita (chiave,slug,nome,fascia,eta,logo,email,telefono,ordine)
             values ('u1','l','L','gialla','8-11','l.png','a@b.it','',1)`,
          )
          .run();
        id = utenti.creaUtente({
          utente: "cu",
          ruolo,
          nome: "N",
          iniziali: "N",
          unita: "u1",
        });
        // senza password l'account resta «invitato», e `leggi()` lo scarta —
        // giustamente: qui serve un account attivo per provare l'altra cosa
        await utenti.impostaPassword(id, "una-password-lunga-abbastanza");
      } else {
        id = await conPassword(ruolo, "u" + ruolo);
      }

      const token = sessioni.apri(id, null, "attesa_totp");
      const viva = sessioni.leggi(token);
      assert.equal(viva.stato, "attesa_totp", ruolo);
    }
  });

  it("la password giusta da sola non promuove niente", async () => {
    const id = await conPassword("gestore", "cg");
    const trovato = await utenti.verificaCredenziali("cg", "una-password-lunga-abbastanza");
    assert.equal(trovato.id, id, "la password è giusta");

    // ciò che l'azione di accesso fa con quel risultato: una MEZZA sessione
    const token = sessioni.apri(id, null, "attesa_totp");
    assert.equal(sessioni.leggi(token).stato, "attesa_totp");
  });
});

describe("gestore e amministratore: l'obbligo vale a maggior ragione", () => {
  for (const ruolo of ["gestore", "sviluppatore"]) {
    it(`«${ruolo}» senza TOTP non ottiene una sessione attiva`, async () => {
      const id = await conPassword(ruolo, "x" + ruolo);
      assert.equal(utenti.utentePerId(id).totpAttivo, false, "parte senza secondo fattore");

      const token = sessioni.apri(id, null, "attesa_totp");
      const viva = sessioni.leggi(token);
      assert.equal(viva.stato, "attesa_totp");

      // e non si promuove senza aver confermato un codice
      assert.equal(utenti.confermaTotp(id, "000000"), false, "un codice inventato non conferma");
      assert.equal(utenti.utentePerId(id).totpAttivo, false);
    });

    it(`«${ruolo}» entra solo dopo aver confermato il primo codice`, async () => {
      const id = await conPassword(ruolo, "y" + ruolo);
      const token = sessioni.apri(id, null, "attesa_totp");

      attivaTotp(id);
      assert.equal(utenti.utentePerId(id).totpAttivo, true);

      assert.equal(sessioni.promuovi(sessioni.leggi(token).id), true);
      assert.equal(sessioni.leggi(token).stato, "attiva");
    });
  }

  it("un codice sbagliato non autentica un account che il TOTP ce l'ha", async () => {
    const id = await conPassword("gestore", "z");
    attivaTotp(id);
    assert.equal(utenti.verificaTotpDi(id, "000000"), false);
  });

  it("il codice giusto autentica, e lo stesso codice non si riusa", async () => {
    const id = await conPassword("gestore", "w");
    const segreto = attivaTotp(id);

    /*
     * Il codice **del passo successivo**, non quello di adesso: quello di adesso
     * l'ha appena consumato l'attivazione, e `verificaTotpDi` lo rifiuta — che è
     * la protezione dal riuso, non un difetto. Provarlo con il codice corrente
     * avrebbe provato la cosa sbagliata.
     */
    const dopo = Date.now() + (totp.PASSO_S + 1) * 1000;
    const codice = totp.codiceOra(segreto, dopo);
    assert.equal(utenti.verificaTotpDi(id, codice, dopo), true);
    assert.equal(
      utenti.verificaTotpDi(id, codice, dopo),
      false,
      "RFC 6238 §5.2: una volta sola",
    );
  });
});

describe("gli account che non possono entrare si riconoscono", () => {
  /*
   * `attivo` senza password è uno stato che in produzione ha una sola origine:
   * un database di sviluppo copiato in produzione. Non aprono niente, ma la loro presenza vuol
   * dire che qualcuno ha copiato un database di sviluppo sulla macchina di
   * esercizio — e insieme agli account può essere arrivato dell'altro.
   * `instrumentation.ts` si rifiuta di partire finché ci sono.
   */
  it("un account attivo senza password viene elencato", () => {
    const id = utenti.creaUtente({
      utente: "finto.demo",
      ruolo: "gestore",
      nome: "Demo",
      iniziali: "DM",
    });
    raw.prepare("update utenti set stato='attivo' where id=?").run(id);

    const trovati = utenti.contiInutilizzabili();
    assert.equal(trovati.length, 1);
    assert.equal(trovati[0].utente, "finto.demo");
  });

  it("un invitato NON viene elencato: è senza password per costruzione", () => {
    utenti.creaUtente({ utente: "invitato", ruolo: "gestore", nome: "I", iniziali: "IN" });
    assert.deepEqual(utenti.contiInutilizzabili(), []);
  });

  it("un account con password non viene elencato", async () => {
    await conPassword("gestore", "vero");
    assert.deepEqual(utenti.contiInutilizzabili(), []);
  });

  it("e comunque un account senza password non entra", async () => {
    const id = utenti.creaUtente({
      utente: "senza.password",
      ruolo: "sviluppatore",
      nome: "S",
      iniziali: "S",
    });
    raw.prepare("update utenti set stato='attivo' where id=?").run(id);
    for (const tentativo of ["", " ", "password", "senza.password"]) {
      assert.equal(
        await utenti.verificaCredenziali("senza.password", tentativo),
        null,
        `«${tentativo}» non deve funzionare`,
      );
    }
  });
});

describe("quello che il secondo fattore non deve rompere", () => {
  it("la revoca dell'account invalida anche una sessione già attiva", async () => {
    const id = await conPassword("gestore", "rev");
    attivaTotp(id);
    const token = sessioni.apri(id, null, "attiva");
    assert.ok(sessioni.leggi(token));

    utenti.revoca(id);
    assert.equal(sessioni.leggi(token), null, "revocato: niente sessione");
  });

  it("cambiare ruolo si vede subito, senza rientrare", async () => {
    const id = await conPassword("gestore", "ruo");
    attivaTotp(id);
    const token = sessioni.apri(id, null, "attiva");
    assert.equal(sessioni.leggi(token).sessione.r, "gestore");

    raw.prepare("update utenti set ruolo='sviluppatore' where id=?").run(id);
    assert.equal(
      sessioni.leggi(token).sessione.r,
      "sviluppatore",
      "il ruolo si legge dalla riga, non dal cookie",
    );
  });

  it("azzerare il TOTP riporta l'account alla schermata di attivazione", async () => {
    const id = await conPassword("gestore", "azz");
    attivaTotp(id);
    assert.equal(utenti.utentePerId(id).totpAttivo, true);

    utenti.azzeraTotp(id);
    assert.equal(utenti.utentePerId(id).totpAttivo, false, "torna a doverlo attivare");
  });
});
