import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Le misure della dashboard di sistema.
 *
 * Sono numeri su cui chi amministra decide se svegliare qualcuno, e la ragione
 * per cui `lib/diagnostica.ts` è un modulo e non tre query dentro il
 * componente è proprio questa: si possono provare senza un browser.
 *
 * Le prove che contano non sono quelle che verificano un conteggio giusto —
 * `count(*)` funziona — ma le due categorie di errore che una schermata di
 * diagnostica può fare, e che sono peggiori di non averla:
 *
 *  1. **dire «a posto» quando non lo è.** Un account attivo senza password, un
 *     album pubblicato senza consenso: se il controllo li conta come `ok`, chi
 *     guarda la dashboard smette di cercare.
 *  2. **dire zero quando non sa.** Con il database chiuso i conteggi devono
 *     tornare `null`, che la schermata scrive «non misurabile». Uno zero al suo
 *     posto è indistinguibile da «tutto pulito».
 */

let cartella;
let percorso;
let raw;
let diagnostica, utenti, riferimenti;
let chiudiPerTest;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-diagnostica-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = join(cartella, "dati");

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  diagnostica = await import("@/lib/diagnostica");
  utenti = await import("@/lib/utenti");
  riferimenti = await import("@/lib/db/riferimenti");
  ({ chiudiPerTest } = await import("@/lib/db/db"));

  raw = new Database(percorso);
  riferimenti.assicuraRiferimenti();
});

beforeEach(() => {
  for (const t of ["sessioni", "tentativi_accesso", "inviti", "utenti"]) {
    raw.prepare(`delete from ${t}`).run();
  }
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  rmSync(cartella, { recursive: true, force: true });
});

/**
 * Un account, nello stato che serve alla prova.
 *
 * Il ruolo predefinito è `gestore` e non `referente` perché lo schema
 * pretende che un referente di unità **abbia** un'unità (`utenti_unita_solo_referente`,
 * ed è un vincolo giusto: un referente di unità senza reparto è un account che non può
 * fare il proprio lavoro). Qui l'unità non c'entra niente, e chiederne una a
 * ogni riga sarebbe rumore in venti prove.
 */
function unAccount({ nome = "prova", ruolo = "gestore", unita, conPassword = true, conTotp = false, stato = "attivo" } = {}) {
  const id = utenti.creaUtente({
    utente: nome,
    ruolo,
    nome: `Nome ${nome}`,
    iniziali: "XX",
    ...(unita ? { unita } : {}),
  });
  raw
    .prepare("update utenti set stato=?, password_hash=?, totp_attivato_il=? where id=?")
    .run(
      stato,
      conPassword ? "argon2id$finto" : null,
      conTotp ? "2026-09-01T10:00:00Z" : null,
      id,
    );
  return id;
}

/** Una sessione, con la scadenza scritta a mano: è il campo che conta. */
function unaSessione(utenteId, { stato = "attiva", scaduta = false } = {}) {
  raw
    .prepare(
      `insert into sessioni (utente_id, impronta, scade_il, ip, stato)
       values (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now', ?), 'prova', ?)`,
    )
    .run(utenteId, `impronta-${Math.random()}`, scaduta ? "-1 hour" : "+2 hours", stato);
}

// ==========================================================================

describe("i controlli sul motore", () => {
  it("cinque righe, e i pragmi del piano risultano a posto", () => {
    const righe = diagnostica.controlliMotore();
    assert.equal(righe.length, 5);
    // `lib/db/db.ts` li imposta a ogni connessione: se qui non sono a posto,
    // è quel modulo che ha smesso di farlo — ed è esattamente il guasto che
    // questa schermata deve pescare.
    const per = (id) => righe.find((r) => r.id === id);
    assert.equal(per("db-risponde").esito, "ok");
    assert.equal(per("journal-mode").valore, "wal");
    assert.equal(per("journal-mode").esito, "ok");
    assert.equal(per("foreign-keys").valore, "on");
    assert.equal(per("busy-timeout").esito, "ok");
  });

  it("ogni controllo porta il valore misurato, non solo l’esito", () => {
    // Un pallino verde da solo non basta: la riga deve dire *che cosa* ha
    // letto, se no non si può distinguere «5000 ms» da «5000 s».
    for (const r of diagnostica.controlliMotore()) {
      assert.ok(r.valore.length > 0, `${r.id} senza valore`);
      assert.ok(r.nota.length > 0, `${r.id} senza nota`);
    }
  });
});

