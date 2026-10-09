import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { sql as sqlDrizzle } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Lo strato di connessione, il mappatore degli errori e le anagrafiche di
 * riferimento — il passo 2B.0.
 *
 * I moduli si importano **dopo** aver impostato `SITO_DB`, perché lo strato
 * apre il database alla prima richiesta e non all'import: è il motivo per cui
 * `lib/db/percorso.ts` espone `percorsoDb()` oltre alla costante.
 */

let cartella;
let percorso;
let db, dbSeEsiste, transazione, pragmiCorrenti, databaseRisponde, chiudiPerTest;
let mappaErroreDatabase, comeStatoAzione;
let assicuraRiferimenti, idAnno, idUnita;
let schema;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-strato-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  // il database va creato e migrato prima che lo strato lo apra
  const raw = new Database(percorso);
  migrate(drizzle(raw), { migrationsFolder: "./drizzle" });
  raw.close();

  ({ db, dbSeEsiste, transazione, pragmiCorrenti, databaseRisponde, chiudiPerTest } = await import(
    "@/lib/db/db"
  ));
  ({ mappaErroreDatabase, comeStatoAzione } = await import("@/lib/db/errori"));
  ({ assicuraRiferimenti, idAnno, idUnita } = await import("@/lib/db/riferimenti"));
  schema = await import("@/lib/db/schema");
});

