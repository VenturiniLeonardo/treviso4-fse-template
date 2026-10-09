import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { contenitoreDi, eImmagineAmmessa, ESTENSIONI, TIPI_MIME } from "@/lib/foto/formato";

/**
 * Riconoscere che cosa è davvero un file, dai primi byte.
 *
 * Le immagini di prova le costruisce `sharp`: sono file veri, non stringhe
 * inventate che assomigliano a un'intestazione. Un annusatore che passa su byte
 * scritti a mano dallo stesso che ha scritto l'annusatore non prova niente.
 */

const tela = () =>
  sharp({ create: { width: 60, height: 40, channels: 3, background: "#4a7d55" } });

describe("i formati che si accettano", () => {
  it("riconosce un JPEG vero", async () => {
    const b = await tela().jpeg().toBuffer();
    assert.equal(contenitoreDi(b), "jpeg");
  });

  it("riconosce un PNG vero", async () => {
    const b = await tela().png().toBuffer();
    assert.equal(contenitoreDi(b), "png");
  });

  it("riconosce un AVIF vero, e non lo confonde con un HEIC", async () => {
    // AVIF e HEIC sono lo **stesso** contenitore con due codificatori diversi:
    // se questa distinzione non funzionasse, il messaggio d'errore sull'HEIC
    // comparirebbe anche su file che si convertono benissimo
    const b = await tela().avif({ effort: 0 }).toBuffer();
    assert.equal(contenitoreDi(b), "avif");
  });
});

describe("quello che non si accetta", () => {
  it("un file che non è un'immagine è `null`, comunque si chiami", () => {
    for (const finto of [
      Buffer.from("#!/bin/sh\nrm -rf /\n"),
      Buffer.from("%PDF-1.7\n"),
      Buffer.from("GIF89a"),
      Buffer.alloc(0),
      Buffer.from([0x89, 0x50, 0x4e]), // firma PNG troncata
    ]) {
      assert.equal(contenitoreDi(finto), null);
      assert.equal(eImmagineAmmessa(finto), false);
    }
  });

  it("un TIFF non passa: sharp lo aprirebbe, ma non è fra quelli ammessi", async () => {
    const b = await tela().tiff().toBuffer();
    assert.equal(contenitoreDi(b), null);
  });

  it("un JPEG con i byte giusti e il resto rovinato passa di qui — e va bene così", async () => {
    // l'annusatore guarda l'intestazione, non l'integrità: quella la dice la
    // decodifica vera, nella coda, che è l'unico posto che può saperlo
    const b = await tela().jpeg().toBuffer();
    const rovinato = Buffer.concat([b.subarray(0, 40), Buffer.alloc(200, 0x00)]);
    assert.equal(contenitoreDi(rovinato), "jpeg");
  });
});

describe("i brand HEIF", () => {
  /** Costruisce la sola scatola `ftyp` di un file ISO-BMFF. */
  function ftyp(principale, compatibili = []) {
    const marchi = [principale, ...compatibili];
    const corpo = Buffer.concat([
      Buffer.from("ftyp", "latin1"),
      Buffer.from(marchi.join(""), "latin1"),
    ]);
    const testa = Buffer.alloc(4);
    testa.writeUInt32BE(corpo.length + 4);
    return Buffer.concat([testa, corpo, Buffer.alloc(64)]);
  }

  it("`heic` è HEIC, `avif` è AVIF", () => {
    assert.equal(contenitoreDi(ftyp("heic", ["mif1"])), "heic");
    assert.equal(contenitoreDi(ftyp("avif", ["mif1"])), "avif");
  });

  it("guarda anche i brand compatibili, non solo il primo", () => {
    // le fotocamere che scrivono `mif1` come principale sono il caso comune:
    // vuol dire soltanto «immagine in un contenitore HEIF»
    assert.equal(contenitoreDi(ftyp("mif1", ["heic", "hevc"])), "heic");
    assert.equal(contenitoreDi(ftyp("mif1", ["avif"])), "avif");
  });

  it("`mif1` da solo si tratta come HEIC: è il caso che arriva davvero", () => {
    assert.equal(contenitoreDi(ftyp("mif1")), "heic");
  });

  it("un ISO-BMFF che non è un'immagine non passa", () => {
    // un filmato: stesso contenitore, brand diverso
    assert.equal(contenitoreDi(ftyp("isom", ["mp42", "avc1"])), null);
    assert.equal(contenitoreDi(ftyp("qt  ")), null);
  });
});

describe("le tabelle", () => {
  it("ogni contenitore ha un tipo MIME e un'estensione", () => {
    for (const c of ["jpeg", "png", "heic", "avif"]) {
      assert.ok(TIPI_MIME[c], c);
      assert.ok(ESTENSIONI[c], c);
    }
  });
});
