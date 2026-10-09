import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * `lib/documenti-store.ts` su SQLite — passo 2B.4.
 *
 * Il seme (`DOCUMENTI` di `lib/data.ts`) è vuoto dal passaggio in produzione:
 * ogni prova crea con `creaDocumento` i documenti che le servono.
 *
 * Due cose che questo store deve saper fare e che sembrano sbagliate: un
 * documento **pubblicato senza file** (una voce d'elenco il cui file arriverà)
 * e l'anno in forma **canonica** `2026-2027`, diversa da quella degli album.
 */

let cartella;
let cartellaDati;
let percorso;
let store;
let DOCUMENTI;
let ErroreDatabase;
let chiudiPerTest;
let raw;

const PDF = Buffer.concat([Buffer.from([0x25, 0x50, 0x44, 0x46]), Buffer.alloc(200, 0x20)]);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 0x20)]);
const FINTO = Buffer.from("non sono un documento");

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-documenti-"));
  cartellaDati = join(cartella, "dati");
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = cartellaDati;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/documenti-store");
  ({ DOCUMENTI } = await import("@/lib/data"));
  ({ ErroreDatabase } = await import("@/lib/db/errori"));
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
  raw.prepare("DELETE FROM documenti").run();
  raw.prepare("DELETE FROM anni_sociali").run();
});

const conteggio = () => raw.prepare("SELECT count(*) n FROM documenti").get().n;
const fileSuDisco = () => {
  try {
    return readdirSync(cartellaDati).filter((f) => f.startsWith("doc-")).sort();
  } catch {
    return [];
  }
};

/**
 * Crea un documento e ne restituisce la chiave. Di partenza è la scheda
 * sanitaria del 2026-2027: modulistica, quindi di gruppo.
 */
async function nuovoDocumento(campi = {}) {
  const esito = await store.creaDocumento(
    {
      titolo: "Scheda sanitaria",
      anno: "2026-2027",
      unita: "gruppo",
      categoria: "iscrizioni",
      nota: "Da consegnare ai referenti prima del campo.",
      ...campi,
    },
    0,
    "gestori",
  );
  assert.equal(esito.ok, true, esito.errore);
  return esito.id;
}

// --------------------------------------------------------------------------

describe("lettura", () => {
  it("il seme è vuoto: a tabella vuota non restituisce nessun documento", async () => {
    assert.deepEqual(DOCUMENTI, [], "nessun documento dimostrativo va in produzione");
    assert.deepEqual(await store.leggiDocumenti(), []);
  });

  it("leggere non scrive", async () => {
    await store.leggiDocumenti();
    assert.equal(conteggio(), 0);
  });

  it("un documento creato si rilegge con i campi che ha ricevuto", async () => {
    const id = await nuovoDocumento({ titolo: "Quota annuale", categoria: "quote", nota: "Entro ottobre." });
    assert.equal(conteggio(), 1);

    const [trovato, ...altri] = await store.leggiDocumenti();
    assert.deepEqual(altri, []);
    assert.equal(trovato.id, id);
    assert.equal(trovato.titolo, "Quota annuale");
    assert.equal(trovato.anno, "2026-2027", "l'anno resta in forma canonica");
    assert.equal(trovato.unita, "gruppo");
    assert.equal(trovato.categoria, "quote");
    assert.equal(trovato.nota, "Entro ottobre.");
    assert.equal(trovato.formato, "PDF");
    assert.equal(trovato.peso, "—");
    assert.equal(trovato.aggiornamento, "");
  });

  it("l'anno è canonico «2026-2027», non «2026 – 2027»", async () => {
    await nuovoDocumento({ anno: "2026-2027" });
    await nuovoDocumento({ anno: "2024-2025" });
    const d = await store.leggiDocumenti();
    assert.equal(d.length, 2);
    for (const x of d) assert.match(x.anno, /^\d{4}-\d{4}$/, `anno inatteso: ${x.anno}`);
  });

  it("un documento si pubblica senza file, e il database lo accetta", async () => {
    const id = await nuovoDocumento();
    assert.equal(await store.cambiaStatoDocumento(id, "pubblicato", 0, ""), true);
    const d = await store.documentoPerId(id);
    assert.equal(d.stato, "pubblicato");
    assert.ok(!d.file);
    assert.ok((await store.documentiPubblicati()).some((x) => x.id === id));
  });

  it("l'ordine è stabile fra due letture", async () => {
    await nuovoDocumento({ titolo: "Scheda sanitaria" });
    await nuovoDocumento({ titolo: "Quota annuale", categoria: "quote" });
    await nuovoDocumento({ titolo: "Scheda sanitaria", anno: "2025-2026" });
    const a = (await store.leggiDocumenti()).map((x) => x.id);
    const b = (await store.leggiDocumenti()).map((x) => x.id);
    assert.equal(a.length, 3);
    assert.deepEqual(a, b);
  });

  it("documentiPubblicati esclude le bozze", async () => {
    const pubblicato = await nuovoDocumento({ titolo: "Quota annuale", categoria: "quote" });
    const id = await nuovoDocumento();
    await store.cambiaStatoDocumento(pubblicato, "pubblicato", 0, "");
    const pubblicati = await store.documentiPubblicati();
    assert.deepEqual(pubblicati.map((x) => x.id), [pubblicato]);
    assert.ok(!pubblicati.some((x) => x.id === id));
    assert.ok((await store.leggiDocumenti()).some((x) => x.id === id));
  });

  it("documentoPerId trova per chiave e restituisce undefined se manca", async () => {
    const id = await nuovoDocumento();
    assert.ok(await store.documentoPerId(id));
    assert.equal(await store.documentoPerId("2026-2027/mai-esistito"), undefined);
  });
});

