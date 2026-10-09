import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * La matrice delle autorizzazioni — fase 5.
 *
 * Il piano §9 lo chiama «il test che protegge la cosa più importante»: per ogni
 * combinazione di ruolo, azione e risorsa di un'altra unità si verifica il
 * rifiuto. Sono un centinaio di asserzioni scritte una volta.
 *
 * Si prova `decidi()`, che è la decisione in forma pura, e la matrice arriva
 * dalla **tabella** — non da una copia scritta nel test. È il punto della fase:
 * matrice visibile e comportamento del server sono la stessa riga letta due
 * volte, e un test che si portasse dietro la propria copia non lo dimostrerebbe.
 */

let cartella;
let percorso;
let decidi, livelloNellaMatrice, Negato, puoAgireSuRuolo, vaInCoda;
let leggiMatrice, impostaLivello, ripristinaMatrice;
let RUOLI_MATRICE;
let chiudiPerTest;
let raw;

const RUOLI = ["sviluppatore", "gestore", "referente", "social"];
const UNITA = ["u1", "u2", "u3", "u4", "u5", "u6"];

/** Una sessione finta: è tutto ciò che serve alla decisione. */
const sess = (ruolo, unita) => ({
  u: ruolo,
  n: ruolo,
  r: ruolo,
  i: "XX",
  ...(unita ? { un: unita } : {}),
  exp: 0,
});

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-autorizzazioni-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  // il modulo PURO: `contesto.ts` importa next/headers e fuori da Next non si carica
  ({ decidi, livelloNellaMatrice, Negato, puoAgireSuRuolo, vaInCoda } = await import(
    "@/lib/auth/decisione"
  ));
  ({ leggiMatrice, impostaLivello, ripristinaMatrice } = await import("@/lib/permessi-store"));
  ({ RUOLI_MATRICE } = await import("@/lib/permessi"));
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
  raw.prepare("DELETE FROM registro").run();
});

// --------------------------------------------------------------------------

describe("la matrice viene dalla tabella, non da una copia nel test", () => {
  it("i quattro ruoli della matrice sono quelli della sessione", () => {
    assert.deepEqual([...RUOLI_MATRICE.map((r) => r.chiave)].sort(), [...RUOLI].sort());
  });

  it("ogni azione del seme ha un livello per tutti e quattro i ruoli", async () => {
    const matrice = await leggiMatrice();
    for (const f of matrice) {
      for (const r of RUOLI) {
        assert.ok(
          ["completo", "limitato", "nessuno"].includes(f.livelli[r]),
          `${f.id}/${r} = ${f.livelli[r]}`,
        );
      }
    }
  });

  it("cambiare la tabella cambia la decisione: è il senso della fase", async () => {
    const matrice = await leggiMatrice();
    // di partenza il gestore pubblica
    assert.equal(decidi(matrice, sess("gestore"), "album-pubblica").ok, true);

    await impostaLivello("album-pubblica", "gestore", "nessuno");
    const dopo = await leggiMatrice();
    const esito = decidi(dopo, sess("gestore"), "album-pubblica");
    assert.equal(esito.ok, false);
    assert.equal(esito.motivo, "ruolo");

    await ripristinaMatrice();
    assert.equal(decidi(await leggiMatrice(), sess("gestore"), "album-pubblica").ok, true);
  });
});

describe("ruolo × azione — ogni combinazione del seme", () => {
  it("la decisione combacia con il livello dichiarato, per tutte le combinazioni", async () => {
    const matrice = await leggiMatrice();
    let controllate = 0;

    for (const f of matrice) {
      for (const ruolo of RUOLI) {
        const livello = f.livelli[ruolo];
        // per il referente di unità si dà l'unità, così `limitato` può passare
        const s = sess(ruolo, ruolo === "referente" ? "u1" : undefined);
        const esito = decidi(matrice, s, f.id);
        controllate++;

        if (livello === "nessuno") {
          assert.equal(esito.ok, false, `${f.id}/${ruolo} dovrebbe essere negato`);
          assert.equal(esito.motivo, "ruolo", `${f.id}/${ruolo}`);
        } else {
          assert.equal(esito.ok, true, `${f.id}/${ruolo} dovrebbe passare`);
          assert.equal(esito.livello, livello, `${f.id}/${ruolo}`);
        }
      }
    }
    assert.equal(controllate, matrice.length * RUOLI.length);
    assert.ok(controllate >= 36, `attese almeno 36 combinazioni, ${controllate}`);
  });

  it("senza sessione tutto è negato, per ogni azione", async () => {
    const matrice = await leggiMatrice();
    for (const f of matrice) {
      const esito = decidi(matrice, null, f.id);
      assert.equal(esito.ok, false, f.id);
      assert.equal(esito.motivo, "sessione", f.id);
    }
  });
});