describe("il peso del database, in forma leggibile", () => {
  it("null diventa «non misurabile» e non «0 B»", () => {
    // È la distinzione che il modulo si è dato: uno zero dove non si sa
    // sarebbe indistinguibile da un database vuoto.
    assert.equal(diagnostica.pesoDb(null), "non misurabile");
  });

  it("le tre soglie, con la virgola italiana", () => {
    assert.equal(diagnostica.pesoDb(512), "512 B");
    assert.equal(diagnostica.pesoDb(320 * 1024), "320 KB");
    assert.equal(diagnostica.pesoDb(Math.round(1.4 * 1024 * 1024)), "1,4 MB");
    assert.equal(diagnostica.pesoDb(3 * 1024 * 1024 * 1024), "3,0 GB");
  });
});

describe("i conti degli account", () => {
  it("separa attivi, invitati e revocati", () => {
    unAccount({ nome: "attivo1" });
    unAccount({ nome: "attivo2" });
    unAccount({ nome: "invitato1", conPassword: false, stato: "invitato" });
    unAccount({ nome: "revocato1", stato: "revocato" });

    const c = diagnostica.contiAccount();
    assert.equal(c.totale, 4);
    assert.equal(c.attivi, 2);
    assert.equal(c.invitati, 1);
    assert.equal(c.revocati, 1);
  });

  it("il secondo fattore si conta sui soli attivi", () => {
    unAccount({ nome: "conTotp", conTotp: true });
    unAccount({ nome: "senzaTotp" });
    // Un revocato con il TOTP non deve gonfiare il numero: non entra più.
    unAccount({ nome: "revocatoConTotp", conTotp: true, stato: "revocato" });

    const c = diagnostica.contiAccount();
    assert.equal(c.attivi, 2);
    assert.equal(c.conTotp, 1);
    assert.equal(c.senzaTotp, 1);
  });

  it("un account attivo senza password è «inutilizzabile», e un invitato no", () => {
    /*
     * La differenza è tutto il senso di questo conteggio. Un **invitato** senza
     * password è uno stato legittimo: aspetta che qualcuno consumi il
     * collegamento d'invito. Un **attivo** senza password è una bugia nella
     * tabella — la schermata «Utenti» lo conta fra gli account e nessuno può
     * entrare con quel nome — e in produzione viene da un database di sviluppo
     * copiato, che è la cosa che va scoperta (§ scripts/conti.mjs).
     */
    unAccount({ nome: "rotto", conPassword: false, stato: "attivo" });
    unAccount({ nome: "inAttesa", conPassword: false, stato: "invitato" });

    const c = diagnostica.contiAccount();
    assert.equal(c.inutilizzabili, 1);
  });

  it("gli inviti scaduti non contano fra quelli da usare", () => {
    const id = unAccount({ nome: "invitato", conPassword: false, stato: "invitato" });
    const inserisci = raw.prepare(
      `insert into inviti (utente_id, impronta, scade_il, usato_il)
       values (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now', ?), ?)`,
    );
    inserisci.run(id, "vivo", "+72 hours", null);
    inserisci.run(id, "scaduto", "-1 hour", null);
    inserisci.run(id, "consumato", "+72 hours", "2026-09-01T10:00:00Z");

    // Solo il primo è un'azione in sospeso per qualcuno.
    assert.equal(diagnostica.contiAccount().invitiVivi, 1);
  });
});