describe("creaDocumento", () => {
  it("crea in bozza e restituisce la chiave", async () => {
    const esito = await store.creaDocumento(
      { titolo: "Verbale del consiglio", anno: "2026-2027", unita: "gruppo", categoria: "statuti", nota: "Prova." },
      0,
      "gestori",
    );
    assert.equal(esito.ok, true);
    assert.equal(esito.id, "2026-2027/verbale-del-consiglio");

    const d = await store.documentoPerId(esito.id);
    assert.equal(d.stato, "bozza");
    assert.equal(d.formato, "PDF");
    assert.equal(d.peso, "—");
    assert.ok(!d.file);
    assert.ok(d.aggiornato > 0, "la data di modifica c'è");
  });

  it("un titolo già usato nello stesso anno viene rifiutato con un messaggio", async () => {
    await nuovoDocumento({ titolo: "Scheda sanitaria", anno: "2026-2027" });
    const dati = { titolo: "Scheda sanitaria", anno: "2026-2027",
      unita: "gruppo", categoria: "iscrizioni", nota: "x" };
    const esito = await store.creaDocumento(dati, 0, "gestori");
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /Esiste già/);
  });

  it("una circolare ha un'unità, e la modulistica no", async () => {
    /*
     * L'invariante che `documenti_circolari_hanno_unita` garantisce nel
     * database, controllata **prima** nello store per poterla spiegare.
     *
     * Sono i due modi in cui l'ambito si sfila: una circolare senza unità che
     * nessun referente di unità potrebbe toccare, e un modulo d'iscrizione intestato a
     * un'unità — che il referente di quell'unità potrebbe poi modificare, perché è
     * nel suo ambito.
     */
    const senzaUnita = await store.creaDocumento(
      { titolo: "Lista materiale", anno: "2026-2027", unita: "gruppo", categoria: "circolari", nota: "" },
      0,
      "ref1",
    );
    assert.equal(senzaUnita.ok, false);
    assert.match(senzaUnita.errore, /circolare è di un’unità/);

    const moduloDiUnita = await store.creaDocumento(
      { titolo: "Modulo strano", anno: "2026-2027", unita: "u1", categoria: "iscrizioni", nota: "" },
      0,
      "ref1",
    );
    assert.equal(moduloDiUnita.ok, false);
    assert.match(moduloDiUnita.errore, /Solo le circolari/);
  });

  it("una circolare d'unità si crea, e porta la sua unità", async () => {
    const esito = await store.creaDocumento(
      {
        titolo: "Lista materiale uscita invernale",
        anno: "2026-2027",
        unita: "u1",
        categoria: "circolari",
        nota: "Sacco a pelo e torcia.",
      },
      0,
      "ref1",
    );
    assert.equal(esito.ok, true);

    const d = await store.documentoPerId(esito.id);
    assert.equal(d.unita, "u1");
    assert.equal(d.categoria, "circolari");
    assert.equal(d.stato, "bozza", "nasce in bozza: si pubblica quando il file c'è");
  });

  it("documentiDiUnita restituisce solo le proprie, e non la modulistica", async () => {
    const modulo = await nuovoDocumento();
    await store.creaDocumento(
      { titolo: "Circolare dell’unità 1", anno: "2026-2027", unita: "u1", categoria: "circolari", nota: "" },
      0,
      "ref1",
    );
    await store.creaDocumento(
      { titolo: "Circolare dell’unità 4", anno: "2026-2027", unita: "u4", categoria: "circolari", nota: "" },
      0,
      "referente-u4",
    );

    const dei = await store.documentiDiUnita("u1");
    assert.deepEqual(
      dei.map((d) => d.titolo),
      ["Circolare dell’unità 1"],
    );
    // `unita: "gruppo"` è l'unità di nessuno, e `copre()` la nega a ogni referente
    // unità: è ciò che tiene la modulistica fuori dalla loro portata
    assert.deepEqual(
      (await store.documentiDiUnita("gruppo")).map((d) => d.id),
      [modulo],
      "«gruppo» resta l'ambito della modulistica, e le circolari non ci finiscono",
    );
  });

  it("lo stesso titolo in un altro anno è ammesso", async () => {
    await nuovoDocumento({ titolo: "Scheda sanitaria", anno: "2026-2027" });
    const esito = await store.creaDocumento(
      { titolo: "Scheda sanitaria", anno: "2025-2026", unita: "gruppo", categoria: "iscrizioni", nota: "x" },
      0,
      "gestori",
    );
    assert.equal(esito.ok, true);
    assert.equal(esito.id, "2025-2026/scheda-sanitaria");
  });

  it("un anno che non è nel reticolo è un errore di validazione, non un guasto", async () => {
    const esito = await store.creaDocumento(
      { titolo: "Fuori tempo", anno: "2099-2100", unita: "gruppo", categoria: "statuti", nota: "x" },
      0,
      "gestori",
    );
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /2099-2100/);
    assert.match(esito.errore, /anni sociali/);
  });
});

