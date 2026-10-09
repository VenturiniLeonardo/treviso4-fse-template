import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Gli iscritti — fase 10.
 *
 * Le prove che contano non sono «si salva e si rilegge». Sono:
 *
 *  - che il consenso **riparta da zero** ogni anno, perché quello dell'anno
 *    scorso non vale per quest'anno;
 *  - che un consenso non possa esistere senza la data in cui è stato firmato;
 *  - che la cancellazione di un ragazzo porti via tutto e non lasci una riga
 *    svuotata;
 *  - che nessuno finisca iscritto due volte allo stesso anno.
 */

let cartella;
let percorso;
let raw;
let store, riferimenti;
let chiudiPerTest;

const ANNO = "2026-2027";
const PRIMA = "2025-2026";

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-iscritti-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/iscritti-store");
  riferimenti = await import("@/lib/db/riferimenti");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
  riferimenti.assicuraRiferimenti();
});

beforeEach(() => {
  raw.prepare("delete from iscrizioni").run();
  raw.prepare("delete from ragazzi").run();
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  rmSync(cartella, { recursive: true, force: true });
});

const iscrivi = (extra = {}) =>
  store.registraIscrizione({
    nome: "Giulia",
    cognome: "Rossi",
    natoIl: "2016-04-11",
    unita: "u1",
    anno: ANNO,
    ...extra,
  });

// =========================================================================

describe("iscrivere", () => {
  it("crea il ragazzo e l'iscrizione, senza consenso e con la quota da saldare", () => {
    const id = iscrivi();
    const i = store.iscrittoPerId(id);
    assert.equal(i.nome, "Giulia");
    assert.equal(i.cognome, "Rossi");
    assert.equal(i.unita, "u1");
    assert.equal(i.anno, ANNO);
    assert.equal(i.quota, "da_saldare");
    assert.equal(i.consenso, false, "il consenso non entra insieme all'anagrafica");
    assert.equal(i.consensoData, null);
  });

  it("calcola l'età dalla data di nascita", () => {
    const id = iscrivi({ natoIl: "2016-04-11" });
    // `etaA` è pura: si prova con una data fissa, se no la prova invecchia
    assert.equal(store.etaA("2016-04-11", new Date("2026-04-10T12:00:00Z")), 9);
    assert.equal(store.etaA("2016-04-11", new Date("2026-04-11T12:00:00Z")), 10, "il compleanno");
    assert.equal(store.etaA(null), null, "senza data di nascita non si inventa un'età");
    assert.ok(store.iscrittoPerId(id).eta >= 9);
  });

  it("senza nome o cognome non si crea niente", () => {
    assert.throws(
      () => store.registraIscrizione({ cognome: "Rossi", unita: "u1", anno: ANNO }),
      /nome e cognome/,
    );
    assert.equal(raw.prepare("select count(*) n from ragazzi").get().n, 0);
  });

  it("un'unità o un anno che non esistono lo dicono, invece di «errore del server»", () => {
    assert.throws(() => iscrivi({ unita: "castorini" }), /castorini/);
    assert.throws(() => iscrivi({ anno: "2099-2100" }), /2099-2100/);
  });

  it("nessuno è iscritto due volte allo stesso anno", () => {
    const primo = iscrivi();
    const ragazzoId = store.iscrittoPerId(primo).ragazzoId;
    assert.throws(() => store.registraIscrizione({ ragazzoId, unita: "u1", anno: ANNO }));
  });

  it("ma lo stesso ragazzo si iscrive all'anno dopo, anche in un'altra unità", () => {
    const primo = store.registraIscrizione({
      nome: "Marco",
      cognome: "Bianchi",
      unita: "u1",
      anno: PRIMA,
    });
    const ragazzoId = store.iscrittoPerId(primo).ragazzoId;

    const secondo = store.registraIscrizione({ ragazzoId, unita: "u3", anno: ANNO });
    assert.equal(store.iscrittoPerId(secondo).ragazzoId, ragazzoId, "è lo stesso ragazzo");
    assert.equal(store.iscrittoPerId(secondo).unita, "u3", "il passaggio di unità");
    assert.equal(raw.prepare("select count(*) n from ragazzi").get().n, 1, "e non un doppione");
  });

  it("un ragazzo che non è in anagrafica lo dice", () => {
    assert.throws(
      () => store.registraIscrizione({ ragazzoId: 9999, unita: "u1", anno: ANNO }),
      /anagrafica/,
    );
  });
});

