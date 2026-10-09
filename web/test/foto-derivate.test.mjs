import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  eDerivata,
  ErroreDerivate,
  generaDerivate,
  LATI,
  misureVere,
  nomeDerivata,
  ripulisciOriginale,
} from "@/lib/foto/derivate";

/**
 * Le derivate — §8 del piano.
 *
 * La prova che conta è quella dei metadati, ed è costruita al contrario di come
 * verrebbe naturale: si fabbrica una fotografia **con** dentro un modello di
 * telefono e delle coordinate GPS, e si verifica che nella derivata non ci
 * siano più. Provare che una foto senza EXIF resta senza EXIF non dimostrerebbe
 * niente.
 */

/** Una fotografia finta con dentro i metadati che un telefono ci mette davvero. */
function conMetadati(larghezza = 1200, altezza = 800) {
  return sharp({
    create: { width: larghezza, height: altezza, channels: 3, background: "#4a7d55" },
  })
    .withExif({
      IFD0: { Model: "iPhone di prova", Make: "Apple" },
      IFD2: {
        GPSLatitudeRef: "N",
        GPSLatitude: "45/1 40/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "12/1 15/1 0/1",
      },
    })
    .jpeg()
    .toBuffer();
}

describe("i metadati spariscono", () => {
  it("l'originale ce li ha — se no la prova non proverebbe niente", async () => {
    const meta = await sharp(await conMetadati()).metadata();
    assert.ok(meta.exif, "l'immagine di prova deve avere EXIF");
    assert.ok(meta.exif.length > 100, "e deve contenere qualcosa");
  });

  it("nessuna delle tre derivate li porta", async () => {
    const { derivate } = await generaDerivate(await conMetadati(), "foto-prova-1-1.jpg");
    assert.equal(derivate.length, 3);

    for (const d of derivate) {
      const meta = await sharp(d.dati).metadata();
      assert.equal(meta.format, "webp", `${d.lato}: deve essere WebP`);
      assert.equal(meta.exif, undefined, `${d.lato}: niente EXIF`);
      assert.equal(meta.icc, undefined, `${d.lato}: niente profilo colore`);
      assert.equal(meta.xmp, undefined, `${d.lato}: niente XMP`);
    }
  });

  it("e nei byte non resta traccia del modello del telefono", async () => {
    // la prova grossolana, quella che non dipende da come `sharp` legge i
    // metadati: la stringa non c'è proprio dentro il file
    const originale = await conMetadati();
    assert.ok(originale.includes(Buffer.from("iPhone di prova")), "c'è nell'originale");

    const { derivate } = await generaDerivate(originale, "foto-prova-1-1.jpg");
    for (const d of derivate) {
      assert.equal(d.dati.includes(Buffer.from("iPhone di prova")), false, `${d.lato}`);
      assert.equal(d.dati.includes(Buffer.from("45/1 40/1")), false, `${d.lato}: GPS`);
    }
  });
});

describe("l'originale ripulito", () => {
  /*
   * `ripulisciOriginale` è nata dall'audit di produzione: l'originale a piena
   * misura resta sul disco e `/foto-file/[file]` lo serve come ripiego quando
   * una derivata manca. Finché non veniva ricodificato, in quella finestra
   * uscivano il modello dell'apparecchio e le coordinate del campo.
   *
   * Il contenitore restituito conta quanto i byte: `aggiungiFoto` ci costruisce
   * estensione e tipo MIME della riga, e sbagliarlo vorrebbe dire un
   * `Content-Type` che non corrisponde al file — cioè un'immagine che il
   * browser non apre.
   */
  it("toglie i metadati senza ridimensionare", async () => {
    const dentro = await conMetadati(1200, 800);
    assert.ok((await sharp(dentro).metadata()).exif, "il fixture deve averli");

    const { dati } = await ripulisciOriginale(dentro, "jpeg");
    const meta = await sharp(dati).metadata();

    assert.equal(meta.exif, undefined, "l'EXIF deve essere sparito");
    assert.equal(dati.includes(Buffer.from("iPhone di prova")), false, "nemmeno nei byte");
    // niente ridimensionamento: è un originale, non una derivata
    assert.equal(meta.width, 1200);
    assert.equal(meta.height, 800);
  });

  it("un PNG resta un PNG", async () => {
    const png = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer();
    const esito = await ripulisciOriginale(png, "png");
    assert.equal(esito.contenitore, "png");
    assert.equal((await sharp(esito.dati).metadata()).format, "png");
  });

  it("i formati che i browser non aprono diventano JPEG, e lo dichiarano", async () => {
    const jpeg = await conMetadati(300, 200);
    for (const dentro of ["heic", "avif"]) {
      // il buffer è un JPEG: qui si verifica la scelta del contenitore
      // d'uscita, che è ciò da cui dipendono estensione e tipo MIME
      const esito = await ripulisciOriginale(jpeg, dentro);
      assert.equal(esito.contenitore, "jpeg", dentro);
      assert.equal((await sharp(esito.dati).metadata()).format, "jpeg", dentro);
    }
  });

  it("applica l'orientamento ai pixel invece di lasciarlo in un'etichetta", async () => {
    // stesso fixture di «l'orientamento» più sotto: `withMetadata({orientation})`
    // e non `withExif`, che scrive l'etichetta senza che `rotate()` la veda
    const piatta = await sharp({
      create: { width: 900, height: 600, channels: 3, background: "#777" },
    })
      .jpeg()
      .toBuffer();
    const girata = await sharp(piatta).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    assert.equal((await sharp(girata).metadata()).orientation, 6, "il fixture deve essere girato");

    const { dati } = await ripulisciOriginale(girata, "jpeg");
    const meta = await sharp(dati).metadata();
    // orientamento 6 = ruotata di 90°: i lati devono risultare scambiati
    assert.equal(meta.width, 600);
    assert.equal(meta.height, 900);
    assert.equal(meta.orientation, undefined, "l'etichetta non deve restare");
  });
});

