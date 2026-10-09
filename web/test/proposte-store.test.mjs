import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Le proposte del social media manager: lo store, il lavoro notturno, e la
 * storia delle unità che fino al 3 ottobre 2026 non si poteva proporre.
 *
 * Le azioni non si provano qui — importano `next/headers` — ma le regole che
 * le reggono stanno negli store, e sono quelle che una svista romperebbe in
 * silenzio: una proposta che non sostituisce la precedente, una fotografia in
 * attesa che il lavoro notturno butta, una storia che il salvataggio scarta.
 */

let cartella;
let cartellaDati;
let raw;
let proposte, orfani, unita, coda, catalogo, chiudiPerTest;
/** Il cookie della sessione che `next/headers` finto restituisce: cambia da una prova all'altra. */
let tokenCorrente;

const VECCHIO = new Date("2024-01-01T00:00:00Z");

/** Un file in archivio, vecchio abbastanza da essere orfano se nessuno lo nomina. */
function file(nome) {
  const p = join(cartellaDati, nome);
  writeFileSync(p, Buffer.alloc(100, 7));
  utimesSync(p, VECCHIO, VECCHIO);
  return nome;
}

const DATI = JSON.stringify({ tipo: "image/jpeg", larghezza: 1600, altezza: 800 });

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-proposte-store-"));
  cartellaDati = join(cartella, "dati");
  mkdirSync(cartellaDati, { recursive: true });
  process.env.SITO_DB = join(cartella, "prova.db");
  process.env.SITO_DATI_DIR = cartellaDati;

  const iniziale = new Database(process.env.SITO_DB);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  // La coda applica i permessi della sessione corrente, letta da `cookies()`,
  // che fuori da una richiesta di Next non esiste: qui risponde il token scelto.
  mock.module("next/headers", {
    namedExports: { cookies: async () => ({ get: () => (tokenCorrente ? { value: tokenCorrente } : undefined) }) },
  });

  proposte = await import("@/lib/proposte-store");
  orfani = await import("@/lib/archivio-orfani");
  unita = await import("@/lib/unita-store");
  coda = await import("@/lib/coda");
  catalogo = await import("@/lib/unita-contenuti");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  const { assicuraRiferimenti } = await import("@/lib/db/riferimenti");
  assicuraRiferimenti();

  raw = new Database(process.env.SITO_DB);
  raw
    .prepare(
      "INSERT INTO utenti (utente, nome, iniziali, ruolo, stato) VALUES ('smm','Social','SM','social','attivo')",
    )
    .run();
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

beforeEach(() => {
  raw.prepare("DELETE FROM proposte").run();
  raw.prepare("DELETE FROM unita_proposte").run();
  raw.prepare("DELETE FROM pagine_testi").run();
});