describe("da quale unità viene un ragazzo (AUTHZ-01)", () => {
  /*
   * Dall'audit di sicurezza: `nuovoIscritto` accettava l'id di un ragazzo già
   * in anagrafica e controllava solo l'unità di destinazione. Ora l'azione
   * passa dal cancello anche con l'unità da cui il ragazzo viene, e quella la
   * dice questa funzione, dall'archivio.
   */
  it("è l'unità dell'iscrizione più recente", () => {
    const primo = store.registraIscrizione({ nome: "Marco", cognome: "Bianchi", unita: "u1", anno: PRIMA });
    const ragazzoId = store.iscrittoPerId(primo).ragazzoId;
    assert.deepEqual(store.provenienzaDelRagazzo(ragazzoId), { unita: "u1" });

    store.registraIscrizione({ ragazzoId, unita: "u3", anno: ANNO });
    assert.deepEqual(store.provenienzaDelRagazzo(ragazzoId), { unita: "u3" });
  });

  it("un ragazzo senza iscrizioni non è di nessuna unità", () => {
    const id = iscrivi();
    const ragazzoId = store.iscrittoPerId(id).ragazzoId;
    store.togliIscrizione(id);
    assert.deepEqual(store.provenienzaDelRagazzo(ragazzoId), { unita: null });
  });

  it("un ragazzo che non c'è è null", () => {
    assert.equal(store.provenienzaDelRagazzo(9999), null);
  });
});

describe("gli omonimi", () => {
  it("due omonimi restano due: nessun accoppiamento automatico", () => {
    /*
     * È il caso per cui l'accoppiamento automatico non esiste. Un doppione lo
     * si vede e si corregge; due bambini fusi in uno vorrebbero dire applicare
     * il consenso dell'uno alle fotografie dell'altro, e non se ne accorgerebbe
     * nessuno.
     */
    store.registraIscrizione({
      nome: "Luca", cognome: "Rossi", natoIl: "2015-01-01", unita: "u1", anno: ANNO,
    });
    store.registraIscrizione({
      nome: "Luca", cognome: "Rossi", natoIl: "2017-06-30", unita: "u2", anno: ANNO,
    });
    const trovati = raw.prepare("select nato_il from ragazzi where cognome = 'Rossi' and nome = 'Luca'").all();
    assert.equal(trovati.length, 2);
    assert.notEqual(trovati[0].nato_il, trovati[1].nato_il, "si distinguono dalla data di nascita");
  });
});

describe("il consenso alle immagini", () => {
  it("si registra con la data, e senza data non si registra", () => {
    const id = iscrivi();
    assert.throws(() => store.registraConsenso(id, true), /data/);
    assert.throws(() => store.registraConsenso(id, true, "11 aprile"), /data/);

    assert.equal(store.registraConsenso(id, true, "2026-09-15"), true);
    const i = store.iscrittoPerId(id);
    assert.equal(i.consenso, true);
    assert.equal(i.consensoData, "2026-09-15");
  });

  it("revocandolo la data sparisce: una data senza consenso farebbe credere il contrario", () => {
    const id = iscrivi();
    store.registraConsenso(id, true, "2026-09-15");
    assert.equal(store.registraConsenso(id, false), true);

    const i = store.iscrittoPerId(id);
    assert.equal(i.consenso, false);
    assert.equal(i.consensoData, null);
  });

  it("il database rifiuta comunque un consenso senza data, anche scritto a mano", () => {
    const id = iscrivi();
    assert.throws(() =>
      raw.prepare("update iscrizioni set consenso_immagini = 1 where id = ?").run(id),
    );
  });

  it("**il consenso riparte da zero ogni anno**", () => {
    const primo = store.registraIscrizione({
      nome: "Marco", cognome: "Bianchi", unita: "u1", anno: PRIMA,
    });
    store.registraConsenso(primo, true, "2025-09-20");

    const ragazzoId = store.iscrittoPerId(primo).ragazzoId;
    const secondo = store.registraIscrizione({ ragazzoId, unita: "u1", anno: ANNO });

    assert.equal(store.iscrittoPerId(primo).consenso, true, "l'anno scorso ce l'ha");
    assert.equal(
      store.iscrittoPerId(secondo).consenso,
      false,
      "quest'anno no: si richiede ogni anno",
    );
  });

  it("l'elenco di chi manca porta i nomi, non un numero", () => {
    const a = iscrivi({ nome: "Giulia", cognome: "Rossi" });
    iscrivi({ nome: "Marco", cognome: "Bianchi" });
    store.registraConsenso(a, true, "2026-09-15");

    const mancano = store.senzaConsenso(ANNO, "u1");
    assert.deepEqual(mancano.map((i) => `${i.cognome} ${i.nome}`), ["Bianchi Marco"]);
  });

  it("senza unità si guarda tutto il gruppo, come fa il trigger di §5", () => {
    iscrivi({ nome: "Giulia", cognome: "Rossi", unita: "u1" });
    iscrivi({ nome: "Anna", cognome: "Verdi", unita: "u2" });
    assert.equal(store.senzaConsenso(ANNO).length, 2);
    assert.equal(store.senzaConsenso(ANNO, "u1").length, 1);
  });
});

