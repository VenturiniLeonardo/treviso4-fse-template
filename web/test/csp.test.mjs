import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Le due politiche di sicurezza dei contenuti.
 *
 * Il sito ne ha **due**, e la differenza è deliberata:
 *
 *  - le pagine pubbliche sono prerenderizzate (§04: una visita non sveglia il
 *    database), quindi non possono avere un nonce — che è diverso a ogni
 *    risposta — e `script-src` deve tollerare gli script in linea del carico
 *    RSC;
 *  - l'area riservata è già dinamica per costruzione (Fig. 3 del piano), quindi
 *    lì il nonce non costa niente e `'unsafe-inline'` **non c'è**.
 *
 * Queste prove non guardano una risposta HTTP: guardano il **sorgente**, perché
 * il modo in cui questa costruzione si rompe è che qualcuno «semplifichi»
 * unendo le due politiche o rimettendo `'unsafe-inline'` dove è stato tolto. Un
 * errore così non fa cadere nessuna pagina: si vede solo leggendo l'header, e
 * nessuno lo legge.
 */

const config = readFileSync("next.config.ts", "utf8");
const mw = readFileSync("proxy.ts", "utf8");

/** Il blocco `CSP_COMUNE` come sta scritto nel file. */
const comune = config.slice(
  config.indexOf("export const CSP_COMUNE"),
  config.indexOf("];", config.indexOf("export const CSP_COMUNE")),
);

/**
 * La politica dell'area, come la compone il middleware.
 *
 * Il taglio finisce su `].join` e non sulla prima graffa chiusa: dentro la
 * funzione c'è un `${nonce}`, e cercare `}` si fermerebbe lì tagliando via
 * proprio la direttiva da controllare. È il tipo di prova che passa per il
 * motivo sbagliato.
 */
const inizioNonce = mw.indexOf("function cspConNonce");
const conNonce = mw.slice(inizioNonce, mw.indexOf('].join', inizioNonce));

describe("le direttive che valgono su tutto", () => {
  for (const direttiva of [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "connect-src 'self'",
    "font-src 'self'",
  ]) {
    it(`«${direttiva}» è nella politica comune`, () => {
      assert.ok(comune.includes(direttiva), `manca: ${direttiva}`);
    });
  }

  it("`script-src` NON sta nella politica comune", () => {
    // se ci stesse, le due metà avrebbero la stessa politica e il nonce
    // dell'area non servirebbe a niente
    assert.equal(
      comune.includes("script-src"),
      false,
      "script-src deve restare fuori: è la sola direttiva che cambia fra le due metà",
    );
  });

  it("`frame-ancestors 'none'` c'è, ed è quella che regge il clickjacking", () => {
    assert.ok(comune.includes("frame-ancestors 'none'"));
    // e `X-Frame-Options` la accompagna, per i browser che non leggono la prima
    assert.ok(config.includes('key: "X-Frame-Options"'));
  });
});

