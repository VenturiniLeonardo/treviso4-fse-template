import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Le migrazioni, applicate da zero su un database vuoto a ogni esecuzione.
 *
 * È il primo dei tre gruppi di prove che il piano §9 mette in CI: «se una
 * migrazione non gira, la CI se ne accorge prima del server». Qui non si prova
 * il codice applicativo, si prova che lo **schema porti davvero le regole** che
 * dice di portare — perché un `CHECK` scritto e non verificato è un commento.
 *
 * Si applica con `migrate()` di Drizzle e non eseguendo il file SQL a mano: così
 * si prova anche il percorso vero, journal compreso, che è quello che girerà al
 * rilascio.
 */

const TABELLE_ATTESE = [
  // anagrafiche
  "anni_sociali",
  "unita",
  "utenti",
  "ragazzi",
  "iscrizioni",
  "sessioni",
  "inviti",
  "permessi",
  "tentativi_accesso",
  // contenuti
  "album",
  // la ventunesima, arrivata con 0006 quando la decisione di §5 è stata presa
  "album_assenze",
  "foto",
  "attivita",
  "documenti",
  // le cartelle dei documenti, arrivate con 0012 al posto di un CHECK
  "cartelle",
  // i documenti per i referenti, arrivati con 0019: due tabelle a parte, che nessuna
  // pagina pubblica legge
  "cartelle_referenti",
  "documenti_referenti",
  "pagine_testi",
  // le tre del CMS dei contenuti, arrivate con 0007 e 0008
  "unita_persone",
  "unita_proposte",
  "faq",
  "messaggi",
  "lavori",
  // i diciotto posti fotografici del disegno, arrivati con 0009
  "immagini",
  // le modifiche del social media manager che aspettano un'approvazione (0013)
  "proposte",
  // conformità
  "registro",
  "richieste_gdpr",
  "limiti",
];

let cartella;
let raw;
let db;

/** Apre una connessione con i pragmi che il piano pretende su **ogni** connessione. */
function apri(percorso, timeoutMs = 5000) {
  const c = new Database(percorso);
  c.pragma("journal_mode = WAL");
  c.pragma("foreign_keys = ON");
  c.pragma(`busy_timeout = ${timeoutMs}`);
  c.pragma("synchronous = NORMAL");
  return c;
}

/** Semina il minimo indispensabile per poter provare i vincoli sulle altre tabelle. */
function semina(c) {
  c.prepare(
    "INSERT INTO anni_sociali (id, etichetta, inizio, fine, corrente) VALUES (1,'2026-2027','2026-09-01','2027-07-31',1)",
  ).run();
  c.prepare(
    "INSERT INTO unita (id, chiave, slug, nome, fascia, ordine) VALUES (1,'u1','unita-1','Label 1','gialla',1)",
  ).run();
  c.prepare(
    "INSERT INTO unita (id, chiave, slug, nome, fascia, ordine) VALUES (2,'u4','unita-4','Label 4','verde',2)",
  ).run();
  c.prepare(
    "INSERT INTO utenti (id, utente, nome, iniziali, ruolo) VALUES (1,'gestori','Nome Cognome','CG','gestore')",
  ).run();
}

before(() => {
  cartella = mkdtempSync(join(tmpdir(), "t4-migrazione-"));
  const percorso = join(cartella, "prova.db");
  raw = apri(percorso);
  db = drizzle(raw);
  migrate(db, { migrationsFolder: "./drizzle" });
  raw.__percorso = percorso;
});

