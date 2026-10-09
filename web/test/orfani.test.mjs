import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import sharp from "sharp";

/**
 * File orfani e righe senza file.
 *
 * Le prove che contano sono quelle sui **freni**. Questo è il solo modulo del
 * progetto la cui conseguenza, se sbaglia, è irreparabile: propone di
 * disfarsi di fotografie. Le prove qui verificano soprattutto quando **non**
 * deve proporre niente.
 */

let cartella;
let cartellaDati;
let raw;
let orfani, album, coda, riferimenti;
let chiudiPerTest;

const VECCHIO = new Date("2024-01-01T00:00:00Z");

/** Un file in archivio, con una data a scelta. */
function file(nome, byte = 100, quando = VECCHIO) {
  const p = join(cartellaDati, nome);
  writeFileSync(p, Buffer.alloc(byte, 7));
  utimesSync(p, quando, quando);
  return nome;
}

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-orfani-"));
  cartellaDati = join(cartella, "dati");
  mkdirSync(cartellaDati, { recursive: true });
  process.env.SITO_DB = join(cartella, "prova.db");
  process.env.SITO_DATI_DIR = cartellaDati;

  const iniziale = new Database(process.env.SITO_DB);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  orfani = await import("@/lib/archivio-orfani");
  album = await import("@/lib/album");
  coda = await import("@/lib/foto/coda");
  riferimenti = await import("@/lib/db/riferimenti");
  ({ chiudiPerTest } = await import("@/lib/db/db"));

  raw = new Database(process.env.SITO_DB);
  riferimenti.assicuraRiferimenti();
});

beforeEach(async () => {
  await coda.attendiCoda();
  for (const t of ["foto", "album", "documenti", "documenti_referenti", "cartelle_referenti", "pagine_testi", "immagini"]) {
    raw.prepare(`delete from ${t}`).run();
  }
  // Le copertine stanno in colonne di `unita`, che non si cancella: le sei
  // righe sono l'anagrafica. Si azzerano le quattro colonne insieme, come vuole
  // il `CHECK` `unita_copertina_completa`.
  raw
    .prepare(
      `update unita set copertina = NULL, copertina_tipo = NULL,
       copertina_larghezza = NULL, copertina_altezza = NULL`,
    )
    .run();
  const { readdirSync } = await import("node:fs");
  for (const e of readdirSync(cartellaDati, { withFileTypes: true })) {
    if (e.isFile()) unlinkSync(join(cartellaDati, e.name));
  }
});

after(async () => {
  await coda.attendiCoda();
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  rmSync(cartella, { recursive: true, force: true });
});

/** Un album con `quante` fotografie vere, derivate comprese. */
async function conFoto(quante) {
  const img = await sharp({
    create: { width: 60, height: 40, channels: 3, background: "#4a7" },
  })
    .jpeg()
    .toBuffer();
  const slug = await album.creaAlbum(
    { titolo: `Album ${Math.random()}`, anno: "2026 – 2027", unita: "u1", data: "Ottobre 2026", sottotitolo: "", tag: "" },
    1,
    "ref1",
  );
  const nomi = [];
  for (let i = 0; i < quante; i++) {
    const e = await album.aggiungiFoto(slug, img, "", Date.now() + i, "ref1");
    nomi.push(e.foto.file);
  }
  await coda.attendiCoda();
  return { slug, nomi };
}

// =========================================================================