describe("area riservata: nessuno script in linea non firmato", () => {
  it("la politica con nonce non contiene 'unsafe-inline'", () => {
    assert.equal(
      /unsafe-inline/.test(conNonce),
      false,
      "l'area riservata non deve tollerare script in linea senza nonce",
    );
  });

  it("contiene il nonce e 'strict-dynamic'", () => {
    assert.ok(/nonce-\$\{nonce\}/.test(conNonce), "manca il nonce");
    assert.ok(
      conNonce.includes("'strict-dynamic'"),
      "senza strict-dynamic la navigazione lato client si rompe al primo fascicolo nuovo",
    );
  });

  it("il nonce va sia sulla richiesta sia sulla risposta", () => {
    // sulla richiesta perché è da lì che Next lo legge per marcare i propri
    // script; sulla risposta perché è la politica che il browser applica
    assert.ok(mw.includes('intestazioni.set("x-nonce"'), "manca x-nonce sulla richiesta");
    assert.ok(
      mw.includes('intestazioni.set("Content-Security-Policy"'),
      "manca la politica sulla richiesta: Next non troverebbe il nonce",
    );
    assert.ok(
      mw.includes('risposta.headers.set("Content-Security-Policy"'),
      "manca la politica sulla risposta",
    );
  });

  it("il nonce è casuale a ogni risposta, non una costante", () => {
    assert.ok(
      mw.includes("crypto.getRandomValues"),
      "un nonce prevedibile non è un nonce",
    );
  });

  it("nessun `NextResponse.next()` nudo lascia passare una pagina senza politica", () => {
    // l'unico ammesso è quello per il sito pubblico, che ha la CSP fissa di
    // `next.config.ts` e arriva qui solo per il controllo delle Server Action
    // da fuori; dentro `conNonce` c'è `NextResponse.next({ … })`, che lo mette
    const pubblico =
      /if \(pathname !== "\/area-riservata" && !pathname\.startsWith\("\/area-riservata\/"\) && !pathname\.startsWith\(`\$\{ANTEPRIMA\}\/`\)\) \{\s*return NextResponse\.next\(\);\s*\}/;
    assert.match(mw, pubblico, "il passaggio nudo è ammesso solo fuori dall'area e dall'anteprima");
    const nudi = [...mw.replace(pubblico, "").matchAll(/NextResponse\.next\(\s*\)/g)];
    assert.deepEqual(
      nudi.map((m) => m[0]),
      [],
      "una risposta che passa oltre senza `conNonce` esce senza politica dell'area",
    );
  });
});

describe("«'unsafe-eval'» esiste solo in sviluppo", () => {
  /**
   * Perché ci sia: `next dev` ricarica a caldo valutando codice con `eval`, e
   * senza questa parola la politica fa cadere l'intero fascicolo del client.
   * La pagina resta quella prerenderizzata e non si idrata niente — spariscono
   * la lente della ricerca e il pulsante del menu, che sono `hidden` finché il
   * componente non è vivo. Ci si accorge del guasto guardando la barra, non
   * leggendo un errore.
   *
   * Perché sia sotto prova: è l'unico allargamento della politica che il
   * progetto si concede, e il modo in cui diventa un buco è che qualcuno lo
   * scriva dentro `script-src` invece che dentro la costante che si spegne in
   * produzione. In un'intestazione servita non si vedrebbe la differenza fino
   * al giorno sbagliato.
   */
  it("sta in una costante spenta in produzione, non a mano in `script-src`", () => {
    assert.ok(
      config.includes(
        'export const CSP_SVILUPPO =\n  process.env.NODE_ENV === "production" ? [] : ["\'unsafe-eval\'"];',
      ),
      "CSP_SVILUPPO deve essere vuoto quando NODE_ENV è production",
    );
  });

  for (const [nome, testo] of [
    ["pubblica", config],
    ["dell'area", mw],
  ]) {
    it(`la politica ${nome} non se la scrive dentro \`script-src\``, () => {
      // si guarda la direttiva scritta, non il file: nei commenti la parola
      // compare, ed è giusto che compaia
      assert.equal(
        /script-src[^`"]*unsafe-eval/.test(testo),
        false,
        "«'unsafe-eval'» si aggiunge solo espandendo CSP_SVILUPPO, che in produzione è vuoto",
      );
    });
  }
});

describe("le due politiche non si sovrappongono", () => {
  it("la CSP pubblica esclude i percorsi dell'area", () => {
    // due intestazioni CSP sulla stessa risposta si sommano: il browser fa
    // rispettare entrambe, e quella larga accanto a quella col nonce
    // bloccherebbe tutto
    assert.ok(
      config.includes("(?!area-riservata|anteprima)"),
      "la sorgente della CSP pubblica deve escludere area riservata e anteprima",
    );
  });

  it("il matcher del proxy copre esattamente quei percorsi", () => {
    assert.ok(mw.includes('"/area-riservata/:path*"'));
    assert.ok(mw.includes('"/anteprima/:path*"'));
  });
});
