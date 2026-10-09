import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Le scritture sui contenuti d'unità — fase 14.4.
 *
 * Il «metà e metà» è la cosa che questo file protegge: i testi liberi vanno
 * online appena salvati, i recapiti e i nomi di persone aspettano il referente
 * gruppo. Sbagliarlo non produce un errore — produce **un recapito online che
 * nessuno ha guardato**, che è il genere di difetto che si scopre da fuori.
 *
 * Si provano lo store e la funzione pura che divide i campi. Le Server Action
 * non si possono chiamare fuori da Next (`next/headers`), ed è la stessa
 * ragione per cui `autorizzazioni.test.mjs` prova `decidi()` e non `contesto()`.
 */

let cartella;
let store;
let serveApprovazione, CAMPI_LIBERI, CAMPI_DA_APPROVARE, CAMPI_UNITA;
let unitaPerChiave;
let chiudiPerTest;
let raw;

const CHIAVE = "u1";
const ALTRA = "u4";

const idDi = (chiave) => raw.prepare("SELECT id FROM unita WHERE chiave = ?").get(chiave).id;

const proposteDi = (chiave) =>
  raw
    .prepare(
      "SELECT campo, valore FROM unita_proposte WHERE unita_id = ? ORDER BY campo",
    )
    .all(idDi(chiave));

const colonna = (chiave, nome) =>
  raw.prepare(`SELECT ${nome} AS v FROM unita WHERE chiave = ?`).get(chiave).v;

const personeDi = (chiave, tipo, stato) =>
  raw
    .prepare(
      `SELECT nome, ruolo, periodo, nota, ordine FROM unita_persone
       WHERE unita_id = ? AND tipo = ? AND stato = ? ORDER BY ordine`,
    )
    .all(idDi(chiave), tipo, stato);

function azzera() {
  raw.prepare("DELETE FROM unita_proposte").run();
  raw.prepare("DELETE FROM unita_persone").run();
  raw.prepare("DELETE FROM pagine_testi WHERE chiave LIKE 'unita.%'").run();
  raw
    .prepare(
      `UPDATE unita SET occhiello=NULL, motto=NULL, ritrovo=NULL, fondazione=NULL,
       referente=NULL, ruolo_referente=NULL, sigla=NULL, iscritti=NULL,
       storia_titolo=NULL, nota_storico=NULL, email=NULL, telefono=NULL`,
    )
    .run();
  chiudiPerTest?.();
}

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-proposte-"));
  process.env.SITO_DB = join(cartella, "prova.db");

  const iniziale = new Database(process.env.SITO_DB);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  ({ unitaPerChiave } = await import("@/lib/data"));
  ({ serveApprovazione, CAMPI_LIBERI, CAMPI_DA_APPROVARE, CAMPI_UNITA } = await import(
    "@/lib/unita-contenuti"
  ));
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  store = await import("@/lib/unita-store");

  const { assicuraRiferimenti } = await import("@/lib/db/riferimenti");
  assicuraRiferimenti();
  raw = new Database(process.env.SITO_DB);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

beforeEach(() => azzera());

describe("il catalogo è la fonte unica della divisione", () => {
  it("ogni campo sta in uno dei due gruppi, e in uno solo", () => {
    const tutti = CAMPI_UNITA.map((c) => c.chiave).sort();
    const somma = [...CAMPI_LIBERI, ...CAMPI_DA_APPROVARE].sort();
    assert.deepEqual(somma, tutti, "nessun campo dimenticato e nessuno contato due volte");
  });

  it("i recapiti e i nomi di persone sono quelli che aspettano", () => {
    // La decisione del 31 agosto, scritta come asserzione: se qualcuno la
    // cambia nel catalogo senza chiederlo, questa riga lo dice.
    assert.deepEqual([...CAMPI_DA_APPROVARE].sort(), [
      "referente",
      "ruoloReferente",
      "telefono",
    ]);
  });

  it("la storia e il ritrovo vanno online subito", () => {
    assert.equal(serveApprovazione("storia", "limitato"), false);
    assert.equal(serveApprovazione("ritrovo", "limitato"), false);
    assert.equal(serveApprovazione("motto", "limitato"), false);
  });

  it("un recapito, per un referente di unità, aspetta", () => {
    assert.equal(serveApprovazione("telefono", "limitato"), true);
    assert.equal(serveApprovazione("referente", "limitato"), true);
  });

  it("per chi ha «completo» non aspetta niente", () => {
    // Il gestore pubblica: la coda serve a far guardare una modifica a
    // qualcuno che non è chi l'ha fatta, e qui quel qualcuno è lui.
    for (const campo of CAMPI_DA_APPROVARE) {
      assert.equal(serveApprovazione(campo, "completo"), false, campo);
    }
  });

  it("un campo inventato non è approvabile: non esiste", () => {
    assert.equal(serveApprovazione("passwordHash", "limitato"), false);
    assert.equal(serveApprovazione("passwordHash", "completo"), false);
  });
});