describe("i freni", () => {
  it("archivio pieno e database che non ne sa niente: è un sospetto, non un elenco", () => {
    file("foto-a-1-1.jpg");
    file("foto-b-1-1.jpg");
    file("doc-c-1.pdf");

    const e = orfani.confronta();
    assert.ok(e.sospetto, "deve insospettirsi");
    assert.match(e.sospetto, /database sbagliato|non ne indicizza nessuno/);
    /*
     * Il punto: da fuori «tre orfani» e «sto guardando il database sbagliato»
     * sono indistinguibili, e portano a decisioni opposte. Lo script si ferma
     * su `sospetto` e non guarda nemmeno l'elenco.
     */
  });

  it("archivio vuoto non è un sospetto: è un archivio vuoto", () => {
    assert.equal(orfani.confronta().sospetto, undefined);
    assert.deepEqual(orfani.confronta().orfani, []);
  });

  it("più di metà dei file orfani è troppo per un archivio sano", async () => {
    await conFoto(1); // 1 originale + 3 derivate = 4 attesi
    for (let i = 0; i < 6; i++) file(`foto-intruso-${i}-1.jpg`);

    const e = orfani.confronta();
    assert.ok(e.sospetto, `nessun sospetto con ${e.orfani.length}/${e.esaminati}`);
    assert.match(e.sospetto, /troppo per un archivio sano/);
  });

  it("senza database non dice che tutto è orfano: dice che non può dirlo", () => {
    chiudiPerTest();
    const vero = process.env.SITO_DB;
    process.env.SITO_DB = join(cartella, "non-esiste.db");
    try {
      const e = orfani.confronta();
      assert.deepEqual(e.orfani, [], "non propone niente");
      assert.ok(e.sospetto);
    } finally {
      process.env.SITO_DB = vero;
      chiudiPerTest();
    }
  });

  it("il periodo di grazia protegge quello che è stato appena scritto", async () => {
    await conFoto(1);
    file("foto-appena-1-1.jpg", 100, new Date());
    file("foto-antico-1-1.jpg", 100, VECCHIO);

    const nomi = orfani.confronta(7).orfani.map((o) => o.nome);
    assert.deepEqual(nomi, ["foto-antico-1-1.jpg"], "quello di oggi non c'è");

    // con grazia zero compaiono entrambi
    assert.equal(orfani.confronta(0).orfani.length, 2);
  });
});

describe("che cosa NON è un orfano", () => {
  it("le derivate: non stanno in nessuna colonna, si ricavano", async () => {
    const { nomi } = await conFoto(2);
    const e = orfani.confronta(0);

    assert.deepEqual(e.orfani, [], "otto file, nessuno orfano");
    // 2 originali + 6 derivate
    assert.equal(e.attesi, 8);
    assert.equal(e.esaminati, 8);
    /*
     * È il caso in cui uno sbaglio costerebbe caro: dimenticare le derivate
     * qui vorrebbe dire proporre di buttare le tre versioni ridotte di ogni
     * fotografia del sito — cioè tutto quello che le pagine servono davvero.
     */
    for (const n of nomi) {
      assert.ok(e.attesi > 0, n);
    }
  });

  it("il database, il WAL e i file che non riconosciamo", async () => {
    await conFoto(1);
    file("sito.db-wal");
    file("tabelle.json");
    file("appunti-del-referente.txt");
    file("IMG_4021.HEIC");

    assert.deepEqual(orfani.confronta(0).orfani, [], "nessuno di quelli si tocca");
  });

  it("il marchio, che sta in `pagine_testi` e non in una colonna `file`", async () => {
    await conFoto(1);
    const nome = file("marchio-123.png");
    raw
      .prepare("insert into pagine_testi (chiave, valore) values (?, ?)")
      .run("gruppo.marchioFile", nome);

    assert.deepEqual(orfani.confronta(0).orfani, [], "il marchio è indicizzato");

    // e se la chiave cambia, quello vecchio diventa orfano
    raw.prepare("update pagine_testi set valore = 'marchio-999.png'").run();
    assert.deepEqual(
      orfani.confronta(0).orfani.map((o) => o.nome),
      [nome],
    );
  });

  it("la copertina di un'unità, con le sue tre derivate", async () => {
    /*
     * È la prova che accompagna l'aggiunta di `copertina-` a `PREFISSI`.
     *
     * Aggiungere un prefisso all'elenco dei file riconosciuti **senza**
     * aggiungere i suoi nomi a `nomiAttesi` trasforma ogni copertina in un
     * orfano da buttare: il primo elenco dice «questo file lo conosco», il
     * secondo «mi serve», e un file nel primo e non nel secondo è per
     * definizione da cancellare. Le due modifiche sono state fatte insieme, e
     * questa riga è ciò che impedisce che si separino.
     */
    await conFoto(1);
    const originale = file("copertina-u1-123.jpg");
    const derivate = [400, 800, 1600].map((l) =>
      file(`copertina-u1-123-${l}.webp`),
    );
    raw
      .prepare(
        `update unita set copertina = ?, copertina_tipo = 'image/jpeg',
         copertina_larghezza = 2400, copertina_altezza = 1200
         where chiave = 'u1'`,
      )
      .run(originale);

    assert.deepEqual(
      orfani.confronta(0).orfani,
      [],
      "né l'originale né le tre derivate sono orfani",
    );

    /*
     * E quando la copertina si sostituisce, i quattro file vecchi lo diventano.
     *
     * `where chiave` non è pignoleria: la prima stesura di questa riga era un
     * `UPDATE` senza `WHERE`, e il `CHECK` `unita_copertina_completa` l'ha
     * rifiutato subito — avrebbe messo il nome del file su tutte e sei le unità
     * lasciando nulle le altre tre colonne. È il vincolo che fa il suo lavoro
     * su chi scrive il test prima che su chi scrive l'applicazione.
     */
    raw
      .prepare("update unita set copertina = 'copertina-u1-999.jpg' where chiave = 'u1'")
      .run();
    assert.deepEqual(
      orfani.confronta(0).orfani.map((o) => o.nome).sort(),
      [originale, ...derivate].sort(),
    );
  });

  it("un documento con la sua riga", async () => {
    await conFoto(1);
    const nome = file("doc-modulo-1.pdf");
    raw
      .prepare(
        "insert into documenti (chiave, anno_id, titolo, categoria, file) values ('x',1,'T','iscrizioni',?)",
      )
      .run(nome);
    assert.deepEqual(orfani.confronta(0).orfani, []);
  });
});

