import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * I documenti per i referenti (migrazione 0019): il riconoscimento dei formati, lo
 * store, e le due righe della matrice che decidono chi legge e chi carica.
 */

let cartella;
let cartellaDati;
let raw;
let store;
let formati;
let chiudiPerTest;

// --------------------------------------------------------------------------
// File di prova: i primi byte che servono a riconoscerli, e niente di più
// --------------------------------------------------------------------------

const ascii = (s) => Buffer.from(s, "latin1");

const PDF = Buffer.concat([ascii("%PDF-1.7\n"), Buffer.alloc(200, 0x20), ascii("%%EOF")]);

/** Uno zip OOXML: intestazione, `[Content_Types].xml`, la cartella del programma. */
function ooxml(cartellaProgramma) {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(26, 0),
    ascii("[Content_Types].xml"),
    Buffer.alloc(40, 1),
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(26, 0),
    ascii(`${cartellaProgramma}document.xml`),
    Buffer.alloc(40, 2),
  ]);
}

/** Uno zip OpenDocument: il primo elemento è `mimetype`, non compresso. */
function odf(mimetype) {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(26, 0),
    ascii("mimetype"),
    ascii(mimetype),
    Buffer.alloc(40, 3),
  ]);
}

const OLE = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(504, 0),
]);

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-documenti-referenti-"));
  cartellaDati = join(cartella, "dati");
  const percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = cartellaDati;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/documenti-referenti-store");
  formati = await import("@/lib/documenti-referenti");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

beforeEach(() => {
  raw.prepare("DELETE FROM documenti_referenti").run();
  raw.prepare("DELETE FROM cartelle_referenti").run();
  for (const nome of fileSulDisco()) unlinkSync(join(cartellaDati, nome));
});

/** I file `referenti-` sul disco, in ordine. */
const fileSulDisco = () =>
  existsSync(cartellaDati)
    ? readdirSync(cartellaDati)
        .filter((n) => n.startsWith("referenti-"))
        .sort()
    : [];

const OPZIONI = { adesso: 1791000000000, autore: "" };

// --------------------------------------------------------------------------
// I formati
// --------------------------------------------------------------------------