describe("i testi liberi si scrivono e sono online", () => {
  it("una colonna si scrive, e il resto non si muove", async () => {
    await store.salvaCampiUnita(CHIAVE, { motto: "Insieme si cresce" }, "ref1");
    chiudiPerTest();

    assert.equal(colonna(CHIAVE, "motto"), "Insieme si cresce");
    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.motto, "Insieme si cresce");
    assert.equal(u.ritrovo, unitaPerChiave(CHIAVE).ritrovo, "il ritrovo non è cambiato");
  });

  it("la storia finisce in pagine_testi, non in una colonna", async () => {
    await store.salvaCampiUnita(CHIAVE, { storia: "Primo.\n\nSecondo." }, "ref1");
    chiudiPerTest();

    const riga = raw
      .prepare("SELECT valore FROM pagine_testi WHERE chiave = ?")
      .get(`unita.${CHIAVE}.storia`);
    assert.ok(riga, "la riga deve esserci");
    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(u.storia, ["Primo.", "Secondo."]);
  });

  it("svuotare un campo mette NULL, non la stringa vuota", async () => {
    await store.salvaCampiUnita(CHIAVE, { motto: "Qualcosa" }, "ref1");
    chiudiPerTest();
    await store.salvaCampiUnita(CHIAVE, { motto: "   " }, "ref1");
    chiudiPerTest();

    assert.equal(colonna(CHIAVE, "motto"), null);
    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.motto, unitaPerChiave(CHIAVE).motto, "torna al predefinito del codice");
  });

  it("svuotare la storia cancella la riga invece di scrivere il vuoto", async () => {
    await store.salvaCampiUnita(CHIAVE, { storia: "Qualcosa." }, "ref1");
    chiudiPerTest();
    await store.salvaCampiUnita(CHIAVE, { storia: "" }, "ref1");
    chiudiPerTest();

    const riga = raw
      .prepare("SELECT valore FROM pagine_testi WHERE chiave = ?")
      .get(`unita.${CHIAVE}.storia`);
    assert.equal(riga, undefined, "una riga vuota vorrebbe dire «la storia è vuota»");
    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(u.storia, unitaPerChiave(CHIAVE).storia);
  });

  it("un nome di campo che non è nel catalogo non scrive niente", async () => {
    // È la mass assignment di §15: la mappa `COLONNA_DI` è anche il filtro, e
    // non c'è un secondo elenco di campi ammessi da tenere allineato.
    await store.salvaCampiUnita(CHIAVE, { slug: "rubato", nome: "Rubato" }, "ref1");
    chiudiPerTest();

    assert.equal(colonna(CHIAVE, "slug"), unitaPerChiave(CHIAVE).slug);
    assert.equal(colonna(CHIAVE, "nome"), unitaPerChiave(CHIAVE).nome);
  });
});