describe("aggiornaDocumento e cambiaStatoDocumento", () => {
  it("aggiorna titolo, categoria e nota, e lascia la chiave invariata", async () => {
    const id = await nuovoDocumento();
    assert.deepEqual(
      await store.aggiornaDocumento(id, { titolo: "Scheda sanitaria (2027)", nota: "Nuova nota." }, 0, "gestori"),
      { ok: true },
    );
    const d = await store.documentoPerId(id);
    assert.equal(d.titolo, "Scheda sanitaria (2027)");
    assert.equal(d.nota, "Nuova nota.");
    assert.equal(d.id, id, "la chiave è stabile: non cambia con il titolo");
  });

  it("l'avviso nasce vuoto, si scrive, si legge e si toglie", async () => {
    const id = await nuovoDocumento();
    assert.equal((await store.documentoPerId(id)).avviso, "", "di partenza nessun riquadro");

    const testo = "Chi è già tesserato in un altro gruppo chiede il trasferimento: non compila questo modulo.";
    assert.deepEqual(await store.aggiornaDocumento(id, { avviso: testo }, 0, "gestori"), {
      ok: true,
    });
    const d = await store.documentoPerId(id);
    assert.equal(d.avviso, testo);
    assert.equal(d.nota, "Da consegnare ai referenti prima del campo.", "la nota resta com'era");

    // un salvataggio che non porta l'avviso non lo cancella
    await store.aggiornaDocumento(id, { titolo: "Scheda sanitaria 2027" }, 0, "gestori");
    assert.equal((await store.documentoPerId(id)).avviso, testo);

    await store.aggiornaDocumento(id, { avviso: "" }, 0, "gestori");
    assert.equal((await store.documentoPerId(id)).avviso, "");
  });

  it("i tre stati vanno e tornano", async () => {
    const id = await nuovoDocumento();
    for (const stato of ["bozza", "in-revisione", "pubblicato"]) {
      assert.equal(await store.cambiaStatoDocumento(id, stato, 0, "gestori"), true);
      assert.equal((await store.documentoPerId(id)).stato, stato);
    }
  });

  it("in-revisione è scritto nel database come in_revisione", async () => {
    const id = await nuovoDocumento();
    await store.cambiaStatoDocumento(id, "in-revisione", 0, "gestori");
    const r = raw.prepare("SELECT stato FROM documenti WHERE chiave = ?").get(id);
    assert.equal(r.stato, "in_revisione");
  });

  it("su un documento inesistente non riescono, e lo dicono", async () => {
    await nuovoDocumento();
    const esito = await store.aggiornaDocumento("2026-2027/no", { titolo: "x" }, 0, "cg");
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /non esiste più/);
    assert.equal(await store.cambiaStatoDocumento("2026-2027/no", "bozza", 0, "cg"), false);
  });
});

