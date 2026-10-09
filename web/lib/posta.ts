import { createTransport, type Transporter } from "nodemailer";

/**
 * La posta in uscita. Serve a una cosa sola: avvisare i gestori che dal
 * sito è arrivato un messaggio.
 *
 * ## Perché serve
 *
 * Il modulo contatti salvava e basta. Chi non apriva l'area riservata non
 * sapeva che era arrivato qualcosa, e la schermata di conferma lo diceva a
 * chiare lettere — «non ricevono una notifica automatica» — che è onesto e
 * inutile: una famiglia che scrive per iscrivere un figlio si aspetta una
 * risposta, non un messaggio in una casella che nessuno guarda.
 *
 * ## Perché `nodemailer` e non un client SMTP scritto qui
 *
 * SMTP fatto bene è STARTTLS, i meccanismi di autenticazione, la codifica delle
 * intestazioni non ASCII, i tempi massimi e la differenza fra un rifiuto
 * temporaneo e uno definitivo. Scriverlo a mano sarebbe stato il tipo di
 * ripiego fragile che questo progetto evita altrove; `nodemailer` è maturo,
 * **senza nessuna dipendenza propria**, MIT, e in JavaScript puro — quindi
 * finisce nel pacchetto `standalone` come qualunque altro modulo, senza il
 * problema dei binari per piattaforma che ha fatto scartare `@node-rs/argon2`
 * in favore di `hash-wasm`.
 *
 * ## Che cosa succede se non è configurata
 *
 * **Niente si rompe, e niente si perde.** Il messaggio è già salvato nel
 * database prima che questo modulo venga interpellato: la notifica è un extra,
 * e un extra non può far fallire l'operazione principale. Senza configurazione
 * `postaConfigurata()` è falsa, il sito lo dice a chi scrive («i referenti lo
 * leggono quando entrano») e nel registro del servizio compare una riga sola
 * all'avvio, non una per messaggio.
 *
 * ## Che cosa NON finisce nei log
 *
 * Il testo del messaggio, l'indirizzo e il telefono di chi scrive. Nel registro
 * va l'identificativo della riga e l'esito: basta a capire se la posta
 * funziona, e non trasforma `journalctl` in una copia della casella.
 *
 * Modulo di solo server.
 */

export interface ConfigurazionePosta {
  host: string;
  porta: number;
  /** `true` per la 465 (TLS dall'inizio), `false` per la 587 (STARTTLS) */
  tls: boolean;
  utente?: string;
  password?: string;
  /**
   * Accesso OAuth2 di Microsoft 365 (flusso «client credentials»): al posto
   * della password, l'app registrata in Entra con il permesso `SMTP.SendAsApp`.
   * Se c'è, ha la precedenza su `password`. `utente` è la casella con cui si
   * invia e deve averne concesso l'accesso all'app.
   */
  oauth?: { tenant: string; clientId: string; segreto: string; urlToken: string };
  /** il mittente, che per molti fornitori deve essere un indirizzo del dominio */
  da: string;
  /** dove arriva l'avviso */
  a: string;
}

/**
 * Legge la configurazione dall'ambiente, o `null` se non c'è.
 *
 * Il minimo indispensabile è **host** e **destinatario**: senza uno dei due non
 * c'è niente da fare, e mezza configurazione è peggio di nessuna perché
 * fallisce a ogni messaggio invece di dirlo una volta all'avvio.
 *
 * L'autenticazione è facoltativa di proposito: un relay interno alla macchina
 * (`localhost:25`) non la vuole, e pretenderla escluderebbe la configurazione
 * più semplice e più privata che questo gruppo possa avere.
 */