after(() => {
  raw?.close();
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

// --------------------------------------------------------------------------

describe("migrazione da database vuoto", () => {
  it("crea tutte le tabelle attese e nessuna di troppo", () => {
    const trovate = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    assert.deepEqual(trovate, [...TABELLE_ATTESE].sort());
  });

  it("album_assenze esiste, e la sua chiave è la coppia (album, iscrizione)", () => {
    /*
     * Queste due prove verificavano il contrario fino alla fase 10.3: che la
     * tabella e il trigger **non** ci fossero, perché dipendevano da una
     * decisione di governance aperta — se un referente di unità possa dichiarare che un
     * ragazzo non compare in un album. Confermata il 31 agosto 2026.
     */
    const sql = raw
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='album_assenze'")
      .get()?.sql;
    assert.ok(sql, "album_assenze deve esistere");
    assert.match(sql, /PRIMARY KEY\(`album_id`, `iscrizione_id`\)/);
    // l'autore non si svuota: una dichiarazione senza autore non è una dichiarazione
    assert.match(sql, /`dichiarata_da` integer NOT NULL/);
  });

  it("il trigger dei consensi esiste, ed è su BEFORE UPDATE OF stato", () => {
    const t = raw
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger'")
      .all();
    assert.deepEqual(t.map((x) => x.name), ["album_niente_pubblicazione_senza_consensi"]);
    assert.match(t[0].sql, /BEFORE UPDATE OF stato ON album/);
    assert.match(t[0].sql, /RAISE\(ABORT, 'consensi immagini mancanti'\)/);
  });

  it("tutte le tabelle sono STRICT", () => {
    // `strict` in sqlite_schema non c'è: si legge dall'SQL della definizione
    const nonStrict = raw
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
      )
      .all()
      .filter((r) => !/\)\s*STRICT\s*$/i.test(r.sql.trim()))
      .map((r) => r.name);
    assert.deepEqual(nonStrict, [], `tabelle senza STRICT: ${nonStrict.join(", ")}`);
  });

  it("è idempotente: riapplicare non cambia niente e non solleva", () => {
    migrate(db, { migrationsFolder: "./drizzle" });
    const quante = raw
      .prepare(
        "SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
      )
      .get().n;
    assert.equal(quante, TABELLE_ATTESE.length);
  });
});

describe("pragmi del motore", () => {
  it("WAL, foreign_keys, busy_timeout e synchronous sono quelli del piano", () => {
    assert.equal(raw.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(raw.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(raw.pragma("busy_timeout", { simple: true }), 5000);
    assert.equal(raw.pragma("synchronous", { simple: true }), 1); // NORMAL
  });

  it("i pragmi valgono per connessione, e le chiavi esterne sono davvero applicate", () => {
    // NOTA — il piano dice «foreign_keys in SQLite è spento di suo». È vero per
    // SQLite nudo, NON per better-sqlite3, che lo accende all'apertura. Lo
    // impostiamo comunque esplicitamente: dipendere dal valore predefinito di un
    // driver è dipendere da una cosa che può cambiare con un aggiornamento, e
    // sarebbe una perdita di integrità silenziosa.
    const nuda = new Database(raw.__percorso);
    assert.equal(
      nuda.pragma("foreign_keys", { simple: true }),
      1,
      "better-sqlite3 accende foreign_keys da sé: se cambia, ce ne accorgiamo qui",
    );
    // journal_mode è invece una proprietà del file, non della connessione:
    // WAL sopravvive alla chiusura e vale per chiunque apra quel file
    assert.equal(nuda.pragma("journal_mode", { simple: true }), "wal");
    // anche busy_timeout è già a 5000: è un altro predefinito di better-sqlite3,
    // che per caso coincide con il valore chiesto dal piano. Coincidenza, non
    // garanzia: continuiamo a impostarlo noi
    assert.equal(nuda.pragma("busy_timeout", { simple: true }), 5000);
    nuda.close();
  });
});

describe("STRICT rifiuta i tipi sbagliati", () => {
  before(() => semina(raw));

  it("una stringa in una colonna INTEGER viene rifiutata", () => {
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO anni_sociali (etichetta, inizio, fine, corrente) VALUES (?,?,?,?)")
          .run("2030-2031", "2030-09-01", "2031-07-31", "quarantaquattro"),
      /cannot store TEXT value in INTEGER column|datatype mismatch/i,
    );
  });

  it("un decimale con parte frazionaria in una colonna INTEGER viene rifiutato", () => {
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO foto (album_id, file, tipo, larghezza, altezza) VALUES (?,?,?,?,?)")
          .run(1, "frazionaria.jpg", "image/jpeg", 800.5, 600),
      /cannot store REAL value in INTEGER column|datatype mismatch/i,
    );
  });

  it("un numero in una colonna TEXT passa, ma diventa «42.0» e non «42»", () => {
    // Due cose che vanno sapute, e nessuna delle due è quella che si crede.
    //
    // 1. STRICT non vuol dire «tipi rigidi»: vuol dire «nessuna conversione con
    //    perdita». 'quarantaquattro' -> INTEGER perde, e viene rifiutato (sopra);
    //    un numero -> TEXT non perde, e passa.
    // 2. better-sqlite3 lega i numeri JavaScript come REAL, perché in JavaScript
    //    esiste un solo tipo numerico. Quindi 42 arriva a SQLite come 42.0, e in
    //    una colonna TEXT si scrive «42.0».
    //
    // È una trappola per lo strato store: le colonne TEXT che contengono numeri
    // — `documenti.peso` è «240 KB», ma il caso esiste — vanno riempite con una
    // stringa costruita in TypeScript, mai lasciando convertire il driver.
    raw.prepare("INSERT INTO ragazzi (id, nome, cognome) VALUES (100, ?, ?)").run(42, "Rossi");
    const r = raw.prepare("SELECT nome, typeof(nome) t FROM ragazzi WHERE id = 100").get();
    assert.equal(r.nome, "42.0", "non «42»: il driver ha legato il numero come REAL");
    assert.equal(r.t, "text", "convertito in TEXT, non conservato come numero");
    raw.prepare("DELETE FROM ragazzi WHERE id = 100").run();
  });
});

