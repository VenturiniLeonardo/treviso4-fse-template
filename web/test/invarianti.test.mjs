import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Gli invarianti del progetto: le regole che non stanno in nessuna funzione.
 *
 * Sono proprietà che valgono su **tutto il codice** e che si rompono con una
 * modifica ragionevole fatta in buona fede — un `cp` di troppo, una Server
 * Action nuova scritta copiando quella accanto, un `TODO` lasciato in fretta.
 * Nessuna prova sul comportamento se ne accorge, perché non c'è un
 * comportamento sbagliato: c'è una regola non seguita.
 *
 * Stanno fra le prove e non in uno script a parte perché così girano in CI e
 * sul portatile con lo stesso comando, e perché una regola che si controlla
 * solo quando qualcuno si ricorda non è una regola.
 */

/*
 * Qui c'era «i due fogli di stile e la regola diversa per ciascuno», che
 * confrontava `web/styles/` con le copie del generatore statico Python in
 * `src/static/css/`. Il generatore è stato tolto prima della messa in linea (23
 * settembre 2026): `web/styles/` è adesso l'unica copia dei fogli di stile, e
 * non c'è più niente con cui divergere.
 */

describe("niente residui di sviluppo nel codice servito", () => {
  /** Tutti i file di codice sotto app/, components/, lib/ e la radice. */
  function sorgenti(dir = ".", raccolti = []) {
    for (const v of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, v.name);
      if (v.isDirectory()) {
        /*
         * Le cartelle che non contengono sorgente nostro.
         *
         * `.next-*` con il glob e non per nome: la cartella di compilazione è
         * configurabile (`distDir` in next.config.ts) e il pacchetto statico
         * pubblico usa `.next-pubblico`. Elencando i nomi uno per uno, la
         * prossima cartella di build farebbe fallire questa prova su un
         * `@ts-ignore` che Next scrive nei propri tipi generati — un allarme
         * su codice che non abbiamo scritto noi.
         */
        if (["node_modules", "dati", "test", "drizzle"].includes(v.name)) continue;
        if (v.name.startsWith(".next")) continue;
        sorgenti(p, raccolti);
      } else if (/\.(ts|tsx)$/.test(v.name) && !v.name.endsWith(".d.ts")) {
        raccolti.push(p);
      }
    }
    return raccolti;
  }

  const file = sorgenti();

  it("ci sono file da controllare (se no la prova non prova niente)", () => {
    assert.ok(file.length > 50, `trovati solo ${file.length} file`);
  });

  for (const marca of ["TODO", "FIXME", "XXX:", "@ts-ignore", "eslint-disable"]) {
    it(`nessun «${marca}»`, () => {
      const con = file.filter((f) => readFileSync(f, "utf8").includes(marca));
      assert.deepEqual(con, [], `${marca} trovato in: ${con.join(", ")}`);
    });
  }

  it("nessun console.log fuori dall'avvio del server", () => {
    /*
     * `instrumentation.ts` è l'eccezione dichiarata: gira una volta all'avvio e
     * quelle righe finiscono in `journalctl`, dove servono. Un `console.log` in
     * una pagina o in un'azione invece gira a ogni richiesta, e su un sito con
     * dati di minori è il modo più facile di riempire un registro di nomi.
     */
    const con = file.filter(
      (f) => f !== "instrumentation.ts" && readFileSync(f, "utf8").includes("console.log("),
    );
    assert.deepEqual(con, [], `console.log in: ${con.join(", ")}`);
  });
});