describe("riconoscere un file", () => {
  const ok = (nome, contenuto, atteso) => {
    const r = formati.riconosciFormato(nome, contenuto);
    assert.equal(r.ok, true, `${nome}: ${r.errore}`);
    assert.equal(r.definizione.formato, atteso);
  };
  const ko = (nome, contenuto, frammento) => {
    const r = formati.riconosciFormato(nome, contenuto);
    assert.equal(r.ok, false, `${nome} non doveva passare`);
    assert.match(r.errore, frammento);
  };

  it("PDF, Office e OpenDocument veri passano", () => {
    ok("Verbale.PDF", PDF, "PDF");
    ok("verbale.docx", ooxml("word/"), "DOCX");
    ok("quote.xlsx", ooxml("xl/"), "XLSX");
    ok("riunione.pptx", ooxml("ppt/"), "PPTX");
    ok("verbale.odt", odf("application/vnd.oasis.opendocument.text"), "ODT");
    ok("quote.ods", odf("application/vnd.oasis.opendocument.spreadsheet"), "ODS");
    ok("riunione.odp", odf("application/vnd.oasis.opendocument.presentation"), "ODP");
    ok("vecchio.doc", OLE, "DOC");
    ok("vecchio.xls", OLE, "XLS");
    ok("vecchio.ppt", OLE, "PPT");
  });

  it("un nome che mente non passa: una pagina HTML chiamata .pdf", () => {
    ko("verbale.pdf", ascii("<!doctype html><script>alert(1)</script>"), /non è un file PDF valido/);
  });

  it("un foglio Excel rinominato .docx non passa", () => {
    ko("verbale.docx", ooxml("xl/"), /non è un file Word valido/);
  });

  it("un OpenDocument col tipo di un altro non passa", () => {
    ko("verbale.odt", odf("application/vnd.oasis.opendocument.spreadsheet"), /non è un file/);
  });

  it("formati fuori elenco: macro, eseguibili, immagini, niente estensione", () => {
    for (const nome of ["verbale.docm", "quote.xlsm", "setup.exe", "foto.jpg", "pagina.html", "senza"]) {
      ko(nome, PDF, /formato non accettato/);
    }
  });

  it("i formati coincidono con il CHECK della migrazione", () => {
    const sqlTesto = readFileSync("./drizzle/0019_documenti_referenti.sql", "utf8");
    const elenco = sqlTesto.match(/"formato" IN \(([^)]*)\)/)[1];
    assert.deepEqual(
      elenco.split(",").map((v) => v.replace(/'/g, "")),
      formati.FORMATI_REFERENTI.map((f) => f.formato),
    );
  });

  it("il nome da scaricare è il titolo, senza caratteri pericolosi", () => {
    assert.equal(formati.nomeDaScaricare("Verbale CoCa 2026–2027", "DOCX"), "Verbale CoCa 2026-2027.docx");
    assert.equal(
      formati.nomeDaScaricare('a"b\r\nContent-Type: x', "PDF"),
      "a-b-Content-Type- x.pdf",
    );
    assert.equal(formati.nomeDaScaricare("«»", "PDF"), "documento.pdf");
  });
});

// --------------------------------------------------------------------------
// Le cartelle
// --------------------------------------------------------------------------

describe("le cartelle", () => {
  it("si creano in fondo, e il nome è unico senza badare alle maiuscole", async () => {
    const a = await store.creaCartellaReferenti({ titolo: "Verbali", descrizione: "" }, "");
    const b = await store.creaCartellaReferenti({ titolo: "Formazione", descrizione: "Corsi" }, "");
    assert.equal(a.ok && b.ok, true);

    const doppia = await store.creaCartellaReferenti({ titolo: "VERBALI", descrizione: "" }, "");
    assert.equal(doppia.ok, false);
    assert.match(doppia.errore, /C’è già la cartella «Verbali»/);

    const elenco = await store.leggiCartelleReferenti();
    assert.deepEqual(
      elenco.map((c) => [c.titolo, c.documenti]),
      [
        ["Verbali", 0],
        ["Formazione", 0],
      ],
    );
  });

  it("si rinominano, ma non con il nome di un'altra", async () => {
    const a = await store.creaCartellaReferenti({ titolo: "Verbali", descrizione: "" }, "");
    await store.creaCartellaReferenti({ titolo: "Formazione", descrizione: "" }, "");

    assert.equal((await store.modificaCartellaReferenti(a.id, { titolo: "formazione", descrizione: "" }, "")).ok, false);
    // la stessa cartella con le maiuscole cambiate non è un doppione di sé stessa
    assert.equal((await store.modificaCartellaReferenti(a.id, { titolo: "VERBALI", descrizione: "x" }, "")).ok, true);
  });

  it("si spostano di un posto", async () => {
    const ids = [];
    for (const titolo of ["A", "B", "C"]) {
      ids.push((await store.creaCartellaReferenti({ titolo, descrizione: "" }, "")).id);
    }
    await store.spostaCartellaReferenti(ids[2], "su");
    await store.spostaCartellaReferenti(ids[0], "su"); // già in cima: niente
    const ordine = raw.prepare("SELECT titolo FROM cartelle_referenti ORDER BY ordine").all().map((r) => r.titolo);
    assert.deepEqual(ordine, ["A", "C", "B"]);
  });

  it("una cartella con dei documenti non si elimina; vuota sì", async () => {
    const c = await store.creaCartellaReferenti({ titolo: "Verbali", descrizione: "" }, "");
    const d = await store.aggiungiDocumentoReferenti(
      { cartellaId: c.id, titolo: "Verbale", nota: "" },
      PDF,
      "verbale.pdf",
      OPZIONI,
    );

    const rifiuto = await store.eliminaCartellaReferenti(c.id);
    assert.equal(rifiuto.ok, false);
    assert.match(rifiuto.errore, /Contiene 1 documento/);

    await store.eliminaDocumentoReferenti(d.id);
    assert.equal((await store.eliminaCartellaReferenti(c.id)).ok, true);
    assert.deepEqual(await store.leggiCartelleReferenti(), []);
  });
});

// --------------------------------------------------------------------------
// I documenti
// --------------------------------------------------------------------------

describe("i documenti", () => {
  it("il caricamento scrive il file con il prefisso e la riga che lo nomina", async () => {
    const c = await store.creaCartellaReferenti({ titolo: "Verbali", descrizione: "" }, "");
    const e = await store.aggiungiDocumentoReferenti(
      { cartellaId: c.id, titolo: "Verbale di ottobre", nota: "" },
      ooxml("word/"),
      "verbale_ottobre.docx",
      OPZIONI,
    );
    assert.equal(e.ok, true);

    const d = await store.documentoReferentiPerId(e.id);
    assert.equal(d.formato, "DOCX");
    assert.equal(d.byte, ooxml("word/").length);
    assert.match(d.file, /^referenti-1791000000000-[0-9a-f]{8}\.docx$/);
    // il titolo non finisce nel nome del file, che compare negli indirizzi
    assert.doesNotMatch(d.file, /verbale/i);
    assert.deepEqual(fileSulDisco(), [d.file]);
    assert.equal((await store.documentoReferentiPerFile(d.file)).id, e.id);
    assert.equal((await store.leggiCartelleReferenti())[0].documenti, 1);
  });

  it("un file rifiutato non lascia niente sul disco", async () => {
    const c = await store.creaCartellaReferenti({ titolo: "Verbali", descrizione: "" }, "");
    const e = await store.aggiungiDocumentoReferenti(
      { cartellaId: c.id, titolo: "Finto", nota: "" },
      ascii("<html></html>"),
      "finto.pdf",
      OPZIONI,
    );
    assert.equal(e.ok, false);
    assert.equal(e.campo, "file");
    assert.deepEqual(fileSulDisco(), []);
  });

  it("in una cartella che non c'è più non si carica, e il file scritto si porta via", async () => {
    const e = await store.aggiungiDocumentoReferenti(
      { cartellaId: 9999, titolo: "Orfano", nota: "" },
      PDF,
      "orfano.pdf",
      OPZIONI,
    );
    assert.equal(e.ok, false);
    assert.deepEqual(fileSulDisco(), []);
  });

  it("si cambia titolo, nota e cartella", async () => {
    const a = await store.creaCartellaReferenti({ titolo: "Verbali", descrizione: "" }, "");
    const b = await store.creaCartellaReferenti({ titolo: "Archivio", descrizione: "" }, "");
    const e = await store.aggiungiDocumentoReferenti({ cartellaId: a.id, titolo: "V", nota: "" }, PDF, "v.pdf", OPZIONI);

    const esito = await store.modificaDocumentoReferenti(
      e.id,
      { titolo: "Verbale 2 ottobre", nota: "Approvato", cartellaId: b.id },
      "",
    );
    assert.equal(esito.ok, true);
    const d = await store.documentoReferentiPerId(e.id);
    assert.deepEqual([d.titolo, d.nota, d.cartellaId], ["Verbale 2 ottobre", "Approvato", b.id]);
    assert.deepEqual(await store.documentiDellaCartella(a.id), []);

    assert.equal(
      (await store.modificaDocumentoReferenti(e.id, { titolo: "x", nota: "", cartellaId: 9999 }, "")).campo,
      "cartella",
    );
  });

  it("una nuova versione sostituisce il file, anche di formato, e cancella il vecchio", async () => {
    const c = await store.creaCartellaReferenti({ titolo: "Verbali", descrizione: "" }, "");
    const e = await store.aggiungiDocumentoReferenti({ cartellaId: c.id, titolo: "V", nota: "" }, PDF, "v.pdf", OPZIONI);
    const prima = (await store.documentoReferentiPerId(e.id)).file;

    const esito = await store.sostituisciFileReferenti(e.id, ooxml("word/"), "v2.docx", {
      adesso: OPZIONI.adesso + 1000,
      autore: "",
    });
    assert.equal(esito.ok, true);

    const dopo = await store.documentoReferentiPerId(e.id);
    assert.notEqual(dopo.file, prima);
    assert.equal(dopo.formato, "DOCX");
    assert.equal(dopo.titolo, "V");
    assert.deepEqual(fileSulDisco(), [dopo.file]);
  });

  it("una nuova versione rifiutata lascia quella di prima", async () => {
    const c = await store.creaCartellaReferenti({ titolo: "Verbali", descrizione: "" }, "");
    const e = await store.aggiungiDocumentoReferenti({ cartellaId: c.id, titolo: "V", nota: "" }, PDF, "v.pdf", OPZIONI);
    const prima = (await store.documentoReferentiPerId(e.id)).file;

    const esito = await store.sostituisciFileReferenti(e.id, PDF, "v.exe", OPZIONI);
    assert.equal(esito.ok, false);
    assert.equal((await store.documentoReferentiPerId(e.id)).file, prima);
    assert.deepEqual(fileSulDisco(), [prima]);
  });

  it("eliminare porta via la riga e il file", async () => {
    const c = await store.creaCartellaReferenti({ titolo: "Verbali", descrizione: "" }, "");
    const e = await store.aggiungiDocumentoReferenti({ cartellaId: c.id, titolo: "Via", nota: "" }, PDF, "via.pdf", OPZIONI);

    assert.equal(await store.eliminaDocumentoReferenti(e.id), "Via");
    assert.equal(await store.documentoReferentiPerId(e.id), undefined);
    assert.deepEqual(fileSulDisco(), []);
    assert.equal(await store.eliminaDocumentoReferenti(e.id), null);
  });

  it("gli ultimi caricati, in tutte le cartelle, dal più recente", async () => {
    const a = await store.creaCartellaReferenti({ titolo: "A", descrizione: "" }, "");
    const b = await store.creaCartellaReferenti({ titolo: "B", descrizione: "" }, "");
    for (const [i, [cartellaId, titolo]] of [
      [a.id, "primo"],
      [b.id, "secondo"],
      [a.id, "terzo"],
    ].entries()) {
      await store.aggiungiDocumentoReferenti({ cartellaId, titolo, nota: "" }, PDF, "x.pdf", {
        adesso: OPZIONI.adesso + i,
        autore: "",
      });
    }
    assert.deepEqual(
      (await store.ultimiDocumentiReferenti(2)).map((d) => d.titolo),
      ["terzo", "secondo"],
    );
    // tutti, dal più recente: la sezione li divide per cartella in una pagina sola
    assert.deepEqual(
      (await store.tuttiDocumentiReferenti()).map((d) => d.titolo),
      ["terzo", "secondo", "primo"],
    );
    // il conteggio per cartella: due in A, uno in B. Con la sottoquery di prima
    // contava i documenti il cui numero coincideva con quello della cartella
    assert.deepEqual(
      (await store.leggiCartelleReferenti()).map((c) => [c.titolo, c.documenti]),
      [
        ["A", 2],
        ["B", 1],
      ],
    );
  });

  it("il database rifiuta un file che non comincia con il prefisso", () => {
    const { lastInsertRowid } = raw.prepare("INSERT INTO cartelle_referenti (titolo, ordine) VALUES ('X', 1)").run();
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO documenti_referenti (cartella_id, titolo, formato, byte, file) VALUES (?, 'T', 'PDF', 1, 'doc-x.pdf')",
          )
          .run(lastInsertRowid),
      /documenti_referenti_file/,
    );
  });
});

