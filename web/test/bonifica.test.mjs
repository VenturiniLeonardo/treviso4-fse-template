import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import sharp from "sharp";

/**
 * La bonifica dei metadati sugli originali già in archivio.
 *
 * Le prove guardano tre cose, in ordine di gravità:
 *
 *  1. che i metadati **spariscano davvero** — GPS, modello, data, XMP;
 *  2. che l'esame senza `--pulisci` **non scriva niente**. È la modalità
 *     predefinita, e se scrivesse per sbaglio riscriverebbe un archivio intero
 *     di fotografie di ragazzi senza che nessuno l'abbia chiesto;
 *  3. che dopo la bonifica **niente si sia rotto**: stesso nome, stesse misure,
 *     nessun file in più, nessun `.bonifica` rimasto, e il peso della riga
 *     allineato ai byte veri.
 */

let cartella;
let cartellaDati;
let percorso;
let raw;
let bonificaMod;
let chiudiPerTest;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-bonifica-"));
  cartellaDati = join(cartella, "dati");
  mkdirSync(cartellaDati, { recursive: true });
  percorso = join(cartellaDati, "sito.db");
  process.env.SITO_DATI_DIR = cartellaDati;
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  bonificaMod = await import("@/lib/foto/bonifica");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

beforeEach(() => {
  raw.prepare("delete from foto").run();
  raw.prepare("delete from album").run();
  raw.prepare("delete from anni_sociali").run();
  raw.prepare("delete from unita").run();
  for (const v of readdirSync(cartellaDati, { withFileTypes: true })) {
    if (v.isFile() && !v.name.includes(".db")) rmSync(join(cartellaDati, v.name), { force: true });
  }
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  rmSync(cartella, { recursive: true, force: true });
});

/**
 * Una fotografia con dentro tutto quello che un telefono ci mette: modello,
 * marca, software, data e coordinate.
 */
async function conMetadati(larghezza = 1200, altezza = 800) {
  return sharp({
    create: { width: larghezza, height: altezza, channels: 3, background: "#4a7d55" },
  })
    .withExif({
      IFD0: {
        Make: "MarcaSegreta",
        Model: "TelefonoSegreto X9",
        Software: "app-di-prova",
        DateTime: "2026:07:14 11:22:33",
      },
      IFD2: {
        GPSLatitudeRef: "N",
        GPSLatitude: "46/1 12/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "12/1 30/1 0/1",
      },
    })
    .jpeg()
    .toBuffer();
}

/** Un anno sociale e un album, creati una volta sola. Le colonne sono quelle vere. */
function assicuraAlbum() {
  const esiste = raw.prepare("select id from album limit 1").get();
  if (esiste) return esiste;
  raw
    .prepare(
      `insert or ignore into anni_sociali (etichetta, inizio, fine, corrente)
       values ('2026-2027','2026-09-01','2027-08-31',1)`,
    )
    .run();
  const anno = raw.prepare("select id from anni_sociali limit 1").get();
  raw
    .prepare(
      `insert into album (slug, anno_id, titolo, data_testo, sottotitolo, stato)
       values ('a', ?, 'A', 'Luglio 2026', '', 'bozza')`,
    )
    .run(anno.id);
  return raw.prepare("select id from album limit 1").get();
}

/** Un album con una fotografia registrata, e il file in archivio. */
async function unaFoto(nome = "foto-prova-1000-1000.jpg", dati) {
  const album = assicuraAlbum();
  const buf = dati ?? (await conMetadati());
  writeFileSync(join(cartellaDati, nome), buf);
  const m = await sharp(buf).metadata();
  raw
    .prepare(
      `insert into foto (album_id,file,tipo,larghezza,altezza,peso,ordine)
       values (?,?,'image/jpeg',?,?,?,0)`,
    )
    .run(album.id, nome, m.width, m.height, buf.length);
  return { nome, buf };
}

const suDisco = () =>
  readdirSync(cartellaDati, { withFileTypes: true })
    .filter((v) => v.isFile() && !v.name.includes(".db"))
    .map((v) => v.name)
    .sort();

// =========================================================================

describe("l'esame non scrive niente", () => {
  it("trova i file con metadati e li lascia dove sono", async () => {
    const { nome, buf } = await unaFoto();
    const prima = suDisco();

    const e = await bonificaMod.bonifica(); // senza argomenti: solo esame
    assert.equal(e.soloEsame, true);
    assert.equal(e.esaminati, 1);
    assert.equal(e.conMetadati, 1);
    assert.equal(e.riscritti, 0);
    assert.equal(e.file[0].stato, "da-pulire");

    assert.deepEqual(suDisco(), prima, "nessun file in più o in meno");
    assert.deepEqual(
      readFileSync(join(cartellaDati, nome)),
      buf,
      "il file non deve essere stato toccato",
    );
  });

  it("un file già pulito risulta pulito, e non si riscrive", async () => {
    const pulita = await sharp({
      create: { width: 300, height: 200, channels: 3, background: "#333" },
    })
      .jpeg()
      .toBuffer();
    await unaFoto("foto-pulita-1-1.jpg", pulita);

    const e = await bonificaMod.bonifica(true); // anche potendo scrivere
    assert.equal(e.conMetadati, 0);
    assert.equal(e.riscritti, 0);
    assert.equal(e.file[0].stato, "pulito");
  });
});