export function configurazionePosta(): ConfigurazionePosta | null {
  const host = process.env.POSTA_HOST?.trim();
  const a = process.env.POSTA_A?.trim();
  if (!host || !a) return null;

  const porta = Number(process.env.POSTA_PORTA ?? 587);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return null;

  /*
   * OAuth2: o ci sono tutti e tre i valori più la casella, o niente. Metà
   * configurazione fallirebbe a ogni messaggio con un errore poco parlante,
   * mentre «non configurata» lo dice una volta sola.
   */
  const tenant = process.env.POSTA_TENANT_ID?.trim();
  const clientId = process.env.POSTA_CLIENT_ID?.trim();
  const segreto = process.env.POSTA_CLIENT_SECRET?.trim();
  const utente = process.env.POSTA_UTENTE?.trim() || undefined;
  const qualcunoOauth = Boolean(tenant || clientId || segreto);
  if (qualcunoOauth && !(tenant && clientId && segreto && utente)) return null;
  const oauth =
    tenant && clientId && segreto
      ? {
          tenant,
          clientId,
          segreto,
          // sovrascrivibile solo per le prove, che non parlano con Microsoft
          urlToken:
            process.env.POSTA_TOKEN_URL?.trim() ||
            `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
        }
      : undefined;

  return {
    host,
    porta,
    // 465 è TLS dall'inizio; tutto il resto parte in chiaro e sale con STARTTLS
    tls: process.env.POSTA_TLS ? process.env.POSTA_TLS === "1" : porta === 465,
    utente,
    password: oauth ? undefined : process.env.POSTA_PASSWORD || undefined,
    oauth,
    da: process.env.POSTA_DA?.trim() || a,
    a,
  };
}

export const postaConfigurata = (): boolean => configurazionePosta() !== null;

/** Quanto si aspetta, a ogni fase della conversazione con il server di posta. */
const ATTESA_MS = 10_000;

let trasporto: Transporter | null = null;
let trasportoPer: string | null = null;

/**
 * Il token d'accesso OAuth2, tenuto in memoria fino a un minuto prima della
 * scadenza (Microsoft li dà da circa un'ora). Una sola richiesta in volo alla
 * volta: due messaggi insieme non chiedono due token.
 */
let token: { valore: string; scade: number; per: string } | null = null;
let tokenInVolo: Promise<string> | null = null;

/** Errore del token, con la stessa forma di quelli SMTP per `erroreDefinitivo`. */
class ErroreToken extends Error {
  responseCode: number | undefined;
  code: string;
  constructor(responseCode: number | undefined, code: string) {
    super(`token OAuth2: ${code}`);
    this.responseCode = responseCode;
    this.code = code;
  }
}

async function ottieniToken(o: NonNullable<ConfigurazionePosta["oauth"]>): Promise<string> {
  const per = `${o.tenant}|${o.clientId}|${o.segreto}`;
  if (token && token.per === per && token.scade > Date.now() + 60_000) return token.valore;
  if (tokenInVolo) return tokenInVolo;

  tokenInVolo = (async () => {
    let risposta: Response;
    try {
      risposta = await fetch(o.urlToken, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: o.clientId,
          client_secret: o.segreto,
          scope: "https://outlook.office365.com/.default",
        }),
        signal: AbortSignal.timeout(ATTESA_MS),
      });
    } catch {
      throw new ErroreToken(undefined, "ETOKENRETE");
    }
    if (!risposta.ok) {
      // il corpo dell'errore di Microsoft può citare l'app: non lo si riporta
      throw new ErroreToken(risposta.status, "ETOKEN");
    }
    const dati = (await risposta.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;
    if (!dati?.access_token) throw new ErroreToken(undefined, "ETOKENVUOTO");
    token = {
      valore: dati.access_token,
      scade: Date.now() + (dati.expires_in ?? 3600) * 1000,
      per,
    };
    return token.valore;
  })().finally(() => {
    tokenInVolo = null;
  });
  return tokenInVolo;
}

/**
 * Il trasporto, riusato fra un messaggio e l'altro.
 *
 * `pool: true` tiene aperta una connessione invece di rifarla ogni volta. Su un
 * sito che manda qualche messaggio al giorno la differenza è irrilevante, ma
 * `nodemailer` senza pool chiude e riapre, e certi fornitori contano le
 * connessioni. La chiave della cache è la configurazione: se cambia — un
 * riavvio con variabili diverse, o un token OAuth2 rinnovato — il trasporto si
 * ricostruisce.
 */
async function ottieniTrasporto(c: ConfigurazionePosta): Promise<Transporter> {
  const accessToken = c.oauth ? await ottieniToken(c.oauth) : undefined;
  const chiave = JSON.stringify([c.host, c.porta, c.tls, c.utente, accessToken ?? null]);
  if (trasporto && trasportoPer === chiave) return trasporto;
  trasporto?.close();

  const auth = accessToken
    ? { type: "OAuth2" as const, user: c.utente, accessToken }
    : c.utente
      ? { user: c.utente, pass: c.password ?? "" }
      : undefined;

  trasporto = createTransport({
    host: c.host,
    port: c.porta,
    secure: c.tls,
    ...(auth ? { auth } : {}),
    pool: true,
    maxConnections: 1,
    connectionTimeout: ATTESA_MS,
    greetingTimeout: ATTESA_MS,
    socketTimeout: ATTESA_MS,
  });
  trasportoPer = chiave;
  return trasporto;
}

export interface EsitoPosta {
  ok: boolean;
  /** perché non è andata, già in forma leggibile. Mai il contenuto del messaggio. */
  motivo?: string;
  /** vero se non c'era configurazione: non è un guasto */
  nonConfigurata?: boolean;
}

/**
 * Manda un messaggio, con **un** ritentativo.
 *
 * Uno e non tre: i guasti di SMTP sono di due specie, e si distinguono dal
 * codice. Un `4xx` è temporaneo — la coda del fornitore è piena, la
 * connessione è caduta — e ritentare ha senso. Un `5xx` è definitivo: la
 * casella non esiste, le credenziali sono sbagliate, il mittente è rifiutato.
 * Ritentare su un `5xx` non manda niente e fa aspettare la persona che ha
 * premuto «Invia». Quindi: un solo ritentativo, e solo se l'errore non è
 * definitivo.
 *
 * **Non solleva mai.** Chi chiama sta rispondendo a un utente che ha appena
 * compilato un modulo, e il messaggio è già salvato: un guasto della posta non
 * deve diventare un errore in faccia a chi scrive.
 */
export async function inviaAvviso(
  oggetto: string,
  testo: string,
  opzioni: { rispondiA?: string; nomeMittente?: string } = {},
): Promise<EsitoPosta> {
  const c = configurazionePosta();
  if (!c) return { ok: false, nonConfigurata: true };
  return spedisci(c, c.a, oggetto, testo, opzioni.rispondiA, opzioni.nomeMittente);
}

/**
 * Come `inviaAvviso`, ma a un indirizzo scelto: l'account di una persona.
 *
 * Serve agli inviti e agli avvisi di attivazione (audit degli accessi del 4
 * ottobre 2026, SoD-4): il collegamento d'invito va a chi lo deve usare, e non
 * resta sullo schermo di chi crea l'account — che altrimenti potrebbe usarlo
 * per primo e agire con il nome di un altro. Il destinatario lo sceglie il
 * codice, dall'anagrafica degli account, mai un modulo.
 */
export async function inviaA(
  destinatario: string,
  oggetto: string,
  testo: string,
): Promise<EsitoPosta> {
  const c = configurazionePosta();
  if (!c) return { ok: false, nonConfigurata: true };
  return spedisci(c, destinatario, oggetto, testo);
}

async function spedisci(
  c: ConfigurazionePosta,
  a: string,
  oggetto: string,
  testo: string,
  rispondiA?: string,
  nomeMittente?: string,
): Promise<EsitoPosta> {
  const messaggio = {
    // Con una casella sola, mittente e destinatario coincidono e Outlook mostra
    // «Nota a sé stessi»: il nome visualizzato dice almeno chi ha scritto.
    from: nomeMittente
      ? { name: nomeMittente.replace(/[\r\n"<>]+/g, " ").trim().slice(0, 100), address: c.da }
      : c.da,
    to: a,
    // «Rispondi» in Outlook scrive a chi ha compilato il modulo, non al gruppo
    ...(rispondiA ? { replyTo: rispondiA } : {}),
    subject: oggetto,
    text: testo,
    // niente HTML: un avviso interno non ha bisogno di impaginazione, e il
    // testo semplice non ha modo di far scattare i filtri antispam
  };

  for (let tentativo = 1; tentativo <= 2; tentativo++) {
    try {
      await (await ottieniTrasporto(c)).sendMail(messaggio);
      return { ok: true };
    } catch (errore) {
      const definitivo = erroreDefinitivo(errore);
      if (definitivo || tentativo === 2) {
        return { ok: false, motivo: motivoLeggibile(errore, definitivo) };
      }
      // il trasporto può essere rimasto in uno stato inutilizzabile
      trasporto = null;
      trasportoPer = null;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return { ok: false, motivo: "non riuscito" };
}

/** `5xx` e credenziali sbagliate: ritentare non cambia niente. */
function erroreDefinitivo(errore: unknown): boolean {
  const e = errore as { responseCode?: number; code?: string };
  // un 4xx dal token (app o segreto sbagliati, scaduti) non passa da solo
  if (e?.code === "ETOKEN") return (e.responseCode ?? 0) < 500 && e.responseCode !== 429;
  if (typeof e?.responseCode === "number") return e.responseCode >= 500;
  return e?.code === "EAUTH";
}

/**
 * Il motivo, senza il messaggio dentro.
 *
 * `nodemailer` mette nell'errore la risposta del server, che per un rifiuto può
 * contenere l'indirizzo del destinatario. Qui si tiene il codice e la classe
 * del guasto, che è quello che serve a chi legge `journalctl`.
 */
function motivoLeggibile(errore: unknown, definitivo: boolean): string {
  const e = errore as { responseCode?: number; code?: string; message?: string };
  const codice =
    e?.code === "ETOKEN"
      ? `token OAuth2 rifiutato (HTTP ${e.responseCode})`
      : e?.responseCode
        ? `SMTP ${e.responseCode}`
        : (e?.code ?? "guasto");
  return `${codice}${definitivo ? " (definitivo)" : " (temporaneo, già ritentato)"}`;
}
