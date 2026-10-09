import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it, mock } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Il social media manager fa la redazione del sito (6 ottobre 2026).
 *
 * Decisione dell'utente: i referenti di unità non hanno tempo per la parte social del
 * gruppo, e l'account del social media manager tiene aggiornato il sito con
 * fotografie e attività. Quindi:
 *
 *  - modifica e cancella **anche le attività degli altri**, con l'approvazione
 *    dei gestori: su una pubblicata la richiesta aspetta in `proposte`
 *    (migrazione 0021) e nel calendario resta quella di adesso;
 *  - le fotografie le **nasconde**, subito, e non le elimina: il file resta, e
 *    per rimetterle serve un gestore;
 *  - lavora anche sugli album degli altri, con la revisione di sempre.
 *
 * Le Server Action non si eseguono fuori da Next: le regole che stanno negli
 * store si provano sul database, quelle che stanno nelle azioni sul sorgente,
 * come in `accessi-ruoli`.
 */

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const leggi = (...p) => readFileSync(join(radice, ...p), "utf8");
const area = (...p) => leggi("app", "(area)", "area-riservata", ...p);

/** Il corpo di una funzione esportata, fino alla successiva. */
function corpo(sorgente, nome) {
  const i = sorgente.search(new RegExp(`(export )?(async )?function ${nome}\\(`));
  assert.ok(i >= 0, `manca ${nome}`);
  const j = sorgente.indexOf("\nexport ", i + 1);
  return sorgente.slice(i, j < 0 ? undefined : j);
}

/** `a` compare prima di `b` nel testo. */
function prima(testo, a, b) {
  const i = testo.indexOf(a);
  const j = testo.indexOf(b);
  assert.ok(i >= 0, `manca «${a}»`);
  assert.ok(j >= 0, `manca «${b}»`);
  assert.ok(i < j, `«${a}» dovrebbe venire prima di «${b}»`);
}

let cartella, raw, chiudiPerTest;
let immagini, unita, album, proposte, propLib, attivitaLib, attivitaStore, coda, decisione, slot;
/** Il cookie della sessione che `next/headers` finto restituisce. */
let tokenCorrente;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-social-redazione-"));
  const dati = join(cartella, "dati");
  mkdirSync(dati, { recursive: true });
  process.env.SITO_DB = join(cartella, "prova.db");
  process.env.SITO_DATI_DIR = dati;

  const iniziale = new Database(process.env.SITO_DB);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  mock.module("next/headers", {
    namedExports: {
      cookies: async () => ({ get: () => (tokenCorrente ? { value: tokenCorrente } : undefined) }),
    },
  });

  immagini = await import("@/lib/immagini-store");
  unita = await import("@/lib/unita-store");
  album = await import("@/lib/album");
  proposte = await import("@/lib/proposte-store");
  propLib = await import("@/lib/proposte");
  attivitaLib = await import("@/lib/attivita");
  attivitaStore = await import("@/lib/attivita-store");
  coda = await import("@/lib/coda");
  decisione = await import("@/lib/auth/decisione");
  slot = (await import("@/lib/slot-immagini")).SLOT.find((s) => !s.persona && !s.unita);
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  (await import("@/lib/db/riferimenti")).assicuraRiferimenti();

  raw = new Database(process.env.SITO_DB);
  const u1 = raw.prepare("SELECT id FROM unita WHERE chiave = 'u1'").get().id;
  raw
    .prepare(
      "INSERT INTO utenti (utente, nome, iniziali, ruolo, unita_id, stato) VALUES " +
        "('smm','Social','SM','social',NULL,'attivo'), " +
        "('referente','Referente','CG','gestore',NULL,'attivo'), " +
        "('ref1','Ref1','AK','referente',?,'attivo')",
    )
    .run(u1);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

async function tokenDi(utente) {
  const { apri } = await import("@/lib/auth/sessioni");
  const uid = raw.prepare("SELECT id FROM utenti WHERE utente = ?").get(utente).id;
  return apri(uid, null);
}

