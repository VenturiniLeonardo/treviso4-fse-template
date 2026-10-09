import { NextResponse, type NextRequest } from "next/server";
import { CSP_COMUNE, CSP_SVILUPPO } from "@/next.config";
import { leggi } from "@/lib/auth/sessioni";
import { primaSezioneDi } from "@/lib/data-area";
import { NOME_COOKIE, PERCORSO_COOKIE_VECCHIO, puoVedere } from "@/lib/sessione";

/**
 * Guardia dell'area riservata.
 *
 * Sta nel proxy — il «middleware» fino a Next 15, rinominato da Next 16 senza
 * cambiare compito — e non nelle pagine perché così **nessuna** rotta sotto
 * /area-riservata può essere dimenticata: si entra da qui o non si entra.
 * §05 del piano lo dice per le scritture — «il referente di unità non vede meno cose in
 * interfaccia, non gliele restituisce proprio il server» — e vale già per la
 * lettura. Il controllo di ruolo è comunque ripetuto nelle Server Action, che il
 * middleware non protegge: Next le risolve per identificativo, non per
 * indirizzo, e una di esse spedita a una rotta consentita passa di qui senza
 * essere vista. È il motivo per cui esiste `lib/auth/contesto.ts`.
 *
 * ## Perché gira su Node e non su Edge
 *
 * Il runtime predefinito del middleware è Edge, che non ha `node:` e quindi non
 * può aprire SQLite. Finché la sessione stava dentro un cookie firmato non era
 * un problema — bastava verificare una firma — ma dalla fase 6 la sessione è una
 * riga di database, e questo file deve poterla leggere.
 *
 * L'audit lo aveva segnato come rischio R2, con la previsione che sarebbe stato
 * il nodo dell'autenticazione. Si scioglie con una riga, `export const runtime`,
 * che Next 15.5 accetta come stabile. Verificato sulla cartella `standalone`:
 * il middleware compilato ci finisce dentro, `better-sqlite3` pure con i binari
 * di tutte le piattaforme, e la lettura del database dal middleware funziona.
 *
 * Da Next 16 quella riga non c'è più: il proxy gira **sempre** su Node, e Next
 * rifiuta la compilazione se il file dichiara un `runtime`. Il comportamento è
 * lo stesso di prima, ora per costruzione.
 *
 * L'alternativa era lasciare qui un controllo debole — «c'è un cookie?» — e
 * spostare quello vero nelle pagine. Sarebbe stato il contrario del motivo per
 * cui questa guardia esiste: una rotta nuova, dimenticata, sarebbe stata aperta.
 */

const ACCEDI = "/area-riservata/accedi";
const TOTP = "/area-riservata/accedi/totp";
/**
 * Il cambio della password provvisoria: l'ultimo passo del primo accesso di un
 * account preparato con `scripts/account-iniziali.mjs`. Con la sessione piena
 * ma la password ancora da cambiare non si apre nient'altro.
 */
const CAMBIO = "/area-riservata/accedi/password";
const INVITO = "/area-riservata/invito";
/**
 * L'anteprima delle pagine pubbliche, dalla fase 14.8.
 *
 * Sta fuori da `/area-riservata` perché **deve essere** la pagina pubblica — con
 * il suo `<body>`, il suo `site.css`, la sua barra — e in Next il layout lo
 * decide la cartella. Ma è riservata quanto una sezione dell'area, quindi passa
 * da qui: è la ragione per cui questa guardia esiste, «si entra da qui o non si
 * entra».
 *
 * Il controllo di ruolo **non** si applica: sotto `/anteprima` il secondo
 * segmento è il tipo di pagina («unita»), non un ruolo, e passarlo a
 * `puoVedere` avrebbe reso la rotta irraggiungibile a tutti tranne l'admin —
 * lo stesso difetto che `NON_SONO_RUOLI` risolve per le rotte di servizio.
 */
const ANTEPRIMA = "/anteprima";

/**
 * Segmenti che stanno accanto ai ruoli ma ruoli non sono.
 *
 * Vanno tenuti allineati con le cartelle statiche sotto
 * `app/(area)/area-riservata/`: se se ne aggiunge una e ci si dimentica di
 * questa riga, la rotta risponde soltanto allo sviluppatore — e in modo
 * silenzioso, con un rimando che sembra un problema di permessi.
 *
 * `utenti` sta in questo elenco e la sua cartella contiene **solo** azioni,
 * non una pagina: la sezione vera è `/area-riservata/<ruolo>/utenti`. Non è
 * questa riga a proteggere quelle azioni — Next le risolve per identificativo e
 * non per indirizzo, quindi non passano da qui e il loro cancello è
 * `autorizzaSuUtente`. Serve solo a far rispondere 404 a chi visita
 * `/area-riservata/utenti` a mano, invece di rimandarlo alla propria vista come
 * se fosse un problema di permessi.
 */