describe("lo stato dei consensi per chi approva", () => {
  /**
   * La distinzione che vale tutta la fase 10.2.
   *
   * Un elenco iscritti vuoto e un elenco tutto in regola producono lo stesso
   * numero — zero consensi mancanti — e in una schermata si vedono uguali.
   * Trattarli allo stesso modo farebbe apparire come controllato un album che
   * nessuno ha controllato, ed è esattamente il modo in cui una serratura si
   * lascia aperta credendo di averla chiusa.
   */
  it("nessun iscritto registrato è `null`, non «tutti a posto»", () => {
    assert.equal(store.statoConsensi(ANNO, "u1"), null);
    assert.equal(store.statoConsensi(ANNO), null);
  });

  it("tutti in regola è zero mancanti, che è un'altra cosa da `null`", () => {
    const a = iscrivi({ nome: "Giulia", cognome: "Rossi" });
    store.registraConsenso(a, true, "2026-09-15");

    const stato = store.statoConsensi(ANNO, "u1");
    assert.notEqual(stato, null, "qui il sito sa, e sa che va bene");
    assert.equal(stato.totale, 0);
    assert.deepEqual(stato.nomi, []);
  });

  it("chi manca si chiama per nome, cognome davanti", () => {
    const a = iscrivi({ nome: "Giulia", cognome: "Rossi" });
    iscrivi({ nome: "Anna", cognome: "Verdi" });
    iscrivi({ nome: "Marco", cognome: "Bianchi" });
    store.registraConsenso(a, true, "2026-09-15");

    const stato = store.statoConsensi(ANNO, "u1");
    assert.equal(stato.totale, 2);
    // in ordine di cognome: è quello con cui si cerca un nome in un elenco
    assert.deepEqual(stato.nomi, ["Bianchi Marco", "Verdi Anna"]);
  });

  it("un album di gruppo guarda tutte le unità", () => {
    iscrivi({ nome: "Giulia", cognome: "Rossi", unita: "u1" });
    iscrivi({ nome: "Anna", cognome: "Verdi", unita: "u2" });

    assert.equal(store.statoConsensi(ANNO).totale, 2, "senza unità: tutto il gruppo");
    assert.equal(store.statoConsensi(ANNO, "u1").totale, 1);
    // e un'unità che non ha nessuno resta `null`, anche se le altre sì
    assert.equal(store.statoConsensi(ANNO, "u5"), null);
  });

  it("un anno diverso non porta dentro gli iscritti dell'anno scorso", () => {
    iscrivi({ nome: "Giulia", cognome: "Rossi" });
    assert.equal(store.statoConsensi("2025-2026", "u1"), null);
  });

  it("revocare un consenso rimette il nome nell'elenco", () => {
    const a = iscrivi({ nome: "Giulia", cognome: "Rossi" });
    store.registraConsenso(a, true, "2026-09-15");
    assert.equal(store.statoConsensi(ANNO, "u1").totale, 0);

    store.registraConsenso(a, false, null);
    assert.deepEqual(store.statoConsensi(ANNO, "u1").nomi, ["Rossi Giulia"]);
  });
});

describe("quota e squadra", () => {
  it("si cambiano, e una quota inventata si rifiuta", () => {
    const id = iscrivi();
    assert.equal(store.cambiaQuota(id, "saldata"), true);
    assert.equal(store.iscrittoPerId(id).quota, "saldata");
    assert.equal(store.cambiaQuota(id, "ridotta"), true);
    assert.throws(() => store.cambiaQuota(id, "esente"), /non valida/);
  });

  it("«esente» non è uno stato: lo dice lo schema, non solo il codice", () => {
    const id = iscrivi();
    assert.throws(() => raw.prepare("update iscrizioni set quota='esente' where id=?").run(id));
  });

  it("le tre etichette coprono i tre stati", () => {
    for (const q of store.QUOTE) assert.ok(store.ETICHETTA_QUOTA[q], q);
    assert.equal(store.ETICHETTA_QUOTA.da_saldare, "da saldare");
  });

  it("la squadra si scrive e si cancella", () => {
    const id = iscrivi();
    assert.equal(store.cambiaGruppoInterno(id, " Rossi "), true);
    assert.equal(store.iscrittoPerId(id).gruppoInterno, "Rossi");
    store.cambiaGruppoInterno(id, "");
    assert.equal(store.iscrittoPerId(id).gruppoInterno, "");
  });
});