describe("caricaFileDocumento", () => {
  let id;
  beforeEach(async () => {
    id = await nuovoDocumento();
  });

  it("accetta un PDF, aggiorna peso e formato, e scrive il file", async () => {
    const esito = await store.caricaFileDocumento(id, PDF, 1000, "gestori", "ago 2026");
    assert.equal(esito.ok, true);

    const d = await store.documentoPerId(id);
    assert.ok(d.file, "la chiave file adesso c'è");
    assert.equal(d.formato, "PDF");
    assert.equal(d.aggiornamento, "ago 2026");
    assert.match(d.peso, /KB|MB/);
    assert.ok(fileSuDisco().includes(d.file));
  });

  it("accetta un DOCX e ne riconosce il formato dai primi byte", async () => {
    await store.caricaFileDocumento(id, DOCX, 2000, "gestori", "set 2026");
    assert.equal((await store.documentoPerId(id)).formato, "DOCX");
  });

  it("rifiuta un file che non è né PDF né DOCX, e non scrive niente sul disco", async () => {
    const prima = fileSuDisco();
    const esito = await store.caricaFileDocumento(id, FINTO, 3000, "gestori", "set 2026");
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /PDF/);
    assert.deepEqual(fileSuDisco(), prima);
  });

  it("sostituire il file porta via il precedente", async () => {
    await store.caricaFileDocumento(id, PDF, 4000, "gestori", "ott 2026");
    const primo = (await store.documentoPerId(id)).file;
    await store.caricaFileDocumento(id, PDF, 5000, "gestori", "nov 2026");
    const secondo = (await store.documentoPerId(id)).file;

    assert.notEqual(primo, secondo, "il nome porta la marca temporale");
    assert.ok(!fileSuDisco().includes(primo), "il vecchio è stato cancellato");
    assert.ok(fileSuDisco().includes(secondo));
  });

  it("su un documento inesistente non lascia il file orfano", async () => {
    const prima = fileSuDisco();
    const esito = await store.caricaFileDocumento("2026-2027/mai-esistito", PDF, 6000, "cg", "dic 2026");
    assert.equal(esito.ok, false);
    assert.deepEqual(fileSuDisco(), prima, "il file scritto prima della transazione è stato ripulito");
  });
});

describe("servire i file: filePubblico e fileInterno", () => {
  let id;
  beforeEach(async () => {
    id = await nuovoDocumento();
  });

  it("un documento pubblicato è servibile a tutti", async () => {
    await store.caricaFileDocumento(id, PDF, 7000, "cg", "ago 2026");
    await store.cambiaStatoDocumento(id, "pubblicato", 0, "cg");
    const nome = (await store.documentoPerId(id)).file;

    const pubblico = await store.filePubblico(nome);
    assert.ok(pubblico);
    assert.equal(pubblico.tipo, "application/pdf");
    assert.equal(pubblico.formato, "PDF");
    assert.ok(pubblico.titolo.length > 0);
  });

  it("una bozza NON è servibile al pubblico, ma lo è a chi è entrato", async () => {
    await store.caricaFileDocumento(id, PDF, 8000, "cg", "ago 2026");
    await store.cambiaStatoDocumento(id, "bozza", 0, "cg");
    const nome = (await store.documentoPerId(id)).file;

    assert.equal(await store.filePubblico(nome), null, "un indirizzo indovinato non deve bastare");
    assert.ok(await store.fileInterno(nome));
  });

  it("un nome di file che non esiste non è servibile", async () => {
    assert.equal(await store.filePubblico("doc-inventato.pdf"), null);
    assert.equal(await store.fileInterno("doc-inventato.pdf"), null);
  });
});

