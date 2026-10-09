import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * La copia di sicurezza — dall'audit di produzione.
 *
 * Le prove che contano sono due, e sono quelle che un backup scritto e mai
 * provato non supera:
 *
 *  1. la copia si può **riaprire** e contiene le righe che diceva di contenere.
 *     Un file da 300 kB che esiste non è un backup: lo diventa quando qualcuno
 *     lo apre;
 *  2. i **collegamenti fisici** tengono in vita i byte quando l'originale viene
 *     cancellato. È l'unica ragione per cui si può fare una copia
 *     dell'archivio ogni notte senza moltiplicare i gigabyte, e se un giorno
 *     smettesse di essere vero il backup delle fotografie diventerebbe un
 *     elenco di nomi.
 */

let cartella;
let cartellaDati;
let cartellaCopieProva;
let percorso;
let raw;
let copiaMod;
let chiudiPerTest;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-copia-"));
  cartellaDati = join(cartella, "dati");
  cartellaCopieProva = join(cartella, "copie");
  mkdirSync(cartellaDati, { recursive: true });

  percorso = join(cartellaDati, "sito.db");
  process.env.SITO_DATI_DIR = cartellaDati;
  process.env.SITO_DB = percorso;
  process.env.SITO_COPIE_DIR = cartellaCopieProva;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  copiaMod = await import("@/lib/db/copia");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

beforeEach(() => {
  rmSync(cartellaCopieProva, { recursive: true, force: true });
  for (const v of readdirSync(cartellaDati, { withFileTypes: true })) {
    if (v.isFile() && !v.name.includes(".db")) rmSync(join(cartellaDati, v.name), { force: true });
  }
  raw.prepare("delete from unita").run();
  ordine = 0;
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  delete process.env.SITO_COPIE_DIR;
  rmSync(cartella, { recursive: true, force: true });
});

let ordine = 0;

/** Una riga riconoscibile, per verificare che la copia sia quella giusta. */
function unaUnita(chiave = "u1") {
  // `unita.ordine` è unico nello schema: il contatore serve a quello
  raw
    .prepare(
      `insert into unita (chiave, slug, nome, fascia, eta, logo, email, telefono, ordine)
       values (?, ?, ?, 'gialla', '8-11', 'l.png', 'a@b.it', '', ?)`,
    )
    .run(chiave, chiave, `Unità ${chiave}`, ++ordine);
}

/** Un file finto in archivio. */
function unFile(nome, contenuto = "byte") {
  writeFileSync(join(cartellaDati, nome), contenuto);
}

// =========================================================================

describe("la copia si può riaprire, ed è quella giusta", () => {
  it("contiene le righe che il manifesto dichiara", () => {
    unaUnita("u1");
    unaUnita("u2");

    const e = copiaMod.copia(7);
    assert.equal(e.integrita, "ok");
    assert.equal(e.righe.unita, 2);

    // la prova vera: si riapre il file copiato
    const dentro = new Database(join(e.cartella, "sito.db"), { readonly: true });
    try {
      assert.equal(dentro.prepare("select count(*) n from unita").get().n, 2);
      assert.equal(dentro.prepare("select nome from unita where chiave='u1'").get().nome, "Unità u1");
    } finally {
      dentro.close();
    }

    const m = copiaMod.leggiManifesto(e.cartella);
    assert.equal(m.righe.unita, 2, "il manifesto deve dire la verità");
    assert.equal(m.integrita, "ok");
  });

  it("la copia è indipendente: cambiare l'originale non la tocca", () => {
    unaUnita("u1");
    const e = copiaMod.copia(7);

    raw.prepare("delete from unita").run();
    assert.equal(raw.prepare("select count(*) n from unita").get().n, 0);

    const dentro = new Database(join(e.cartella, "sito.db"), { readonly: true });
    try {
      assert.equal(dentro.prepare("select count(*) n from unita").get().n, 1, "nella copia resta");
    } finally {
      dentro.close();
    }
  });

  it("non lascia cartelle «.parziale» in giro", () => {
    copiaMod.copia(7);
    const residui = readdirSync(cartellaCopieProva).filter((n) => n.endsWith(".parziale"));
    assert.deepEqual(residui, []);
  });
});

