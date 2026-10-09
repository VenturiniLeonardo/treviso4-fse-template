import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * La 0013 su un database **in esercizio**, non su uno vuoto.
 *
 * Le altre prove migrano un database nuovo, dove `utenti` è vuota: lì
 * ricostruirla non costa niente, e la prova passerebbe anche se la migrazione
 * azzerasse ogni autore del sito. Il caso che conta è il rilascio, con gli
 * account, le sessioni aperte e i contenuti firmati — ed è quello che si prova
 * qui, due volte:
 *
 *  - con `applicaMigrazioni` (cioè `npm run db:applica`), che spegne le chiavi
 *    esterne fuori dalla transazione: niente si deve muovere;
 *  - con il `migrate()` nudo di Drizzle, a chiavi accese, che è quello che
 *    farebbe `drizzle-kit migrate` lanciato a mano: la guardia lo deve fermare
 *    prima che tocchi qualcosa.
 */

let cartella;
let migrazioni12;
let applicaMigrazioni;

/** Un database fermo alla 0012, con dentro quello che c'è in esercizio. */
function popolato(nome) {
  const percorso = join(cartella, nome);
  const c = new Database(percorso);
  migrate(drizzle(c), { migrationsFolder: migrazioni12 });

  c.prepare(
    "INSERT INTO unita (id, chiave, slug, nome, fascia, ordine) VALUES (1,'u1','unita-1','Unità 1','gialla',1)",
  ).run();
  c.prepare(
    "INSERT INTO utenti (id, utente, nome, iniziali, ruolo, unita_id, stato, totp_attivato_il) VALUES " +
      "(1,'ref1','Ref1','R1','referente',1,'attivo','2026-09-01T10:00:00Z')," +
      "(2,'referente','Referente','CG','gestore',NULL,'attivo',NULL)",
  ).run();
  // le tre cose che le azioni delle chiavi esterne porterebbero via: una
  // sessione (CASCADE), un autore (SET NULL), un testo firmato (SET NULL)
  c.prepare(
    "INSERT INTO sessioni (utente_id, impronta, scade_il) VALUES (1, 'impronta-di-prova', '2099-01-01T00:00:00Z')",
  ).run();
  c.prepare("UPDATE unita SET motto = 'Sempre avanti', autore_id = 1 WHERE id = 1").run();
  c.prepare(
    "INSERT INTO pagine_testi (chiave, valore, autore_id) VALUES ('home.intro', 'Ciao', 2)",
  ).run();
  return c;
}

const conta = (c, sql) => c.prepare(sql).get().n;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-0013-"));
  migrazioni12 = join(cartella, "drizzle-12");
  cpSync("./drizzle", migrazioni12, { recursive: true });
  const giornale = join(migrazioni12, "meta", "_journal.json");
  const g = JSON.parse(readFileSync(giornale, "utf8"));
  g.entries = g.entries.filter((e) => e.idx < 13);
  writeFileSync(giornale, JSON.stringify(g));

  ({ applicaMigrazioni } = await import("@/lib/db/applica"));
});

after(() => {
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

describe("0013 con «npm run db:applica»", () => {
  let c;
  let esito;

  before(() => {
    c = popolato("applica.db");
    // la sessione si scrive con lo schema vero: se le colonne fossero altre,
    // l'INSERT qui sopra avrebbe già sollevato
    esito = applicaMigrazioni(c, "./drizzle");
  });

  after(() => c?.close());

  it("applica la migrazione, e nessun riferimento resta appeso", () => {
    // la 0013 e quelle venute dopo (dalla 0014 in poi): tutte, e solo quelle
    const dopoLa12 = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")).entries.filter(
      (e) => e.idx >= 13,
    ).length;
    assert.equal(esito.dopo, esito.prima + dopoLa12);
    assert.deepEqual(esito.appese, []);
    assert.equal(c.pragma("integrity_check", { simple: true }), "ok");
  });

  it("riaccende le chiavi esterne", () => {
    assert.equal(c.pragma("foreign_keys", { simple: true }), 1);
  });

  it("gli account sono gli stessi, colonna per colonna", () => {
    const righe = c
      .prepare("SELECT id, utente, ruolo, unita_id, stato, totp_attivato_il FROM utenti ORDER BY id")
      .all();
    assert.deepEqual(righe, [
      {
        id: 1,
        utente: "ref1",
        ruolo: "referente",
        unita_id: 1,
        stato: "attivo",
        totp_attivato_il: "2026-09-01T10:00:00Z",
      },
      { id: 2, utente: "referente", ruolo: "gestore", unita_id: null, stato: "attivo", totp_attivato_il: null },
    ]);
  });

  it("le sessioni aperte e gli autori dei contenuti non si muovono", () => {
    assert.equal(conta(c, "SELECT count(*) n FROM sessioni"), 1, "la sessione c'è ancora");
    assert.equal(conta(c, "SELECT autore_id n FROM unita WHERE id = 1"), 1);
    assert.equal(conta(c, "SELECT autore_id n FROM pagine_testi WHERE chiave = 'home.intro'"), 2);
  });

  it("il ruolo nuovo entra in utenti e in permessi, senza unità", () => {
    c.prepare(
      "INSERT INTO utenti (utente, nome, iniziali, ruolo, stato) VALUES ('smm','Social','SM','social','invitato')",
    ).run();
    c.prepare(
      "INSERT INTO permessi (funzione, nome, ruolo, livello) VALUES ('pagine','Testi','social','limitato')",
    ).run();
    assert.throws(
      () =>
        c
          .prepare(
            "INSERT INTO utenti (utente, nome, iniziali, ruolo, unita_id, stato) VALUES ('smm2','S','S','social',1,'invitato')",
          )
          .run(),
      /utenti_unita_solo_referente/,
      "un'unità resta dei soli referenti di unità",
    );
  });

  it("un ruolo inventato resta fuori", () => {
    assert.throws(
      () =>
        c
          .prepare(
            "INSERT INTO utenti (utente, nome, iniziali, ruolo, stato) VALUES ('x','X','X','referente-supremo','invitato')",
          )
          .run(),
      /utenti_ruolo/,
    );
  });

  it("i due indici sui nomi tengono ancora maiuscole e minuscole insieme", () => {
    assert.throws(
      () =>
        c
          .prepare(
            "INSERT INTO utenti (utente, nome, iniziali, ruolo, unita_id, stato) VALUES ('REF1','A','A','referente',1,'invitato')",
          )
          .run(),
      /UNIQUE/,
    );
  });
});

describe("0013 con il migratore nudo, a chiavi esterne accese", () => {
  it("la guardia la ferma, e il database resta com'era", () => {
    const c = popolato("nudo.db");
    try {
      assert.equal(c.pragma("foreign_keys", { simple: true }), 1);
      assert.throws(
        () => migrate(drizzle(c), { migrationsFolder: "./drizzle" }),
        (e) => /0013_va_applicata_con_npm_run_db_applica/.test(e.cause?.message ?? e.message),
      );
      assert.equal(conta(c, "SELECT count(*) n FROM __drizzle_migrations"), 13);
      assert.equal(conta(c, "SELECT count(*) n FROM sessioni"), 1);
      assert.equal(conta(c, "SELECT autore_id n FROM unita WHERE id = 1"), 1);
      assert.equal(
        conta(c, "SELECT count(*) n FROM sqlite_master WHERE name = 'proposte'"),
        0,
        "la transazione si è annullata intera",
      );
    } finally {
      c.close();
    }
  });
});