const NON_SONO_RUOLI = new Set([
  "accedi",
  "invito",
  "manutenzione",
  "esporta",
  "profilo",
  "utenti",
  // le azioni e i file dei documenti per i referenti: la sezione vera è
  // `/area-riservata/<ruolo>/documenti-referenti`, e la rotta dei file chiede da sé
  // la matrice. Senza questa riga un referente di unità che apre un file verrebbe
  // rimandato alla propria vista, come se «documenti-referenti» fosse un ruolo.
  "documenti-referenti",
]);

/**
 * L'origine pubblica del sito: lo schema e il dominio da cui arriva il
 * visitatore, non quelli su cui il processo è in ascolto.
 *
 * Serve perché `NextResponse.redirect(new URL(…, req.url))` — la forma che
 * sembra naturale, e che questo file usava — in produzione manda gli utenti su
 * `localhost`. Il motivo sta in Next: nel pacchetto `standalone` il middleware
 * riceve un `req.url` costruito dall'indirizzo di ascolto, perché
 * `experimental.trustHostHeader` è spento. Dietro il Caddy di §06 quel valore
 * è `http://localhost:3000`, e chi apriva `https://example.org/area-riservata`
 * si ritrovava rimandato a una porta della propria macchina: **l'area
 * riservata era irraggiungibile da fuori**. Verificato dal vivo sul pacchetto
 * `standalone`, con e senza `Host` e `X-Forwarded-Host`.
 *
 * Una `Location` relativa risolverebbe il problema alla radice e non si può
 * usare: l'adattatore del middleware di Next la ripassa da `new NextURL(...)`
 * senza base e solleva `ERR_INVALID_URL`. Provato: risposta 500. Quindi
 * l'indirizzo assoluto va composto, e la domanda diventa di chi fidarsi.
 *
 * L'ordine è quello della fiducia decrescente, ed è lo stesso ragionamento con
 * cui `scripts/invita.mjs` compone i collegamenti d'invito:
 *
 *  1. `SITO_BASE_URL`, se c'è. È una decisione di chi amministra, scritta
 *     nell'unità systemd: nessuna richiesta può cambiarla.
 *  2. `X-Forwarded-Host`, che dietro il proxy di §06 è il dominio vero. Ci si
 *     fida per lo stesso motivo per cui `indirizzoRichiedente()` si fida di
 *     `X-Forwarded-For`: fra Internet e questo processo c'è un Caddy che la
 *     riscrive, e che risponde soltanto ai domini dichiarati nel Caddyfile.
 *  3. `Host`, per chi gira senza proxy.
 *  4. Quello che sa Next, che in sviluppo è giusto e in produzione è il caso
 *     che questa funzione esiste per non lasciar succedere.
 *
 * Il dominio si convalida prima di usarlo: un `Host` con caratteri strani
 * farebbe fallire `new URL` più avanti, dentro una risposta, cioè come 500 e
 * non come rimando. Il rischio residuo di fidarsi dell'intestazione è
 * contenuto: le destinazioni sono sempre percorsi di questo sito, quindi chi
 * riuscisse a falsificare `Host` rimanderebbe soltanto se stesso altrove — il
 * cookie di sessione, che è `SameSite=Lax` e legato al dominio, non lo segue.
 * Chi vuole chiudere anche quello imposta `SITO_BASE_URL`.
 */
const DOMINIO_VALIDO = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;

function origine(req: NextRequest): string {
  const configurata = process.env.SITO_BASE_URL;
  if (configurata) {
    try {
      return new URL(configurata).origin;
    } catch {
      // variabile scritta male: non è un motivo per non rispondere, si scende
      // al passo successivo — e l'errore si vede nei log una volta sola
      console.warn(`middleware: SITO_BASE_URL non è un indirizzo valido: «${configurata}»`);
    }
  }

  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() ?? req.headers.get("host");
  if (host && DOMINIO_VALIDO.test(host)) {
    const protocollo =
      req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ??
      (process.env.NODE_ENV === "production" ? "https" : "http");
    if (protocollo === "http" || protocollo === "https") return `${protocollo}://${host}`;
  }

  return req.nextUrl.origin;
}