describe("ambito — un referente di unità e le unità che non sono sue", () => {
  it("per ogni azione limitata, la propria unità passa e le altre cinque no", async () => {
    const matrice = await leggiMatrice();
    const limitate = matrice.filter((f) => f.livelli["referente"] === "limitato");
    assert.ok(limitate.length > 0, "il seme deve avere azioni limitate per il referente di unità");

    let negate = 0;
    for (const f of limitate) {
      for (const mia of UNITA) {
        const s = sess("referente", mia);

        // la propria unità: passa
        const propria = decidi(matrice, s, f.id, { unita: mia });
        assert.equal(propria.ok, true, `${f.id}: ${mia} sulla propria unità`);
        assert.equal(propria.livello, "limitato");

        // le altre cinque: negate, e il motivo è l'ambito
        for (const altra of UNITA.filter((u) => u !== mia)) {
          const esito = decidi(matrice, s, f.id, { unita: altra });
          assert.equal(esito.ok, false, `${f.id}: ${mia} su ${altra} deve essere negato`);
          assert.equal(esito.motivo, "ambito", `${f.id}: ${mia} su ${altra}`);
          negate++;
        }
      }
    }
    assert.equal(negate, limitate.length * UNITA.length * (UNITA.length - 1));
    assert.ok(negate >= 100, `attese almeno 100 negazioni d'ambito, ${negate}`);
  });

  it("«gruppo» è fuori dall'ambito di ogni referente di unità", async () => {
    const matrice = await leggiMatrice();
    const limitate = matrice.filter((f) => f.livelli["referente"] === "limitato");
    for (const f of limitate) {
      for (const mia of UNITA) {
        const esito = decidi(matrice, sess("referente", mia), f.id, { unita: "gruppo" });
        assert.equal(
          esito.ok,
          false,
          `${f.id}: un contenuto di gruppo raccoglie ragazzi di tutte le unità`,
        );
        assert.equal(esito.motivo, "ambito");
      }
    }
  });

  it("un referente di unità SENZA unità nella sessione non copre niente", async () => {
    const matrice = await leggiMatrice();
    const limitate = matrice.filter((f) => f.livelli["referente"] === "limitato");
    for (const f of limitate) {
      const esito = decidi(matrice, sess("referente", undefined), f.id, { unita: "u1" });
      assert.equal(esito.ok, false, `${f.id}: senza unità è il valore prudente`);
      assert.equal(esito.motivo, "ambito");
      // e nemmeno senza risorsa indicata
      assert.equal(decidi(matrice, sess("referente", undefined), f.id).ok, false);
    }
  });

  it("gestore e sviluppatore attraversano ogni unità: è il senso di «completo»", async () => {
    const matrice = await leggiMatrice();
    for (const ruolo of ["gestore", "sviluppatore"]) {
      for (const f of matrice) {
        if (f.livelli[ruolo] === "nessuno") continue;
        for (const u of [...UNITA, "gruppo"]) {
          assert.equal(
            decidi(matrice, sess(ruolo), f.id, { unita: u }).ok,
            true,
            `${ruolo} su ${f.id}/${u}`,
          );
        }
      }
    }
  });
});