describe("una proposta per chiave", () => {
  it("la seconda sostituisce la prima, e restituisce la fotografia da portare via", async () => {
    const prima = await proposte.proponi("immagine", "chi-siamo.gruppo", DATI, "immagine-a.jpg", "smm");
    assert.equal(prima, null, "la prima non sostituisce niente");

    const seconda = await proposte.proponi(
      "immagine",
      "chi-siamo.gruppo",
      DATI,
      "immagine-b.jpg",
      "smm",
    );
    assert.equal(seconda, "immagine-a.jpg");

    const tutte = await proposte.leggiProposteInAttesa();
    assert.equal(tutte.length, 1);
    assert.equal(tutte[0].file, "immagine-b.jpg");
    assert.equal(tutte[0].autore, "smm");
  });

  it("lo stesso campo di tipi diversi non si scontra", async () => {
    await proposte.proponi("pagina", "home.intro", "Ciao", null, "smm");
    await proposte.proponi("copertina", "home.intro", "{}", null, "smm");
    assert.equal((await proposte.leggiProposteInAttesa()).length, 2);
    assert.equal((await proposte.leggiProposteInAttesa("pagina")).length, 1);
  });

  it("chi la prende è l'unico che la decide", async () => {
    await proposte.proponi("pagina", "home.intro", "Ciao", null, "smm");
    const presa = await proposte.prendiProposta("pagina", "home.intro");
    assert.equal(presa?.valore, "Ciao");
    assert.equal(await proposte.prendiProposta("pagina", "home.intro"), null);
  });

  it("rimessa dopo un errore, torna com'era", async () => {
    await proposte.proponi("faq", "faq", "[]", null, "smm");
    const presa = await proposte.prendiProposta("faq", "faq");
    await proposte.rimettiProposta(presa);
    const [di_nuovo] = await proposte.leggiProposteInAttesa("faq");
    assert.equal(di_nuovo.valore, "[]");
    assert.equal(di_nuovo.autore, "smm");
  });

  it("il ripristino non sovrascrive una proposta arrivata dopo la presa (QA BUG-014)", async () => {
    await proposte.proponi("pagina", "home.intro", "PROPOSTA-VECCHIA", null, "smm");
    const presa = await proposte.prendiProposta("pagina", "home.intro");
    // fra la presa e il ripristino, chi propone scrive di nuovo
    await proposte.proponi("pagina", "home.intro", "PROPOSTA-NUOVA", null, "smm");
    assert.equal(await proposte.rimettiProposta(presa), false, "la presa è superata");
    const [rimasta] = await proposte.leggiProposteInAttesa("pagina");
    assert.equal(rimasta.valore, "PROPOSTA-NUOVA");
  });

  it("rimessa, riprende il suo posto in coda", async () => {
    await proposte.proponi("pagina", "home.intro", "Prima", null, "smm");
    const presa = await proposte.prendiProposta("pagina", "home.intro");
    assert.equal(await proposte.rimettiProposta(presa), true);
    const [di_nuovo] = await proposte.leggiProposteInAttesa("pagina");
    assert.equal(di_nuovo.quando, presa.quando);
  });

  it("un file solo con le fotografie: il database lo rifiuta su un testo", () => {
    assert.throws(
      () =>
        raw
          .prepare(
            "INSERT INTO proposte (tipo, chiave, valore, file) VALUES ('pagina','home.intro','x','immagine-x.jpg')",
          )
          .run(),
      /proposte_file_solo_immagini/,
    );
  });

  it("l'impronta cambia con il contenuto: si approva quello che è stato guardato", () => {
    const a = proposte.improntaProposta({ valore: "uno", file: null });
    assert.equal(a, proposte.improntaProposta({ valore: "uno", file: null }));
    assert.notEqual(a, proposte.improntaProposta({ valore: "due", file: null }));
    assert.notEqual(a, proposte.improntaProposta({ valore: "uno", file: "immagine-x.jpg" }));
  });
});

describe("il lavoro notturno e le fotografie in attesa", () => {
  it("una fotografia proposta, con le sue derivate, non è orfana", async () => {
    const nome = file("immagine-chi-siamo-gruppo-1.jpg");
    for (const lato of [1600, 800, 400]) file(`immagine-chi-siamo-gruppo-1-${lato}.webp`);
    const estranea = file("immagine-nessuno-2.jpg");

    await proposte.proponi("immagine", "chi-siamo.gruppo", DATI, nome, "smm");
    chiudiPerTest();

    const esito = orfani.confronta(0);
    const nomi = esito.orfani.map((o) => o.nome);
    assert.ok(!nomi.includes(nome), "la proposta non si butta");
    assert.ok(
      !nomi.some((n) => n.startsWith("immagine-chi-siamo-gruppo-1-")),
      "e nemmeno le sue derivate",
    );
    assert.ok(nomi.includes(estranea), "un file che nessuno nomina resta orfano");
  });
});