// --------------------------------------------------------------------------

describe("la migrazione 0021", () => {
  it("`proposte` accetta il tipo attività, ma senza file", () => {
    raw
      .prepare("INSERT INTO proposte (tipo, chiave, valore) VALUES ('attivita', '999', '{}')")
      .run();
    assert.throws(() =>
      raw
        .prepare("INSERT INTO proposte (tipo, chiave, valore, file) VALUES ('attivita', '998', '{}', 'x.jpg')")
        .run(),
    );
    raw.prepare("DELETE FROM proposte WHERE chiave = '999'").run();
  });

  it("le tre colonne «nascosta» ci sono, e partono da 0", () => {
    const colonna = (tabella, nome) =>
      raw.prepare(`PRAGMA table_info(${tabella})`).all().find((c) => c.name === nome);
    for (const [t, c] of [
      ["foto", "nascosta"],
      ["immagini", "nascosta"],
      ["unita", "copertina_nascosta"],
    ]) {
      const col = colonna(t, c);
      assert.ok(col, `${t}.${c}`);
      assert.equal(col.notnull, 1);
      assert.equal(col.dflt_value, "0");
    }
  });
});

describe("i riquadri nascosti", () => {
  it("il sito non li vede, l'area sì; e un'immagine nuova nel posto si vede di nuovo", async () => {
    await immagini.registraImmagine(slot.chiave, "riquadro-1.jpg", "image/jpeg", { larghezza: 1600, altezza: 800 }, "", "referente");
    assert.equal(await immagini.nascondiImmagine(slot.chiave, true), true);

    assert.equal((await immagini.immaginiCaricate()).has(slot.chiave), false, "le pagine pubbliche non la ricevono");
    const nellArea = (await immagini.tutteLeImmagini()).get(slot.chiave);
    assert.equal(nellArea?.nascosta, true);
    assert.equal((await immagini.immagineRegistrata("riquadro-1.jpg"))?.nascosta, true);

    await immagini.registraImmagine(slot.chiave, "riquadro-2.jpg", "image/jpeg", { larghezza: 1600, altezza: 800 }, "", "referente");
    assert.equal((await immagini.immaginiCaricate()).get(slot.chiave)?.file, "riquadro-2.jpg");
  });

  it("rimetterla la riporta sul sito", async () => {
    await immagini.nascondiImmagine(slot.chiave, true);
    assert.equal(await immagini.nascondiImmagine(slot.chiave, false), true);
    assert.equal((await immagini.immaginiCaricate()).has(slot.chiave), true);
  });

  it("un posto vuoto non ha niente da nascondere", async () => {
    assert.equal(await immagini.nascondiImmagine("chi-siamo.posto-che-non-ce", true), false);
  });
});

describe("le copertine nascoste", () => {
  it("la pagina torna al segnaposto, l'area la vede da dietro il cancello, il file resta suo", async () => {
    await unita.registraCopertina("u1", "copertina-1.jpg", "image/jpeg", { larghezza: 2400, altezza: 1200 }, "referente");
    assert.equal(await unita.nascondiCopertina("u1", true), true);

    const u = await unita.unitaSalvataPerChiave("u1");
    assert.equal(u.copertina, undefined);
    assert.match(u.copertinaNascosta.src, /^\/in-attesa\/copertina-1\.jpg$/);
    assert.equal((await unita.copertinaRegistrata("copertina-1.jpg"))?.nascosta, true);
    // chi la sostituisce porta via anche una nascosta: è un file in archivio
    assert.equal(await unita.fileCopertina("u1"), "copertina-1.jpg");

    await unita.registraCopertina("u1", "copertina-2.jpg", "image/jpeg", { larghezza: 2400, altezza: 1200 }, "referente");
    const dopo = await unita.unitaSalvataPerChiave("u1");
    assert.match(dopo.copertina.src, /copertina-2\.jpg$/);
    assert.equal(dopo.copertinaNascosta, undefined);
  });

  it("un'unità senza copertina non ne ha una da nascondere", async () => {
    assert.equal(await unita.nascondiCopertina("u4", true), false);
  });
});