describe("le regole che §8 del piano pretende, verificate una per una", () => {
  const nega = async (ruolo, azione) => {
    const matrice = await leggiMatrice();
    const esito = decidi(matrice, sess(ruolo, ruolo === "referente" ? "u1" : undefined), azione);
    assert.equal(esito.ok, false, `${ruolo} NON deve poter fare «${azione}»`);
    return esito;
  };

  it("il referente di unità non approva e non pubblica", async () => {
    await nega("referente", "album-pubblica");
  });

  it("il referente di unità non tocca utenti, ruoli e permessi", async () => {
    await nega("referente", "utenti");
  });

  it("il referente di unità non archivia l'anno", async () => {
    await nega("referente", "archivio-anno");
  });

  it("il referente di unità non modifica i testi globali delle pagine", async () => {
    await nega("referente", "pagine");
  });

  // -------------------------------------------------------------- fase 14
  //
  // Il perimetro deciso il 31 agosto 2026, riga per riga. Le prove generiche
  // qui sopra coprono già le tre righe nuove — leggono la matrice dalla
  // tabella e iterano — ma quelle sono prove sulla *forma*: dicono che
  // `limitato` si comporta come `limitato`. Queste dicono **quale** livello
  // ogni riga deve avere, che è la decisione, e fallirebbero se qualcuno la
  // cambiasse nel seme senza chiederlo.

  it("il referente di unità non rinomina la propria unità né ne cambia il logo", async () => {
    await nega("referente", "unita-anagrafica");
  });

  it("il referente di unità scrive i testi della PROPRIA unità, e di nessun'altra", async () => {
    const matrice = await leggiMatrice();
    const suo = sess("referente", "u1");
    assert.equal(decidi(matrice, suo, "unita-scheda", { unita: "u1" }).ok, true);
    for (const altra of UNITA.filter((u) => u !== "u1")) {
      assert.equal(
        decidi(matrice, suo, "unita-scheda", { unita: altra }).ok,
        false,
        `un referente dell'unità 1 non scrive su «${altra}»`,
      );
    }
    // «gruppo» non è la sua unità: i testi comuni non sono di nessun referente di unità
    assert.equal(decidi(matrice, suo, "unita-scheda", { unita: "gruppo" }).ok, false);
  });

  it("il referente di unità propone i propri referenti, e non quelli di un'altra unità", async () => {
    const matrice = await leggiMatrice();
    const suo = sess("referente", "u4");
    assert.equal(decidi(matrice, suo, "referenti", { unita: "u4" }).ok, true);
    assert.equal(decidi(matrice, suo, "referenti", { unita: "u5" }).ok, false);
  });

  it("il gestore attraversa unità e anagrafica di tutte e sei", async () => {
    const matrice = await leggiMatrice();
    for (const u of UNITA) {
      for (const azione of ["unita-scheda", "unita-anagrafica", "referenti"]) {
        assert.equal(
          decidi(matrice, sess("gestore"), azione, { unita: u }).ok,
          true,
          `gestore → ${azione} su ${u}`,
        );
      }
    }
  });

  it("chi propone non approva: sulla propria unità il livello è «limitato», mai «completo»", async () => {
    /*
     * È la regola che tiene in piedi la coda, e il cancello **da solo non la
     * garantisce**: un referente di unità ha `limitato` su `referenti` e `unita-scheda`, e
     * sulla *propria* unità `copre()` lo lascia passare. Senza altro,
     * potrebbe approvare la proposta che ha appena scritto.
     *
     * `decidiProposta` in `unita/actions.ts` pretende quindi `completo`, non
     * solo `ok`. Questa prova fissa il presupposto di quel controllo: per un
     * referente di unità il livello riconosciuto è `limitato` anche quando passa, e
     * quindi la richiesta di `completo` lo esclude sempre — non «quasi
     * sempre», e non «finché la matrice resta com'è».
     */
    const matrice = await leggiMatrice();
    const suo = sess("referente", "u1");
    for (const azione of ["referenti", "unita-scheda"]) {
      const esito = decidi(matrice, suo, azione, { unita: "u1" });
      assert.equal(esito.ok, true, `${azione}: sulla propria unità passa`);
      assert.equal(
        esito.livello,
        "limitato",
        `${azione}: e passa come «limitato», che è ciò che gli vieta di approvare`,
      );
    }
    // e chi approva davvero ha «completo»
    for (const ruolo of ["gestore", "sviluppatore"]) {
      for (const azione of ["referenti", "unita-scheda"]) {
        assert.equal(decidi(matrice, sess(ruolo), azione, { unita: "u1" }).livello, "completo");
      }
    }
  });

  it("il gestore tocca gli account, ma solo quelli dei referenti di unità", async () => {
    /*
     * Questa prova asseriva l'opposto — «il gestore non tocca utenti,
     * ruoli e permessi» — che è quello che dice §8 del piano.
     *
     * **Cambiata su decisione del 31 agosto 2026**, e la divergenza dal piano è
     * voluta: il ricambio dei referenti di unità è di settembre, e farlo passare da un
     * comando sul server significa che a settembre non si fa. Il piano non
     * distingueva fra «creare un referente di unità» e «creare un altro gestore»;
     * la matrice adesso sì, con `limitato`.
     *
     * Quello che il piano proteggeva resta protetto, ed è la seconda metà di
     * questa prova: un gestore non si dà un pari grado.
     */
    const matrice = await leggiMatrice();
    const esito = decidi(matrice, sess("gestore"), "utenti");
    assert.equal(esito.ok, true, "la schermata si apre");
    assert.equal(esito.livello, "limitato", "ma non con mano libera");
    assert.equal(puoAgireSuRuolo(esito.livello, "referente"), true);
    assert.equal(puoAgireSuRuolo(esito.livello, "gestore"), false);
    assert.equal(puoAgireSuRuolo(esito.livello, "sviluppatore"), false);
  });

  it("il gestore non tocca configurazione, log e backup", async () => {
    await nega("gestore", "backup");
  });

  it("lo sviluppatore può tutto quello che la matrice gli concede", async () => {
    const matrice = await leggiMatrice();
    for (const f of matrice) {
      assert.notEqual(
        f.livelli["sviluppatore"],
        "nessuno",
        `nel seme lo sviluppatore ha «${f.id}»`,
      );
      assert.equal(decidi(matrice, sess("sviluppatore"), f.id).ok, true, f.id);
    }
  });
});