/** Un rimando dentro il sito, composto sull'origine pubblica e non su quella di ascolto. */
function rimanda(percorso: string, req: NextRequest): NextResponse {
  return NextResponse.redirect(new URL(percorso, origine(req)));
}

/**
 * La politica di sicurezza dei contenuti dell'area riservata, con un nonce.
 *
 * ## Perché qui e non in `next.config.ts`
 *
 * Un nonce è un numero casuale diverso a **ogni risposta**: si può mettere in
 * un'intestazione solo mentre quella risposta si costruisce, e le intestazioni
 * di `next.config.ts` sono fisse. Quindi la politica con il nonce la può
 * scrivere solo il middleware — e infatti Next legge il nonce dall'intestazione
 * `Content-Security-Policy` che il middleware mette sulla **richiesta**, e lo
 * applica da sé ai propri `<script>`.
 *
 * ## Perché solo qui
 *
 * Perché un nonce costringe a costruire la risposta a ogni richiesta, e le
 * pagine pubbliche sono prerenderizzate per scelta di §04: una visita non deve
 * svegliare il database. Sotto `/area-riservata` e `/anteprima` quel costo non
 * esiste — quelle pagine **sono già dinamiche**, come vuole la Fig. 3 del piano,
 * perché elenchi, consensi e code di approvazione non possono essere serviti da
 * un file salvato.
 *
 * Il risultato è che `'unsafe-inline'` sparisce esattamente dove serve che
 * sparisca: le schermate con gli elenchi di iscritti, i recapiti dei minori e i
 * pulsanti che pubblicano e cancellano. Sulle pagine pubbliche resta, e §«CSP»
 * di `next.config.ts` dice perché lì il rischio è di un altro ordine.
 *
 * ## `strict-dynamic`
 *
 * Con `'strict-dynamic'` un `<script>` caricato da uno script già fidato è
 * fidato a sua volta: è ciò che permette al router di Next di aggiungere i
 * propri fascicoli senza che ognuno debba portare il nonce. Senza, la
 * navigazione lato client si romperebbe alla prima rotta caricata a richiesta.
 * `'self'` resta per i browser che `strict-dynamic` non lo conoscono, che lo
 * ignorano e ricadono su di lui.
 */
function cspConNonce(nonce: string): string {
  return [
    ...CSP_COMUNE,
    [`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`, ...CSP_SVILUPPO].join(" "),
  ].join("; ");
}

/** Sedici byte casuali in base64: quello che finisce nella politica. */
function nuovoNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

/**
 * Aggiunge la politica con il nonce a una risposta che passa oltre.
 *
 * Va usata **solo** dove il middleware fa passare la richiesta a una pagina:
 * su un rimando non serve, perché un 307 non ha un corpo da proteggere, e
 * mettercela vorrebbe dire generare un nonce per niente.
 *
 * Il nonce va in due posti, e servono entrambi: sulla **richiesta**, da cui
 * Next lo legge per marcare i propri script, e sulla **risposta**, che è la
 * politica che il browser fa rispettare.
 */
function conNonce(req: NextRequest): NextResponse {
  const nonce = nuovoNonce();
  const politica = cspConNonce(nonce);

  const intestazioni = new Headers(req.headers);
  intestazioni.set("x-nonce", nonce);
  intestazioni.set("Content-Security-Policy", politica);

  const risposta = NextResponse.next({ request: { headers: intestazioni } });
  risposta.headers.set("Content-Security-Policy", politica);
  return risposta;
}

/**
 * Una Server Action spedita da un altro sito: si respinge qui, con un 403.
 *
 * Next la respinge già da sé — confronta `Origin` con `X-Forwarded-Host` o
 * `Host` e non esegue l'azione — ma lo fa sollevando un errore, e la risposta
 * è un **500** (in `next dev` con lo stack nel log). Per chi la manda è un
 * errore suo, non del server: QA, BUG-004.
 *
 * Il controllo ripete quello di Next ed è un po' più largo, mai più stretto:
 * basta che l'origine coincida con uno dei due domini perché passi, e allora
 * decide Next come prima. Senza `Origin` lascia passare, come Next: un browser
 * la manda sempre con una POST, e chi la toglie a mano non ha i cookie altrui.
 * Guarda solo ciò che può essere un'azione — l'intestazione `Next-Action` o un
 * modulo — perché le altre POST non sono affare di questo controllo.
 */
