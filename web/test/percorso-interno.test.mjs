import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

/**
 * L'indirizzo di ritorno di `/manutenzione` — audit di sicurezza, WEB-01.
 *
 * Il filtro di prima accettava `/\esempio.com`, che molti browser leggono come
 * `//esempio.com`: un collegamento del sito che portava fuori dal sito.
 */

let percorsoInterno;

before(async () => {
  ({ percorsoInterno } = await import("@/lib/percorso-interno"));
});

describe("percorsoInterno", () => {
  it("accetta i percorsi del sito", () => {
    for (const buono of ["/", "/documenti", "/unita/u1?anno=2026#referenti"]) {
      assert.equal(percorsoInterno(buono), buono);
    }
  });

  it("rifiuta ciò che può uscire dal sito", () => {
    for (const storto of [
      "/\\esempio.com",
      "/\\/esempio.com",
      "//esempio.com",
      "https://esempio.com",
      "esempio.com",
      "/../segreto",
      "/\tesempio",
      "",
      null,
      undefined,
    ]) {
      assert.equal(percorsoInterno(storto), null, String(storto));
    }
  });

  it("con un prefisso, solo i percorsi sotto quel prefisso", () => {
    assert.equal(percorsoInterno("/area-riservata/x", "/area-riservata/"), "/area-riservata/x");
    assert.equal(percorsoInterno("/documenti", "/area-riservata/"), null);
  });
});