describe("eliminaDocumento", () => {
  it("porta via la riga e il file", async () => {
    const id = await nuovoDocumento();
    await store.caricaFileDocumento(id, PDF, 9000, "cg", "ago 2026");
    const nome = (await store.documentoPerId(id)).file;

    assert.equal(await store.eliminaDocumento(id), true);
    assert.equal(await store.documentoPerId(id), undefined);
    assert.ok(!fileSuDisco().includes(nome), "il file è stato cancellato dopo il commit");
  });

  it("su un documento inesistente restituisce false", async () => {
    assert.equal(await store.eliminaDocumento("2026-2027/mai-esistito"), false);
  });
});

describe("riconosciDocumento — funzione pura", () => {
  it("riconosce PDF e DOCX dai primi byte e rifiuta il resto", async () => {
    assert.equal(store.riconosciDocumento(PDF).formato, "PDF");
    assert.equal(store.riconosciDocumento(DOCX).formato, "DOCX");
    assert.equal(store.riconosciDocumento(FINTO), null);
  });
});

describe("gli errori non portano SQL fuori dallo store", () => {
  it("una cartella inventata è un errore di validazione, non un guasto", async () => {
    const esito = await store.creaDocumento(
      { titolo: "Cartella inventata", anno: "2026-2027", unita: "gruppo", categoria: "cartella-che-non-esiste", nota: "x" },
      0,
      "cg",
    );
    assert.equal(esito.ok, false);
    assert.equal(esito.campo, "categoria");
    assert.match(esito.errore, /cartella non esiste più/);
    assert.equal(conteggio(), 0);
  });

  it("un vincolo che scatta nel database arriva come ErroreDatabase con messaggio sicuro", async () => {
    /*
     * Era una categoria fuori elenco, che il `CHECK` rifiutava. Dalla 0012 la
     * cartella la controlla lo store prima di scrivere, quindi per arrivare al
     * database serve un vincolo che lo store non conosce: un trigger di prova,
     * con un messaggio pieno delle parole che non devono uscire.
     */
    raw
      .prepare(
        "CREATE TRIGGER prova_blocca BEFORE INSERT ON documenti " +
          "BEGIN SELECT RAISE(ABORT, 'insert su documenti vietato: SQLITE_ constraint'); END",
      )
      .run();
    try {
      const e = await store
        .creaDocumento(
          { titolo: "Bloccato", anno: "2026-2027", unita: "gruppo", categoria: "iscrizioni", nota: "x" },
          0,
          "cg",
        )
        .then(() => null, (err) => err);

      assert.ok(e instanceof ErroreDatabase, `atteso ErroreDatabase, ricevuto ${e}`);
      assert.equal(e.codice, "REGOLA_DB");
      const testo = `${e.message} ${e.codice}`;
      for (const proibito of ["insert", "documenti", "SQLITE_", "constraint", "vietato"]) {
        assert.ok(
          !testo.toLowerCase().includes(proibito.toLowerCase()),
          `«${proibito}» non deve uscire dallo store: ${testo}`,
        );
      }
    } finally {
      raw.prepare("DROP TRIGGER prova_blocca").run();
    }
  });
});

// --------------------------------------------------------------------------
// Le cartelle e i documenti sempre validi — migrazione 0012
// --------------------------------------------------------------------------

describe("documenti sempre validi", () => {
  it("un documento senza anno è sempre valido, e la sua chiave comincia con sempre/", async () => {
    const id = await nuovoDocumento({ anno: null, titolo: "Modulo di tesseramento" });
    assert.equal(id, "sempre/modulo-di-tesseramento");
    const d = await store.documentoPerId(id);
    assert.equal(d.anno, null);
    const r = raw.prepare("SELECT anno_id FROM documenti WHERE chiave = ?").get(id);
    assert.equal(r.anno_id, null, "nel database è anno_id nullo");
  });

  it("i sempre validi vengono prima, poi gli anni dal più recente", async () => {
    await nuovoDocumento({ anno: "2025-2026", titolo: "Vecchio" });
    await nuovoDocumento({ anno: "2026-2027", titolo: "Di quest'anno" });
    await nuovoDocumento({ anno: null, titolo: "Per sempre" });
    const anni = (await store.leggiDocumenti()).map((d) => d.anno);
    assert.deepEqual(anni, [null, "2026-2027", "2025-2026"]);
  });

  it("un documento cambia anno, anche in «sempre valido», e la chiave resta quella", async () => {
    const id = await nuovoDocumento({ anno: "2026-2027" });
    assert.deepEqual(await store.aggiornaDocumento(id, { anno: null }, 0, "cg"), { ok: true });
    const d = await store.documentoPerId(id);
    assert.equal(d.anno, null);
    assert.equal(d.id, id);

    assert.deepEqual(await store.aggiornaDocumento(id, { anno: "2025-2026" }, 0, "cg"), { ok: true });
    assert.equal((await store.documentoPerId(id)).anno, "2025-2026");
  });

  it("un anno fuori reticolo, in modifica, è un rifiuto spiegato", async () => {
    const id = await nuovoDocumento();
    const esito = await store.aggiornaDocumento(id, { anno: "2099-2100" }, 0, "cg");
    assert.equal(esito.ok, false);
    assert.equal(esito.campo, "anno");
    assert.equal((await store.documentoPerId(id)).anno, "2026-2027", "non è cambiato niente");
  });
});

