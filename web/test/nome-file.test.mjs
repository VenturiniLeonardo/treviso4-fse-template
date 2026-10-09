import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

/**
 * Il nome di un documento nell'intestazione — audit di sicurezza, FILE-01.
 *
 * Un titolo con un carattere oltre Latin-1 faceva fallire la costruzione della
 * risposta: `Headers` rifiuta i valori che non sono ByteString.
 */

let contentDisposition;

before(async () => {
  ({ contentDisposition } = await import("@/lib/nome-file"));
});

describe("contentDisposition", () => {
  it("un titolo con lettere oltre Latin-1 produce un'intestazione valida", () => {
    const valore = contentDisposition("Łódź – campo 2026 🏕.pdf", true);
    assert.doesNotThrow(() => new Headers({ "Content-Disposition": valore }));
    assert.match(valore, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    assert.ok(valore.includes(encodeURIComponent("Łódź")), "il nome vero viaggia in filename*");
  });

  it("le lettere accentate restano leggibili nel nome di ripiego", () => {
    assert.match(contentDisposition("Attività è già.pdf", false), /^inline; filename="Attivita e gia\.pdf"/);
  });

  it("niente virgolette o barre rovesciate nel nome ASCII", () => {
    const valore = contentDisposition('a"b\\c.pdf', true);
    assert.match(valore, /filename="a-b-c\.pdf"/);
  });
});