describe("le immagini dei posti fissi del disegno", () => {
  /*
   * La regola scritta in cima a `lib/archivio-orfani.ts`: un prefisso nuovo va
   * aggiunto a `PREFISSI` **e** a `nomiAttesi` nella stessa modifica, o i suoi
   * file diventano tutti orfani da cancellare.
   *
   * `immagine-` è entrato con i diciotto posti fotografici. Senza il ciclo in
   * `nomiAttesi`, la prima esecuzione avrebbe proposto di cancellare le
   * fotografie della home, quelle d'archivio delle unità e tutti i ritratti —
   * con le loro derivate, settantadue file a posti tutti pieni.
   */
  async function conImmagine(chiave = "home.fascia-gialla") {
    const { registraImmagine } = await import("@/lib/immagini-store");
    const { generaDerivate } = await import("@/lib/foto/derivate");
    const { scriviCaricato } = await import("@/lib/archivio");
    const buf = await sharp({
      create: { width: 80, height: 50, channels: 3, background: "#357" },
    })
      .jpeg()
      .toBuffer();
    const nome = `immagine-${chiave.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}.jpg`;
    const e = await generaDerivate(buf, nome);
    await scriviCaricato(nome, buf);
    for (const d of e.derivate) await scriviCaricato(d.nome, d.dati);
    await registraImmagine(chiave, nome, "image/jpeg", { larghezza: e.larghezza, altezza: e.altezza }, "", "");
    return nome;
  }

  it("un'immagine registrata non è orfana, e nemmeno le sue derivate", async () => {
    const nome = await conImmagine();
    const e = orfani.confronta(0);
    assert.deepEqual(
      e.orfani.map((o) => o.nome),
      [],
      "né l'originale né le tre derivate devono comparire fra gli orfani",
    );
    assert.ok(e.attesi >= 4, `l'originale e le tre derivate devono essere attesi (attesi: ${e.attesi})`);
    assert.ok(nome);
  });

  it("tolta la riga, i suoi file diventano orfani", async () => {
    // la controprova: se non lo fossero, questa prova non proverebbe che
    // `nomiAttesi` guarda davvero la tabella
    const nome = await conImmagine("chi-siamo.gruppo");
    const { togliImmagine } = await import("@/lib/immagini-store");
    await togliImmagine("chi-siamo.gruppo");

    const e = orfani.confronta(0);
    assert.ok(
      e.orfani.some((o) => o.nome === nome),
      `l'originale ${nome} deve risultare orfano dopo che la riga non c'è più`,
    );
  });

  it("una riga il cui file non c'è si segnala", async () => {
    const nome = await conImmagine("home.fascia-rossa");
    unlinkSync(join(cartellaDati, nome));

    const e = orfani.confronta(0);
    const righe = e.righeSenzaFile.filter((r) => r.genere === "immagine");
    assert.equal(righe.length, 1);
    assert.equal(righe[0].file, nome);
    assert.match(righe[0].dove, /home\.fascia-rossa/);
  });
});

