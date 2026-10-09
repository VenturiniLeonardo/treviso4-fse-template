import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Le fotografie nascoste su un database **fermo alla 0020**.
 *
 * È la finestra del rilascio: il pacchetto nuovo si compila sul server prima
 * di applicare le migrazioni, e la compilazione prerenderizza home, Chi siamo e
 * le pagine delle unità leggendo il database in esercizio. Qui si prova che in
 * quella finestra le letture non sollevano — niente è nascosto, perché la
 * colonna non c'è — e che nascondere risponde «non fatto» invece di cadere.
 *
 * Solo letture, e non per pigrizia: drizzle scrive in ogni `INSERT` tutte le
 * colonne dello schema, quindi su un database fermo alla 0020 nessun
 * inserimento in `unita`, `immagini` o `foto` può riuscire — né questo, né
 * quello di ogni altra migrazione che ha aggiunto una colonna. Al rilascio non
 * conta: si compila (letture), si migra, e solo dopo il servizio riparte e
 * scrive. Per lo stesso motivo le righe qui si scrivono in SQL.
 *
 * File a parte, e non un caso di `social-redazione.test.mjs`: `haColonna`
 * ricorda di aver visto una colonna, e in quel file le colonne ci sono.
 */

let cartella;
let immagini, unita, album, chiudiPerTest;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-prima-0021-"));
  const migrazioni = join(cartella, "drizzle");
  cpSync("./drizzle", migrazioni, { recursive: true });
  const percorsoGiornale = join(migrazioni, "meta", "_journal.json");
  const giornale = JSON.parse(readFileSync(percorsoGiornale, "utf8"));
  giornale.entries = giornale.entries.filter((e) => e.idx < 21);
  writeFileSync(percorsoGiornale, JSON.stringify(giornale));

  const percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = join(cartella, "dati");

  const c = new Database(percorso);
  migrate(drizzle(c), { migrationsFolder: migrazioni });
  c.close();

  immagini = await import("@/lib/immagini-store");
  unita = await import("@/lib/unita-store");
  album = await import("@/lib/album");
  ({ chiudiPerTest } = await import("@/lib/db/db"));

  // un'immagine e una copertina scritte dal codice di prima, con lo schema di prima
  const raw = new Database(percorso);
  raw
    .prepare(
      "INSERT INTO unita (chiave, slug, nome, eta, fascia, ordine) VALUES ('u1', 'u1', 'Unità di prova', '8–11 anni', 'gialla', 1)",
    )
    .run();
  raw
    .prepare(
      "INSERT INTO immagini (chiave, file, tipo, larghezza, altezza) VALUES ('chi-siamo.gruppo', 'vecchia.jpg', 'image/jpeg', 1600, 800)",
    )
    .run();
  raw
    .prepare(
      "UPDATE unita SET copertina = 'cop.jpg', copertina_tipo = 'image/jpeg', copertina_larghezza = 2400, copertina_altezza = 1200 WHERE chiave = 'u1'",
    )
    .run();
  raw.close();
});

after(() => {
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

describe("prima della 0021", () => {
  it("le immagini si leggono, e nessuna è nascosta", async () => {
    const i = (await immagini.immaginiCaricate()).get("chi-siamo.gruppo");
    assert.equal(i?.file, "vecchia.jpg");
    assert.equal(i?.nascosta, false);
    assert.equal((await immagini.immagineRegistrata("vecchia.jpg"))?.nascosta, false);
  });

  it("le copertine si leggono, e nessuna è nascosta", async () => {
    const u = await unita.unitaSalvataPerChiave("u1");
    assert.match(u.copertina.src, /cop\.jpg$/);
    assert.equal(u.copertinaNascosta, undefined);
    assert.equal((await unita.copertinaRegistrata("cop.jpg"))?.nascosta, false);
  });

  it("gli album si leggono", async () => {
    assert.ok(Array.isArray(await album.leggiAlbum()));
    assert.ok(Array.isArray(await album.albumPubblicati()));
  });

  it("nascondere risponde «non fatto», senza sollevare", async () => {
    assert.equal(await immagini.nascondiImmagine("chi-siamo.gruppo", true), false);
    assert.equal(await unita.nascondiCopertina("u1", true), false);
  });
});