describe("l'archivio, e i collegamenti fisici", () => {
  it("i file entrano nella copia", () => {
    unFile("foto-a-1.jpg", "aaa");
    unFile("doc-b-2.pdf", "bbb");

    const e = copiaMod.copia(7);
    assert.equal(e.file, 2);
    assert.equal(readdirSync(join(e.cartella, "archivio")).sort().join(","), "doc-b-2.pdf,foto-a-1.jpg");
  });

  it("i byte sopravvivono alla cancellazione dell'originale", () => {
    unFile("foto-importante-1.jpg", "la fotografia del campo");
    const e = copiaMod.copia(7);
    assert.equal(e.collegamenti, true, "su un solo filesystem devono essere collegamenti");

    // il disastro: qualcuno cancella la fotografia
    rmSync(join(cartellaDati, "foto-importante-1.jpg"));
    assert.equal(existsSync(join(cartellaDati, "foto-importante-1.jpg")), false);

    // e i byte sono ancora là, perché il collegamento li tiene in vita
    const dentro = join(e.cartella, "archivio", "foto-importante-1.jpg");
    assert.equal(readFileSync(dentro, "utf8"), "la fotografia del campo");
  });

  it("i collegamenti non moltiplicano lo spazio", () => {
    unFile("foto-grossa-1.jpg", "x".repeat(200_000));
    const e = copiaMod.copia(7);
    // stesso inode: lo si vede dal numero di collegamenti sul file originale
    const s = statSync(join(cartellaDati, "foto-grossa-1.jpg"));
    assert.ok(s.nlink >= 2, `il file deve avere almeno due collegamenti, ne ha ${s.nlink}`);
    assert.equal(e.byteFile, 200_000);
  });

  it("il database e i suoi file di appoggio non finiscono nell'archivio", () => {
    unFile("foto-a-1.jpg", "aaa");
    const e = copiaMod.copia(7);
    const dentro = readdirSync(join(e.cartella, "archivio"));
    assert.equal(dentro.some((n) => n.includes(".db")), false, dentro.join(","));
  });

  it("le scritture a metà («.nuovo») restano fuori", () => {
    unFile("foto-a-1.jpg", "aaa");
    unFile("gruppo.json.nuovo", "{ a metà");
    const e = copiaMod.copia(7);
    assert.equal(e.file, 1);
    assert.equal(readdirSync(join(e.cartella, "archivio")).includes("gruppo.json.nuovo"), false);
  });
});

describe("la conservazione", () => {
  /** Copie con date crescenti, per non dipendere dall'orologio. */
  function tre() {
    const fatte = [];
    for (let g = 1; g <= 3; g++) {
      fatte.push(copiaMod.copia(99, new Date(Date.UTC(2026, 0, g, 2, 10, 0))).cartella);
    }
    return fatte;
  }

  it("tiene le più recenti e toglie le altre", () => {
    tre();
    assert.equal(copiaMod.elencoCopie().length, 3);

    const scadute = copiaMod.potaCopie(2);
    assert.equal(scadute.length, 1);
    const restano = copiaMod.elencoCopie().map((c) => c.nome);
    assert.equal(restano.length, 2);
    // la più vecchia è quella andata via
    assert.equal(restano.includes("copia-20260101-021000"), false);
  });

  it("l'elenco è dalla più recente alla più vecchia", () => {
    tre();
    const nomi = copiaMod.elencoCopie().map((c) => c.nome);
    assert.deepEqual(nomi, [...nomi].sort().reverse());
  });

  it("una copia incoerente non conta come copia da tenere", () => {
    /*
     * Sette copie rotte non devono poter far buttare l'ottava buona: se si
     * contassero tutte, la conservazione a 7 terrebbe le sette inutili e
     * cancellerebbe la sola che serve.
     */
    const buona = copiaMod.copia(99, new Date(Date.UTC(2026, 0, 1, 2, 0, 0))).cartella;
    for (let g = 2; g <= 4; g++) {
      const c = copiaMod.copia(99, new Date(Date.UTC(2026, 0, g, 2, 0, 0))).cartella;
      const m = copiaMod.leggiManifesto(c);
      m.integrita = "malformed database";
      writeFileSync(join(c, "manifesto.json"), JSON.stringify(m));
    }

    copiaMod.potaCopie(1);
    const restano = copiaMod.elencoCopie().map((c) => c.cartella);
    assert.ok(restano.includes(buona), "la sola copia sana deve restare");
  });

  it("«tieni 0» non cancella la copia appena fatta", () => {
    // è il caso del ripristino, che mette da parte lo stato attuale con 0:
    // cancellarlo subito vorrebbe dire ripristinare senza via di ritorno
    const e = copiaMod.copia(0);
    assert.ok(existsSync(e.cartella), "la copia appena fatta deve restare");
  });
});