describe("le fotografie nascoste degli album", () => {
  let slug;

  before(async () => {
    slug = await album.creaAlbum(
      { titolo: "Uscita di prova", anno: "2026 – 2027", unita: "u1", data: "Ottobre 2026", sottotitolo: "", tag: "prova" },
      Date.now(),
      "ref1",
    );
    const id = await album.idAlbumPerIndirizzo(slug);
    const foto = raw.prepare(
      "INSERT INTO foto (album_id, file, tipo, larghezza, altezza, ordine) VALUES (?, ?, 'image/jpeg', 100, 100, ?)",
    );
    foto.run(id, "album-1.jpg", 0);
    foto.run(id, "album-2.jpg", 1);
    raw.prepare("UPDATE album SET stato = 'pubblicato' WHERE id = ?").run(id);
  });

  it("il pubblico non la riceve, né in pagina né dalla rotta; l'area sì", async () => {
    assert.equal(await album.nascondiFoto(slug, "album-1.jpg", true, "smm"), true);

    const pubblico = (await album.albumPubblicati()).find((a) => a.slug === slug);
    assert.deepEqual(pubblico.foto.map((f) => f.file), ["album-2.jpg"]);
    assert.deepEqual(
      (await album.albumPubblicoPerIndirizzo(slug)).foto.map((f) => f.file),
      ["album-2.jpg"],
    );
    const nellArea = await album.albumPerIndirizzo(slug);
    assert.equal(nellArea.foto.find((f) => f.file === "album-1.jpg")?.nascosta, true);

    assert.equal(await album.fotoPubblica("album-1.jpg"), null);
    assert.ok(await album.fotoInterna("album-1.jpg"), "chi gestisce l'album la vede ancora");
    // la copertina è la prima fra le visibili
    assert.equal((await album.fotoPubblica("album-2.jpg"))?.copertina, true);
  });

  it("rimessa, torna com'era", async () => {
    assert.equal(await album.nascondiFoto(slug, "album-1.jpg", false, "smm"), true);
    assert.equal((await album.fotoPubblica("album-1.jpg"))?.copertina, true);
  });

  it("una fotografia che non c'è non si nasconde", async () => {
    assert.equal(await album.nascondiFoto(slug, "non-ce.jpg", true, "smm"), false);
  });
});

