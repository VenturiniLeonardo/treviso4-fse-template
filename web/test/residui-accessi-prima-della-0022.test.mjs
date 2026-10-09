import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Il cestino delle fotografie e la verifica dei consensi su un database
 * **fermo alla 0021**: la finestra del rilascio, in cui il pacchetto nuovo si
 * compila leggendo il database in esercizio prima di migrarlo.
 *
 * Solo letture, scritte in SQL, per la stessa ragione detta in
 * `social-redazione-prima-della-0021.test.mjs`: drizzle scrive in ogni
 * `INSERT` tutte le colonne dello schema. File a parte perché `haColonna`
 * ricorda le colonne che ha visto.
 */

let cartella;
let album, iscritti, chiudiPerTest;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-prima-0022-"));
  const migrazioni = join(cartella, "drizzle");
  cpSync("./drizzle", migrazioni, { recursive: true });
  const percorsoGiornale = join(migrazioni, "meta", "_journal.json");
  const giornale = JSON.parse(readFileSync(percorsoGiornale, "utf8"));
  giornale.entries = giornale.entries.filter((e) => e.idx < 22);
  writeFileSync(percorsoGiornale, JSON.stringify(giornale));

  const percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = join(cartella, "dati");

  const c = new Database(percorso);
  migrate(drizzle(c), { migrationsFolder: migrazioni });
  c.prepare(
    "INSERT INTO anni_sociali (id, etichetta, inizio, fine, corrente) VALUES (1, '2026-2027', '2026-09-01', '2027-08-31', 1)",
  ).run();
  c.prepare(
    "INSERT INTO unita (id, chiave, slug, nome, eta, fascia, ordine) VALUES (1, 'u1', 'u1', 'Unità 1', '8–11 anni', 'gialla', 1)",
  ).run();
  c.prepare(
    "INSERT INTO album (id, slug, anno_id, titolo, data_testo, stato) VALUES (1, 'uscita', 1, 'Uscita', 'Ottobre 2026', 'pubblicato')",
  ).run();
  c.prepare(
    "INSERT INTO foto (album_id, file, tipo, larghezza, altezza) VALUES (1, 'foto-a.jpg', 'image/jpeg', 10, 10)",
  ).run();
  c.prepare("INSERT INTO ragazzi (id, nome, cognome) VALUES (1, 'Anna', 'Prova')").run();
  c.prepare(
    "INSERT INTO iscrizioni (ragazzo_id, unita_id, anno_id, consenso_immagini, consenso_data) VALUES (1, 1, 1, 1, '2026-09-15')",
  ).run();
  c.close();

  album = await import("@/lib/album");
  iscritti = await import("@/lib/iscritti-store");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
});

after(() => {
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

describe("prima della 0022", () => {
  it("gli album si leggono con le loro fotografie, e il cestino è vuoto", async () => {
    const a = await album.albumPerIndirizzo("uscita");
    assert.deepEqual(a.foto.map((f) => f.file), ["foto-a.jpg"]);
    assert.equal((await album.fotoPubblica("foto-a.jpg"))?.copertina, true);
    assert.deepEqual(await album.fotoNelCestino("uscita"), []);
    assert.deepEqual(await album.svuotaCestino(), []);
  });

  it("gli iscritti si leggono, senza verifica", () => {
    const [i] = iscritti.elencoIscritti({ anno: "2026-2027" });
    assert.equal(i.consenso, true);
    assert.equal(i.verifica, null);
    assert.equal(i.consensoModulo, "");
    assert.deepEqual(iscritti.campioneDaVerificare("2026-2027", "cg"), []);
    assert.equal(iscritti.statoVerifiche("2026-2027").consensi, 0);
  });
});