describe("le tre misure", () => {
  it("sono 1600, 800 e 400, e nessuna supera il proprio lato", async () => {
    assert.deepEqual([...LATI], [1600, 800, 400]);

    const { derivate } = await generaDerivate(await conMetadati(3000, 2000), "f.jpg");
    for (const d of derivate) {
      assert.ok(d.larghezza <= d.lato && d.altezza <= d.lato, `${d.lato}`);
      // il lato lungo tocca il limite: `fit: inside` non lascia margine
      assert.equal(Math.max(d.larghezza, d.altezza), d.lato);
    }
  });

  it("una fotografia piccola non viene ingrandita", async () => {
    const { derivate } = await generaDerivate(await conMetadati(300, 200), "f.jpg");
    const grande = derivate.find((d) => d.lato === 1600);
    assert.equal(grande.larghezza, 300, "resta 300, non diventa 1600");
    assert.equal(grande.altezza, 200);
  });

  it("le proporzioni non cambiano", async () => {
    const { derivate } = await generaDerivate(await conMetadati(1600, 900), "f.jpg");
    for (const d of derivate) {
      assert.ok(Math.abs(d.larghezza / d.altezza - 16 / 9) < 0.02, `${d.lato}`);
    }
  });
});

describe("l'orientamento", () => {
  /** Una fotografia i cui pixel sono orizzontali ma che va mostrata verticale. */
  async function diTraverso() {
    const piatta = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#4a7d55" },
    })
      .jpeg()
      .toBuffer();
    // 6 = «ruota di 90° in senso orario»: è quello che scrive un telefono
    // tenuto in verticale
    return sharp(piatta).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  }

  it("le misure vere sono quelle dopo la rotazione, non quelle dei pixel", async () => {
    const b = await diTraverso();
    assert.equal((await sharp(b).metadata()).width, 1200, "sul disco è larga 1200");

    const misure = await misureVere(b);
    assert.equal(misure.larghezza, 800, "ma la fotografia è verticale");
    assert.equal(misure.altezza, 1200);
  });

  it("le derivate escono già girate, e senza l'etichetta che le girava", async () => {
    const { larghezza, altezza, derivate } = await generaDerivate(await diTraverso(), "f.jpg");
    assert.equal(larghezza, 800);
    assert.equal(altezza, 1200);

    for (const d of derivate) {
      assert.ok(d.altezza > d.larghezza, `${d.lato}: deve restare verticale`);
      const meta = await sharp(d.dati).metadata();
      // se l'etichetta restasse, il browser girerebbe una seconda volta
      assert.ok(!meta.orientation || meta.orientation === 1, `${d.lato}: orientamento azzerato`);
    }
  });
});

describe("i nomi", () => {
  it("la derivata prende il nome dell'originale più il lato", () => {
    assert.equal(nomeDerivata("foto-uscita-1730-42.jpg", 800), "foto-uscita-1730-42-800.webp");
    assert.equal(nomeDerivata("foto-x-1-1.png", 1600), "foto-x-1-1-1600.webp");
    // senza estensione, non si perde niente
    assert.equal(nomeDerivata("senzapunto", 400), "senzapunto-400.webp");
  });

  it("si riconosce una derivata da un originale", () => {
    assert.equal(eDerivata("foto-x-1-1-800.webp"), true);
    assert.equal(eDerivata("foto-x-1-1.jpg"), false);
    // un lato che non esiste non è una derivata nostra
    assert.equal(eDerivata("foto-x-1-1-999.webp"), false);
  });
});

describe("quello che non si converte", () => {
  it("un file che non è un'immagine solleva un errore leggibile", async () => {
    await assert.rejects(
      () => generaDerivate(Buffer.from("non sono un'immagine"), "x.jpg"),
      (e) => e instanceof ErroreDerivate && /JPEG, PNG o HEIC/.test(e.message),
    );
  });

  it("un JPEG troncato solleva, e non passa per buono", async () => {
    const buono = await conMetadati();
    const troncato = buono.subarray(0, 80);
    await assert.rejects(() => misureVere(troncato), ErroreDerivate);
  });

  it("un HEIC dice che cosa fare, non «file non valido»", async () => {
    /*
     * Il `sharp` distribuito porta un libvips che apre i file HEIF codificati
     * in AV1 (AVIF) ma non quelli codificati in HEVC — cioè quelli degli
     * iPhone. Qui si costruisce la sola intestazione con il brand `heic`: basta
     * a far riconoscere il contenitore, e la decodifica fallisce come
     * fallirebbe su un file vero.
     */
    const testa = Buffer.alloc(4);
    const corpo = Buffer.concat([
      Buffer.from("ftyp", "latin1"),
      Buffer.from("heicmif1", "latin1"),
    ]);
    testa.writeUInt32BE(corpo.length + 4);
    const finto = Buffer.concat([testa, corpo, Buffer.alloc(256)]);

    await assert.rejects(
      () => generaDerivate(finto, "x.heic"),
      (e) => e instanceof ErroreDerivate && /HEIC/.test(e.message) && /compatibilità/.test(e.message),
    );
  });
});