describe("un solo anno corrente", () => {
  it("il secondo anno con corrente = 1 viene rifiutato dall'indice parziale", () => {
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO anni_sociali (etichetta, inizio, fine, corrente) VALUES (?,?,?,1)")
          .run("2027-2028", "2027-09-01", "2028-07-31"),
      /UNIQUE constraint failed/i,
    );
  });

  it("più anni con corrente = 0 sono ammessi: l'indice è parziale", () => {
    raw
      .prepare("INSERT INTO anni_sociali (etichetta, inizio, fine, corrente) VALUES (?,?,?,0)")
      .run("2025-2026", "2025-09-01", "2026-07-31");
    raw
      .prepare("INSERT INTO anni_sociali (etichetta, inizio, fine, corrente) VALUES (?,?,?,0)")
      .run("2024-2025", "2024-09-01", "2025-07-31");
    const n = raw.prepare("SELECT count(*) n FROM anni_sociali WHERE corrente = 0").get().n;
    assert.equal(n, 2);
  });

  it("lo scambio dell'anno corrente riesce dentro una transazione", () => {
    // è la manovra di archiviaAnno: si spegne il vecchio e si accende il nuovo
    raw.exec("BEGIN IMMEDIATE");
    raw.prepare("UPDATE anni_sociali SET corrente = 0 WHERE corrente = 1").run();
    raw.prepare("UPDATE anni_sociali SET corrente = 1 WHERE etichetta = '2025-2026'").run();
    raw.exec("COMMIT");

    const corrente = raw.prepare("SELECT etichetta FROM anni_sociali WHERE corrente = 1").all();
    assert.equal(corrente.length, 1);
    assert.equal(corrente[0].etichetta, "2025-2026");

    // si rimette come prima, per i test che seguono
    raw.exec("BEGIN IMMEDIATE");
    raw.prepare("UPDATE anni_sociali SET corrente = 0 WHERE corrente = 1").run();
    raw.prepare("UPDATE anni_sociali SET corrente = 1 WHERE etichetta = '2026-2027'").run();
    raw.exec("COMMIT");
  });
});

describe("chiavi esterne", () => {
  it("un anno inesistente viene rifiutato", () => {
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO album (slug, anno_id, titolo, data_testo) VALUES ('x', 999, 'T', 'Settembre 2026')",
          )
          .run(),
      /FOREIGN KEY constraint failed/i,
    );
  });

  it("un'unità inesistente viene rifiutata", () => {
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO album (slug, anno_id, unita_id, titolo, data_testo) VALUES ('y', 1, 999, 'T', 'Settembre 2026')",
          )
          .run(),
      /FOREIGN KEY constraint failed/i,
    );
  });

  it("un album di gruppo ha unita_id NULL, e passa", () => {
    raw
      .prepare(
        "INSERT INTO album (id, slug, anno_id, unita_id, titolo, data_testo) VALUES (1,'di-gruppo', 1, NULL, 'Apertura', 'Settembre 2026')",
      )
      .run();
    const a = raw.prepare("SELECT unita_id FROM album WHERE slug='di-gruppo'").get();
    assert.equal(a.unita_id, null);
  });
});