after(() => {
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

// --------------------------------------------------------------------------

describe("strato di connessione", () => {
  it("applica tutti e quattro i pragmi", () => {
    assert.deepEqual(pragmiCorrenti(), {
      journal_mode: "wal",
      foreign_keys: 1,
      busy_timeout: 5000,
      synchronous: 1,
    });
  });

  it("risponde alla sonda di stato senza leggere dati applicativi", () => {
    assert.equal(databaseRisponde(), true);
  });

  it("restituisce lo stesso handle: una connessione per processo", () => {
    assert.equal(dbSeEsiste(), dbSeEsiste());
  });

  it("le chiavi esterne sono applicate davvero, non solo dichiarate", () => {
    assert.throws(
      () =>
        db()
          .insert(schema.album)
          .values({ slug: "orfano", annoId: 9999, titolo: "T", dataTesto: "Settembre 2026" })
          .run(),
      (e) => mappaErroreDatabase(e).genere === "chiave_esterna",
    );
  });
});

describe("transazioni", () => {
  it("commette quando la callback ritorna", () => {
    const n = transazione((d) => {
      d.insert(schema.ragazzi).values({ nome: "Marco", cognome: "Rossi" }).run();
      return 1;
    });
    assert.equal(n, 1);
    const righe = db().select().from(schema.ragazzi).all();
    assert.equal(righe.length, 1);
  });

  it("annulla tutto se la callback solleva: niente scritture parziali", () => {
    assert.throws(() =>
      transazione((d) => {
        d.insert(schema.ragazzi).values({ nome: "Anna", cognome: "Bianchi" }).run();
        // un vincolo violato a metà: il primo inserimento non deve sopravvivere
        d.insert(schema.album)
          .values({ slug: "x", annoId: 9999, titolo: "T", dataTesto: "S" })
          .run();
      }),
    );
    const nomi = db().select().from(schema.ragazzi).all().map((r) => r.nome);
    assert.ok(!nomi.includes("Anna"), "l'inserimento prima dell'errore è stato annullato");
  });

  it("apre in BEGIN IMMEDIATE: un secondo scrittore trova occupato", () => {
    const altro = new Database(percorso);
    altro.pragma("busy_timeout = 200");
    let codice = "(nessun errore)";
    transazione((d) => {
      d.insert(schema.ragazzi).values({ nome: "Luca", cognome: "Verdi" }).run();
      try {
        altro.exec("BEGIN IMMEDIATE");
      } catch (e) {
        codice = e.code;
      }
      return null;
    });
    altro.close();
    assert.equal(codice, "SQLITE_BUSY", "il lucchetto di scrittura è preso subito, non alla prima scrittura");
  });
});

describe("mappatore degli errori — nessun SQL verso il browser", () => {
  /** Ricava un vero errore Drizzle, invece di costruirne uno finto. */
  function erroreVero(fn) {
    try {
      fn();
      throw new Error("l'operazione avrebbe dovuto fallire");
    } catch (e) {
      return e;
    }
  }

  it("un conflitto di unicità diventa GIA_ESISTE", () => {
    db().insert(schema.unita).values({
      chiave: "prova", slug: "prova", nome: "Prova", fascia: "gialla", ordine: 90,
    }).run();
    const e = erroreVero(() =>
      db().insert(schema.unita).values({
        chiave: "prova", slug: "prova2", nome: "Prova 2", fascia: "gialla", ordine: 91,
      }).run(),
    );
    const m = mappaErroreDatabase(e);
    assert.equal(m.genere, "conflitto");
    assert.equal(m.codice, "GIA_ESISTE");
  });

  it("un CHECK violato diventa DATI_NON_VALIDI", () => {
    const e = erroreVero(() =>
      db().insert(schema.unita).values({
        chiave: "x", slug: "x", nome: "X", fascia: "fucsia", ordine: 92,
      }).run(),
    );
    const m = mappaErroreDatabase(e);
    assert.equal(m.genere, "vincolo");
    assert.equal(m.codice, "DATI_NON_VALIDI");
  });

  it("una chiave esterna mancante diventa RIFERIMENTO_MANCANTE", () => {
    const e = erroreVero(() =>
      db().insert(schema.album).values({
        slug: "senza-anno", annoId: 12345, titolo: "T", dataTesto: "Settembre 2026",
      }).run(),
    );
    assert.equal(mappaErroreDatabase(e).codice, "RIFERIMENTO_MANCANTE");
  });

  /** Niente di sensibile deve comparire in ciò che il browser riceve. */
  function nienteFuga(errore, valori) {
    const versoIlBrowser = JSON.stringify(comeStatoAzione(mappaErroreDatabase(errore)));
    for (const proibito of [
      ...valori,
      "INSERT",
      "insert into",
      "update ",
      "values",
      "SQLITE_",
      "constraint",
      "unita",
    ]) {
      assert.ok(
        !versoIlBrowser.toLowerCase().includes(proibito.toLowerCase()),
        `«${proibito}» non deve comparire in ciò che va al browser: ${versoIlBrowser}`,
      );
    }
    return versoIlBrowser;
  }

  it("dal query builder: l'errore porta il vincolo, e non passa al browser", () => {
    // Con il query builder di Drizzle l'errore arriva grezzo da better-sqlite3:
    // `SqliteError: UNIQUE constraint failed: unita.chiave`. Non contiene i
    // valori, ma contiene tabella e colonna — che al browser non devono arrivare.
    const e = erroreVero(() =>
      db().insert(schema.unita).values({
        chiave: "prova", slug: "segretissimo-slug", nome: "Nome Riservato", fascia: "gialla", ordine: 93,
      }).run(),
    );
    assert.match(String(e.message), /constraint failed/i, "premessa: l'errore nomina il vincolo");
    nienteFuga(e, ["segretissimo-slug", "Nome Riservato"]);
  });

  it("da SQL grezzo: l'errore porta la query completa CON i valori, e non passa al browser", () => {
    // Questo è il caso dimostrato nella fase 1, ed è il peggiore: Drizzle
    // avvolge l'errore e mette l'intera query, valori compresi, in `e.message`.
    // È il motivo per cui questo mappatore esiste.
    const sql = sqlDrizzle;
    const e = erroreVero(() =>
      db().run(
        sql.raw(
          "INSERT INTO unita (chiave, slug, nome, fascia, ordine) VALUES ('prova','segretissimo-slug-2','Nome Riservatissimo','gialla',95)",
        ),
      ),
    );
    assert.ok(
      String(e.message).includes("segretissimo-slug-2"),
      `premessa: l'errore grezzo contiene i valori. Invece: ${e.message}`,
    );
    nienteFuga(e, ["segretissimo-slug-2", "Nome Riservatissimo"]);
  });

  it("il dettaglio per il registro c'è, ma è quello di SQLite e non di Drizzle", () => {
    const e = erroreVero(() =>
      db().insert(schema.unita).values({
        chiave: "prova", slug: "altro", nome: "Altro", fascia: "gialla", ordine: 94,
      }).run(),
    );
    const m = mappaErroreDatabase(e);
    assert.match(m.dettaglio, /SQLITE_CONSTRAINT/);
    assert.ok(!m.dettaglio.includes("insert into"), "il dettaglio non porta l'SQL di Drizzle");
  });

  it("non solleva mai, qualunque cosa gli si dia", () => {
    for (const cosa of [undefined, null, 0, "", "boom", new Error("x"), {}, [], Symbol("s")]) {
      const m = mappaErroreDatabase(cosa);
      assert.equal(typeof m.codice, "string");
      assert.equal(typeof m.messaggio, "string");
      assert.ok(m.messaggio.length > 0);
    }
  });

  it("un errore di filesystem si distingue da uno del database", () => {
    const e = Object.assign(new Error("no such file"), { code: "ENOENT" });
    const m = mappaErroreDatabase(e);
    assert.equal(m.genere, "filesystem");
    assert.equal(m.codice, "FS_ENOENT");
  });

  it("SQLITE_BUSY diventa un messaggio che invita a riprovare", () => {
    const m = mappaErroreDatabase(Object.assign(new Error("busy"), { code: "SQLITE_BUSY" }));
    assert.equal(m.codice, "OCCUPATO");
    assert.match(m.messaggio, /riprovate/i);
  });

  it("un abort da trigger è classificabile: serve al cancello dei consensi", () => {
    // forma verificata nella fase 1: Drizzle mette l'originale in `cause`
    const finto = Object.assign(new Error("Failed to run the query 'UPDATE …'"), {
      cause: Object.assign(new Error("consensi immagini mancanti"), {
        code: "SQLITE_CONSTRAINT_TRIGGER",
      }),
    });
    const m = mappaErroreDatabase(finto);
    assert.equal(m.genere, "trigger");
    assert.equal(m.codice, "REGOLA_DB");
    assert.match(m.dettaglio, /consensi immagini mancanti/);
    assert.ok(
      !m.messaggio.includes("consensi immagini mancanti"),
      "il messaggio del trigger resta nel registro: al browser va una frase scritta da noi",
    );
  });
});

describe("anagrafiche di riferimento", () => {
  it("crea le sei unità e i quattro anni", () => {
    const esito = assicuraRiferimenti();
    assert.equal(esito.unitaCreate, 6);
    assert.equal(esito.anniCreati, 4);
  });

  it("«gruppo» NON è fra le unità: nel modello è unita_id NULL", () => {
    const chiavi = db().select().from(schema.unita).all().map((u) => u.chiave);
    assert.ok(!chiavi.includes("gruppo"), "una riga «gruppo» romperebbe il trigger dei consensi");
    assert.equal(idUnita("gruppo"), undefined);
    assert.ok(idUnita("u1"));
  });

  it("un anno solo è corrente, ed è quello di ANNI_DOC", () => {
    const correnti = db()
      .select()
      .from(schema.anniSociali)
      .all()
      .filter((a) => a.corrente === 1);
    assert.equal(correnti.length, 1);
    assert.equal(correnti[0].etichetta, "2026-2027");
  });

  it("gli anni hanno inizio a settembre e fine a luglio", () => {
    const a = db().select().from(schema.anniSociali).all().find((x) => x.etichetta === "2026-2027");
    assert.equal(a.inizio, "2026-09-01");
    assert.equal(a.fine, "2027-07-31");
  });

  it("è idempotente: la seconda esecuzione non crea niente", () => {
    const esito = assicuraRiferimenti();
    assert.equal(esito.unitaCreate, 0);
    assert.equal(esito.anniCreati, 0);
    // 6 più la riga «prova» inserita dai test sugli errori
    assert.equal(esito.unitaPresenti, 7);
    assert.equal(esito.anniPresenti, 4);
  });

  it("idAnno risolve l'etichetta canonica e non crea anni nuovi", () => {
    assert.ok(idAnno("2026-2027"));
    assert.equal(idAnno("2030-2031"), undefined);
    assert.equal(db().select().from(schema.anniSociali).all().length, 4);
  });
});