describe("la pulizia toglie i metadati e non rompe niente", () => {
  it("GPS, modello, marca, software e data spariscono", async () => {
    const { nome, buf } = await unaFoto();
    // il fixture li ha davvero: se no la prova non proverebbe niente
    const testo = buf.toString("latin1");
    for (const s of ["MarcaSegreta", "TelefonoSegreto X9", "app-di-prova", "2026:07:14"]) {
      assert.ok(testo.includes(s), `il fixture deve contenere «${s}»`);
    }

    const e = await bonificaMod.bonifica(true);
    assert.equal(e.riscritti, 1, JSON.stringify(e.file));

    const dopo = readFileSync(join(cartellaDati, nome));
    const testoDopo = dopo.toString("latin1");
    for (const s of ["MarcaSegreta", "TelefonoSegreto X9", "app-di-prova", "2026:07:14"]) {
      assert.equal(testoDopo.includes(s), false, `«${s}» deve essere sparito`);
    }
    const m = await sharp(dopo).metadata();
    assert.equal(m.exif, undefined, "nessun EXIF");
    assert.equal(m.icc, undefined, "nessun profilo colore");
  });

  it("il nome non cambia, quindi il riferimento nel database regge", async () => {
    const { nome } = await unaFoto();
    await bonificaMod.bonifica(true);
    assert.ok(existsSync(join(cartellaDati, nome)), "il file deve avere lo stesso nome");
    assert.equal(
      raw.prepare("select count(*) n from foto where file = ?").get(nome).n,
      1,
      "la riga continua a nominarlo",
    );
  });

  it("le misure restano quelle, e il peso della riga si allinea ai byte veri", async () => {
    const { nome } = await unaFoto();
    const prima = raw.prepare("select larghezza,altezza,peso from foto where file=?").get(nome);

    await bonificaMod.bonifica(true);

    const dopo = raw.prepare("select larghezza,altezza,peso from foto where file=?").get(nome);
    const byteVeri = readFileSync(join(cartellaDati, nome)).length;
    assert.equal(dopo.larghezza, prima.larghezza);
    assert.equal(dopo.altezza, prima.altezza);
    assert.equal(dopo.peso, byteVeri, "il peso deve dire i byte che ci sono adesso");
  });

  it("non lascia nessun file in più, e nessun «.bonifica»", async () => {
    const { nome } = await unaFoto();
    const prima = suDisco();
    await bonificaMod.bonifica(true);
    assert.deepEqual(suDisco(), prima, "stesso insieme di file");
    assert.equal(
      suDisco().some((n) => n.endsWith(".bonifica")),
      false,
    );
    assert.ok(nome);
  });

  it("rieseguirla non fa niente: è idempotente", async () => {
    await unaFoto();
    const primo = await bonificaMod.bonifica(true);
    assert.equal(primo.riscritti, 1);

    const secondo = await bonificaMod.bonifica(true);
    assert.equal(secondo.conMetadati, 0);
    assert.equal(secondo.riscritti, 0);
  });
});

describe("quello che la bonifica non tocca", () => {
  it("le derivate non entrano nell'elenco", async () => {
    const { nome } = await unaFoto();
    // una derivata, che è già pulita per costruzione
    writeFileSync(join(cartellaDati, nome.replace(/\.jpg$/, "-800.webp")), "finta");

    const e = await bonificaMod.bonifica();
    assert.equal(e.esaminati, 1, "solo l'originale");
    assert.equal(e.file[0].file, nome);
  });

  it("un file che il database non nomina non si tocca", async () => {
    await unaFoto();
    const estraneo = join(cartellaDati, "foto-non-indicizzata-1-1.jpg");
    writeFileSync(estraneo, await conMetadati(100, 100));
    const prima = readFileSync(estraneo);

    await bonificaMod.bonifica(true);
    assert.deepEqual(
      readFileSync(estraneo),
      prima,
      "i file non indicizzati sono affare di db:orfani, non di questo comando",
    );
  });

  it("una riga che nomina un file assente dà errore, non un silenzio", async () => {
    await unaFoto("foto-che-sparisce-1-1.jpg");
    rmSync(join(cartellaDati, "foto-che-sparisce-1-1.jpg"));

    const e = await bonificaMod.bonifica(true);
    assert.equal(e.errori, 1);
    assert.equal(e.file[0].stato, "errore");
    assert.ok(e.file[0].motivo, "deve dire perché");
  });

  it("un file che non è un'immagine viene saltato, non riscritto", async () => {
    // registrata come foto ma sul disco c'è altro: succede con un ripristino
    // fatto male, e riscriverlo sarebbe la cosa peggiore
    const album = assicuraAlbum();
    writeFileSync(join(cartellaDati, "foto-finta-1-1.jpg"), "#!/bin/sh\necho ciao\n");
    raw
      .prepare(
        `insert into foto (album_id,file,tipo,larghezza,altezza,peso,ordine)
         values (?,'foto-finta-1-1.jpg','image/jpeg',10,10,20,0)`,
      )
      .run(album.id);

    const e = await bonificaMod.bonifica(true);
    // `sharp` non lo legge nemmeno: esce come errore, e il file resta
    assert.equal(e.riscritti, 0);
    assert.equal(
      readFileSync(join(cartellaDati, "foto-finta-1-1.jpg"), "utf8"),
      "#!/bin/sh\necho ciao\n",
      "non deve essere stato riscritto",
    );
  });
});