describe("il doppione è per cartella", () => {
  it("lo stesso titolo in due cartelle è ammesso, e la seconda chiave prende un numero", async () => {
    const primo = await nuovoDocumento({ anno: null, categoria: "iscrizioni" });
    const secondo = await nuovoDocumento({ anno: null, categoria: "campi" });
    assert.equal(primo, "sempre/scheda-sanitaria");
    assert.equal(secondo, "sempre/scheda-sanitaria-2");
    assert.equal(conteggio(), 2);
  });

  it("lo stesso titolo nella stessa cartella, fra i sempre validi, è rifiutato", async () => {
    await nuovoDocumento({ anno: null });
    const esito = await store.creaDocumento(
      { titolo: "Scheda sanitaria", anno: null, unita: "gruppo", categoria: "iscrizioni", nota: "" },
      0,
      "cg",
    );
    assert.equal(esito.ok, false);
    assert.equal(esito.campo, "titolo");
    assert.match(esito.errore, /Esiste già/);
    assert.match(esito.errore, /sempre validi/);
  });

  it("il confronto dei titoli ignora maiuscole, accenti e spazi doppi", async () => {
    await nuovoDocumento({ anno: null, titolo: "Scheda sanitaria" });
    const esito = await store.creaDocumento(
      { titolo: "scheda  SANITARIA", anno: null, unita: "gruppo", categoria: "iscrizioni", nota: "" },
      0,
      "cg",
    );
    assert.equal(esito.ok, false);
  });

  it("un sempre valido e uno dell'anno con lo stesso titolo convivono", async () => {
    await nuovoDocumento({ anno: null });
    await nuovoDocumento({ anno: "2026-2027" });
    assert.equal(conteggio(), 2);
  });

  it("la stessa circolare in due unità è ammessa: sono due liste diverse", async () => {
    const dati = { titolo: "Lista materiale", anno: "2026-2027", categoria: "circolari", nota: "" };
    const a = await store.creaDocumento({ ...dati, unita: "u1" }, 0, "ref1");
    const b = await store.creaDocumento({ ...dati, unita: "u4" }, 0, "referente-u4");
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.notEqual(a.id, b.id);
  });
});

describe("cambiare cartella", () => {
  it("un documento del gruppo passa da una cartella all'altra, con la chiave di prima", async () => {
    const id = await nuovoDocumento({ categoria: "iscrizioni" });
    assert.deepEqual(await store.aggiornaDocumento(id, { categoria: "campi" }, 0, "cg"), { ok: true });
    const d = await store.documentoPerId(id);
    assert.equal(d.categoria, "campi");
    assert.equal(d.id, id);
  });

  it("una circolare non esce dalle circolari, e un modulo non ci entra", async () => {
    const modulo = await nuovoDocumento();
    const entra = await store.aggiornaDocumento(modulo, { categoria: "circolari" }, 0, "cg");
    assert.equal(entra.ok, false);
    assert.equal(entra.campo, "categoria");

    const circ = await store.creaDocumento(
      { titolo: "Lista", anno: "2026-2027", unita: "u1", categoria: "circolari", nota: "" },
      0,
      "ref1",
    );
    const esce = await store.aggiornaDocumento(circ.id, { categoria: "iscrizioni" }, 0, "ref1");
    assert.equal(esce.ok, false);
    assert.equal((await store.documentoPerId(circ.id)).categoria, "circolari");
  });

  it("una cartella che non esiste è rifiutata anche in modifica", async () => {
    const id = await nuovoDocumento();
    const esito = await store.aggiornaDocumento(id, { categoria: "inventata" }, 0, "cg");
    assert.equal(esito.ok, false);
    assert.equal((await store.documentoPerId(id)).categoria, "iscrizioni");
  });

  it("senza categoria, la modifica lascia il documento dov'è", async () => {
    const id = await nuovoDocumento({ categoria: "quote" });
    await store.aggiornaDocumento(id, { titolo: "Quote 2027", categoria: undefined }, 0, "cg");
    assert.equal((await store.documentoPerId(id)).categoria, "quote");
  });
});