// --------------------------------------------------------------------------
// Chi legge e chi carica
// --------------------------------------------------------------------------

describe("le due righe della matrice", () => {
  let decidi;
  let FUNZIONI_INIZIALI;
  const sess = (r, un) => ({ u: r, n: r, r, i: "", exp: 0, ...(un ? { un } : {}) });

  before(async () => {
    ({ decidi } = await import("@/lib/auth/decisione"));
    ({ FUNZIONI_INIZIALI } = await import("@/lib/permessi"));
  });

  it("i referenti di unità leggono, ma non caricano", () => {
    const referente = sess("referente", "u1");
    assert.equal(decidi(FUNZIONI_INIZIALI, referente, "documenti-referenti-leggi").ok, true);
    assert.equal(
      decidi(FUNZIONI_INIZIALI, referente, "documenti-referenti-carica", { unita: "gruppo" }).ok,
      false,
    );
  });

  it("gestore e sviluppatore leggono e caricano", () => {
    for (const r of ["gestore", "sviluppatore"]) {
      assert.equal(decidi(FUNZIONI_INIZIALI, sess(r), "documenti-referenti-leggi").ok, true);
      assert.equal(decidi(FUNZIONI_INIZIALI, sess(r), "documenti-referenti-carica", { unita: "gruppo" }).ok, true);
    }
  });

  it("senza sessione, niente", () => {
    assert.equal(decidi(FUNZIONI_INIZIALI, null, "documenti-referenti-leggi").ok, false);
  });

  it("un ruolo che la riga non nomina non legge", () => {
    // è il caso di un ruolo aggiunto dopo: la cella mancante vale «nessuno»
    assert.equal(decidi(FUNZIONI_INIZIALI, sess("altro"), "documenti-referenti-leggi").ok, false);
  });

  it("con la scrittura messa a «limitato», l'ambito «gruppo» tiene fuori il referente di unità", () => {
    const allargata = FUNZIONI_INIZIALI.map((f) =>
      f.id === "documenti-referenti-carica"
        ? { ...f, livelli: { ...f.livelli, "referente": "limitato" } }
        : f,
    );
    const referente = sess("referente", "u1");
    assert.equal(decidi(allargata, referente, "documenti-referenti-carica", { unita: "gruppo" }).ok, false);
  });
});
