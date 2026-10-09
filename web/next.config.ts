import type { NextConfig } from "next";

/** I pacchetti con codice compilato, che nel runtime Edge non esistono. */
const NATIVI = ["sharp", "better-sqlite3"];

/**
 * Le intestazioni di sicurezza, su tutte le risposte servite da Next.
 *
 * L'audit di §09 le ha trovate assenti: nessuna delle cinque c'era, e sono
 * righe che non costano niente e chiudono classi intere di guai. Stanno qui e
 * non nel Caddy di §06 perché così valgono anche in sviluppo e in prova, e
 * perché una configurazione del server è un file che si dimentica di copiare —
 * questa viaggia con il pacchetto.
 *
 * `Content-Security-Policy` merita una spiegazione, perché è quella dichiarata
 * a metà. Le direttive che valgono davvero ci sono tutte:
 *
 *  - `frame-ancestors 'none'` — nessuno può incorniciare il sito: è la difesa
 *    dal clickjacking sull'area riservata, dove ci sono pulsanti che
 *    pubblicano e cancellano;
 *  - `form-action 'self'` — un modulo non può spedire altrove, nemmeno se
 *    qualcuno riuscisse a scrivere nella pagina;
 *  - `base-uri 'self'` — nessun `<base>` iniettato può dirottare gli indirizzi
 *    relativi, che è il modo classico di trasformare una piccola iniezione in
 *    un caricamento di script da fuori;
 *  - `object-src 'none'` — niente plugin;
 *  - `default-src 'self'` e `connect-src 'self'` — niente esce verso terzi.
 *    Vale anche come verifica dell'impegno «ospitato in UE» di §04: i caratteri
 *    sono già serviti dal nostro dominio, e questa riga fa fallire in modo
 *    visibile la prima libreria che qualcuno importasse da una CDN.
 *
 * `script-src` è **l'unica direttiva che cambia fra le due metà del sito**, e
 * per questo non sta nell'elenco comune qui sotto:
 *
 *  - sulle **pagine pubbliche** contiene `'unsafe-inline'`, perché sono
 *    prerenderizzate e un nonce — diverso a ogni risposta — le renderebbe
 *    dinamiche, contro §04;
 *  - nell'**area riservata** c'è un nonce e `'unsafe-inline'` non c'è. Quelle
 *    pagine sono già dinamiche per costruzione (Fig. 3 del piano), quindi il
 *    nonce non costa niente, e lo scrive `proxy.ts` — che è l'unico posto
 *    da cui si può, visto che le intestazioni di qui sono fisse.
 *
 * Il risultato è che la politica stretta copre esattamente le schermate con gli
 * elenchi di iscritti e i pulsanti che pubblicano e cancellano. Il perché per
 * esteso, da tutte e due le parti, sta su `CSP_PUBBLICA` qui sotto e su
 * `cspConNonce` nel proxy.
 *
 * `Strict-Transport-Security` solo in produzione: su `http://localhost` un
 * browser che la riceve si impunta sull'HTTPS per tutte le porte della
 * macchina, e si passa il pomeriggio a capire perché.
 */
/** Le direttive che valgono per tutte e due le politiche. `script-src` no: vedi sopra. */
export const CSP_COMUNE = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
];

/**
 * La politica delle **pagine pubbliche prerenderizzate**.
 *
 * `script-src` contiene `'unsafe-inline'` e non è pigrizia: l'App Router mette
 * nella pagina una quindicina di `<script>` in linea con il carico RSC, e
 * l'unico modo di elencarli è un nonce diverso a ogni risposta. Un nonce si
 * genera mentre la risposta si costruisce, cioè **rendendo dinamica ogni
 * pagina** — l'esatto contrario di §04, che le vuole prerenderizzate perché una
 * visita non svegli il database.
 *
 * Su queste pagine il rischio è però il più basso del progetto: non c'è nessuna
 * sessione, nessun dato di chi guarda, e **nessun testo di un utente finisce
 * nell'HTML** — l'unico ingresso pubblico è il modulo contatti, che scrive nel
 * database e non ristampa niente. Quello che un'iniezione otterrebbe qui è
 * eseguire codice su una pagina anonima, che è brutto ma non porta via niente.
 *
 * Le direttive che contano restano intere: `frame-ancestors 'none'` (nessuno
 * incornicia il sito), `form-action 'self'` (nessun modulo spedisce altrove),
 * `base-uri 'self'` (nessun `<base>` iniettato dirotta gli indirizzi relativi),
 * `connect-src 'self'` (niente esce verso terzi — è anche la verifica
 * dell'impegno «ospitato in UE» di §04).
 */