describe("aggiungiDocumentoConFile — il caricamento di una cartella", () => {
  const dati = (campi = {}) => ({
    titolo: "Modulo tesseramento",
    anno: null,
    unita: "gruppo",
    categoria: "iscrizioni",
    nota: "",
    ...campi,
  });
  const opzioni = (campi = {}) => ({ adesso: 10_000, autore: "gestori", mese: "set 2026", pubblica: true, ...campi });

  it("crea il documento con il suo file, già pubblicato", async () => {
    const esito = await store.aggiungiDocumentoConFile(dati(), PDF, opzioni());
    assert.equal(esito.ok, true, esito.errore);

    const d = await store.documentoPerId(esito.id);
    assert.equal(d.stato, "pubblicato");
    assert.equal(d.anno, null);
    assert.equal(d.formato, "PDF");
    assert.equal(d.aggiornamento, "set 2026");
    assert.match(d.peso, /KB/);
    assert.ok(d.file && fileSuDisco().includes(d.file), "il file è sul disco");
    assert.ok(await store.filePubblico(d.file), "e si scarica dal sito");
  });

  it("senza «pubblica» resta in bozza, e il file non esce", async () => {
    const esito = await store.aggiungiDocumentoConFile(dati(), DOCX, opzioni({ pubblica: false }));
    const d = await store.documentoPerId(esito.id);
    assert.equal(d.stato, "bozza");
    assert.equal(d.formato, "DOCX");
    assert.equal(await store.filePubblico(d.file), null);
  });

  it("un file che non è PDF né DOCX non crea niente e non lascia niente sul disco", async () => {
    const prima = fileSuDisco();
    const esito = await store.aggiungiDocumentoConFile(dati(), FINTO, opzioni());
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /PDF/);
    assert.equal(conteggio(), 0);
    assert.deepEqual(fileSuDisco(), prima);
  });

  it("un doppione non crea niente, e il file già scritto se ne va", async () => {
    await store.aggiungiDocumentoConFile(dati(), PDF, opzioni({ adesso: 11_000 }));
    const prima = fileSuDisco();
    const esito = await store.aggiungiDocumentoConFile(dati(), PDF, opzioni({ adesso: 12_000 }));
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /Esiste già/);
    assert.equal(conteggio(), 1);
    assert.deepEqual(fileSuDisco(), prima, "nessun file orfano");
  });

  it("stesso titolo in due cartelle nello stesso millisecondo: due file, nessuno sovrascritto", async () => {
    const a = await store.aggiungiDocumentoConFile(dati({ categoria: "iscrizioni" }), PDF, opzioni());
    const b = await store.aggiungiDocumentoConFile(dati({ categoria: "campi" }), DOCX, opzioni());
    const fa = (await store.documentoPerId(a.id)).file;
    const fb = (await store.documentoPerId(b.id)).file;
    assert.notEqual(fa, fb);
    assert.ok(fileSuDisco().includes(fa) && fileSuDisco().includes(fb));
    assert.equal((await store.documentoPerId(a.id)).formato, "PDF", "il primo è ancora il PDF");
  });

  it("una circolare si carica nella sua unità, e nessun modulo di gruppo fra le circolari", async () => {
    const circ = await store.aggiungiDocumentoConFile(
      dati({ categoria: "circolari", unita: "u1", anno: "2026-2027", titolo: "Lista materiale" }),
      PDF,
      opzioni(),
    );
    assert.equal(circ.ok, true, circ.errore);
    assert.equal((await store.documentoPerId(circ.id)).unita, "u1");

    const sbagliato = await store.aggiungiDocumentoConFile(
      dati({ categoria: "circolari" }),
      PDF,
      opzioni({ adesso: 13_000 }),
    );
    assert.equal(sbagliato.ok, false);
    assert.match(sbagliato.errore, /circolare è di un’unità/);
  });
});