describe("i documenti per i referenti", () => {
  /*
   * `referenti-` è entrato con la migrazione 0013, in `PREFISSI` e in `nomiAttesi`
   * nella stessa modifica: senza il secondo, la prima esecuzione avrebbe
   * proposto di cancellare ogni verbale caricato.
   */
  function conDocumentoReferenti() {
    const nome = file("referenti-1791000000000-0a1b2c3d.pdf");
    const { lastInsertRowid } = raw
      .prepare("insert into cartelle_referenti (titolo, ordine) values ('Verbali', 1)")
      .run();
    const { lastInsertRowid: id } = raw
      .prepare(
        "insert into documenti_referenti (cartella_id, titolo, formato, byte, file) values (?, 'Verbale', 'PDF', 100, ?)",
      )
      .run(lastInsertRowid, nome);
    return { nome, id };
  }

  it("un documento per i referenti con la sua riga non è orfano", () => {
    conDocumentoReferenti();
    const e = orfani.confronta(0);
    assert.deepEqual(e.orfani, []);
    assert.equal(e.attesi, 1);
  });

  it("tolta la riga, il suo file diventa orfano", () => {
    // la controprova: il prefisso è riconosciuto, e `nomiAttesi` guarda davvero la tabella
    const { nome, id } = conDocumentoReferenti();
    file("doc-modulo-1.pdf");
    raw
      .prepare(
        "insert into documenti (chiave, anno_id, titolo, categoria, file) values ('x',1,'T','iscrizioni','doc-modulo-1.pdf')",
      )
      .run();
    raw.prepare("delete from documenti_referenti where id = ?").run(id);
    assert.deepEqual(
      orfani.confronta(0).orfani.map((o) => o.nome),
      [nome],
    );
  });

  it("una riga il cui file non c'è si segnala", () => {
    const { nome, id } = conDocumentoReferenti();
    unlinkSync(join(cartellaDati, nome));
    const righe = orfani.confronta(0).righeSenzaFile;
    assert.deepEqual(righe, [
      { genere: "documento per i referenti", dove: `documento per i referenti #${id}`, file: nome },
    ]);
  });
});

describe("le righe senza file", () => {
  it("una copertina registrata il cui originale non c'è", async () => {
    // Il guasto più visibile dell'elenco: l'immagine in cima alla pagina di
    // un'unità. Si segnala solo se manca l'originale — con le derivate la
    // pagina si vede comunque, e nominarla sarebbe un allarme per niente.
    await conFoto(1);
    raw
      .prepare(
        `update unita set copertina = 'copertina-u4-777.jpg',
         copertina_tipo = 'image/jpeg', copertina_larghezza = 2400,
         copertina_altezza = 1200 where chiave = 'u4'`,
      )
      .run();

    const e = orfani.confronta(0);
    assert.deepEqual(
      e.righeSenzaFile.filter((r) => r.genere === "copertina").map((r) => r.file),
      ["copertina-u4-777.jpg"],
    );
  });

  it("una fotografia la cui riga c'è e il file no", async () => {
    const { nomi } = await conFoto(1);
    unlinkSync(join(cartellaDati, nomi[0]));

    const e = orfani.confronta(0);
    assert.equal(e.righeSenzaFile.length, 1);
    assert.equal(e.righeSenzaFile[0].genere, "foto");
    assert.equal(e.righeSenzaFile[0].file, nomi[0]);
  });

  it("un documento la cui riga c'è e il file no", () => {
    raw
      .prepare(
        "insert into documenti (chiave, anno_id, titolo, categoria, file) values ('x',1,'T','iscrizioni','doc-mancante-1.pdf')",
      )
      .run();
    const e = orfani.confronta(0);
    assert.deepEqual(
      e.righeSenzaFile.map((r) => r.genere),
      ["documento"],
    );
  });

  it("un documento senza file non è una riga senza file: è una voce senza allegato", () => {
    // venticinque documenti reali su ventisei sono così — vedi schema-review §5
    raw
      .prepare(
        "insert into documenti (chiave, anno_id, titolo, categoria) values ('x',1,'T','iscrizioni')",
      )
      .run();
    assert.deepEqual(orfani.confronta(0).righeSenzaFile, []);
  });

  it("le derivate mancanti non si segnalano: le rifà la coda", async () => {
    const { nomi } = await conFoto(1);
    const { nomeDerivata, LATI } = await import("@/lib/foto/derivate");
    for (const lato of LATI) unlinkSync(join(cartellaDati, nomeDerivata(nomi[0], lato)));

    // l'originale c'è, quindi nessuna riga è senza file; e le derivate le
    // rimette `accodaMancanti()` all'avvio, non una cancellazione
    assert.deepEqual(orfani.confronta(0).righeSenzaFile, []);
  });
});