describe("le richieste su un'attività", () => {
  const UNITA = ["u1", "u2", "u3", "u4", "u5", "u6"];
  const campi = {
    titolo: "Uscita al lago",
    data: "2026-11-15",
    tipo: "uscita",
    unita: ["u1"],
    nota: "",
    luogo: "Lago di prova",
    durata: "Un giorno",
  };

  it("i campi proposti si ricontrollano con le regole del modulo", () => {
    assert.deepEqual(attivitaLib.campiAttivitaDa(campi, UNITA), campi);
    assert.equal(attivitaLib.campiAttivitaDa({ ...campi, data: "2026-02-31" }, UNITA), null);
    assert.equal(attivitaLib.campiAttivitaDa({ ...campi, unita: ["marziani"] }, UNITA), null);
    assert.equal(attivitaLib.campiAttivitaDa({ ...campi, tipo: "attivita-squadra" }, UNITA), null);
    assert.equal(attivitaLib.campiAttivitaDa({ ...campi, titolo: "x".repeat(500) }, UNITA), null);
    assert.equal(attivitaLib.campiAttivitaDa({ ...campi, titolo: "  " }, UNITA), null);
    assert.equal(attivitaLib.campiAttivitaDa("non un oggetto", UNITA), null);
  });

  it("rimettere una fotografia è una proposta senza file, riconoscibile", () => {
    assert.equal(propLib.chiedeDiMostrare({ valore: propLib.VALORE_MOSTRA, file: null }), true);
    assert.equal(propLib.chiedeDiMostrare({ valore: propLib.VALORE_MOSTRA, file: "x.jpg" }), false);
    assert.equal(propLib.chiedeDiMostrare({ valore: "{}", file: null }), false);
  });

  it("la coda: chi approva vede il confronto, il social la sua richiesta, il referente di unità no", async () => {
    const id = await attivitaStore.creaAttivita(
      { titolo: "Uscita al lago", data: "2026-11-15", tipo: "uscita", unita: ["u1"], luogo: "Lago di prova", durata: "Un giorno" },
      "ref1",
    );
    await attivitaStore.cambiaStatoAttivita(id, "pubblicato", "referente");
    await proposte.proponi(
      "attivita",
      String(id),
      JSON.stringify({ azione: "modifica", campi: { ...campi, luogo: "Lago nuovo" } }),
      null,
      "smm",
    );
    // un'attività in revisione creata da un referente di unità: il social la vede in coda
    const altra = await attivitaStore.creaAttivita(
      { titolo: "Uscita dell'unità 1", data: "2026-12-06", tipo: "uscita", unita: ["u1"] },
      "ref1",
    );
    await attivitaStore.cambiaStatoAttivita(altra, "in-revisione", "ref1");
    chiudiPerTest();

    const [referente, smm, ref1] = [await tokenDi("referente"), await tokenDi("smm"), await tokenDi("ref1")];
    chiudiPerTest();
    const richiesta = (voci) => voci.find((v) => v.proposta && v.tipo === "attivita" && v.chiave === String(id));

    tokenCorrente = referente;
    const perReferente = richiesta((await coda.vociDellaCoda({ vista: "chi-approva" })).voci);
    assert.ok(perReferente, "il gestore la vede");
    assert.deepEqual(perReferente.confronto, [{ etichetta: "Luogo", prima: "Lago di prova", dopo: "Lago nuovo" }]);

    tokenCorrente = smm;
    const perSmm = (await coda.vociDellaCoda({ vista: "chi-propone" })).voci;
    assert.ok(richiesta(perSmm), "il social vede la sua richiesta");
    assert.ok(
      perSmm.some((v) => !v.proposta && v.tipo === "attivita" && v.chiave === String(altra)),
      "e le attività degli altri in revisione",
    );

    tokenCorrente = ref1;
    assert.equal(richiesta((await coda.vociDellaCoda({ vista: "chi-propone" })).voci), undefined);
    tokenCorrente = undefined;
  });
});