describe("chi può agire su quale account — la riga «utenti»", () => {
  /*
   * La regola più pesante della fase 14.9: chi può invitare può creare un
   * accesso. `limitato` su questa riga significa «i soli referenti di unità», e non è
   * `copre()` a verificarlo — l'ambito non è un'unità.
   *
   * Sono le prove che tengono in piedi quella regola. Sbagliarla non produce un
   * errore: produce un gestore che si è dato un pari grado.
   */
  const RUOLI_BERSAGLIO = ["referente", "gestore", "sviluppatore", "social"];

  it("con «completo» si tocca qualunque account", () => {
    for (const r of RUOLI_BERSAGLIO) {
      assert.equal(puoAgireSuRuolo("completo", r), true, r);
    }
  });

  it("con «limitato» si toccano SOLO i referenti di unità e il social media manager", () => {
    assert.equal(puoAgireSuRuolo("limitato", "referente"), true);
    // il gestore sceglie chi gli prepara i contenuti: è sotto di lui
    assert.equal(puoAgireSuRuolo("limitato", "social"), true);
    assert.equal(
      puoAgireSuRuolo("limitato", "gestore"),
      false,
      "un gestore non si dà un pari grado",
    );
    assert.equal(
      puoAgireSuRuolo("limitato", "sviluppatore"),
      false,
      "e non si promuove ad amministratore",
    );
  });

  it("un ruolo inventato non passa nemmeno con «limitato»", () => {
    // chiusura prudente: la funzione ammette un solo valore, non «tutto tranne
    // due». Un ruolo nuovo nasce quindi chiuso, come una riga assente dalla
    // matrice.
    assert.equal(puoAgireSuRuolo("limitato", "referente-supremo"), false);
    assert.equal(puoAgireSuRuolo("limitato", ""), false);
  });

  it("la matrice concede «utenti» al gestore, ma come «limitato»", async () => {
    /*
     * Le due metà insieme: il cancello lo lascia passare — quindi la schermata
     * si apre e il ricambio di settembre si fa — e il livello riconosciuto è
     * `limitato`, che è ciò che `puoAgireSuRuolo` traduce in «solo referenti di unità».
     *
     * Se un domani qualcuno mettesse quella riga a `completo` dalla schermata,
     * questa prova continuerebbe a passare ed è giusto: la matrice è
     * configurazione, e quel clic è una decisione consapevole di chi
     * amministra. Ciò che le prove garantiscono è che il *seme* non lo faccia da
     * sé.
     */
    const matrice = await leggiMatrice();
    const esito = decidi(matrice, sess("gestore"), "utenti");
    assert.equal(esito.ok, true);
    assert.equal(esito.livello, "limitato");
  });

  it("il referente di unità non tocca account, in nessun modo", async () => {
    const matrice = await leggiMatrice();
    assert.equal(decidi(matrice, sess("referente", "u1"), "utenti").ok, false);
  });
});