describe("l'elenco", () => {
  it("è in ordine di cognome: è come si cerca un nome in un elenco stampato", () => {
    iscrivi({ nome: "Anna", cognome: "Verdi" });
    iscrivi({ nome: "Giulia", cognome: "Bianchi" });
    iscrivi({ nome: "Marco", cognome: "Rossi" });
    assert.deepEqual(
      store.elencoIscritti().map((i) => i.cognome),
      ["Bianchi", "Rossi", "Verdi"],
    );
  });

  it("si filtra per unità e per anno", () => {
    iscrivi({ nome: "A", cognome: "Uno", unita: "u1" });
    iscrivi({ nome: "B", cognome: "Due", unita: "u2" });
    iscrivi({ nome: "C", cognome: "Tre", unita: "u1", anno: PRIMA });

    assert.equal(store.elencoIscritti({ unita: "u1" }).length, 2);
    assert.equal(store.elencoIscritti({ unita: "u1", anno: ANNO }).length, 1);
    assert.equal(store.elencoIscritti({ anno: PRIMA }).length, 1);
  });

  it("i quattro numeri in cima tornano", () => {
    const a = iscrivi({ nome: "A", cognome: "Uno" });
    iscrivi({ nome: "B", cognome: "Due" });
    store.registraConsenso(a, true, "2026-09-15");
    store.cambiaQuota(a, "saldata");

    assert.deepEqual(store.conteggi({ unita: "u1", anno: ANNO }), {
      iscritti: 2,
      conConsenso: 1,
      senzaConsenso: 1,
      quoteDaSaldare: 1,
    });
  });
});

describe("cancellare", () => {
  it("togliere un'iscrizione lascia il ragazzo in anagrafica", () => {
    const id = iscrivi();
    assert.equal(store.togliIscrizione(id), true);
    assert.equal(store.iscrittoPerId(id), null);
    assert.equal(raw.prepare("select count(*) n from ragazzi").get().n, 1);
  });

  it("cancellare un ragazzo porta via tutti i suoi anni — è il CASCADE", () => {
    const primo = store.registraIscrizione({
      nome: "Marco", cognome: "Bianchi", unita: "u1", anno: PRIMA,
    });
    const ragazzoId = store.iscrittoPerId(primo).ragazzoId;
    store.registraIscrizione({ ragazzoId, unita: "u1", anno: ANNO });

    const esito = store.cancellaRagazzo(ragazzoId);
    assert.deepEqual(esito, { cancellato: true, iscrizioni: 2 });
    assert.equal(raw.prepare("select count(*) n from iscrizioni").get().n, 0);
  });

  it("cancella **davvero**: non resta nessuna riga svuotata", () => {
    const id = iscrivi();
    const ragazzoId = store.iscrittoPerId(id).ragazzoId;
    store.registraConsenso(id, true, "2026-09-15");
    store.cancellaRagazzo(ragazzoId);

    const tutto = JSON.stringify([
      ...raw.prepare("select * from ragazzi").all(),
      ...raw.prepare("select * from iscrizioni").all(),
    ]);
    assert.equal(tutto.includes("Giulia"), false);
    assert.equal(tutto.includes("2016-04-11"), false);
  });

  it("il nome sparisce anche dal registro, e le voci restano (PRIV-01)", () => {
    const id = iscrivi();
    const ragazzoId = store.iscrittoPerId(id).ragazzoId;
    const ins = raw.prepare(
      "INSERT INTO registro (quando, utente, nome, ruolo, tipo, operazione, origine, esito) VALUES (?,?,?,?,?,?,?,?)",
    );
    ins.run("2026-09-15T10:00:00Z", "cu", "Referente", "referente", "iscritti", "Iscritto Rossi Giulia in u1 per l’anno 2026-2027", "iscritti", "ok");
    ins.run("2026-09-15T10:01:00Z", "cu", "Referente", "referente", "consenso", "Consenso immagini registrato per Rossi Giulia (firmato il 2026-09-15)", "iscritti", "ok");
    ins.run("2026-09-15T10:02:00Z", "cu", "Referente", "referente", "contenuto", "Creato l’album «Rossi»", "album", "ok");

    store.cancellaRagazzo(ragazzoId);

    const voci = raw.prepare("select operazione from registro order by id").all().map((r) => r.operazione);
    assert.equal(voci.length, 3, "le voci restano: dicono che cosa è successo");
    assert.equal(voci.some((v) => v.includes("Rossi Giulia")), false);
    assert.match(voci[0], /\[persona cancellata\]/);
    assert.equal(voci[2], "Creato l’album «Rossi»", "le voci che non la nominano non si toccano");
    raw.prepare("delete from registro").run();
  });

  it("su un ragazzo che non c'è restituisce falso, senza sollevare", () => {
    assert.deepEqual(store.cancellaRagazzo(9999), { cancellato: false, iscrizioni: 0 });
    assert.equal(store.togliIscrizione(9999), false);
  });
});