describe("le regole, nelle azioni", () => {
  it("il social le fotografie le nasconde soltanto; gli altri ruoli no", () => {
    assert.equal(decisione.nascondeSoltanto("social", "limitato"), true);
    assert.equal(decisione.nascondeSoltanto("referente", "limitato"), false);
    assert.equal(decisione.nascondeSoltanto("gestore", "completo"), false);
  });

  it("attività: su una pubblicata il social propone, prima di toccare la riga", () => {
    const a = area("attivita", "actions.ts");
    const modifica = corpo(a, "modificaAttivita");
    prima(modifica, 'vaInCoda(ctx.sessione.r, ctx.livello) && prima.stato === "pubblicato"', 'proponi("attivita"');
    prima(modifica, 'proponi("attivita"', "aggiornaAttivita(");
    assert.doesNotMatch(a, /suaDi\(/, "non chiede più «è sua?» per modificare");
  });

  it("attività: cancellare è una richiesta, tranne per una bozza sua mai pubblicata", () => {
    const a = area("attivita", "actions.ts");
    const rimuovi = corpo(a, "rimuoviAttivita");
    prima(rimuovi, "!cancellaDaSe(ctx, a)", "eliminaAttivita(");
    prima(rimuovi, 'proponi("attivita"', "eliminaAttivita(");
    // una richiesta rimasta su un'attività cancellata non si potrebbe più decidere
    prima(rimuovi, "eliminaAttivita(", 'prendiProposta("attivita"');
    const cancella = corpo(a, "cancellaDaSe");
    assert.match(cancella, /eSuo\(/);
    assert.match(cancella, /fuPubblicato\(/);
    prima(corpo(a, "inviaAttivita"), 'a.stato === "pubblicato" && vaInCoda(', "cambiaStatoAttivita(");
  });

  it("la decisione: un'attività la approva chi pubblica, e «rimetti» non porta via il file", () => {
    const p = area("proposte", "actions.ts");
    const decidi = corpo(p, "decidiPropostaSito");
    prima(decidi, 'contesto("album-pubblica"', "prendiProposta(");
    const applica = corpo(p, "applica");
    prima(applica, 'if (tipo === "attivita")', 'if (tipo === "pagina")');
    assert.match(applica, /campiAttivitaDa\(/);
    // «rimetti» va riconosciuto prima di «togli»: sono tutte e due senza file
    const iImmagine = applica.indexOf('if (tipo === "immagine")');
    prima(applica.slice(iImmagine), "chiedeDiMostrare(", "file === null");
    const iCopertina = applica.indexOf("const unita = chiave as UnitaKey;");
    prima(applica.slice(iCopertina), "chiedeDiMostrare(", "file === null");
  });

  it("fotografie: il social non elimina, da nessuna delle tre porte", () => {
    prima(corpo(area("immagini", "actions.ts"), "rimuoviImmagine"), "nascondeSoltanto(", "togliImmagine(");
    prima(corpo(area("unita", "actions.ts"), "rimuoviCopertina"), "nascondeSoltanto(", "dimenticaCopertina(");
    const albumAzioni = area("album", "actions.ts");
    prima(corpo(albumAzioni, "rimuoviFoto"), "p.nascondeSoltanto", "togliFoto(");
    prima(corpo(albumAzioni, "rimuoviAlbum"), "p.suo", "eliminaAlbum(");
  });

  it("fotografie: nascondere non rimanda in revisione, rimettere sì", () => {
    const albumAzioni = area("album", "actions.ts");
    assert.doesNotMatch(corpo(albumAzioni, "nascondiFotoAlbum"), /cambiaStatoAlbum\(/);
    prima(corpo(albumAzioni, "mostraFotoAlbum"), 'cambiaStatoAlbum(slug, "in-revisione"', "nascondiFoto(");
    prima(corpo(area("immagini", "actions.ts"), "mostraImmagine"), "inCoda(p)", "scriviNascosta(chiave, false)");
    prima(corpo(area("unita", "actions.ts"), "mostraCopertina"), "vaInCoda(", "scriviCopertinaNascosta(unita, false)");
  });

  it("gli album: il social ci lavora anche se non sono suoi, e anche se pubblicati", () => {
    const permesso = corpo(area("album", "actions.ts"), "permesso");
    assert.doesNotMatch(permesso, /return \{ ok: false, esito: NEGATO \};\s*\}\s*\n\s*\/\/ Il social/);
    assert.doesNotMatch(permesso, /Rifiutata modifica social su album già pubblicato/);
  });

  it("le rotte pubbliche non servono le nascoste; `/in-attesa/` sì, dietro il cancello", () => {
    assert.match(leggi("app", "immagine", "[file]", "route.ts"), /riga\.nascosta/);
    assert.match(leggi("app", "copertina", "[file]", "route.ts"), /riga\.nascosta/);
    const inAttesa = leggi("app", "in-attesa", "[file]", "route.ts");
    assert.match(inAttesa, /immagine\?\.nascosta/);
    assert.match(inAttesa, /copertina\?\.nascosta/);
    prima(inAttesa, "fileDaServire(file)", "puoVederla(riga.proposta, riga.chiave)");
    assert.match(leggi("app", "(sito)", "foto", "[album]", "page.tsx"), /albumPubblicoPerIndirizzo\(/);
  });
});
