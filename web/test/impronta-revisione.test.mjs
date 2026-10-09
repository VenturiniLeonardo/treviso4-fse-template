import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

/**
 * L'impronta di ciò che chi approva ha visto — audit di sicurezza, BIZ-02.
 *
 * La coda la mette nel modulo, `decidi()` la ricalcola prima di pubblicare.
 * Deve cambiare quando cambia il contenuto, e **non** quando cambia solo ciò
 * che si muove da sé: altrimenti ogni approvazione durante una conversione di
 * fotografie verrebbe respinta.
 */

let improntaDiRevisione;

const ALBUM = {
  slug: "uscita",
  titolo: "Uscita di primavera",
  sottotitolo: "",
  stato: "in-revisione",
  aggiornato: 1,
  autore: "cu",
  foto: [{ file: "a.jpg", didascalia: "", larghezza: 0, altezza: 0, conversione: "attesa" }],
};

before(async () => {
  ({ improntaDiRevisione } = await import("@/lib/impronta-revisione"));
});

describe("improntaDiRevisione", () => {
  it("è la stessa per lo stesso contenuto", () => {
    assert.equal(improntaDiRevisione(ALBUM), improntaDiRevisione(structuredClone(ALBUM)));
  });

  it("cambia se cambia il titolo o se si aggiunge una fotografia", () => {
    const prima = improntaDiRevisione(ALBUM);
    assert.notEqual(improntaDiRevisione({ ...ALBUM, titolo: "Altro" }), prima);
    assert.notEqual(
      improntaDiRevisione({ ...ALBUM, foto: [...ALBUM.foto, { file: "b.jpg", didascalia: "" }] }),
      prima,
    );
  });

  it("non cambia per la conversione, lo stato, l'autore o l'ora", () => {
    const convertita = {
      ...ALBUM,
      stato: "bozza",
      aggiornato: 99,
      autore: "cg",
      foto: [{ file: "a.jpg", didascalia: "", larghezza: 1600, altezza: 1200, conversione: "pronta" }],
    };
    assert.equal(improntaDiRevisione(convertita), improntaDiRevisione(ALBUM));
  });
});
