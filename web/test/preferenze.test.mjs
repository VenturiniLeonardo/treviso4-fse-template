import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classeTema,
  leggiPreferenze,
  PREFERENZE_PREDEFINITE,
  scriviPreferenze,
} from "@/lib/preferenze";

describe("preferenze: il tema", () => {
  it("senza cookie vale il sistema", () => {
    assert.equal(leggiPreferenze(undefined).tema, "sistema");
    assert.equal(PREFERENZE_PREDEFINITE.tema, "sistema");
  });

  it("un cookie scritto prima del tema lo lascia al sistema e tiene il resto", () => {
    const p = leggiPreferenze("d=compatta&t=grande&f=1");
    assert.deepEqual(p, { tema: "sistema", densita: "compatta", testo: "grande", fermo: true });
  });

  it("un valore sconosciuto non passa", () => {
    assert.equal(leggiPreferenze("c=viola").tema, "sistema");
  });

  it("scritto e riletto resta uguale", () => {
    for (const tema of ["sistema", "chiaro", "scuro"]) {
      const p = { ...PREFERENZE_PREDEFINITE, tema };
      assert.deepEqual(leggiPreferenze(scriviPreferenze(p)), p);
    }
  });

  it("la classe per <html> dice il tema", () => {
    assert.equal(classeTema({ ...PREFERENZE_PREDEFINITE, tema: "scuro" }), "tema-scuro");
  });
});