describe("i nomi delle copie", () => {
  it("sono ordinabili come stringhe", () => {
    const a = copiaMod.nomeCopia(new Date(Date.UTC(2026, 0, 9, 2, 10, 0)));
    const b = copiaMod.nomeCopia(new Date(Date.UTC(2026, 0, 10, 2, 10, 0)));
    assert.ok(a < b, `${a} deve venire prima di ${b}`);
  });

  it("si riconoscono, e non si confondono con altre cartelle", () => {
    assert.equal(copiaMod.eCopia("copia-20260101-021000"), true);
    assert.equal(copiaMod.eCopia("copia-20260101-021000.parziale"), false);
    assert.equal(copiaMod.eCopia("copie-vecchie"), false);
    assert.equal(copiaMod.eCopia("archivio"), false);
  });
});

describe("quando il database di partenza è rotto", () => {
  /*
   * Il caso trovato provando davvero: si corrompe il file e si chiede una
   * copia.
   *
   * Due proprietà, e la seconda è quella che si scopre tardi. La prima è che
   * non deve nascere niente che somigli a una copia buona — se nascesse, il
   * ripristino sceglierebbe quella e il backup sarebbe peggio che assente. La
   * seconda è che non deve restare la cartella `.parziale`: il lavoro gira da
   * un timer ogni notte, e un database corrotto non si aggiusta da solo — una
   * cartella a metà per notte riempie il disco della macchina che sta già
   * avendo un problema.
   */
  it("non lascia né una copia buona né una cartella a metà", () => {
    // un database vero, e poi rovinato dentro
    const rotto = join(cartella, "rotto");
    mkdirSync(rotto, { recursive: true });
    const suo = join(rotto, "sito.db");
    const d = new Database(suo);
    migrate(drizzle(d), { migrationsFolder: "./drizzle" });
    d.close();

    const f = readFileSync(suo);
    f.fill(0, 4096, Math.min(12288, f.length));
    writeFileSync(suo, f);

    const copieRotte = join(rotto, "copie");
    const dbPrima = process.env.SITO_DB;
    const copiePrima = process.env.SITO_COPIE_DIR;
    process.env.SITO_DB = suo;
    process.env.SITO_COPIE_DIR = copieRotte;
    try {
      assert.throws(
        () => copiaMod.copia(7),
        /malformed|corrupt/i,
        "un database illeggibile deve fermare la copia, non produrne una",
      );
      const rimasto = existsSync(copieRotte) ? readdirSync(copieRotte) : [];
      assert.deepEqual(rimasto, [], `in archivio è rimasto: ${rimasto.join(", ")}`);
    } finally {
      process.env.SITO_DB = dbPrima;
      if (copiePrima === undefined) delete process.env.SITO_COPIE_DIR;
      else process.env.SITO_COPIE_DIR = copiePrima;
    }
  });
});