describe("i campi delicati aspettano, e quello in linea non si muove", () => {
  it("una proposta si scrive in unita_proposte e non nella colonna", async () => {
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 111 0001" }, "ref1");
    chiudiPerTest();

    assert.deepEqual(proposteDi(CHIAVE), [{ campo: "telefono", valore: "340 111 0001" }]);
    assert.equal(colonna(CHIAVE, "telefono"), null, "la colonna non si tocca");

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.telefono, unitaPerChiave(CHIAVE).telefono, "il sito mostra ancora la vecchia");
  });

  it("la seconda proposta sullo stesso campo sostituisce la prima", async () => {
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 111 0002" }, "ref1");
    chiudiPerTest();
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 111 0003" }, "ref1");
    chiudiPerTest();

    assert.deepEqual(proposteDi(CHIAVE), [{ campo: "telefono", valore: "340 111 0003" }]);
  });

  it("riproporre il valore che è già online annulla la proposta", async () => {
    const vera = unitaPerChiave(CHIAVE).telefono;
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 111 0004" }, "ref1");
    chiudiPerTest();
    assert.equal(proposteDi(CHIAVE).length, 1);

    await store.proponiCampiUnita(CHIAVE, { telefono: vera }, "ref1");
    chiudiPerTest();
    assert.deepEqual(
      proposteDi(CHIAVE),
      [],
      "chi rimette il valore di prima sta ritirando la richiesta, non chiedendo di nuovo",
    );
  });

  it("la proposta porta accanto il valore in linea, per il confronto in coda", async () => {
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 000 0000" }, "ref1");
    chiudiPerTest();

    const [p] = await store.leggiProposte();
    assert.equal(p.unita, CHIAVE);
    assert.equal(p.campo, "telefono");
    assert.equal(p.proposto, "340 000 0000");
    assert.equal(p.attuale, unitaPerChiave(CHIAVE).telefono, "«prima» è quello che dice il sito");
  });

  it("approvare travasa il valore e toglie la riga dalla coda", async () => {
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 111 0005" }, "ref1");
    chiudiPerTest();

    assert.equal(await store.approvaProposta(CHIAVE, "telefono", "gestori"), true);
    chiudiPerTest();

    assert.equal(colonna(CHIAVE, "telefono"), "340 111 0005");
    assert.deepEqual(proposteDi(CHIAVE), []);
    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.telefono, "340 111 0005", "adesso il sito la mostra");
  });

  it("rimandare toglie la riga e lascia la colonna dov'era", async () => {
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 111 0006" }, "ref1");
    chiudiPerTest();

    assert.equal(await store.rifiutaProposta(CHIAVE, "telefono"), true);
    chiudiPerTest();

    assert.equal(colonna(CHIAVE, "telefono"), null);
    assert.deepEqual(proposteDi(CHIAVE), []);
  });

  it("approvare due volte la stessa proposta dà «non c'è più», non un errore", async () => {
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 111 0007" }, "ref1");
    chiudiPerTest();
    assert.equal(await store.approvaProposta(CHIAVE, "telefono", "gestori"), true);
    chiudiPerTest();
    assert.equal(
      await store.approvaProposta(CHIAVE, "telefono", "gestori"),
      false,
      "due gestori che premono insieme: il secondo non deve vedere un guasto",
    );
  });

  it("una proposta su un campo non del catalogo non si approva", async () => {
    raw
      .prepare("INSERT INTO unita_proposte (unita_id, campo, valore) VALUES (?,?,?)")
      .run(idDi(CHIAVE), "slug", "rubato");
    chiudiPerTest();

    assert.equal(await store.approvaProposta(CHIAVE, "slug", "gestori"), false);
    assert.equal(colonna(CHIAVE, "slug"), unitaPerChiave(CHIAVE).slug);
  });

  it("le proposte di un'unità non toccano un'altra", async () => {
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 111 0008" }, "ref1");
    chiudiPerTest();

    assert.deepEqual(proposteDi(ALTRA), []);
    const g = await store.unitaSalvataPerChiave(ALTRA);
    assert.equal(g.telefono, unitaPerChiave(ALTRA).telefono);
  });
});

/**
 * Ogni campo colonna, uno per uno: salvato e approvato (QA BUG-012).
 *
 * `.set()` di Drizzle vuole le chiavi TypeScript (`storiaTitolo`) e scarta in
 * silenzio i nomi SQL (`storia_titolo`): i campi con lo stesso nome nei due
 * sistemi, come `motto`, non lo mostravano. Per questo il giro si fa su tutti.
 */