describe("la storia di un'unità si può proporre", () => {
  it("finisce in coda, e la scheda online non cambia", async () => {
    const quante = await unita.proponiCampiUnita(
      "u1",
      { storia: "Primo paragrafo.\r\n\r\nSecondo paragrafo." },
      "smm",
    );
    assert.equal(quante, 1);
    chiudiPerTest();

    const [p] = await unita.leggiProposte();
    assert.equal(p.campo, "storia");
    assert.ok(p.attuale.length > 0, "accanto, la storia che è online adesso");
    assert.equal(
      raw.prepare("SELECT count(*) n FROM pagine_testi WHERE chiave = 'unita.u1.storia'").get().n,
      0,
      "niente è stato scritto online",
    );
  });

  it("riproporre la storia di adesso, con altri a capo, non è una modifica", async () => {
    const adesso = (await unita.unitaSalvataPerChiave("u1")).storia.join("\r\n\r\n\n");
    assert.equal(await unita.proponiCampiUnita("u1", { storia: adesso }, "smm"), 0);
  });

  it("approvata, va in pagine_testi; l'anteprima la mostra a paragrafi", async () => {
    await unita.proponiCampiUnita("u1", { storia: "Uno.\n\nDue." }, "smm");
    chiudiPerTest();
    const slug = (await unita.unitaSalvataPerChiave("u1")).slug;

    const anteprima = await unita.unitaInAnteprima(slug);
    assert.deepEqual(anteprima.unita.storia, ["Uno.", "Due."]);

    assert.equal(await unita.approvaProposta("u1", "storia", "referente"), true);
    chiudiPerTest();
    assert.equal(
      raw.prepare("SELECT valore FROM pagine_testi WHERE chiave = 'unita.u1.storia'").get()
        .valore,
      "Uno.\n\nDue.",
    );
    assert.deepEqual((await unita.unitaSalvataPerChiave("u1")).storia, ["Uno.", "Due."]);
    assert.deepEqual(await unita.leggiProposte(), []);
  });
});

describe("la coda di chi propone: contenuti sì, recapiti e indirizzi no", () => {
  it("il catalogo tiene fuori dai contenuti ritrovo, telefono e nomi dei referenti", () => {
    assert.deepEqual(
      catalogo.CAMPI_UNITA.filter((c) => !c.contenuto).map((c) => c.chiave).sort(),
      ["referente", "ritrovo", "ruoloReferente", "telefono"],
    );
  });

  it("chi approva vede tutte le proposte di un referente di unità; chi propone solo le proprie, e il solo testo", async () => {
    const id = raw.prepare("SELECT id FROM unita WHERE chiave = 'u1'").get().id;
    const referente = raw
      .prepare(
        "INSERT INTO utenti (utente, nome, iniziali, ruolo, unita_id, stato) VALUES ('ref1-coda','Ref1','AK','referente',?,'attivo')",
      )
      .run(id).lastInsertRowid;
    const scrivi = raw.prepare(
      "INSERT INTO unita_proposte (unita_id, campo, valore, autore_id) VALUES (?, ?, ?, ?)",
    );
    scrivi.run(id, "telefono", "333 000 0000", referente);
    scrivi.run(id, "ritrovo", "Sabato alle 15, via di Prova 1", referente);
    scrivi.run(id, "motto", "Del nostro meglio, di prova", referente);
    chiudiPerTest();

    const { apri } = await import("@/lib/auth/sessioni");
    const apriPer = (utente) => {
      const uid = raw.prepare("SELECT id FROM utenti WHERE utente = ?").get(utente).id;
      const token = apri(uid, null);
      chiudiPerTest();
      return token;
    };
    const tokenSmm = apriPer("smm");
    const tokenAutore = apriPer("ref1-coda");
    // chi approva è il gestore: un account che non c'è nel seme di prova
    raw.prepare(
      "INSERT INTO utenti (utente, nome, iniziali, ruolo, stato) VALUES ('gestore-coda','Referente','CG','gestore','attivo')",
    ).run();
    const tokenReferente = apriPer("gestore-coda");

    const campiDi = (voci) =>
      voci
        .filter((v) => v.tipo === "campo")
        .flatMap((v) => v.confronto.map((c) => c.etichetta))
        .sort();

    tokenCorrente = tokenReferente;
    const tutte = await coda.vociDellaCoda({ vista: "chi-approva" });
    assert.equal(campiDi(tutte.voci).length, 3);

    // chi propone vede le proprie, e di quelle solo i contenuti: non gli altrui
    tokenCorrente = tokenSmm;
    assert.deepEqual(campiDi((await coda.vociDellaCoda({ vista: "chi-propone" })).voci), []);

    tokenCorrente = tokenAutore;
    const sue = await coda.vociDellaCoda({ vista: "chi-propone" });
    assert.deepEqual(campiDi(sue.voci), ["Motto dell’unità"]);
    assert.ok(
      !sue.voci.some((v) => v.tipo === "documento" || v.tipo === "persone"),
      "niente documenti né elenchi di referenti",
    );
  });
});
