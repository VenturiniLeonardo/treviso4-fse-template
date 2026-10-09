import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Chi può riscrivere la matrice dei permessi — audit di sicurezza.
 *
 * La matrice è la configurazione più privilegiata del sistema: chi la modifica
 * può darsi qualunque permesso, incluso «utenti» completo (e quindi creare un
 * account sviluppatore), oppure `gdpr` e `backup`. La schermata la mostra
 * modificabile al solo sviluppatore.
 *
 * Il buco chiuso qui: le Server Action della matrice si fermavano a
 * `contesto("utenti")`. Ma nel seme «utenti» vale `limitato` per il gestore,
 * e con `limitato` — senza risorsa — quel cancello si **supera**. Un referente
 * gruppo, invocando l'azione direttamente (senza passare dalla schermata dello
 * sviluppatore, che il middleware gli nega), poteva riscrivere le regole.
 *
 * Si prova la **regola pura** — che il livello di «utenti» distingue davvero i
 * ruoli — e la **presenza della soglia `completo` nel sorgente** delle quattro
 * azioni, perché le Server Action non si eseguono fuori da Next: la strada che
 * NON deve esistere si dimostra sul sorgente, come in `secondo-fattore.test.mjs`.
 */

let cartella, percorso, raw;
let decidi, leggiMatrice, chiudiPerTest;

const sess = (r) => ({ u: r, n: r, r, i: "XX", exp: 0 });

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-permessi-cancello-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  ({ decidi } = await import("@/lib/auth/decisione"));
  ({ leggiMatrice } = await import("@/lib/permessi-store"));
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  rmSync(cartella, { recursive: true, force: true });
});

describe("il livello di «utenti» distingue admin da gestore", () => {
  it("solo lo sviluppatore ha «utenti» completo; il gestore ha limitato", async () => {
    const m = await leggiMatrice();
    const liv = (r) => {
      const e = decidi(m, sess(r), "utenti", undefined);
      return e.ok ? e.livello : `negato:${e.motivo}`;
    };
    // è ESATTAMENTE lo stato su cui si fondava l'escalation: il gestore
    // supera il cancello, ma a un livello inferiore a completo
    assert.equal(liv("sviluppatore"), "completo");
    assert.equal(liv("gestore"), "limitato");
    assert.equal(liv("referente"), "negato:ruolo");
  });
});

describe("le azioni della matrice esigono il permesso distinto «permessi»", () => {
  const sorgente = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "app",
      "(area)",
      "area-riservata",
      "permessi",
      "actions.ts",
    ),
    "utf8",
  );

  it("esiste una soglia esplicita sul livello «completo»", () => {
    assert.match(sorgente, /livello\s*!==\s*"completo"/);
  });

  it("nessuna azione si ferma al solo contesto(AZIONE) senza la soglia", () => {
    // il vecchio schema vulnerabile: `(await contesto(AZIONE)).sessione` come
    // unico cancello. Dopo la correzione non deve più comparire: tutte passano
    // da `soloAdmin()`.
    assert.doesNotMatch(sorgente, /\(await contesto\(AZIONE\)\)\.sessione/);
  });

  it("tutte le tre azioni chiamano il cancello soloAdmin()", () => {
    const chiamate = sorgente.match(/await soloAdmin\(\)/g) ?? [];
    // cambiaLivello, rimuoviFunzione, ripristina
    assert.equal(chiamate.length, 3);
  });
});
