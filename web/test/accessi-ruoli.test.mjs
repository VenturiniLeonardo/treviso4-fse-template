import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Le correzioni dell'audit degli accessi del 4 ottobre 2026.
 *
 * Un audit degli accessi ha guardato i quattro
 * ruoli dell'area riservata con una domanda sola: ogni cosa che un ruolo vede o
 * fa gli serve davvero? Qui si prova che le risposte sono diventate codice:
 *
 *  - i **tetti**: quello che la matrice non può concedere a un ruolo (M-5);
 *  - «è suo?» per il social media manager, e le code delle fotografie (A-4, M-1, M-3) —
 *    che dal 6 ottobre 2026 vale solo per cancellare da sé: vedi
 *    `social-redazione.test.mjs`;
 *  - le sezioni chiuse dalla matrice, non solo tolte dal menu (M-2);
 *  - la separazione dei compiti su consensi e cancellazioni (SoD-1, SoD-3);
 *  - la migrazione 0014, che dice chi ha creato album e attività.
 *
 * Le Server Action non si eseguono fuori da Next: dove la regola sta dentro
 * un'azione, la si prova sul sorgente, come fanno `sicurezza-sorgenti` e
 * `permessi-cancello`.
 */

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const leggi = (...p) => readFileSync(join(radice, ...p), "utf8");
const area = (...p) => leggi("app", "(area)", "area-riservata", ...p);