function azioneDaFuori(req: NextRequest): boolean {
  if (req.method !== "POST") return false;
  const tipo = req.headers.get("content-type") ?? "";
  const modulo = tipo.startsWith("multipart/form-data") || tipo.startsWith("application/x-www-form-urlencoded");
  if (!req.headers.has("next-action") && !modulo) return false;
  const o = req.headers.get("origin");
  if (!o) return false;
  let host: string;
  try {
    host = o === "null" ? "null" : new URL(o).host;
  } catch {
    return true;
  }
  const inoltrato = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  return host !== inoltrato && host !== req.headers.get("host");
}

export async function proxy(req: NextRequest) {
  if (azioneDaFuori(req)) {
    return new NextResponse("Richiesta non consentita.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const { pathname, search } = req.nextUrl;
  // il secondo matcher porta qui anche il sito pubblico, solo per il controllo di sopra
  if (pathname !== "/area-riservata" && !pathname.startsWith("/area-riservata/") && !pathname.startsWith(`${ANTEPRIMA}/`)) {
    return NextResponse.next();
  }

  const viva = leggi(req.cookies.get(NOME_COOKIE)?.value);
  // con la password provvisoria la sessione è piena ma non apre l'area
  const daCambiare = viva?.stato === "attiva" && viva.daCambiare;
  const attiva = viva?.stato === "attiva" && !viva.daCambiare;
  const attesaTotp = viva?.stato === "attesa_totp";

  /*
   * La password provvisoria: chi ce l'ha ancora va solo alla schermata del
   * cambio, da qualunque indirizzo dell'area arrivi — anche dall'invito, dalla
   * schermata di accesso e dall'anteprima. Chi non ce l'ha non ha niente da
   * fare lì.
   */
  if (pathname === CAMBIO) {
    if (daCambiare) return conNonce(req);
    if (attiva) return rimanda(primaSezioneDi(viva.sessione.r), req);
    if (attesaTotp) return rimanda(TOTP, req);
    return rimanda(ACCEDI, req);
  }
  if (daCambiare) return rimanda(CAMBIO, req);

  /*
   * L'invito è aperto a chi non è entrato: è la porta di chi non ha ancora una
   * password. Chi invece è già dentro non ha niente da fare lì — un invito
   * consumato da una sessione aperta è quasi sempre qualcuno che ha cliccato un
   * collegamento vecchio, e portarlo alla sua area è la risposta giusta.
   */
  if (pathname.startsWith(INVITO)) {
    if (attiva) return rimanda(primaSezioneDi(viva.sessione.r), req);
    return conNonce(req);
  }

  /*
   * Il secondo fattore: ci si arriva solo con la mezza sessione, e solo da lì.
   * Chi ha già finito viene rimandato dentro, chi non ha dato la password torna
   * al principio — se no, la schermata del codice sarebbe raggiungibile senza
   * aver dimostrato niente.
   */
  if (pathname === TOTP) {
    if (attiva) return rimanda(primaSezioneDi(viva.sessione.r), req);
    if (attesaTotp) return conNonce(req);
    return rimanda(ACCEDI, req);
  }

  // La pagina di accesso è l'altra aperta. Chi è già entrato non ci resta, e chi
  // ha la mezza sessione va al codice invece di ridare la password.
  if (pathname === ACCEDI) {
    if (attiva) return rimanda(primaSezioneDi(viva.sessione.r), req);
    if (attesaTotp) return rimanda(TOTP, req);
    return conNonce(req);
  }

  if (!attiva) {
    // con la mezza sessione manca un passo, non le credenziali: si va al codice
    if (attesaTotp) return rimanda(TOTP, req);

    // dove voleva andare, per riportarlo lì dopo l'accesso
    const dove =
      pathname === "/area-riservata"
        ? ACCEDI
        : `${ACCEDI}?da=${encodeURIComponent(pathname + search)}`;
    const risposta = rimanda(dove, req);
    // Se il cookie c'era ma non è valido, si butta — con il percorso esplicito:
    // un `delete` con un percorso diverso da quello di scrittura non cancella
    // niente, e il cookie scaduto resterebbe addosso a ogni richiesta.
    if (req.cookies.has(NOME_COOKIE)) risposta.cookies.delete(NOME_COOKIE);
    return risposta;
  }

  const sessione = viva.sessione;

  /*
   * L'anteprima: basta una sessione attiva, e il ruolo non conta.
   *
   * Si torna qui **dopo** il controllo `!attiva` di sopra, quindi chi arriva ha
   * già dimostrato di essere entrato. Il ritorno anticipato serve a saltare il
   * controllo di ruolo che segue, che su questo percorso leggerebbe «unita» come
   * se fosse un ruolo.
   */
  if (pathname.startsWith(ANTEPRIMA)) return scadiIlCookieVecchio(conNonce(req), req);

  // /area-riservata senza altro: ognuno alla vista del proprio ruolo
  if (pathname === "/area-riservata") {
    return rimanda(primaSezioneDi(sessione.r), req);
  }

  // Ambito: un referente di unità non apre la vista del gestore (§05).
  //
  // Il secondo segmento è il ruolo **solo** per le viste. Le rotte di servizio
  // che stanno allo stesso livello non lo sono, e vanno lasciate passare: senza
  // questo elenco `puoVedere(sessione, "manutenzione")` è falso per tutti tranne
  // l'admin, e quelle pagine diventano irraggiungibili — è successo davvero.
  // Ciascuna fa il proprio controllo al suo interno.
  const segmenti = pathname.split("/").filter(Boolean); // ["area-riservata", ruolo, ...]
  const ruoloRichiesto = segmenti[1];
  if (
    ruoloRichiesto &&
    !NON_SONO_RUOLI.has(ruoloRichiesto) &&
    !puoVedere(sessione, ruoloRichiesto)
  ) {
    return rimanda(primaSezioneDi(sessione.r), req);
  }

  return scadiIlCookieVecchio(conNonce(req), req);
}

/**
 * Fa scadere il cookie scritto con il percorso vecchio (`/area-riservata`).
 *
 * Serve solo alla transizione: chi era entrato prima del cambio ha un cookie
 * che il browser manda ancora qui, e che l'uscita non riuscirebbe a cancellare
 * — resterebbe dentro dopo aver premuto «Esci». Facendolo scadere qui, alla
 * prima richiesta, quelle sessioni si chiudono e si rientra una volta sola.
 *
 * Va scritto a mano nell'intestazione: `risposta.cookies.delete()` userebbe la
 * mappa di Next, indicizzata per nome, e sovrascriverebbe il cookie buono.
 *
 * Da togliere dopo il rilascio: passate dodici ore nessuna sessione vecchia può
 * più esistere.
 *
 * ## Non sulle Server Action
 *
 * Trovato il 25 settembre 2026 creando una cartella dei documenti: l'azione
 * finisce con `redirect()`, e dopo il salvataggio compariva la schermata di
 * accesso. La sessione era buona; la perdeva una richiesta che fa Next.
 *
 * Quando un'azione reindirizza dentro l'app, Next non rimanda al browser:
 * rende subito la pagina di arrivo con una richiesta interna, e le passa i
 * cookie della richiesta **fusi con quelli della risposta** (`getForwardedHeaders`
 * in `action-handler.js`), per nome e senza guardare il percorso. Questa riga
 * ha lo stesso nome del cookie di sessione e il valore vuoto: nella fusione
 * prende il suo posto, e la pagina di arrivo si rende come per chi non è
 * entrato. Toccava ogni azione che reindirizza — anche «Elimina» di documenti e
 * album — e il browser, che il cookie buono l'aveva ancora, mostrava lo stesso
 * la schermata di accesso.
 *
 * Il cookie vecchio scade comunque alla prima richiesta normale.
 */
function scadiIlCookieVecchio(risposta: NextResponse, req: NextRequest): NextResponse {
  if (!req.cookies.has(NOME_COOKIE)) return risposta;
  if (req.headers.has("next-action")) return risposta;
  risposta.headers.append(
    "set-cookie",
    `${NOME_COOKIE}=; Path=${PERCORSO_COOKIE_VECCHIO}; Max-Age=0; HttpOnly; SameSite=Lax`,
  );
  return risposta;
}

export const config = {
  matcher: [
    "/area-riservata",
    "/area-riservata/:path*",
    "/anteprima/:path*",
    // le Server Action del sito pubblico (il modulo contatti, le preferenze dei
    // cookie): solo le richieste con `Origin`, che una visita normale non ha
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      has: [{ type: "header", key: "origin" }],
    },
  ],
};