describe("CHECK sui valori", () => {
  it("un ruolo non valido viene rifiutato", () => {
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO utenti (utente, nome, iniziali, ruolo) VALUES (?,?,?,?)")
          .run("tizio", "Tizio", "TZ", "referente-supremo"),
      /CHECK constraint failed/i,
    );
  });

  it("un referente di unità senza unità viene rifiutato", () => {
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO utenti (utente, nome, iniziali, ruolo) VALUES (?,?,?,?)")
          .run("ref1", "Ref1", "RF", "referente"),
      /CHECK constraint failed/i,
      "è il caso reale di utenti.json: vedi import-audit.md §A3.1",
    );
  });

  it("un gestore CON unità viene rifiutato", () => {
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO utenti (utente, nome, iniziali, ruolo, unita_id) VALUES (?,?,?,?,?)",
          )
          .run("cg2", "Altro", "AL", "gestore", 1),
      /CHECK constraint failed/i,
    );
  });

  // ------------------------------------------------------------------- 0007
  //
  // I vincoli del CMS dei contenuti. La migrazione 0007 è scritta a mano —
  // `ALTER TABLE ADD COLUMN` invece della ricreazione che drizzle-kit
  // produceva — e con l'SQL scritto a mano non basta che la migrazione non
  // protesti: va provato che i `CHECK` siano **atterrati e attivi**, perché un
  // vincolo battuto a macchina nel posto sbagliato è silenzioso.

  it("un numero di iscritti negativo viene rifiutato", () => {
    assert.throws(
      () => raw.prepare("UPDATE unita SET iscritti = -3 WHERE id = 1").run(),
      /unita_iscritti/i,
    );
  });

  it("la copertina di un'unità è tutta o niente", () => {
    // Un record a metà darebbe un'immagine senza misure, cioè il salto di
    // layout che le misure servono a evitare (soglia CLS di §04).
    assert.throws(
      () => raw.prepare("UPDATE unita SET copertina = 'a.jpg' WHERE id = 1").run(),
      /unita_copertina_completa/i,
    );
    raw
      .prepare(
        "UPDATE unita SET copertina='a.jpg', copertina_tipo='image/jpeg'," +
          " copertina_larghezza=1200, copertina_altezza=800 WHERE id = 1",
      )
      .run();
    assert.throws(
      () => raw.prepare("UPDATE unita SET copertina_larghezza = 0 WHERE id = 1").run(),
      /unita_copertina_misure/i,
    );
    // si torna indietro tutti insieme, che è l'altro lato dello stesso vincolo
    raw
      .prepare(
        "UPDATE unita SET copertina=NULL, copertina_tipo=NULL," +
          " copertina_larghezza=NULL, copertina_altezza=NULL WHERE id = 1",
      )
      .run();
  });

  it("un tipo di persona inventato viene rifiutato", () => {
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO unita_persone (unita_id, tipo, nome) VALUES (1,'inventato','X')")
          .run(),
      /unita_persone_tipo/i,
    );
  });

  it("di una stessa unità e campo esiste una proposta sola", () => {
    // La seconda proposta **sostituisce** la prima (lo store usa
    // ON CONFLICT DO UPDATE). Senza l'indice unico, un referente che si corregge tre
    // volte lascerebbe tre righe in coda e chi approva dovrebbe indovinare.
    raw.prepare("INSERT INTO unita_proposte (unita_id, campo, valore) VALUES (1,'email','a@b.it')").run();
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO unita_proposte (unita_id, campo, valore) VALUES (1,'email','c@d.it')")
          .run(),
      /UNIQUE constraint failed/i,
    );
    raw.prepare("DELETE FROM unita_proposte WHERE unita_id = 1 AND campo = 'email'").run();
  });

  it("solo le circolari hanno un'unità, e viceversa", () => {
    /*
     * Sono i due modi in cui l'ambito si sfila, e il database li chiude
     * entrambi:
     *
     *   una circolare senza unità  →  nessun referente di unità la potrebbe toccare
     *   un modulo con un'unità     →  il referente di quell'unità potrebbe
     *                                 modificare la modulistica del gruppo
     */
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO documenti (chiave, anno_id, categoria, titolo) VALUES ('c1',1,'circolari','Lista materiale')",
          )
          .run(),
      /documenti_circolari_hanno_unita/i,
    );
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO documenti (chiave, anno_id, unita_id, categoria, titolo) VALUES ('c2',1,1,'iscrizioni','Modulo')",
          )
          .run(),
      /documenti_circolari_hanno_unita/i,
    );
    // e le due forme legittime passano
    raw
      .prepare(
        "INSERT INTO documenti (chiave, anno_id, unita_id, categoria, titolo) VALUES ('c3',1,1,'circolari','Lista materiale')",
      )
      .run();
    raw
      .prepare(
        "INSERT INTO documenti (chiave, anno_id, categoria, titolo) VALUES ('c4',1,'iscrizioni','Modulo')",
      )
      .run();
    raw.prepare("DELETE FROM documenti WHERE chiave IN ('c3','c4')").run();
  });

  // ------------------------------------------------------------------- 0012
  //
  // Le cartelle dei documenti. La categoria era un elenco chiuso in un CHECK;
  // adesso è una chiave esterna su `cartelle.chiave`, e l'anno può mancare.

  it("le sei cartelle di partenza ci sono, nell'ordine della vecchia pagina", () => {
    const righe = raw.prepare("SELECT chiave FROM cartelle ORDER BY ordine").all();
    assert.deepEqual(
      righe.map((r) => r.chiave),
      ["iscrizioni", "autorizzazioni", "campi", "quote", "statuti", "circolari"],
    );
  });

  it("un documento in una cartella che non esiste viene rifiutato", () => {
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO documenti (chiave, anno_id, categoria, titolo) VALUES ('x1',1,'tesseramenti','Modulo')",
          )
          .run(),
      /FOREIGN KEY constraint failed/i,
    );
  });

  it("un documento senza anno è ammesso: è un documento sempre valido", () => {
    raw
      .prepare("INSERT INTO documenti (chiave, anno_id, categoria, titolo) VALUES ('sempre/x',NULL,'iscrizioni','Modulo')")
      .run();
    const r = raw.prepare("SELECT anno_id FROM documenti WHERE chiave = 'sempre/x'").get();
    assert.equal(r.anno_id, null);
    raw.prepare("DELETE FROM documenti WHERE chiave = 'sempre/x'").run();
  });

  it("una cartella con dentro dei documenti non si cancella", () => {
    raw
      .prepare("INSERT INTO cartelle (chiave, titolo, ordine) VALUES ('tesseramenti','Tesseramenti',7)")
      .run();
    raw
      .prepare("INSERT INTO documenti (chiave, anno_id, categoria, titolo) VALUES ('sempre/c',NULL,'tesseramenti','Modulo')")
      .run();
    assert.throws(
      () => raw.prepare("DELETE FROM cartelle WHERE chiave = 'tesseramenti'").run(),
      /FOREIGN KEY constraint failed/i,
    );
    // vuota, invece, sì
    raw.prepare("DELETE FROM documenti WHERE chiave = 'sempre/c'").run();
    raw.prepare("DELETE FROM cartelle WHERE chiave = 'tesseramenti'").run();
  });

  it("l'indirizzo di una cartella è fatto di minuscole, cifre e trattini", () => {
    for (const sbagliata of ["Tesseramenti", "campi estivi", "-campi", "", "campi/estivi"]) {
      assert.throws(
        () =>
          raw
            .prepare("INSERT INTO cartelle (chiave, titolo, ordine) VALUES (?, 'x', 9)")
            .run(sbagliata),
        /cartelle_chiave_forma|UNIQUE/i,
        `«${sbagliata}» non doveva passare`,
      );
    }
    raw.prepare("INSERT INTO cartelle (chiave, titolo, ordine) VALUES ('campi-estivi-2','x',9)").run();
    raw.prepare("DELETE FROM cartelle WHERE chiave = 'campi-estivi-2'").run();
  });

  // ------------------------------------------------------------------- 0008
  //
  // Le FAQ. Il vincolo che conta è quello sull'indirizzo del collegamento: una
  // risposta può rimandare a una pagina del sito, e un campo libero sarebbe un
  // posto dove mettere un indirizzo che porta altrove.

  it("una fascia inventata per una FAQ viene rifiutata", () => {
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO faq (domanda, risposta, fascia) VALUES ('D','R','arcobaleno')")
          .run(),
      /faq_fascia/i,
    );
  });

  it("il collegamento di una FAQ è tutto o niente", () => {
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO faq (domanda, risposta, link_testo) VALUES ('D','R','Documenti')",
          )
          .run(),
      /faq_link_completo/i,
      "un testo senza indirizzo sarebbe una parola che sembra un link",
    );
    raw
      .prepare(
        "INSERT INTO faq (id, domanda, risposta, link_testo, link_href, link_coda) VALUES (90,'D','R','Documenti','/documenti','.')",
      )
      .run();
  });

  it("l'indirizzo di un collegamento può essere solo un percorso interno", () => {
    /*
     * Tre forme, e la seconda è quella che un controllo scritto solo su
     * «comincia con /» lascerebbe passare: `//evil.example` per un browser è un
     * indirizzo assoluto con lo stesso schema della pagina.
     */
    const rifiuta = (href) =>
      assert.throws(
        () =>
          raw
            .prepare(
              "INSERT INTO faq (domanda, risposta, link_testo, link_href, link_coda) VALUES ('D','R','T',?,'.')",
            )
            .run(href),
        /faq_link_interno/i,
        `«${href}» non deve passare`,
      );

    rifiuta("https://esempio.invalid/truffa");
    rifiuta("//esempio.invalid/truffa");
    rifiuta("/documenti/../../etc/passwd");
    rifiuta("javascript:alert(1)");
  });

  it("il nome utente è unico senza distinzione di maiuscole", () => {
    // l'accesso confronta in minuscolo: «Ref1» e «ref1» non devono coesistere
    raw
      .prepare("INSERT INTO utenti (id, utente, nome, iniziali, ruolo, unita_id) VALUES (?,?,?,?,?,?)")
      .run(50, "Ref2", "Ref2", "RE", "referente", 1);
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO utenti (id, utente, nome, iniziali, ruolo, unita_id) VALUES (?,?,?,?,?,?)",
          )
          .run(51, "ref2", "Ref2 minuscolo", "RE", "referente", 2),
      /UNIQUE constraint failed/i,
    );
    raw.prepare("DELETE FROM utenti WHERE id = 50").run();
  });

  it("un referente di unità CON unità passa", () => {
    raw
      .prepare("INSERT INTO utenti (id, utente, nome, iniziali, ruolo, unita_id) VALUES (?,?,?,?,?,?)")
      .run(2, "ref1", "Ref1", "RF", "referente", 1);
    const u = raw.prepare("SELECT unita_id FROM utenti WHERE utente='ref1'").get();
    assert.equal(u.unita_id, 1);
  });

  it("uno stato album non previsto viene rifiutato, e in_revisione passa", () => {
    assert.throws(
      () => raw.prepare("UPDATE album SET stato='in-revisione' WHERE id=1").run(),
      /CHECK constraint failed/i,
      "il trattino è il valore dell'applicazione, non del database: vedi schema-decisions.md",
    );
    raw.prepare("UPDATE album SET stato='in_revisione' WHERE id=1").run();
    assert.equal(raw.prepare("SELECT stato FROM album WHERE id=1").get().stato, "in_revisione");
  });

  it("una quota fuori elenco viene rifiutata", () => {
    raw.prepare("INSERT INTO ragazzi (id, nome, cognome) VALUES (1,'Marco','Rossi')").run();
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO iscrizioni (ragazzo_id, unita_id, anno_id, quota) VALUES (1,1,1,?)",
          )
          .run("esente"),
      /CHECK constraint failed/i,
      "«esente» è l'etichetta dell'interfaccia: l'enum del piano è ridotta — decisione minore aperta",
    );
  });

  it("un consenso concesso senza data viene rifiutato", () => {
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO iscrizioni (ragazzo_id, unita_id, anno_id, consenso_immagini) VALUES (1,1,1,1)",
          )
          .run(),
      /CHECK constraint failed/i,
    );
  });

  it("un consenso concesso con data passa", () => {
    raw
      .prepare(
        "INSERT INTO iscrizioni (id, ragazzo_id, unita_id, anno_id, consenso_immagini, consenso_data) VALUES (1,1,1,1,1,?)",
      )
      .run("2026-09-15T10:00:00Z");
    const i = raw.prepare("SELECT consenso_immagini FROM iscrizioni WHERE id=1").get();
    assert.equal(i.consenso_immagini, 1);
  });

  it("un ragazzo non può essere iscritto due volte nello stesso anno", () => {
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO iscrizioni (ragazzo_id, unita_id, anno_id) VALUES (1,2,1)")
          .run(),
      /UNIQUE constraint failed/i,
    );
  });

  it("più di tre tentativi su un lavoro vengono rifiutati", () => {
    raw.prepare("INSERT INTO lavori (id) VALUES (1)").run();
    raw.prepare("UPDATE lavori SET tentativi = 3 WHERE id = 1").run();
    assert.throws(
      () => raw.prepare("UPDATE lavori SET tentativi = 4 WHERE id = 1").run(),
      /CHECK constraint failed/i,
    );
  });
});