describe("il social media manager — tutto in coda, niente pubblicato da sé", () => {
  /*
   * La decisione del 3 ottobre 2026: carica album, cambia foto e testi di tutte
   * le unità e del sito, e ogni modifica passa dall'approvazione del referente
   * gruppo o dello sviluppatore. Nella matrice è `limitato`; per lui non vuol
   * dire «la propria unità» — non ne ha una — ma «con l'approvazione».
   *
   * Le prove sono le due metà della regola: l'ambito copre tutto, e ogni cosa
   * che il cancello gli lascia fare passa da `vaInCoda`.
   */
  const CONTENUTI = ["album-carica", "unita-scheda", "unita-anagrafica", "attivita", "pagine"];
  const NEGATE = [
    "album-pubblica",
    "documenti",
    // i documenti per i referenti, dal 6 ottobre 2026: sono dei referenti, il social no
    "documenti-referenti-leggi",
    "documenti-referenti-carica",
    "identita",
    "referenti",
    "iscritti",
    // dal 4 ottobre 2026 la lettura dell'elenco è una riga a parte, e il social
    // non ha nemmeno quella; né il registro né le richieste delle famiglie
    "iscritti-elenco",
    // la verifica a campione dei consensi, dal 7 ottobre 2026: non è sua
    "consensi-verifica",
    "messaggi",
    "archivio-anno",
    "esporta",
    "utenti",
    "permessi",
    "permessi-leggi",
    "gdpr",
    "privacy",
    "registro",
    "backup",
    "viste",
  ];

  it("sulle righe di contenuto ha «limitato», e attraversa ogni unità e il gruppo", async () => {
    const matrice = await leggiMatrice();
    for (const azione of CONTENUTI) {
      for (const unita of [...UNITA, "gruppo", undefined]) {
        const esito = decidi(matrice, sess("social"), azione, unita ? { unita } : undefined);
        assert.equal(esito.ok, true, `${azione} su ${unita ?? "nessuna unità"}`);
        assert.equal(esito.livello, "limitato", azione);
      }
    }
  });

  it("e con «limitato» ogni sua scrittura va in coda", () => {
    assert.equal(vaInCoda("social", "limitato"), true);
  });

  it("non pubblica, non legge iscritti né messaggi, non tocca account né configurazione", async () => {
    const matrice = await leggiMatrice();
    for (const azione of NEGATE) {
      const esito = decidi(matrice, sess("social"), azione, { unita: "u1" });
      assert.equal(esito.ok, false, azione);
      assert.equal(esito.motivo, "ruolo", azione);
    }
  });

  it("le due liste coprono la matrice intera: una riga nuova va decisa, non ereditata", async () => {
    const matrice = await leggiMatrice();
    assert.deepEqual(
      matrice.map((f) => f.id).sort(),
      [...CONTENUTI, ...NEGATE].sort(),
      "è comparsa una riga: decidete che cosa vuol dire per il social media manager",
    );
  });

  it("«limitato» non manda in coda gli altri ruoli: il referente di unità resta «metà e metà»", () => {
    assert.equal(vaInCoda("referente", "limitato"), false);
    assert.equal(vaInCoda("gestore", "limitato"), false);
  });

  it("«completo» non va in coda nemmeno per lui: se la matrice lo dice, pubblica", () => {
    // la matrice decide: un amministratore che gira una sua riga a «completo»
    // sceglie di lasciarlo pubblicare lì, e la schermata lo dice
    assert.equal(vaInCoda("social", "completo"), false);
  });

  it("il gestore lo può invitare, il social media manager non invita nessuno", async () => {
    const matrice = await leggiMatrice();
    const referente = decidi(matrice, sess("gestore"), "utenti");
    assert.equal(referente.ok, true);
    assert.equal(puoAgireSuRuolo(referente.livello, "social"), true);
    assert.equal(decidi(matrice, sess("social"), "utenti").ok, false);
  });
});

describe("il ciclo dei clic nella matrice non passa dal permesso pieno", () => {
  /*
   * La matrice applica subito: un livello sbagliato per due secondi è un
   * permesso aperto per due secondi. Il ciclo dei clic va quindi dal più
   * stretto al più largo, così allargare di un passo dà il passo successivo e
   * non l'ultimo.
   *
   * Trovato provando davvero, nella fase 14.7: per mettere `documenti` a
   * «limitato» bisognava passare da «completo», e fra i due clic un referente di unità
   * poteva toccare la modulistica del gruppo.
   */
  let CICLO_LIVELLI;

  before(async () => {
    ({ CICLO_LIVELLI } = await import("@/lib/permessi"));
  });

  it("da «nessuno» il passo successivo è «limitato», non «completo»", () => {
    const i = CICLO_LIVELLI.indexOf("nessuno");
    assert.equal(CICLO_LIVELLI[(i + 1) % CICLO_LIVELLI.length], "limitato");
  });

  it("il ciclo contiene i tre livelli, una volta ciascuno", () => {
    assert.deepEqual([...CICLO_LIVELLI].sort(), ["completo", "limitato", "nessuno"]);
  });

  it("l'ordine è crescente in permissività", () => {
    // se un domani i livelli diventassero quattro, questa riga direbbe subito
    // che il ciclo va rimesso in ordine
    assert.deepEqual(CICLO_LIVELLI, ["nessuno", "limitato", "completo"]);
  });
});