/**
 * Il pezzo di `script-src` che esiste **solo in sviluppo**.
 *
 * Il ricaricamento a caldo di `next dev` valuta codice con `eval`, e senza
 * `'unsafe-eval'` la politica fa cadere l'intero fascicolo del client: la
 * pagina resta quella prerenderizzata, non si idrata niente, e sparisce tutto
 * ciò che compare solo a JavaScript vivo — la lente della ricerca e il
 * pulsante del menu, che sono `hidden` finché il componente non è vivo.
 *
 * Vale per tutte e due le politiche, perché in sviluppo il fascicolo è lo
 * stesso da tutte e due le parti. In produzione l'elenco è vuoto: `eval` non
 * serve a niente nel codice compilato, e questa è la direttiva che non va
 * allargata.
 */
export const CSP_SVILUPPO =
  process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"];

const CSP_PUBBLICA = [
  ...CSP_COMUNE,
  ["script-src 'self' 'unsafe-inline'", ...CSP_SVILUPPO].join(" "),
].join("; ");

/**
 * Le intestazioni che valgono **su tutto**, CSP esclusa.
 *
 * La CSP è l'unica che cambia fra le due metà del sito, quindi si applica a
 * parte: due intestazioni `Content-Security-Policy` sulla stessa risposta si
 * sommano — il browser fa rispettare **entrambe** — e la politica pubblica con
 * `'unsafe-inline'` accanto a quella con il nonce bloccherebbe tutto.
 */