describe("ogni colonna del catalogo arriva davvero nel database", () => {
  const COLONNE = {
    occhiello: "occhiello",
    motto: "motto",
    ritrovo: "ritrovo",
    fondazione: "fondazione",
    storiaTitolo: "storia_titolo",
    notaStorico: "nota_storico",
    referente: "referente",
    ruoloReferente: "ruolo_referente",
    telefono: "telefono",
  };

  for (const [campo, sql] of Object.entries(COLONNE)) {
    it(`${campo}: il salvataggio diretto scrive ${sql}`, async () => {
      await store.salvaCampiUnita(CHIAVE, { [campo]: `QA-${campo}` }, "ref1");
      chiudiPerTest();
      assert.equal(colonna(CHIAVE, sql), `QA-${campo}`);
    });

    it(`${campo}: l'approvazione scrive ${sql} prima di togliere la proposta`, async () => {
      await store.proponiCampiUnita(CHIAVE, { [campo]: `QA-prop-${campo}` }, "ref1");
      chiudiPerTest();
      assert.equal(await store.approvaProposta(CHIAVE, campo, "gestori"), true);
      chiudiPerTest();
      assert.equal(colonna(CHIAVE, sql), `QA-prop-${campo}`);
      assert.deepEqual(proposteDi(CHIAVE), []);
    });
  }
});

describe("l'anteprima: come sarebbe se tutto venisse approvato", () => {
  const SLUG = () => unitaPerChiave(CHIAVE).slug;

  it("senza niente in attesa è identica alla pagina pubblica", async () => {
    const e = await store.unitaInAnteprima(SLUG());
    const vera = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(e.unita, vera);
    assert.deepEqual(e.campi, []);
    assert.deepEqual(e.elenchi, []);
  });

  it("un campo in attesa si vede in anteprima e NON in pagina", async () => {
    /*
     * È la coppia di asserzioni che dà senso alla funzione. Una sola delle due
     * non basta: se l'anteprima mostrasse il valore proposto **e** la pagina
     * pubblica lo mostrasse anche, l'anteprima sarebbe corretta e il sistema
     * rotto.
     */
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 111 0009" }, "ref1");
    chiudiPerTest();

    const e = await store.unitaInAnteprima(SLUG());
    assert.equal(e.unita.telefono, "340 111 0009", "in anteprima sì");

    const vera = await store.unitaSalvataPerChiave(CHIAVE);
    assert.notEqual(vera.telefono, "340 111 0009", "in pagina no");
  });

  it("l'anteprima elenca che cosa aspetta, con il prima e il dopo", async () => {
    // La fascia lo stampa: vedere una pagina senza sapere quali righe sono
    // ancora da approvare lascia a chi guarda il confronto a memoria.
    const prima = unitaPerChiave(CHIAVE).telefono;
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 999 8877" }, "ref1");
    chiudiPerTest();

    const e = await store.unitaInAnteprima(SLUG());
    assert.deepEqual(e.campi, [{ campo: "telefono", prima, dopo: "340 999 8877" }]);
  });

  it("un elenco di persone in revisione si vede in anteprima e non in pagina", async () => {
    const proposti = [
      { nome: "Nuovo Referente", ruolo: "Ref1", periodo: "dal 2027", nota: "" },
      { nome: "Nuovo Aiuto", ruolo: "Aiuto", periodo: "dal 2027", nota: "" },
    ];
    await store.pubblicaPersone(CHIAVE, "responsabile", [proposti[0]], "gestori");
    chiudiPerTest();
    await store.proponiPersone(CHIAVE, "responsabile", proposti, "ref1");
    chiudiPerTest();

    const e = await store.unitaInAnteprima(SLUG());
    assert.equal(e.unita.responsabili.length, 2, "in anteprima i due proposti");
    assert.deepEqual(e.elenchi, ["responsabile"]);

    const vera = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(vera.responsabili.length, 1, "in pagina resta quello approvato");
  });

  it("l'anteprima non scrive niente: è una lettura", async () => {
    await store.proponiCampiUnita(CHIAVE, { telefono: "340 111 0007" }, "ref1");
    chiudiPerTest();

    await store.unitaInAnteprima(SLUG());
    chiudiPerTest();

    // la proposta è ancora in coda, e la colonna è ancora nulla
    assert.equal(proposteDi(CHIAVE).length, 1, "la proposta non è stata consumata");
    assert.equal(colonna(CHIAVE, "telefono"), null, "e non è stata applicata");
  });

  it("un indirizzo che non esiste dà null, non un errore", async () => {
    assert.equal(await store.unitaInAnteprima("unita-inventata"), null);
  });

  it("l'anteprima di un'unità non mostra le proposte di un'altra", async () => {
    await store.proponiCampiUnita(ALTRA, { telefono: "340 111 0010" }, "referente-u4");
    chiudiPerTest();

    const e = await store.unitaInAnteprima(SLUG());
    assert.deepEqual(e.campi, [], "l'unità 1 non ha niente in attesa");
    assert.equal(e.unita.telefono, unitaPerChiave(CHIAVE).telefono);
  });
});

