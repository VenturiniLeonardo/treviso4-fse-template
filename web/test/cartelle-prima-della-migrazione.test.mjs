import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Il codice delle cartelle su un database **fermo alla 0011**.
 *
 * È la finestra del rilascio: `rilascio.md` compila il pacchetto nuovo sul
 * server prima di applicare le migrazioni, e la compilazione prerenderizza
 * `/documenti` leggendo il database in esercizio. Qui si prova che in quella
 * finestra le letture non sollevano — le cartelle ricadono sulle sei di
 * partenza, i documenti si leggono come prima — e quindi che la compilazione
 * non si ferma su «no such table: cartelle».
 *
 * File a parte, e non un caso di `cartelle-store.test.mjs`: lo store ricorda di
 * aver visto la tabella, e in quel file la tabella c'è.
 */

let cartella;
let store;
let documenti;
let chiudiPerTest;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-prima-0012-"));
  // le migrazioni fino alla 0011: una copia della cartella con il giornale corto
  const migrazioni = join(cartella, "drizzle");
  cpSync("./drizzle", migrazioni, { recursive: true });
  const percorsoGiornale = join(migrazioni, "meta", "_journal.json");
  const giornale = JSON.parse(readFileSync(percorsoGiornale, "utf8"));
  giornale.entries = giornale.entries.filter((e) => e.idx < 12);
  writeFileSync(percorsoGiornale, JSON.stringify(giornale));

  const percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = join(cartella, "dati");

  const c = new Database(percorso);
  migrate(drizzle(c), { migrationsFolder: migrazioni });
  // un documento scritto dal codice di prima, con lo schema di prima
  c.prepare(
    "INSERT INTO anni_sociali (id, etichetta, inizio, fine, corrente) VALUES (1,'2026-2027','2026-09-01','2027-07-31',1)",
  ).run();
  c.prepare(
    "INSERT INTO documenti (chiave, anno_id, categoria, titolo, stato) VALUES ('2026-2027/quote',1,'quote','Quote','pubblicato')",
  ).run();
  c.close();

  store = await import("@/lib/cartelle-store");
  documenti = await import("@/lib/documenti-store");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
});

after(() => {
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

describe("prima della 0012", () => {
  it("le cartelle ricadono sulle sei di partenza, senza sollevare", async () => {
    const c = await store.leggiCartelle();
    assert.deepEqual(
      c.map((x) => x.chiave),
      ["iscrizioni", "autorizzazioni", "campi", "quote", "statuti", "circolari"],
    );
  });

  it("i documenti si leggono con lo schema vecchio, anno compreso", async () => {
    const [d, ...altri] = await documenti.documentiPubblicati();
    assert.deepEqual(altri, []);
    assert.equal(d.titolo, "Quote");
    assert.equal(d.categoria, "quote");
    assert.equal(d.anno, "2026-2027");
    // la colonna arriva con la 0016: senza, nessun riquadro e nessun errore
    assert.equal(d.avviso, "");
  });
});