describe("i controlli di sicurezza", () => {
  it("senza secondo fattore l’esito è «aperto», non «guasto»", () => {
    /*
     * È la distinzione a tre valori del modulo, e non è pedanteria: chi apre
     * questa schermata alle due di notte deve poter separare «va riparato
     * adesso» da «va configurato prima dell'esercizio». Il secondo fattore
     * obbligatorio è §08 del piano, cioè lavoro non fatto: niente è rotto.
     */
    unAccount({ nome: "senzaTotp" });
    const c = diagnostica.controlliSicurezza(diagnostica.contiAccount());
    const totp = c.find((r) => r.id === "totp");
    assert.equal(totp.esito, "aperto");
    assert.equal(totp.valore, "0 su 1");
  });

  it("con il secondo fattore su tutti gli attivi l’esito è «ok»", () => {
    unAccount({ nome: "a", conTotp: true });
    unAccount({ nome: "b", conTotp: true });
    const c = diagnostica.controlliSicurezza(diagnostica.contiAccount());
    assert.equal(c.find((r) => r.id === "totp").esito, "ok");
  });

  it("un account attivo che non può entrare è «guasto», non «aperto»", () => {
    // Qui invece non è una configurazione che manca: è una riga che dice il
    // falso, e va segnalata come tale.
    unAccount({ nome: "rotto", conPassword: false, stato: "attivo" });
    const c = diagnostica.controlliSicurezza(diagnostica.contiAccount());
    const conti = c.find((r) => r.id === "conti-inutilizzabili");
    assert.equal(conti.esito, "guasto");
    assert.equal(conti.valore, "1");
  });

  it("senza conti l’esito è «guasto» e il valore «non misurabile»", () => {
    // `null` significa «il database non risponde», e un controllo che in quel
    // caso dicesse «ok» sarebbe la peggiore delle tre risposte possibili.
    const c = diagnostica.controlliSicurezza(null);
    for (const id of ["totp", "conti-inutilizzabili"]) {
      const r = c.find((x) => x.id === id);
      assert.equal(r.esito, "guasto");
      assert.equal(r.valore, "non misurabile");
    }
  });
});

describe("i controlli sui servizi", () => {
  it("senza copie il backup è «aperto», mai «ok»", () => {
    /*
     * Era la riga scritta a mano «non configurato». Adesso misura l'archivio
     * delle copie, e in questa prova l'archivio è vuoto: la risposta deve
     * restare quella di prima — da configurare — e non diventare un «ok» per
     * mancanza di prove contrarie.
     */
    const b = diagnostica.controlliServizi().find((r) => r.id === "backup");
    assert.equal(b.esito, "aperto");
    assert.equal(b.valore, "nessuna copia");
  });

  it("la copia vale solo se recente e integra", () => {
    const adesso = Date.parse("2026-09-23T10:00:00Z");
    const copia = (quando, integrita = "ok") => [
      {
        nome: "copia-20260923-020000",
        cartella: "/x",
        manifesto: { quando, integrita, byteDb: 1000, byteFile: 2000, database: "", file: 0, collegamenti: true, righe: {} },
      },
    ];
    const ok = diagnostica.controlloCopia(copia("2026-09-23T02:00:00Z"), adesso);
    assert.equal(ok.esito, "ok");
    assert.equal(ok.valore, "8 h fa");

    // una notte saltata: l'ultima copia è di ieri l'altro
    assert.equal(diagnostica.controlloCopia(copia("2026-09-21T02:00:00Z"), adesso).esito, "guasto");

    // c'è, è di stanotte, ma non ha passato integrity_check: ripristinarla
    // vorrebbe dire ripristinare un database rotto
    const rotta = diagnostica.controlloCopia(copia("2026-09-23T02:00:00Z", "malformed"), adesso);
    assert.equal(rotta.esito, "guasto");
    assert.equal(rotta.valore, "non integra");

    // senza manifesto non si può verificare, e non si conta come buona
    const cieca = diagnostica.controlloCopia([{ nome: "copia-x", cartella: "/x", manifesto: null }], adesso);
    assert.equal(cieca.esito, "guasto");
  });

  it("la coda vuota è «ok» e lo dice a parole", () => {
    const c = diagnostica.controlliServizi().find((r) => r.id === "coda");
    assert.equal(c.esito, "ok");
    assert.equal(c.valore, "vuota");
  });

  it("la posta segue la configurazione d’ambiente", () => {
    const prima = process.env.POSTA_HOST;
    const primaA = process.env.POSTA_A;
    try {
      delete process.env.POSTA_HOST;
      delete process.env.POSTA_A;
      assert.equal(
        diagnostica.controlliServizi().find((r) => r.id === "posta").esito,
        "aperto",
      );
    } finally {
      if (prima !== undefined) process.env.POSTA_HOST = prima;
      if (primaA !== undefined) process.env.POSTA_A = primaA;
    }
  });
});