describe("i tre CHECK che deliberatamente non ci sono", () => {
  it("un documento pubblicato senza file è ammesso: 25 su 26 dei dati reali lo sono", () => {
    raw
      .prepare(
        "INSERT INTO documenti (chiave, anno_id, categoria, titolo, stato, file) VALUES ('2026-2027/x',1,'iscrizioni','Modulo','pubblicato',NULL)",
      )
      .run();
    const d = raw.prepare("SELECT file, stato FROM documenti WHERE chiave='2026-2027/x'").get();
    assert.equal(d.file, null);
    assert.equal(d.stato, "pubblicato");
  });

  it("il registro accetta il ruolo «sconosciuto»: è quello che scrive un accesso fallito", () => {
    raw
      .prepare(
        "INSERT INTO registro (utente, nome, ruolo, tipo, operazione, origine, esito) VALUES (?,?,?,?,?,?,?)",
      )
      .run("tizio", "tizio", "sconosciuto", "accesso", "Tentativo rifiutato", "accesso", "rifiutato");
    const v = raw.prepare("SELECT ruolo, esito FROM registro WHERE utente='tizio'").get();
    assert.equal(v.ruolo, "sconosciuto");
    assert.equal(v.esito, "rifiutato");
  });

  it("attivita.tipo adesso ha un vocabolario, e rifiuta quelli vecchi", () => {
    /*
     * Fino alla fase 8 questa prova verificava il contrario: che `tipo`
     * accettasse **entrambi** gli elenchi in disaccordo del repository, perché
     * scegliere avrebbe rotto uno dei due e fondere sarebbe stato inventare.
     *
     * La decisione è stata presa, e non è stata scegliere: i due elenchi erano
     * due assi diversi schiacciati in una colonna sola. `gruppo` diceva a chi si
     * rivolge l'attività — che adesso lo dice l'ambito — e `uscita di
     * squadra` che cosa è, che adesso è `uscita-squadra`. Vedi
     * `lib/attivita.ts`.
     */
    for (const vecchio of ["gruppo", "unità", "uscita di squadra"]) {
      assert.throws(
        () =>
          raw
            .prepare(
              "INSERT INTO attivita (anno_id, titolo, data_testo, tipo) VALUES (1,'Prova','11 ott 2026',?)",
            )
            .run(vecchio),
        `«${vecchio}» non è più un tipo valido`,
      );
    }

    raw
      .prepare(
        "INSERT INTO attivita (anno_id, titolo, data_testo, tipo) VALUES (1,'Prova','11 ott 2026','uscita-squadra')",
      )
      .run();
    assert.equal(raw.prepare("SELECT count(*) n FROM attivita").get().n, 1);
  });

  it("attivita: l'ambito lo dice una colonna sola", () => {
    // `unita_id` e `unita_chiavi` insieme sarebbero due risposte alla stessa
    // domanda, e la schermata potrebbe mostrarne una e il filtro l'altra
    assert.throws(() =>
      raw
        .prepare(
          "INSERT INTO attivita (anno_id, titolo, data_testo, tipo, unita_id, unita_chiavi) " +
            "VALUES (1,'Prova','11 ott 2026','uscita',1,'u4')",
        )
        .run(),
    );
  });

  it("l'esito del registro è 'ok' per difetto: nei dati reali la chiave è assente su tutte", () => {
    raw
      .prepare(
        "INSERT INTO registro (utente, nome, ruolo, tipo, operazione, origine) VALUES ('cg','Nome','gestore','contenuto','Modifica','album')",
      )
      .run();
    const v = raw.prepare("SELECT esito FROM registro WHERE utente='cg'").get();
    assert.equal(v.esito, "ok");
  });
});