const INTESTAZIONI = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), " +
      "browsing-topics=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=()",
  },
  // ridondante con `frame-ancestors`, e serve ai browser che quella non la
  // leggono: costa un'intestazione
  { key: "X-Frame-Options", value: "DENY" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // §06 del piano: si copia una cartella sul server e parte, senza toolchain.
  output: "standalone",

  /**
   * Dove finisce la compilazione. `.next`, tranne quando qualcuno dice altrove.
   *
   * Serve a due cose. La copia statica pubblica (vedi `lib/modulo-contatti.ts`)
   * deve compilare **con un'impostazione sua** — il modulo contatti spento,
   * perché in un pacchetto statico non ha nessuno che lo riceva — e non può
   * farlo nella cartella di sempre. Lì c'è la build che si rilascia in
   * produzione, e lasciarla sostituita da una in cui il modulo non c'è è il
   * tipo di scambio che si scopre dal sito vero, settimane dopo.
   *
   * Con una cartella separata le due build convivono e non si somigliano
   * nemmeno di nome: `.next` è quella vera, `.next-pubblico` è la copia
   * statica.
   *
   * L'altra è `npm run verifica` sul portatile con un `next dev` acceso:
   * `SITO_DIST_DIR=.next-verifica` compila accanto, invece di riscrivere
   * sotto al server di sviluppo la cartella che sta usando.
   */
  distDir: process.env.SITO_DIST_DIR || ".next",

  /**
   * Quanto può pesare il corpo di una Server Action.
   *
   * Il valore predefinito di Next è **1 MB**, e senza questa riga il sito
   * prometteva una cosa che non poteva fare: l'interfaccia dice «JPEG o PNG,
   * fino a 20 MB», `FOTO_PESO_MAX` vale 20 MB, e qualunque fotografia sopra il
   * megabyte — cioè qualunque fotografia scattata con un telefono — moriva
   * prima di arrivare all'azione. Non con il rifiuto ordinato che il codice
   * sapeva dare, ma con `Body exceeded 1 MB limit` e una pagina «500: Internal
   * Server Error»: il limite scattava dentro Next, dove il nostro messaggio non
   * arriva.
   *
   * Trovato provando il caricamento vero via HTTP. Le prove di libreria non
   * potevano vederlo — chiamano `aggiungiFoto` direttamente, e quel limite sta
   * nel trasporto.
   *
   * 24 MB e non 20: il multipart aggiunge intestazioni e delimitatori, e un
   * file esattamente al massimo consentito deve poter passare. Il tetto vero
   * per l'utente resta `FOTO_PESO_MAX`, che rifiuta con un messaggio leggibile.
   *
   * Vale anche per i documenti (PDF e DOCX) e per le immagini dell'identità,
   * che passano dalle stesse azioni.
   */
  experimental: {
    serverActions: { bodySizeLimit: "24mb" },
    /*
     * Il secondo limite, quello del proxy. Le richieste dell'area passano da
     * `proxy.ts`, e Next ne clona il corpo fermandosi a **10 MB** di
     * predefinito: oltre, «Request body exceeded 10MB» e l'azione riceve un
     * multipart troncato, che non si legge più come FormData — 500 per una
     * fotografia da 12 MB che il sito dichiara ammessa (report QA, BUG-007).
     * Va tenuto uguale a `bodySizeLimit`: è lo stesso trasporto.
     */
    proxyClientMaxBodySize: "24mb",
  },

  // §04: l'ottimizzazione a richiesta è disattivata. Le tre derivate (1600,
  // 800, 400) sono generate al caricamento e servite come file statici da
  // Caddy; con 2 GB di RAM il primo visitatore non deve pagare il resize.
  images: { unoptimized: true },

  /**
   * Moduli nativi: si lasciano fuori dal pacchetto.
   *
   * `sharp` e `better-sqlite3` sono estensioni compilate in C++, e portano con
   * sé codice che chiede `child_process` e `fs`. Next compila
   * `instrumentation.ts` per **ogni** runtime — anche per quello Edge del
   * middleware — e webpack segue l'`import()` prima che il controllo su
   * `NEXT_RUNTIME` possa impedirlo: la guardia è a tempo di esecuzione, il
   * pacchetto si costruisce prima. Da qui l'errore «Can't resolve
   * 'child_process'» in sviluppo, mentre `next build` passava.
   *
   * Dichiarandoli esterni restano una `require` normale risolta da Node quando
   * il codice gira davvero, che è l'unico posto in cui possono funzionare.
   */
  serverExternalPackages: ["sharp", "better-sqlite3"],

  /**
   * Gli stessi moduli nativi, tenuti fuori anche dalle compilazioni che non
   * sono Node.
   *
   * `serverExternalPackages` da solo non basta, e il motivo è istruttivo. Next
   * compila `instrumentation.ts` una volta per runtime; in quella per l'Edge la
   * guardia `process.env.NEXT_RUNTIME !== "nodejs"` diventa una costante falsa,
   * e in **produzione** l'eliminazione del codice morto porta via tutto il
   * blocco dopo il `return`. In **sviluppo** quella eliminazione non c'è: il
   * ramo resta nel grafo, webpack prova a risolvere `sharp`, e si ferma su
   * `child_process`. Da qui il guasto che si vedeva solo con `npm run dev`.
   *
   * Dichiarandoli esterni per i runtime non-Node, la richiesta resta una
   * stringa che nessuno prova ad aprire — e nel runtime giusto `sharp` viene
   * caricato normalmente.
   *
   * ## Perché si compila ancora con webpack
   *
   * Da Next 16 il compilatore predefinito è Turbopack, che questa funzione la
   * ignora, e con una funzione `webpack` presente `next build` si rifiuta di
   * partire. Gli script `dev` e `build` passano quindi `--webpack`: è lo stesso
   * compilatore della 15, e il pacchetto `standalone` si confeziona come prima.
   * Provato anche Turbopack (ottobre 2026, Next 16.3.8): compila,
   * ma rifà `instrumentation.ts` anche per Edge e avvisa che l'accesso
   * dinamico al filesystem fa tracciare **l'intero progetto** nel pacchetto
   * `standalone` — da sistemare prima di cambiare compilatore.
   */
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime === "nodejs") return config;

    // Tutto ciò che è di Node — i moduli nativi e i `node:` incorporati —
    // diventa una richiesta esterna: webpack la lascia scritta com'è invece di
    // provare ad aprirla. Nel runtime Edge quel codice non viene mai eseguito,
    // quindi non c'è niente da risolvere davvero; serve solo che il grafo si
    // chiuda. Elencare i singoli pacchetti non basterebbe: appena si toglie
    // `sharp` compare `node:fs/promises`, poi il prossimo.
    config.externals = [
      ...(config.externals ?? []),
      ({ request }: { request?: string }, callback: (e?: unknown, r?: string) => void) =>
        request && (request.startsWith("node:") || NATIVI.includes(request))
          ? callback(undefined, `commonjs ${request}`)
          : callback(),
    ];
    return config;
  },

  async headers() {
    return [
      // le comuni, davvero su tutto
      { source: "/:percorso*", headers: INTESTAZIONI },
      /*
       * La CSP pubblica **tranne** sotto /area-riservata e /anteprima, dove la
       * scrive il proxy con il nonce. La regressione negativa serve a non
       * mandare due politiche sulla stessa risposta.
       *
       * Se un giorno nascesse una terza radice riservata, va aggiunta qui **e**
       * al `matcher` del proxy: dimenticare questa riga significa spedirle
       * la politica larga, dimenticare quella significa non spedirgliene
       * nessuna.
       */
      {
        source: "/:percorso((?!area-riservata|anteprima).*)",
        headers: [{ key: "Content-Security-Policy", value: CSP_PUBBLICA }],
      },
    ];
  },

  /**
   * Gli indirizzi di un'unità che ha cambiato nome.
   *
   * Quando un'unità cambia nome cambia anche il suo indirizzo, e quello vecchio
   * può essere già stato mandato alle famiglie: senza un rimando porterebbe a
   * una pagina «non trovata». Per esempio:
   *
   *   { source: "/unita/nome-vecchio", destination: "/unita/nome-nuovo", permanent: true }
   */
  async redirects() {
    return [];
  },

  poweredByHeader: false,

  // Da Next 16.3 `next dev` scrive `AGENTS.md` e `CLAUDE.md` accanto a
  // package.json, a ogni avvio. Sono file nuovi nel repository che nessuno ha
  // deciso di aggiungere, e il secondo cambia le istruzioni di chi ci lavora
  // con un assistente: come con Next 15, non si generano.
  agentRules: false,
};

export default nextConfig;