describe("le sessioni e i tentativi", () => {
  it("conta le sessioni vive, non le righe in tabella", () => {
    const a = unAccount({ nome: "a" });
    const b = unAccount({ nome: "b" });
    unaSessione(a);
    unaSessione(a); // due sessioni, una persona sola
    unaSessione(b, { stato: "attesa_totp" });
    unaSessione(b, { scaduta: true });

    const c = diagnostica.contiAccesso();
    assert.equal(c.sessioniAttive, 2);
    assert.equal(c.personeDentro, 1, "due sessioni dello stesso account sono una persona");
    assert.equal(c.sessioniInAttesa, 1);
    assert.equal(c.sessioniScadute, 1);
  });

  it("i tentativi si contano nella finestra di quindici minuti, come il blocco", () => {
    /*
     * La finestra non è scelta qui: è quella che `lib/auth/tentativi.ts` usa
     * per bloccare. Un numero calcolato su un'altra finestra non
     * corrisponderebbe a nessuna decisione del sistema, e chi lo legge non
     * potrebbe farci niente.
     */
    const inserisci = raw.prepare(
      `insert into tentativi_accesso (tipo, chiave, quando)
       values (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now', ?))`,
    );
    inserisci.run("utente", "ref1", "-1 minute");
    inserisci.run("utente", "ref1", "-2 minutes");
    inserisci.run("utente", "giulia", "-3 minutes");
    inserisci.run("utente", "vecchio", "-30 minutes");
    // Gli IP sono un conteggio indipendente e non entrano in questo numero.
    inserisci.run("ip", "10.0.0.1", "-1 minute");

    const c = diagnostica.contiAccesso();
    assert.equal(c.tentativiRecenti, 3);
    assert.equal(c.tentativiSuUtenti, 2);
  });
});

describe("l’inventario del database", () => {
  it("una riga per tabella, con la chiave che serve a chi scrive le query", () => {
    const righe = diagnostica.inventario(true);
    assert.ok(righe.length >= 13);
    for (const r of righe) {
      assert.ok(r.tabella.length > 0, "manca il nome della tabella");
      assert.ok(r.etichetta.length > 0, "manca l’etichetta leggibile");
      assert.equal(typeof r.righe, "number");
    }
  });

  it("conta le righe che ci sono davvero", () => {
    unAccount({ nome: "uno" });
    unAccount({ nome: "due" });
    const utentiRiga = diagnostica.inventario(true).find((r) => r.tabella === "utenti");
    assert.equal(utentiRiga.righe, 2);
  });
});

describe("l’ambiente", () => {
  it("dice il file di database aperto adesso", () => {
    // È la risposta a «sto guardando la macchina che credo»: se questo campo
    // fosse una costante scritta a mano, sarebbe la bugia più costosa della
    // schermata.
    assert.equal(diagnostica.ambiente().database, percorso);
  });

  it("il modo è quello di Node, non una dichiarazione a parte", () => {
    const a = diagnostica.ambiente();
    assert.equal(a.modo, process.env.NODE_ENV === "production" ? "produzione" : "sviluppo");
    assert.equal(a.node, process.version);
    assert.ok(/^\d+ (g|h|min|s)/.test(a.inPiediDa) || /^\d+ s$/.test(a.inPiediDa));
  });
});