describe("cancellazioni a cascata, e quelle che non devono cascare", () => {
  it("cancellare un album porta via le sue foto", () => {
    raw
      .prepare(
        "INSERT INTO foto (id, album_id, file, tipo, larghezza, altezza) VALUES (1,1,'f.jpg','image/jpeg',800,600)",
      )
      .run();
    raw.prepare("DELETE FROM album WHERE id = 1").run();
    assert.equal(raw.prepare("SELECT count(*) n FROM foto").get().n, 0);
  });

  it("cancellare un ragazzo porta via le sue iscrizioni: è la cancellazione GDPR", () => {
    assert.equal(raw.prepare("SELECT count(*) n FROM iscrizioni").get().n, 1);
    raw.prepare("DELETE FROM ragazzi WHERE id = 1").run();
    assert.equal(raw.prepare("SELECT count(*) n FROM iscrizioni").get().n, 0);
  });

  it("cancellare un utente porta via le sue sessioni: è la revoca immediata", () => {
    raw
      .prepare("INSERT INTO sessioni (utente_id, impronta, scade_il) VALUES (2,'abc','2026-01-01T00:00:00Z')")
      .run();
    raw.prepare("DELETE FROM utenti WHERE id = 2").run();
    assert.equal(raw.prepare("SELECT count(*) n FROM sessioni").get().n, 0);
  });

  it("cancellare un utente NON porta via le sue voci di registro", () => {
    raw
      .prepare("INSERT INTO utenti (id, utente, nome, iniziali, ruolo) VALUES (3,'sv','Sv','SV','sviluppatore')")
      .run();
    raw
      .prepare(
        "INSERT INTO registro (utente_id, utente, nome, ruolo, tipo, operazione, origine) VALUES (3,'sv','Sv','sviluppatore','pubblicazione','Pubblicato un album','album')",
      )
      .run();

    raw.prepare("DELETE FROM utenti WHERE id = 3").run();

    const v = raw.prepare("SELECT utente_id, utente, nome, ruolo FROM registro WHERE utente='sv'").get();
    assert.ok(v, "la voce di registro deve sopravvivere alla cancellazione dell'utente");
    assert.equal(v.utente_id, null, "il riferimento si annulla");
    assert.equal(v.utente, "sv", "ma il nome utente resta come testo");
    assert.equal(v.ruolo, "sviluppatore", "e anche il ruolo");
  });
});

