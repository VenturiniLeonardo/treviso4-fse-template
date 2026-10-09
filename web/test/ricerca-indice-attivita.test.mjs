import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * La ricerca legge le attività dal database — dall'audit (DEV-01).
 *
 * Prima l'indice della ricerca costruiva le voci del calendario dal seme
 * statico `EVENTI`, mentre la pagina `/attivita` le legge dal database: appena
 * un referente avesse aggiunto o tolto un'attività, la lente e la pagina avrebbero
 * detto cose diverse. È la stessa svista già corretta nello stesso file per le
 * unità e le domande frequenti.
 *
 * Qui si prova che l'indice: con la tabella vuota non ha voci di calendario
 * (il seme è vuoto, e la pagina ci ricade allo stesso modo); mostra
 * un'attività **pubblicata** appena creata, e porta alla pagina del
 * calendario; e **non** mostra una bozza.
 */

let costruisciIndice, attivitaStore, chiudiPerTest, EVENTI;
let raw;
let cartella, percorso;

/** Le sole voci della sezione «Attività». */
async function attivitaNellIndice() {
  const voci = await costruisciIndice();
  return voci.filter((v) => v.sezione === "Attività");
}

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-ricerca-att-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  ({ costruisciIndice } = await import("@/lib/ricerca-indice"));
  attivitaStore = await import("@/lib/attivita-store");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  ({ EVENTI } = await import("@/lib/data"));

  const riferimenti = await import("@/lib/db/riferimenti");
  raw = new Database(percorso);
  riferimenti.assicuraRiferimenti();
});

beforeEach(() => {
  raw.prepare("delete from attivita").run();
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  rmSync(cartella, { recursive: true, force: true });
});

describe("l'indice della ricerca e le attività", () => {
  it("con la tabella vuota non ha voci di calendario (il seme è vuoto, come la pagina)", async () => {
    assert.deepEqual(await attivitaNellIndice(), []);
  });

  it("un'attività pubblicata compare (l'indice legge i dati vivi, non il seme)", async () => {
    const titolo = "Gioco a squadre dell'audit XZ7";
    const id = await attivitaStore.creaAttivita(
      { titolo, data: "2026-11-05", tipo: "uscita", luogo: "Parco cittadino", durata: "un giorno" },
      "referente",
    );
    await attivitaStore.cambiaStatoAttivita(id, "pubblicato", "referente");

    const attivita = await attivitaNellIndice();
    const titoli = attivita.map((v) => v.titolo);
    assert.ok(titoli.includes(titolo), "un'attività pubblicata dev'essere nella ricerca");
    // e ogni voce porta alla pagina del calendario
    assert.ok(attivita.every((v) => v.href === "/attivita"));
    // il titolo è inventato: se comparisse solo perché è nel seme, la prova non varrebbe
    assert.equal(EVENTI.some((e) => e.titolo === titolo), false, "presupposto: non è nel seme");
  });

  it("una bozza NON compare (solo le pubblicate, come per album e documenti)", async () => {
    const titolo = "Bozza riservata dell'audit XZ7";
    await attivitaStore.creaAttivita(
      { titolo, data: "2026-12-05", tipo: "riunione" },
      "referente",
    ); // resta in bozza

    const titoli = (await attivitaNellIndice()).map((v) => v.titolo);
    assert.equal(titoli.includes(titolo), false, "una bozza non deve finire nella ricerca pubblica");
  });
});