/** Il corpo di una funzione esportata, fino alla successiva. */
function corpo(sorgente, nome) {
  const i = sorgente.indexOf(`export async function ${nome}(`);
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

const RUOLI = ["sviluppatore", "gestore", "referente", "social"];
const RANGO = { nessuno: 0, limitato: 1, completo: 2 };

let cartella, percorso, raw;
let permessi, decisione, permessiStore, dataArea, registro, chiudiPerTest;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-accessi-ruoli-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  permessi = await import("@/lib/permessi");
  decisione = await import("@/lib/auth/decisione");
  permessiStore = await import("@/lib/permessi-store");
  dataArea = await import("@/lib/data-area");
  registro = await import("@/lib/registro");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

beforeEach(() => {
  raw.prepare("DELETE FROM permessi").run();
});

const sess = (r, un) => ({ u: r, n: r, r, i: "XX", ...(un ? { un } : {}), exp: 0 });

// --------------------------------------------------------------------------

describe("i tetti: quello che la matrice non può concedere (M-5)", () => {
  it("il seme sta tutto sotto i tetti: nessuna riga di partenza li supera", () => {
    for (const f of permessi.FUNZIONI_INIZIALI) {
      for (const r of RUOLI) {
        const scritto = f.livelli[r];
        const t = permessi.tetto(f.id, r).livello;
        if (permessi.RIGHE_FISSE[f.id]) continue;
        assert.ok(RANGO[scritto] <= RANGO[t], `${f.id} per ${r}: ${scritto} oltre il tetto ${t}`);
      }
    }
  });

  it("anche se la tabella dice «completo», il social non va oltre «limitato» — e su iscritti è «nessuno»", async () => {
    await permessiStore.ripristinaMatrice();
    raw.prepare("UPDATE permessi SET livello = 'completo' WHERE ruolo = 'social'").run();
    const matrice = await permessiStore.leggiMatrice();
    for (const f of matrice) assert.notEqual(f.livelli.social, "completo", f.id);
    for (const azione of ["iscritti", "iscritti-elenco", "referenti", "messaggi", "utenti", "gdpr", "registro"]) {
      assert.equal(decisione.decidi(matrice, sess("social"), azione, { unita: "u1" }).ok, false, azione);
    }
  });

  it("il gestore non registra consensi, qualunque cosa dica una tabella vecchia (SoD-1)", async () => {
    await permessiStore.ripristinaMatrice();
    // un'installazione nata prima: «iscritti» completo per il gestore
    raw.prepare("UPDATE permessi SET livello = 'completo' WHERE funzione = 'iscritti' AND ruolo = 'gestore'").run();
    const matrice = await permessiStore.leggiMatrice();
    assert.equal(decisione.decidi(matrice, sess("gestore"), "iscritti", { unita: "u1" }).ok, false);
    // ma l'elenco lo consulta, su tutte le unità
    const legge = decisione.decidi(matrice, sess("gestore"), "iscritti-elenco", { unita: "u1" });
    assert.equal(legge.ok, true);
    assert.equal(legge.livello, "completo");
  });

  it("un referente di unità non ha mai «completo», che per lui vorrebbe dire «tutte le unità»", async () => {
    await permessiStore.ripristinaMatrice();
    raw.prepare("UPDATE permessi SET livello = 'completo' WHERE ruolo = 'referente'").run();
    const matrice = await permessiStore.leggiMatrice();
    for (const f of matrice) assert.notEqual(f.livelli["referente"], "completo", f.id);
    // e le righe senza ambito d'unità restano chiuse: «limitato» lì sarebbe «tutto»
    for (const azione of ["messaggi", "pagine", "identita", "registro", "privacy", "utenti", "album-pubblica"]) {
      assert.equal(decisione.decidi(matrice, sess("referente", "u1"), azione).ok, false, azione);
    }
  });

  it("le righe fisse non decidono la tabella: «viste» è dell'amministratore, comunque", async () => {
    await permessiStore.ripristinaMatrice();
    raw.prepare("UPDATE permessi SET livello = 'completo' WHERE funzione = 'viste'").run();
    raw.prepare("UPDATE permessi SET livello = 'nessuno' WHERE funzione = 'viste' AND ruolo = 'sviluppatore'").run();
    const viste = (await permessiStore.leggiMatrice()).find((f) => f.id === "viste");
    assert.deepEqual(viste.livelli, permessi.RIGHE_FISSE.viste.livelli);
    assert.equal(permessi.ammesso("viste", "gestore", "completo"), false);
  });

  it("`ammesso` respinge proprio le celle che la schermata blocca", () => {
    assert.equal(permessi.ammesso("iscritti", "social", "limitato"), false);
    assert.equal(permessi.ammesso("unita-scheda", "social", "completo"), false);
    assert.equal(permessi.ammesso("unita-scheda", "social", "limitato"), true);
    assert.equal(permessi.ammesso("utenti", "gestore", "completo"), false);
    assert.equal(permessi.ammesso("gdpr", "sviluppatore", "completo"), true);
  });

  it("l'azione della matrice controlla il tetto prima di scrivere", () => {
    const c = corpo(area("permessi", "actions.ts"), "cambiaLivello");
    prima(c, "ammesso(", "impostaLivello(");
    assert.match(c, /"rifiutato"/);
  });
});

describe("le righe nuove della matrice", () => {
  it("consultare e registrare gli iscritti sono due righe, con chi ne ha bisogno", () => {
    const r = (id) => permessi.FUNZIONI_INIZIALI.find((f) => f.id === id).livelli;
    assert.deepEqual(r("iscritti"), {
      sviluppatore: "completo",
      "gestore": "nessuno",
      "referente": "limitato",
      social: "nessuno",
    });
    assert.equal(r("iscritti-elenco")["gestore"], "completo");
    assert.equal(r("registro")["gestore"], "completo");
    assert.equal(r("privacy")["gestore"], "completo");
    assert.equal(r("gdpr")["gestore"], "nessuno");
  });
});

describe("code e proprietà (M-3, A-4)", () => {
  it("una fotografia con «limitato» va in coda — anche quella del referente di unità", () => {
    assert.equal(decisione.immagineInCoda("limitato"), true);
    assert.equal(decisione.immagineInCoda("completo"), false);
  });

  it("solo il social media manager cancella da sé solo i propri contenuti", () => {
    assert.equal(decisione.soloIPropri("social", "limitato"), true);
    assert.equal(decisione.soloIPropri("referente", "limitato"), false);
    assert.equal(decisione.soloIPropri("gestore", "completo"), false);
  });

  it("le azioni degli album chiedono «è suo?» dopo il cancello — per l'eliminazione", () => {
    const a = area("album", "actions.ts");
    prima(a, 'contesto("album-carica", { unita: album.unita', "eSuo(ctx.sessione, ctx.livello, creatoreAlbum(slug))");
    prima(corpo(a, "rimuoviAlbum"), "p.suo", "eliminaAlbum(");
  });

  it("le attività: il social cancella da sé solo una bozza sua, e non ritira quelle pubblicate", () => {
    const a = area("attivita", "actions.ts");
    prima(corpo(a, "rimuoviAttivita"), "!cancellaDaSe(ctx, a)", "eliminaAttivita(");
    prima(corpo(a, "inviaAttivita"), 'a.stato === "pubblicato" && vaInCoda(', "cambiaStatoAttivita(");
  });

  it("le fotografie dei riquadri passano da `immagineInCoda`, non più da `vaInCoda`", () => {
    const a = area("immagini", "actions.ts");
    assert.match(a, /immagineInCoda\(p\.ctx\.livello\)/);
    assert.doesNotMatch(a, /vaInCoda\(/);
  });

  it("le bozze degli album dalla rotta delle fotografie passano dal cancello dell'album", () => {
    assert.match(leggi("app", "foto-file", "[file]", "route.ts"), /puoSuAlbumId\(interna\.albumId/);
  });

  it("i file in attesa seguono la matrice, non un elenco di ruoli", () => {
    const r = leggi("app", "in-attesa", "[file]", "route.ts");
    // il codice, senza i commenti che raccontano com'era
    const codice = r
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    assert.doesNotMatch(codice, /sessione\.r === "social"/);
    assert.match(r, /puoVederla\(riga\.proposta, riga\.chiave\)/);
  });
});

describe("gli album pubblicati (A-1, A-3, SoD-1)", () => {
  const a = area("album", "actions.ts");

  it("togliere una fotografia da un album online lo rimanda in revisione, prima, e lo registra", () => {
    const c = corpo(a, "rimuoviFoto");
    prima(c, 'cambiaStatoAlbum(slug, "in-revisione"', "togliFoto(");
    prima(c, "togliFoto(", '"eliminazione"');
  });

  it("la password di un album stato online: il social no, gli altri lo rimandano in revisione", () => {
    const c = corpo(a, "cambiaPasswordAlbum");
    prima(c, 'p.sessione.r === "social"', "impostaPasswordAlbum(");
    prima(c, 'cambiaStatoAlbum(slug, "in-revisione"', "impostaPasswordAlbum(");
  });

  it("chi ha dichiarato un'assenza non pubblica lo stesso album, da nessuna delle due porte", () => {
    prima(corpo(a, "cambiaStato"), "haDichiarato(slug, p.sessione.u)", "cambiaStatoAlbum(");
    const d = corpo(area("approvazioni", "actions.ts"), "decidi");
    prima(d, "assenzeDichiarateDa(id, sessione.u)", "cambiaStatoAlbum(");
  });
});

describe("le sezioni seguono la matrice (M-2)", () => {
  it("ogni sezione di ogni ruolo ha una riga di matrice, o è nell'elenco di quelle che non ne hanno", () => {
    for (const ruolo of dataArea.RUOLI) {
      for (const chiave of Object.keys(ruolo.sezioni)) {
        const conRiga = Object.hasOwn(dataArea.AZIONE_DI_SEZIONE, chiave);
        const senza = dataArea.SEZIONI_SENZA_RIGA.includes(chiave);
        assert.ok(conRiga !== senza, `${ruolo.slug}/${chiave}: decidete se ha una riga di matrice`);
      }
    }
  });

  it("le righe nominate esistono nel seme: una sezione non punta a una riga inventata", () => {
    const ids = new Set(permessi.FUNZIONI_INIZIALI.map((f) => f.id));
    for (const [sezione, azione] of Object.entries(dataArea.AZIONE_DI_SEZIONE)) {
      assert.ok(ids.has(azione), `${sezione} → ${azione}`);
    }
  });

  it("per ogni ruolo, una sezione del suo menu che il seme gli nega è chiusa — e la pagina la chiude", () => {
    const pagina = area("[ruolo]", "[sezione]", "page.tsx");
    prima(pagina, 'if (azioneSezione && !(await concesso(azioneSezione as Azione))) notFound()', "const identita = await leggiIdentita()");
  });

  it("il gestore ha le sezioni di controllo, e le sue righe le aprono", () => {
    const cg = dataArea.RUOLI.find((r) => r.slug === "gestore");
    for (const chiave of ["privacy", "log", "permessi"]) {
      assert.ok(Object.hasOwn(cg.sezioni, chiave), chiave);
      const azione = dataArea.AZIONE_DI_SEZIONE[chiave];
      const livello = decisione.livelloNellaMatrice(permessi.FUNZIONI_INIZIALI, azione, "gestore");
      assert.notEqual(livello, "nessuno", `${chiave} (${azione})`);
    }
  });

  it("«Iscritti e consensi» non è più una sezione del gestore (6 ottobre 2026); il referente di unità ha il suo elenco", () => {
    const cg = dataArea.RUOLI.find((r) => r.slug === "gestore");
    assert.ok(!Object.hasOwn(cg.sezioni, "iscritti"));
    assert.ok(!dataArea.chiaviSezioni(cg).includes("iscritti"));
    const cu = dataArea.RUOLI.find((r) => r.slug === "referente");
    assert.ok(Object.hasOwn(cu.sezioni, "iscritti"));
  });

  it("nessun ruolo ha più il gruppo «Strumenti» né la locandina", () => {
    for (const r of dataArea.RUOLI) {
      assert.ok(!r.nav.some((g) => g.label === "Strumenti"), r.slug);
      assert.equal(Object.hasOwn(r.sezioni, "locandina"), false, r.slug);
    }
  });

  it("lo sviluppatore ha «Contenuti del sito», le stesse voci e le stesse sezioni del gestore", () => {
    const voci = (slug) =>
      dataArea.RUOLI.find((r) => r.slug === slug).nav.find((g) => g.label === "Contenuti del sito")?.voci.map((v) => v.chiave);
    assert.ok(voci("sviluppatore"));
    assert.deepEqual(voci("sviluppatore"), voci("gestore"));
    const dev = dataArea.RUOLI.find((r) => r.slug === "sviluppatore");
    for (const chiave of voci("sviluppatore")) assert.ok(Object.hasOwn(dev.sezioni, chiave), chiave);
  });
});

describe("cancellare i dati di una persona: la doppia firma (SoD-3)", () => {
  it("serve una richiesta di cancellazione aperta da un'altra persona, e la si chiude", () => {
    const c = corpo(area("iscritti", "actions.ts"), "cancellaDatiRagazzo");
    prima(c, 'richiesta.diritto !== "cancellazione"', "cancellaRagazzo(");
    prima(c, "richiesta.apertaDa === ctx.utente", "cancellaRagazzo(");
    prima(c, "cancellaRagazzo(", 'cambiaStatoRichiesta(richiesta.id, "eseguita")');
  });

  it("le richieste le apre chi ha la riga «privacy»; toglierne una resta «gdpr»", () => {
    const p = area("privacy", "actions.ts");
    assert.match(corpo(p, "nuovaRichiesta"), /contesto\("privacy"\)/);
    assert.match(corpo(p, "segnaRichiesta"), /contesto\("privacy"\)/);
    assert.match(corpo(p, "rimuoviRichiesta"), /contesto\("gdpr"\)/);
  });
});

describe("account e inviti (M-6, SoD-4)", () => {
  const u = area("utenti", "actions.ts");

  it("con «limitato» non si rifà l'invito di un account attivo", () => {
    prima(corpo(u, "rifaiInvito"), 'ctx.livello !== "completo" && u.stato === "attivo"', "creaInvito(id)");
  });

  it("l'invito passa da `consegna`, e il registro dice per quale strada", () => {
    assert.match(corpo(u, "invita"), /await consegna\(/);
    assert.match(corpo(u, "rifaiInvito"), /await consegna\(/);
    assert.match(u, /consegnato\.nota/);
  });
});

describe("«Da sapere» nella dashboard del gestore", () => {
  const v = (operazione, extra = {}) => ({
    quando: Date.now() - 1000,
    utente: "admin",
    nome: "Admin",
    ruolo: "sviluppatore",
    tipo: "configurazione",
    operazione,
    origine: "utenti",
    ...extra,
  });

  it("raccoglie matrice, account di pari grado, cancellazioni e accessi eccezionali", () => {
    const voci = [
      v("«iscritti» per social → limitato", { tipo: "permessi", origine: "permessi" }),
      v("Accesso eccezionale a «iscritti» — motivo: prova", { tipo: "permessi", origine: "eccezione" }),
      v("Creato l’account «nuovo» (sviluppatore) e generato l’invito — collegamento mostrato a chi invita"),
      v("Creato l’account «ref1» (referente, u1) e generato l’invito"),
      v("Cancellati i dati di una persona (art. 17), su richiesta GDPR #3", { tipo: "eliminazione", origine: "iscritti" }),
      v("Modificato l’album «x»", { tipo: "contenuto", origine: "album" }),
    ];
    const scelte = registro.daSapere(voci, Date.now()).map((x) => x.operazione);
    assert.equal(scelte.length, 4);
    assert.ok(!scelte.some((o) => o.includes("ref1")), "un referente di unità invitato è lavoro ordinario");
  });

  it("non oltre trenta giorni, e non i rifiuti", () => {
    const vecchia = v("«x» per social → limitato", { tipo: "permessi", quando: Date.now() - 40 * 86_400_000 });
    const rifiutata = v("Rifiutato «x»", { tipo: "permessi", esito: "rifiutato" });
    assert.deepEqual(registro.daSapere([vecchia, rifiutata], Date.now()), []);
  });
});

describe("export degli iscritti (M-4)", () => {
  const r = leggi("app", "(area)", "area-riservata", "esporta", "[sezione]", "route.ts");

  it("lo esporta chi tiene l'elenco, non chi lo consulta", () => {
    prima(r, 'chiave === "iscritti" && (await livelloPer("iscritti")) === "nessuno"', "righe.push(");
  });

  it("con «limitato» le colonne sono quelle dell'uscita: niente età, niente quota", () => {
    assert.match(r, /riga\(\["Cognome", "Nome", "Gruppo interno", "Consenso immagini"\]\)/);
  });

  it("per l'amministratore elenchi e posta richiedono l'accesso eccezionale", () => {
    assert.match(r, /eccezioneAperta\(sessione, "iscritti"\)/);
    assert.match(r, /eccezioneAperta\(sessione, "messaggi"\)/);
  });
});

// --------------------------------------------------------------------------

describe("migrazione 0014: chi ha creato, e le righe nuove della matrice", () => {
  let c;

  before(() => {
    const migrazioni13 = join(cartella, "drizzle-13");
    cpSync("./drizzle", migrazioni13, { recursive: true });
    const giornale = join(migrazioni13, "meta", "_journal.json");
    const g = JSON.parse(readFileSync(giornale, "utf8"));
    g.entries = g.entries.filter((e) => e.idx < 14);
    writeFileSync(giornale, JSON.stringify(g));

    c = new Database(join(cartella, "0014.db"));
    migrate(drizzle(c), { migrationsFolder: migrazioni13 });

    c.prepare("INSERT INTO anni_sociali (id, etichetta, inizio, fine, corrente) VALUES (1, '2026-2027', '2026-09-01', '2027-08-31', 1)").run();
    c.prepare(
      "INSERT INTO utenti (id, utente, nome, iniziali, ruolo, stato) VALUES " +
        "(1, 'social', 'Social', 'SM', 'social', 'attivo'), (2, 'referente', 'Referente', 'CG', 'gestore', 'attivo')",
    ).run();
    c.prepare("INSERT INTO album (id, slug, anno_id, titolo, data_testo, autore_id) VALUES (1, 'campo', 1, 'Campo estivo', 'Agosto 2026', 2), (2, 'vecchio', 1, 'Vecchio', 'Maggio 2026', 2)").run();
    c.prepare("INSERT INTO attivita (id, anno_id, titolo, data_testo, tipo) VALUES (1, 1, 'Uscita al lago', '11 ott 2026', 'uscita')").run();
    c.prepare(
      "INSERT INTO registro (utente_id, utente, nome, ruolo, tipo, operazione, origine) VALUES " +
        "(1, 'social', 'Social', 'social', 'contenuto', 'Creato l’album «Campo estivo», protetto da password', 'album')," +
        "(1, 'social', 'Social', 'social', 'contenuto', 'Creata l’attività «Uscita al lago»', 'attivita')",
    ).run();
    // una matrice già seminata, con un referente di unità chiuso sugli iscritti
    const riga = c.prepare("INSERT INTO permessi (funzione, nome, ruolo, livello, ordine) VALUES (?, ?, ?, ?, ?)");
    for (const [r, l] of [["sviluppatore", "completo"], ["gestore", "completo"], ["referente", "nessuno"], ["social", "nessuno"]]) {
      riga.run("iscritti", "Elenco iscritti e consensi", r, l, 7);
      riga.run("utenti", "Utenti", r, r === "sviluppatore" ? "completo" : "nessuno", 12);
      riga.run("esporta", "Esportare", r, r === "social" ? "nessuno" : r === "sviluppatore" ? "completo" : "limitato", 11);
    }

    migrate(drizzle(c), { migrationsFolder: "./drizzle" });
  });

  after(() => c?.close());

  it("album e attività prendono l'autore dalla riga di creazione nel registro", () => {
    assert.equal(c.prepare("SELECT creato_da FROM album WHERE id = 1").get().creato_da, 1);
    assert.equal(c.prepare("SELECT creato_da FROM attivita WHERE id = 1").get().creato_da, 1);
  });

  it("senza una riga di creazione l'album resta di nessuno, non di chi l'ha toccato per ultimo", () => {
    assert.equal(c.prepare("SELECT creato_da FROM album WHERE id = 2").get().creato_da, null);
  });

  it("la consultazione degli iscritti nasce con i livelli di prima: nessuno perde né guadagna", () => {
    const livelli = Object.fromEntries(
      c.prepare("SELECT ruolo, livello FROM permessi WHERE funzione = 'iscritti-elenco'").all().map((x) => [x.ruolo, x.livello]),
    );
    assert.deepEqual(livelli, {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "nessuno",
    });
  });

  it("registro e richieste: sviluppatore e gestore", () => {
    for (const f of ["registro", "privacy"]) {
      const aperti = c
        .prepare("SELECT ruolo FROM permessi WHERE funzione = ? AND livello = 'completo' ORDER BY ruolo")
        .all(f)
        .map((x) => x.ruolo);
      assert.deepEqual(aperti, ["gestore", "sviluppatore"], f);
    }
  });

  it("l'esportazione del gestore dice quello che fa: «completo»; il referente di unità resta «limitato»", () => {
    const l = (r) => c.prepare("SELECT livello FROM permessi WHERE funzione = 'esporta' AND ruolo = ?").get(r).livello;
    assert.equal(l("gestore"), "completo");
    assert.equal(l("referente"), "limitato");
  });

  it("la chiave esterna su chi ha creato lascia NULL, non cancella, se l'account sparisce", () => {
    const fk = c.prepare("PRAGMA foreign_key_list(album)").all().find((x) => x.from === "creato_da");
    assert.equal(fk.on_delete, "SET NULL");
  });

  it("su un database vuoto non inventa righe di matrice: le scrive il seme", () => {
    const vuoto = new Database(join(cartella, "vuoto.db"));
    migrate(drizzle(vuoto), { migrationsFolder: "./drizzle" });
    assert.equal(vuoto.prepare("SELECT count(*) AS n FROM permessi").get().n, 0);
    vuoto.close();
  });
});