describe("niente contenuto finto nelle pagine pubbliche", () => {
  /** I file che compongono il sito pubblico. */
  function pubblici(dir, raccolti = []) {
    for (const v of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, v.name);
      if (v.isDirectory()) pubblici(p, raccolti);
      else if (/\.tsx$/.test(v.name)) raccolti.push(p);
    }
    return raccolti;
  }

  const file = [...pubblici(join("app", "(sito)")), ...pubblici(join("components", "site"))];

  it("ci sono pagine da controllare", () => {
    assert.ok(file.length > 15, `trovati solo ${file.length} file`);
  });

  it("nessuna griglia di segnaposto generata a ripetizione", () => {
    /*
     * La regola nasce da un difetto vero: l'album senza fotografie mostrava
     * dodici riquadri rigati numerati da 1 a 12, con le altezze alternate «come
     * una parete di stampe». Nel mockup servivano a far vedere il disegno di
     * una galleria piena; sul sito vero, sotto la riga «nessuna ancora», erano
     * dodici fotografie che non esistono.
     *
     * `Array.from({ length: N })` in una pagina pubblica è la forma che prende
     * quel difetto: N elementi di contenuto che nessuno ha caricato. Nell'area
     * riservata è un'altra cosa — le righe vuote in fondo a una tabella da
     * compilare sono uno strumento di redazione — e infatti questa prova
     * guarda solo il sito pubblico.
     */
    const con = file.filter((f) => /Array\.from\(\{\s*length/.test(readFileSync(f, "utf8")));
    assert.deepEqual(
      con,
      [],
      `contenuto ripetuto generato in: ${con.join(", ")}. ` +
        "Un elenco pubblico si disegna sui dati che ci sono, non su un numero fisso.",
    );
  });

  /**
   * Il file senza i commenti.
   *
   * Serve perché la prova qui sotto cerca parole che non devono **arrivare al
   * pubblico**, e un commento non arriva a nessuno: la prima versione segnalava
   * la riga che spiega come sono stati togliersi due «Nome Cognome» dal mockup,
   * cioè accusava la nota che documenta la correzione. Una prova che si offende
   * per la propria spiegazione va sistemata, non zittita.
   *
   * Lo `//` si taglia solo se non è preceduto da due punti, per non mangiare
   * `https://` dentro una stringa.
   */
  const senzaCommenti = (testo) =>
    testo.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("nessun riquadro segnaposto porta l'etichetta del progetto grafico", () => {
    /*
     * `<Photo label="…">` disegna una scritta sopra il rettangolo rigato. Nel
     * mockup diceva che immagine ci sarebbe andata — «foto fascia gialla»,
     * «ritratto», «foto d'archivio», «copertina dell'album» — ed erano note del
     * designer servite a un genitore: il nome di una cosa che non c'è.
     *
     * L'audit ne ha contate nove diverse su ventuno pagine. Adesso i riquadri
     * vuoti sono rettangoli nel colore della fascia e basta, e l'immagine vera
     * la mette chi carica (`ImmagineSlot`, i diciotto posti di
     * `lib/slot-immagini.ts`).
     *
     * `labelClass` resta consentito: è una classe CSS, non un testo. E
     * `aria-label` pure, che è l'opposto del problema.
     */
    const con = [];
    for (const f of file) {
      const testo = senzaCommenti(readFileSync(f, "utf8"));
      for (const m of testo.matchAll(/\blabel=\{?["'`]/g)) {
        const prima = testo.slice(Math.max(0, m.index - 12), m.index);
        if (/aria-|labelled|labelClass/.test(prima + "label")) continue;
        con.push(`${f}: ${testo.slice(m.index, m.index + 40).split("\n")[0]}`);
      }
    }
    assert.deepEqual(
      con,
      [],
      `etichetta da mockup in: ${con.join("; ")}. ` +
        "Un riquadro vuoto non si annuncia: o c'è l'immagine, o c'è il colore.",
    );
  });

  it("nessuna parola da riempitivo nel testo servito", () => {
    /*
     * L'elenco è quello dell'audit di produzione. Vale sui sorgenti del sito
     * pubblico perché è lì che una frase di comodo scritta per far vedere
     * l'impaginazione resta poi per sempre.
     *
     * `placeholder` non è nell'elenco: è il nome di un attributo HTML, e nei
     * moduli ci sono i suggerimenti veri («es. Mario Rossi»). Quello che conta
     * è che dentro non ci sia un nome finto, e i nomi finti sono elencati qui.
     *
     * «Lorem ipsum» e «Label» invece sono ammessi: in questo modello sono i
     * segnaposto voluti di tutti i contenuti, da sostituire prima di andare
     * in linea.
     */
    const vietate = [
      "Nome Cognome",
      "Mario Rossi</",
      "coming soon",
      "Coming soon",
      "prossimamente",
      "esempio.it",
      "example.com",
      "dummy",
      "TBD",
      "da definire",
    ];
    const trovate = [];
    for (const f of file) {
      const testo = senzaCommenti(readFileSync(f, "utf8"));
      for (const w of vietate) if (testo.includes(w)) trovate.push(`${f}: «${w}»`);
    }
    assert.deepEqual(trovate, [], trovate.join("; "));
  });
});

describe("ogni Server Action passa da un cancello", () => {
  /*
   * La regola di §05: «il referente di unità non vede meno cose in interfaccia, non
   * gliele restituisce proprio il server». Il middleware protegge gli
   * indirizzi, non le azioni — Next le risolve per identificativo — quindi ogni
   * file di azioni deve interrogare la matrice.
   *
   * Il controllo è grossolano di proposito: guarda che il file **nomini** un
   * cancello, non che lo chiami nel posto giusto. Una prova fine su questo
   * sarebbe un'analisi statica, e quella che serve davvero è l'altra: che un
   * file di azioni nuovo, scritto copiando quello accanto, non nasca senza
   * niente.
   */
  const azioni = [];
  function raccogli(dir) {
    for (const v of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, v.name);
      if (v.isDirectory()) raccogli(p);
      else if (v.name === "actions.ts") azioni.push(p);
    }
  }
  raccogli("app");

  /**
   * I tre file che non passano dalla matrice, e perché.
   *
   * Vanno tenuti pochi e giustificati: ogni riga qui è un'eccezione, e le
   * eccezioni si moltiplicano se non costa niente aggiungerle.
   */
  const ESENTI = new Map([
    [
      join("app", "(sito)", "contatti", "actions.ts"),
      "il modulo contatti è pubblico per definizione: il cancello è il limite per IP",
    ],
    [
      join("app", "(sito)", "foto", "actions.ts"),
      "apre un album con la sua password: la password è il cancello, e il limite per IP la difende",
    ],
    [
      join("app", "(sito)", "legale", "preferenze-cookie", "actions.ts"),
      "scrive una preferenza nel cookie di chi la imposta, non nel database",
    ],
    [
      join("app", "(area)", "area-riservata", "accedi", "actions.ts"),
      "è il cancello: qui si entra, quindi non si può già essere dentro",
    ],
    [
      join("app", "(area)", "area-riservata", "accedi", "totp", "actions.ts"),
      "secondo passo dell'accesso: la mezza sessione è la sua autorizzazione",
    ],
    [
      join("app", "(area)", "area-riservata", "accedi", "password", "actions.ts"),
      "ultimo passo del primo accesso: la sessione piena con la password provvisoria è la sua autorizzazione, e vuole di nuovo quella password",
    ],
    [
      join("app", "(area)", "area-riservata", "invito", "[token]", "actions.ts"),
      "l'invito è la credenziale: chi arriva qui non ha ancora un ruolo",
    ],
    [
      join("app", "(area)", "area-riservata", "profilo", "actions.ts"),
      "ognuno sul proprio account: il cancello è `sessioneCorrente`",
    ],
  ]);

  it("ci sono file di azioni da controllare", () => {
    assert.ok(azioni.length >= 10, `trovati solo ${azioni.length} file di azioni`);
  });

  for (const f of azioni) {
    it(`${f} è protetto`, () => {
      const testo = readFileSync(f, "utf8");
      const motivo = ESENTI.get(f);
      const cancello =
        /\bcontesto\(/.test(testo) ||
        /\bpuo\(/.test(testo) ||
        /\bautorizzaSuUtente\(/.test(testo) ||
        /\bsessioneCorrente\(/.test(testo) ||
        /\bchiEntra\(/.test(testo);

      if (motivo) {
        // un'esenzione che non serve più va togliersi, non lasciata a coprire
        // un file che intanto ha imparato a proteggersi
        assert.ok(true, motivo);
        return;
      }
      assert.ok(
        cancello,
        `${f} non nomina nessun cancello autorizzativo. Se è voluto, va aggiunto a ESENTI con il perché.`,
      );
    });
  }
});

describe("le intestazioni di sicurezza sono dichiarate", () => {
  const config = readFileSync("next.config.ts", "utf8");
  for (const h of [
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "X-Frame-Options",
    "Strict-Transport-Security",
    "Content-Security-Policy",
  ]) {
    it(h, () => assert.ok(config.includes(h), `manca ${h} in next.config.ts`));
  }

  it("il limite del corpo delle azioni copre le fotografie che il sito promette", () => {
    /*
     * Tre numeri che devono restare d'accordo, e che stanno in tre file
     * diversi: `bodySizeLimit` qui, `FOTO_PESO_MAX` e `CARICO_MAX` in
     * `lib/contenuti.ts`.
     *
     * Senza `bodySizeLimit` Next si ferma a 1 MB: il sito diceva «fino a 20 MB»
     * e qualunque fotografia scattata con un telefono moriva con una pagina
     * «500» prima di arrivare al codice che avrebbe saputo rifiutarla per
     * bene. Abbassare quel numero — o alzare `FOTO_PESO_MAX` senza toccarlo —
     * rimette il sito in quella condizione, e nessuna prova sul comportamento
     * se ne accorgerebbe: il guasto sta nel trasporto, e le prove chiamano le
     * funzioni direttamente.
     */
    const contenuti = readFileSync(join("lib", "contenuti.ts"), "utf8");
    const mb = (n) => n / (1024 * 1024);

    const limite = config.match(/bodySizeLimit:\s*"(\d+)mb"/);
    assert.ok(limite, "manca experimental.serverActions.bodySizeLimit in next.config.ts");
    const corpoMb = Number(limite[1]);

    const peso = contenuti.match(/FOTO_PESO_MAX\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    const carico = contenuti.match(/CARICO_MAX\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    assert.ok(peso && carico, "FOTO_PESO_MAX e CARICO_MAX devono restare leggibili in MB");

    assert.ok(
      corpoMb > Number(peso[1]),
      `bodySizeLimit (${corpoMb} MB) deve stare sopra FOTO_PESO_MAX (${peso[1]} MB): ` +
        "il multipart aggiunge intestazioni, e una fotografia al limite deve passare",
    );
    assert.ok(
      Number(carico[1]) < corpoMb,
      `CARICO_MAX (${carico[1]} MB) deve stare sotto bodySizeLimit (${corpoMb} MB): ` +
        "è il controllo nel browser, e serve solo se scatta prima di quello di Next",
    );
    // il proxy clona il corpo con un suo limite (10 MB di predefinito): deve
    // stare almeno a quello delle azioni, o le foto oltre 10 MB arrivano
    // troncate (report QA, BUG-007)
    const proxy = config.match(/proxyClientMaxBodySize:\s*"(\d+)mb"/);
    assert.ok(proxy, "manca experimental.proxyClientMaxBodySize in next.config.ts");
    assert.ok(
      Number(proxy[1]) >= corpoMb,
      `proxyClientMaxBodySize (${proxy[1]} MB) deve stare almeno a bodySizeLimit (${corpoMb} MB)`,
    );
    assert.ok(mb(1) > 0);
  });

  it("HSTS solo in produzione", () => {
    /*
     * Su `http://localhost` un browser che riceve HSTS si impunta sull'HTTPS per
     * tutte le porte della macchina.
     *
     * `lastIndexOf` e non `indexOf`: il nome compare anche nel commento in cima
     * al file, e cercare la prima occorrenza guardava lì — la prova falliva pur
     * essendo il codice giusto. Un controllo che legge un commento invece del
     * codice è peggio di nessun controllo.
     */
    const i = config.lastIndexOf("Strict-Transport-Security");
    assert.ok(
      config.slice(Math.max(0, i - 400), i).includes('NODE_ENV === "production"'),
      "HSTS deve stare dietro il controllo su NODE_ENV",
    );
  });
});