describe("le tuple di Unita e le righe del modulo", () => {
  /*
   * `Unita` porta tre array di tuple con **tre ordini diversi**, perché è così
   * che le tre tabelle della pagina pubblica li stampano. È il punto in cui si
   * sbaglia senza accorgersene: scambiare nome e periodo nello storico produce
   * una tabella plausibile e falsa, e nessun errore.
   */
  let righeDaUnita;

  before(async () => {
    ({ righeDaUnita } = await import("@/lib/unita-contenuti"));
  });

  it("i responsabili sono [nome, ruolo, periodo]", () => {
    const u = unitaPerChiave(CHIAVE);
    const righe = righeDaUnita(u, "responsabile");
    assert.equal(righe.length, u.responsabili.length);
    assert.deepEqual(righe[0], {
      nome: u.responsabili[0][0],
      ruolo: u.responsabili[0][1],
      periodo: u.responsabili[0][2],
      nota: "",
    });
  });

  it("lo staff è [nome, ruolo], senza periodo", () => {
    const u = unitaPerChiave(CHIAVE);
    const righe = righeDaUnita(u, "staff");
    assert.deepEqual(righe[0], {
      nome: u.staff[0][0],
      ruolo: u.staff[0][1],
      periodo: "",
      nota: "",
    });
  });

  it("lo storico è [anni, nome, nota]: il periodo viene PRIMA del nome", () => {
    const u = unitaPerChiave(CHIAVE);
    const righe = righeDaUnita(u, "storico");
    assert.deepEqual(righe[0], {
      nome: u.storico[0][1],
      ruolo: "",
      periodo: u.storico[0][0],
      nota: u.storico[0][2],
    });
    // e la prova che conta: il periodo non è un nome di persona
    assert.match(righe[0].periodo, /\d{4}|—/);
  });
});