describe("testo", () => {
  it("sopravvive a UTF-8 a 4 byte: è un dato reale, non un caso di scuola", () => {
    // dalla riga di prova in dati/tabelle.json: virgolette, punto e virgola, emoji
    const cattivo = 'Rossi, "Detto Bó"; Ünità 😀';
    raw.prepare("INSERT INTO ragazzi (id, nome, cognome) VALUES (9, ?, 'X')").run(cattivo);
    const r = raw.prepare("SELECT nome FROM ragazzi WHERE id = 9").get();
    assert.equal(r.nome, cattivo);
    assert.equal([...r.nome].length, [...cattivo].length);
    assert.ok(r.nome.includes("😀"), "l'emoji non deve perdersi");
  });
});

describe("scritture concorrenti", () => {
  it("BEGIN IMMEDIATE serializza, e busy_timeout attende invece di fallire subito", () => {
    const percorso = raw.__percorso;
    const a = apri(percorso, 5000);
    const b = apri(percorso, 300); // timeout corto, per non far durare il test

    a.exec("BEGIN IMMEDIATE");
    const inizio = Date.now();
    let messaggio = "";
    try {
      b.exec("BEGIN IMMEDIATE");
      messaggio = "(nessun errore)";
    } catch (e) {
      messaggio = e.code ?? e.message;
    }
    const atteso = Date.now() - inizio;
    a.exec("ROLLBACK");
    a.close();
    b.close();

    assert.equal(messaggio, "SQLITE_BUSY", "la seconda scrittura deve trovare occupato");
    assert.ok(
      atteso >= 250,
      `busy_timeout deve far attendere prima di arrendersi: atteso ${atteso} ms`,
    );
  });

  it("le letture non si bloccano mentre una scrittura è aperta: è il senso di WAL", () => {
    const percorso = raw.__percorso;
    const scrittore = apri(percorso);
    const lettore = apri(percorso);

    scrittore.exec("BEGIN IMMEDIATE");
    scrittore.prepare("INSERT INTO ragazzi (nome, cognome) VALUES ('Nuovo','Rossi')").run();

    // il lettore vede lo stato precedente, senza attendere e senza errore
    const n = lettore.prepare("SELECT count(*) n FROM ragazzi").get().n;
    assert.equal(typeof n, "number");

    scrittore.exec("ROLLBACK");
    scrittore.close();
    lettore.close();
  });
});