describe("chiusura prudente", () => {
  it("un'azione che non è nella matrice è negata, non aperta", async () => {
    const matrice = await leggiMatrice();
    assert.equal(livelloNellaMatrice(matrice, "azione-inventata", "sviluppatore"), "nessuno");
    const esito = decidi(matrice, sess("sviluppatore"), "azione-inventata");
    assert.equal(esito.ok, false);
    assert.equal(esito.motivo, "ruolo");
  });

  it("togliere una riga dalla matrice chiude l'azione, non la apre", async () => {
    const { togliFunzione } = await import("@/lib/permessi-store");
    await ripristinaMatrice();
    assert.equal(decidi(await leggiMatrice(), sess("sviluppatore"), "documenti").ok, true);

    await togliFunzione("documenti");
    const esito = decidi(await leggiMatrice(), sess("sviluppatore"), "documenti");
    assert.equal(esito.ok, false, "una riga assente non è un permesso aperto");
    await ripristinaMatrice();
  });

  it("un ruolo sconosciuto non ottiene niente", async () => {
    const matrice = await leggiMatrice();
    for (const f of matrice) {
      const esito = decidi(matrice, sess("referente-supremo"), f.id);
      assert.equal(esito.ok, false, f.id);
    }
  });

  it("una funzione nuova nasce chiusa per tutti", async () => {
    const { aggiungiFunzione } = await import("@/lib/permessi-store");
    await aggiungiFunzione("Funzione nuova", "funzione-nuova");
    const matrice = await leggiMatrice();
    for (const ruolo of RUOLI) {
      const esito = decidi(matrice, sess(ruolo, "u1"), "funzione-nuova");
      assert.equal(esito.ok, false, `${ruolo} non deve avere una funzione appena creata`);
    }
  });
});

describe("il messaggio del rifiuto non dice quale cancello ha chiuso", () => {
  it("«ruolo» e «ambito» danno la stessa frase all'utente", () => {
    const perRuolo = new Negato("ruolo", "utenti");
    const perAmbito = new Negato("ambito", "album-carica");
    assert.equal(
      perRuolo.message,
      perAmbito.message,
      "distinguerli direbbe a chi tira a indovinare che la risorsa esiste",
    );
    assert.notEqual(perRuolo.motivo, perAmbito.motivo, "ma il motivo vero resta, per il registro");
  });

  it("la sessione scaduta è l'unico caso che si distingue, e va detto", () => {
    const scaduta = new Negato("sessione", "documenti");
    assert.match(scaduta.message, /sessione/i);
    assert.notEqual(scaduta.message, new Negato("ruolo", "documenti").message);
  });

  it("il messaggio non nomina l'azione né l'unità", () => {
    const e = new Negato("ambito", "album-carica");
    assert.ok(!e.message.includes("album-carica"));
    assert.ok(!e.message.toLowerCase().includes("u1"));
  });
});

describe("i rifiuti finiscono nel registro", () => {
  it("un rifiuto d'ambito lascia una riga con esito «rifiutato»", async () => {
    // `contesto()` registra prima di sollevare; qui si prova la scrittura che
    // ne è l'effetto, chiamando lo stesso store che usa
    const { registra } = await import("@/lib/registro-store");
    await registra(
      sess("referente", "u1"),
      "configurazione",
      "Rifiutata «album-carica» (unità u2) — ambito",
      "autorizzazione",
      "rifiutato",
    );

    const r = raw.prepare("SELECT utente, tipo, operazione, origine, esito FROM registro").get();
    assert.equal(r.esito, "rifiutato");
    assert.equal(r.origine, "autorizzazione");
    assert.match(r.operazione, /album-carica/);
    assert.match(r.operazione, /ambito/);
  });
});