describe("gli elenchi di persone si stagiano interi", () => {
  const tre = [
    { nome: "Mario Rossi", ruolo: "Ref1", periodo: "dal 2022", nota: "" },
    { nome: "Chiara Rossi", ruolo: "Vice", periodo: "dal 2024", nota: "" },
    { nome: "Anna Neri", ruolo: "Tesoriera", periodo: "dal 2025", nota: "" },
  ];

  it("il gestore pubblica direttamente", async () => {
    await store.pubblicaPersone(CHIAVE, "responsabile", tre, "gestori");
    chiudiPerTest();

    assert.equal(personeDi(CHIAVE, "responsabile", "pubblicato").length, 3);
    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.responsabili.length, 3);
  });

  it("il referente di unità propone, e in pagina resta l'elenco di prima", async () => {
    await store.pubblicaPersone(CHIAVE, "responsabile", [tre[0]], "gestori");
    chiudiPerTest();
    await store.proponiPersone(CHIAVE, "responsabile", tre, "ref1");
    chiudiPerTest();

    assert.equal(personeDi(CHIAVE, "responsabile", "pubblicato").length, 1);
    assert.equal(personeDi(CHIAVE, "responsabile", "in_revisione").length, 3);

    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.responsabili.length, 1, "il sito mostra ancora quello approvato");
  });

  it("approvare sostituisce l'elenco: nessun nome resta due volte", async () => {
    /*
     * È il difetto che l'ordine dentro la transazione previene: promuovere
     * prima e cancellare dopo lascerebbe, se qualcosa si fermasse in mezzo, due
     * elenchi pubblicati — e la pagina mostrerebbe ogni responsabile due volte.
     */
    await store.pubblicaPersone(CHIAVE, "responsabile", [tre[0]], "gestori");
    chiudiPerTest();
    await store.proponiPersone(CHIAVE, "responsabile", tre, "ref1");
    chiudiPerTest();

    assert.equal(await store.approvaPersone(CHIAVE, "responsabile", "gestori"), true);
    chiudiPerTest();

    const pubblicate = personeDi(CHIAVE, "responsabile", "pubblicato");
    assert.equal(pubblicate.length, 3);
    assert.equal(personeDi(CHIAVE, "responsabile", "in_revisione").length, 0);
    assert.deepEqual(
      pubblicate.map((p) => p.nome),
      tre.map((p) => p.nome),
    );
  });

  it("una cancellazione passa dalla coda come tutto il resto", async () => {
    // Non ha una riga in cui aspettare — la riga è quella che si vuole togliere
    // — ed è la ragione per cui si stagia l'elenco e non la singola persona.
    await store.pubblicaPersone(CHIAVE, "responsabile", tre, "gestori");
    chiudiPerTest();
    await store.proponiPersone(CHIAVE, "responsabile", [tre[0]], "ref1");
    chiudiPerTest();

    let u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.responsabili.length, 3, "finché non è approvata, sono ancora tre");

    await store.approvaPersone(CHIAVE, "responsabile", "gestori");
    chiudiPerTest();
    u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.responsabili.length, 1);
  });

  it("rimandare butta la proposta e lascia l'elenco online", async () => {
    await store.pubblicaPersone(CHIAVE, "responsabile", [tre[0]], "gestori");
    chiudiPerTest();
    await store.proponiPersone(CHIAVE, "responsabile", tre, "ref1");
    chiudiPerTest();

    assert.equal(await store.rifiutaPersone(CHIAVE, "responsabile"), true);
    chiudiPerTest();

    assert.equal(personeDi(CHIAVE, "responsabile", "in_revisione").length, 0);
    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.equal(u.responsabili.length, 1);
  });

  it("una riga senza nome si scarta invece di finire in pagina", async () => {
    await store.pubblicaPersone(
      CHIAVE,
      "responsabile",
      [tre[0], { nome: "  ", ruolo: "", periodo: "", nota: "" }],
      "gestori",
    );
    chiudiPerTest();
    assert.equal(personeDi(CHIAVE, "responsabile", "pubblicato").length, 1);
  });

  it("l'ordine in pagina è l'ordine in cui il modulo li manda", async () => {
    await store.pubblicaPersone(CHIAVE, "responsabile", [tre[2], tre[0]], "gestori");
    chiudiPerTest();
    const u = await store.unitaSalvataPerChiave(CHIAVE);
    assert.deepEqual(
      u.responsabili.map(([nome]) => nome),
      ["Anna Neri", "Mario Rossi"],
    );
  });

  it("i tre elenchi non si pestano i piedi", async () => {
    await store.pubblicaPersone(CHIAVE, "responsabile", [tre[0]], "gestori");
    chiudiPerTest();
    await store.pubblicaPersone(CHIAVE, "staff", [tre[1]], "gestori");
    chiudiPerTest();

    assert.equal(personeDi(CHIAVE, "responsabile", "pubblicato").length, 1);
    assert.equal(personeDi(CHIAVE, "staff", "pubblicato").length, 1);
  });

  it("il gestore che pubblica cancella una proposta pendente", async () => {
    // Altrimenti domani la coda riproporrebbe una versione più vecchia di
    // quella che è online.
    await store.proponiPersone(CHIAVE, "responsabile", tre, "ref1");
    chiudiPerTest();
    await store.pubblicaPersone(CHIAVE, "responsabile", [tre[0]], "gestori");
    chiudiPerTest();

    assert.equal(personeDi(CHIAVE, "responsabile", "in_revisione").length, 0);
    assert.equal((await store.personeInRevisione()).length, 0);
  });

  it("la coda dice quanti nomi ci sono adesso e quanti ne propone", async () => {
    await store.pubblicaPersone(CHIAVE, "responsabile", [tre[0]], "gestori");
    chiudiPerTest();
    await store.proponiPersone(CHIAVE, "responsabile", tre, "ref1");
    chiudiPerTest();

    const [v] = await store.personeInRevisione();
    assert.equal(v.unita, CHIAVE);
    assert.equal(v.tipo, "responsabile");
    assert.equal(v.quantiOra, 1);
    assert.equal(v.proposte.length, 3);
  });

  it("approvare quando non c'è niente in coda dà falso", async () => {
    assert.equal(await store.approvaPersone(CHIAVE, "responsabile", "gestori"), false);
  });
});
