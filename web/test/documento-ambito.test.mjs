import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * L'ambito d'unità della rotta dei file dei documenti — audit di sicurezza.
 *
 * `/documento/[file]` serve i moduli caricati; per un documento **non
 * pubblicato** decide la riga «documenti» della matrice. Dalla fase 14 quella
 * riga vale `limitato` per il referente di unità (le circolari della propria unità), non
 * più `nessuno` come il commento della rotta diceva ancora. Ma la rotta chiamava
 * `puo("documenti")` **senza risorsa**: con `limitato` e senza ambito il cancello
 * passa sempre, e un referente di unità poteva scaricare la bozza di un'altra unità o
 * della modulistica di gruppo.
 *
 * La correzione porta l'unità del documento nella decisione, come già fa la
 * rotta delle fotografie. Qui si prova: (1) che lo store restituisce l'unità del
 * documento; (2) che `decidi("documenti", {unita})` confina davvero il referente
 * unità; (3) che la rotta passa l'ambito.
 */

let cartella, percorso, raw;
let store, decidi, chiudiPerTest;

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(16, 0x20)]);
const sess = (r, un) => ({ u: r, n: r, r, i: "XX", ...(un ? { un } : {}), exp: 0 });

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-doc-ambito-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = cartella;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/documenti-store");
  ({ decidi } = await import("@/lib/auth/decisione"));
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  // il reticolo — anni sociali e unità — che le circolari referenziano
  const { assicuraRiferimenti } = await import("@/lib/db/riferimenti");
  assicuraRiferimenti();
  raw = new Database(percorso);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  rmSync(cartella, { recursive: true, force: true });
});

// L'anno da usare: uno di quelli seminati da `assicuraRiferimenti`.
const annoSeminato = () => {
  const r = raw.prepare("SELECT etichetta FROM anni_sociali ORDER BY etichetta DESC LIMIT 1").get();
  return r?.etichetta;
};

describe("lo store restituisce l'unità del documento", () => {
  it("una circolare porta la sua unità; un documento di gruppo porta «gruppo»", async () => {
    const anno = annoSeminato();
    assert.ok(anno, "il seme deve avere almeno un anno sociale");

    // una circolare dell'unità 1 (bozza, con file)
    const circ = await store.creaDocumento(
      { titolo: "Circolare uscita u1", anno, unita: "u1", categoria: "circolari", nota: "" },
      Date.now(),
      "",
    );
    assert.ok(circ.ok, "creazione circolare");
    let esito = await store.caricaFileDocumento(circ.id, PDF, Date.now(), "", "gen 2026");
    assert.ok(esito.ok, "file circolare");

    // un documento di gruppo (bozza, con file)
    const grp = await store.creaDocumento(
      { titolo: "Modulo prova gruppo", anno, unita: "gruppo", categoria: "iscrizioni", nota: "" },
      Date.now(),
      "",
    );
    assert.ok(grp.ok, "creazione documento di gruppo");
    esito = await store.caricaFileDocumento(grp.id, PDF, Date.now() + 1, "", "gen 2026");
    assert.ok(esito.ok, "file gruppo");

    const fileCirc = raw.prepare("SELECT file FROM documenti WHERE chiave = ?").get(circ.id).file;
    const fileGrp = raw.prepare("SELECT file FROM documenti WHERE chiave = ?").get(grp.id).file;

    const iCirc = await store.fileInterno(fileCirc);
    const iGrp = await store.fileInterno(fileGrp);
    assert.equal(iCirc?.unita, "u1");
    assert.equal(iGrp?.unita, "gruppo");
  });
});

describe("la decisione confina il referente di unità", () => {
  const matrice = [
    {
      id: "documenti",
      nome: "Documenti",
      livelli: { sviluppatore: "completo", "gestore": "completo", "referente": "limitato" },
    },
  ];
  const ok = (r, un, unitaRis) =>
    decidi(matrice, sess(r, un), "documenti", { unita: unitaRis }).ok;

  it("un referente di unità vede solo i file interni della propria unità", () => {
    assert.equal(ok("referente", "u1", "u1"), true);
    assert.equal(ok("referente", "u1", "u4"), false);
    // la modulistica di gruppo (bozza) non è sua
    assert.equal(ok("referente", "u1", "gruppo"), false);
  });

  it("gestore e sviluppatore vedono ogni file interno", () => {
    for (const r of ["gestore", "sviluppatore"]) {
      for (const u of ["u1", "u4", "gruppo"]) {
        assert.equal(ok(r, undefined, u), true, `${r} deve vedere ${u}`);
      }
    }
  });
});

describe("la rotta porta l'ambito nella decisione", () => {
  const sorgente = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "app", "documento", "[file]", "route.ts"),
    "utf8",
  );
  it("chiama puo(\"documenti\", { unita: interno.unita })", () => {
    assert.match(sorgente, /puo\(\s*"documenti"\s*,\s*\{\s*unita:\s*interno\.unita\s*\}\s*\)/);
  });
});
