import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { permessi as tabellaPermessi, unita as tabellaUnita, utenti as tabella } from "@/lib/db/schema";
import {
  creaHashPassword,
  daRiHashare,
  verificaAVuoto,
  verificaPassword,
} from "@/lib/auth/password";
import { PASSWORD_MAX, passwordAccettabile } from "@/lib/password-regole";
import { nuovoSegreto, verificaCodice } from "@/lib/auth/totp";
import { cifra, decifra } from "@/lib/auth/cifratura";
import { annullaPrenotazione, attesa, azzera, prenotaTentativo, segnaFallimento } from "@/lib/auth/tentativi";
import { consumaCodiceRecupero } from "@/lib/auth/profilo-sicurezza";
import { FUNZIONI_INIZIALI, livelloEffettivo, type Livello } from "@/lib/permessi";
import { RUOLI_VALIDI, type RuoloSessione } from "@/lib/sessione";

/**
 * Gli account dell'area riservata. Modulo di solo server.
 *
 * Fino alla fase 6 stavano in un file JSON indicato da `SITO_UTENTI_FILE`,
 * con un commento che diceva «provvisorio: il database arriva in F3». È
 * arrivato. Adesso stanno nella tabella `utenti`, e il file JSON serve una volta
 * sola — a `scripts/importa-utenti.mjs`, che lo travasa.
 *
 * **Perché non si legge più anche il file.** Tenere le due fonti insieme, con il
 * database che vince e il file come ripiego, sembra prudente e non lo è: due
 * posti in cui può stare la password di un referente sono due posti da revocare
 * quando gli si toglie l'accesso, e il secondo lo si dimentica. Una sola fonte,
 * e un errore chiaro quando è vuota.
 *
 * Le firme che il resto dell'applicazione usava — `verificaCredenziali`,
 * `cambiaPassword`, `configurazioneMancante`, `PASSWORD_MIN`,
 * `passwordAccettabile` — sono rimaste quelle. È lo stesso criterio della fase
 * 2B: SQLite sostituisce il retro dello store, non il contratto davanti.
 */

export { PASSWORD_MIN, passwordAccettabile } from "@/lib/password-regole";

export type StatoUtente = "invitato" | "attivo" | "revocato";

export interface Utente {
  id: number;
  utente: string;
  ruolo: RuoloSessione;
  /** nome mostrato nella barra */
  nome: string;
  iniziali: string;
  /**
   * Unità di competenza, dei soli referenti di unità: è l'ambito di §05.
   *
   * Nel database è `unita_id`, qui è la chiave (`u1`, …) perché è quello
   * che la sessione porta e che `puoScrivereSu` confronta. La traduzione sta
   * qui e in nessun altro posto.
   */
  unita?: string;
  email?: string;
  stato: StatoUtente;
  /** falso per un account invitato che non ha ancora scelto la password */
  haPassword: boolean;
  /** vero solo dopo che il primo codice è stato confermato */
  totpAttivo: boolean;
  /** vero finché la password provvisoria data da chi ha preparato l'account non è cambiata */
  passwordDaCambiare: boolean;
  /**
   * Falso se chi amministra ha tolto il secondo fattore a quest'account: all'accesso
   * basta la password. Vero per ogni account nuovo e per chi esisteva già.
   */
  mfaRichiesto: boolean;
}

/** Le colonne che servono a costruire un `Utente`, con l'unità già unita. */
function selezione(d: Handle) {
  return d
    .select({
      id: tabella.id,
      utente: tabella.utente,
      ruolo: tabella.ruolo,
      nome: tabella.nome,
      iniziali: tabella.iniziali,
      email: tabella.email,
      stato: tabella.stato,
      passwordHash: tabella.passwordHash,
      totpAttivatoIl: tabella.totpAttivatoIl,
      passwordDaCambiare: tabella.passwordDaCambiare,
      mfaRichiesto: tabella.mfaRichiesto,
      unita: tabellaUnita.chiave,
    })
    .from(tabella)
    .leftJoin(tabellaUnita, eq(tabella.unitaId, tabellaUnita.id));
}

type Riga = Awaited<ReturnType<ReturnType<typeof selezione>["all"]>>[number];

function componi(r: Riga): Utente {
  return {
    id: r.id,
    utente: r.utente,
    ruolo: r.ruolo as RuoloSessione,
    nome: r.nome,
    iniziali: r.iniziali,
    ...(r.unita ? { unita: r.unita } : {}),
    ...(r.email ? { email: r.email } : {}),
    stato: r.stato as StatoUtente,
    haPassword: r.passwordHash !== null && r.passwordHash !== "",
    totpAttivo: r.totpAttivatoIl !== null,
    passwordDaCambiare: r.passwordDaCambiare === 1,
    mfaRichiesto: r.mfaRichiesto !== 0,
  };
}

/**
 * Il confronto del nome utente è **senza distinzione di maiuscole**.
 *
 * Lo era già con il file, dove `verificaCredenziali` faceva `.toLowerCase()`. Il
 * `lower()` qui è la stessa espressione dell'indice unico `utenti_utente`, così
 * la ricerca lo usa invece di leggere tutta la tabella — e soprattutto così non
 * esiste un modo di scrivere il nome che trova una riga che l'indice considera
 * duplicata.
 */
const stessoNome = (nomeUtente: string) =>
  sql`lower(${tabella.utente}) = ${nomeUtente.trim().toLowerCase()}`;

/** Un account per nome, in qualunque stato. `null` se non c'è. */
export function trovaUtente(nomeUtente: string): Utente | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    const r = selezione(d).where(stessoNome(nomeUtente)).get();
    return r ? componi(r) : null;
  } catch (errore) {
    solleva("utenti.trovaUtente", errore);
  }
}

/** Un account per identificativo. Serve dopo l'accesso, quando il nome non c'è più. */
export function utentePerId(id: number): Utente | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    const r = selezione(d).where(eq(tabella.id, id)).get();
    return r ? componi(r) : null;
  } catch (errore) {
    solleva("utenti.utentePerId", errore);
  }
}

/** Tutti gli account, per l'amministrazione. Ordinati per nome utente. */
export function elencoUtenti(): Utente[] {
  const d = dbSeEsiste();
  if (!d) return [];
  try {
    return selezione(d).orderBy(tabella.utente).all().map(componi);
  } catch (errore) {
    solleva("utenti.elencoUtenti", errore);
  }
}

/**
 * Vero se non c'è nessun account con cui si possa entrare.
 *
 * «Nessuno» vuol dire nessuno **attivo e con una password**: un elenco di soli
 * invitati non permette di accedere, e dirlo qui evita la schermata che chiede
 * credenziali che non possono funzionare.
 */
export function configurazioneMancante(): boolean {
  const d = dbSeEsiste();
  if (!d) return true;
  try {
    const r = d
      .select({ n: sql<number>`count(*)` })
      .from(tabella)
      .where(and(eq(tabella.stato, "attivo"), isNotNull(tabella.passwordHash)))
      .get();
    return (r?.n ?? 0) === 0;
  } catch {
    // qui un errore di database non deve diventare un'eccezione: questa
    // funzione la chiama la schermata di accesso, che deve poter dire «non
    // configurato» invece di rispondere 500
    return true;
  }
}

/**
 * Verifica le credenziali. Restituisce l'account o `null`, senza dire quale dei
 * due campi era sbagliato.
 *
 * Tre cose che non si vedono dalla firma:
 *
 *  - se il nome non esiste si calcola comunque un argon2id contro un hash
 *    finto, se no «utente inesistente» risponderebbe in un millesimo del tempo
 *    di «password sbagliata» e i nomi diventerebbero elencabili a cronometro;
 *  - un account `revocato` o `invitato` viene rifiutato **dopo** la verifica,
 *    per lo stesso motivo di tempo;
 *  - un hash `scrypt$…` riuscito viene riscritto in argon2id qui, che è l'unico
 *    momento in cui la password in chiaro c'è.
 */
export async function verificaCredenziali(
  nomeUtente: string,
  password: string,
): Promise<Utente | null> {
  const d = dbSeEsiste();
  if (!d) return null;

  let riga: { id: number; passwordHash: string | null } | undefined;
  try {
    riga = d
      .select({ id: tabella.id, passwordHash: tabella.passwordHash })
      .from(tabella)
      .where(stessoNome(nomeUtente))
      .get();
  } catch (errore) {
    solleva("utenti.verificaCredenziali", errore);
  }

  if (!riga?.passwordHash) {
    await verificaAVuoto(password);
    return null;
  }
  if (!(await verificaPassword(password, riga.passwordHash))) return null;

  if (daRiHashare(riga.passwordHash)) await riscriviHash(riga.id, password);

  const utente = utentePerId(riga.id);
  // l'account c'è e la password è giusta, ma non è (più) uno che può entrare
  return utente && utente.stato === "attivo" ? utente : null;
}

/** L'accesso pubblico usa questa verifica con prenotazione atomica del tentativo. */
export async function verificaCredenzialiLimitate(
  nomeUtente: string,
  password: string,
  ip: string,
): Promise<{ esito: "bloccato"; minuti: number } | { esito: "errore" } | { esito: "ok"; utente: Utente }> {
  const prenotazione = prenotaTentativo(nomeUtente, ip);
  if (prenotazione.bloccato) return { esito: "bloccato", minuti: prenotazione.minuti };
  const utente = await verificaCredenziali(nomeUtente, password);
  if (!utente) return { esito: "errore" };
  annullaPrenotazione(prenotazione.ids);
  return { esito: "ok", utente };
}

/**
 * Riscrive un hash vecchio nel formato nuovo, in silenzio.
 *
 * Se fallisce non si interrompe l'accesso: l'utente ha dato la password giusta,
 * e fargli vedere un errore perché non siamo riusciti a migliorare il nostro
 * archivio sarebbe punire lui di un problema nostro. Si riproverà al prossimo
 * accesso.
 */
async function riscriviHash(id: number, password: string): Promise<void> {
  try {
    const nuovo = await creaHashPassword(password);
    transazione((d) => {
      d.update(tabella).set({ passwordHash: nuovo }).where(eq(tabella.id, id)).run();
    });
  } catch (errore) {
    console.warn("utenti: non sono riuscito a riscrivere un hash scrypt:", errore);
  }
}

/** Segna l'istante dell'ultimo accesso riuscito. Non blocca niente se fallisce. */
export function segnaAccesso(id: number): void {
  try {
    transazione((d) => {
      d.update(tabella)
        .set({ ultimoAccesso: sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')` })
        .where(eq(tabella.id, id))
        .run();
    });
  } catch (errore) {
    console.warn("utenti: non sono riuscito a segnare l'ultimo accesso:", errore);
  }
}

// ==========================================================================
// Password
// ==========================================================================

/**
 * Cambia la password, verificando prima quella vecchia.
 *
 * La verifica della vecchia non è una formalità: senza, chi trovasse una
 * sessione aperta su un computer incustodito potrebbe cambiare la password e
 * chiudere fuori il proprietario.
 *
 * L'hash si calcola **prima** di aprire la transazione: `transazione()` vuole
 * una funzione sincrona, e tenere una scrittura aperta per i 28 ms di un
 * argon2id bloccherebbe gli altri per niente.
 */
export async function cambiaPassword(
  nomeUtente: string,
  vecchia: string,
  nuova: string,
  ip: string,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  const problema = passwordAccettabile(nuova);
  if (problema) return { ok: false, errore: problema };
  if (nuova === vecchia) {
    return { ok: false, errore: "La password nuova deve essere diversa da quella attuale." };
  }

  /*
   * La password attuale si indovina quanto quella dell'accesso: stesso limite,
   * stesso conteggio per utente e per IP. Senza, chi trovava una sessione
   * aperta su un dispositivo lasciato acceso poteva provarla all'infinito e,
   * indovinandola, chiudere fuori il titolare (audit di sicurezza, AUTH-03).
   * Il conteggio è condiviso con l'accesso, di proposito: cinque errori qui
   * valgono come cinque all'ingresso.
   */
  const d = dbSeEsiste();
  if (!d) return { ok: false, errore: "Il database non è raggiungibile." };

  const riga = d
    .select({ id: tabella.id, passwordHash: tabella.passwordHash })
    .from(tabella)
    .where(stessoNome(nomeUtente))
    .get();

  if (!riga?.passwordHash) return { ok: false, errore: "Questo utente non ha una password." };
  const prenotazione = prenotaTentativo(nomeUtente, ip);
  if (prenotazione.bloccato) {
    return { ok: false, errore: `Troppi tentativi. Riprovate fra ${prenotazione.minuti} minuti.` };
  }
  if (!(await verificaPassword(vecchia, riga.passwordHash))) {
    return { ok: false, errore: "La password attuale non è corretta." };
  }
  annullaPrenotazione(prenotazione.ids);

  const nuovoHash = await creaHashPassword(nuova);
  try {
    transazione((dd) => {
      // cambiarla è anche l'unico modo di uscire da una password provvisoria
      dd.update(tabella)
        .set({ passwordHash: nuovoHash, passwordDaCambiare: 0 })
        .where(eq(tabella.id, riga.id))
        .run();
    });
  } catch (errore) {
    solleva("utenti.cambiaPassword", errore);
  }
  return { ok: true };
}

/**
 * Imposta la password senza chiedere quella vecchia, e attiva l'account.
 *
 * È la strada dell'invito: chi arriva con un token valido una password vecchia
 * non ce l'ha. **Non esporla a nessun'altra chiamante** senza un controllo
 * davanti, perché è esattamente la funzione che permette di prendere possesso
 * di un account.
 */
export async function impostaPassword(
  id: number,
  nuova: string,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  const problema = passwordAccettabile(nuova);
  if (problema) return { ok: false, errore: problema };

  const nuovoHash = await creaHashPassword(nuova);
  try {
    transazione((d) => {
      d.update(tabella)
        .set({ passwordHash: nuovoHash, stato: "attivo", passwordDaCambiare: 0 })
        .where(eq(tabella.id, id))
        .run();
    });
  } catch (errore) {
    solleva("utenti.impostaPassword", errore);
  }
  return { ok: true };
}

/**
 * Dà all'account una password **provvisoria** e lo attiva.
 *
 * È la strada degli account preparati prima della messa in produzione
 * (`scripts/account-iniziali.mjs`): chi li riceve entra con una password che
 * conoscono anche altri, e al primo accesso — dopo aver attivato il secondo
 * fattore — non arriva a nessuna pagina finché non ne sceglie una sua
 * (`proxy.ts` e `sessioneCorrente`). Per questo qui non vale il minimo di
 * `passwordAccettabile`: una password provvisoria non resta.
 *
 * Solo per gli script lanciati da chi amministra la macchina, mai da una
 * schermata: è una presa di possesso dell'account quanto `impostaPassword`.
 */
export async function impostaPasswordProvvisoria(id: number, provvisoria: string): Promise<void> {
  if (provvisoria === "" || provvisoria.length > PASSWORD_MAX) {
    throw new Error("Password provvisoria vuota o troppo lunga.");
  }
  const hash = await creaHashPassword(provvisoria);
  try {
    transazione((d) => {
      d.update(tabella)
        .set({ passwordHash: hash, stato: "attivo", passwordDaCambiare: 1 })
        .where(eq(tabella.id, id))
        .run();
    });
  } catch (errore) {
    solleva("utenti.impostaPasswordProvvisoria", errore);
  }
}

// ==========================================================================
// Secondo fattore
// ==========================================================================

/**
 * Genera un segreto TOTP nuovo e lo salva **non ancora attivo**.
 *
 * Restituisce il segreto perché la schermata deve mostrarne il QR. Fino a
 * `confermaTotp` l'account resta senza secondo fattore: se l'attivazione si
 * interrompe a metà — batteria scarica, app sbagliata — il prossimo tentativo
 * ricomincia da un segreto nuovo, invece di chiedere un codice che nessun
 * telefono sa produrre.
 */
export function iniziaTotp(id: number): string {
  const segreto = nuovoSegreto();
  try {
    transazione((d) => {
      d.update(tabella)
        // il segreto si cifra a riposo (vedi `lib/auth/cifratura.ts`); alla
        // schermata torna quello **in chiaro**, che è ciò che il QR deve mostrare
        .set({ totpSecret: cifra(segreto), totpAttivatoIl: null, totpUltimoPasso: null, totpInAttesa: null, totpInAttesaScadeIl: null, codiciRecupero: null })
        .where(eq(tabella.id, id))
        .run();
    });
  } catch (errore) {
    solleva("utenti.iniziaTotp", errore);
  }
  return segreto;
}

/**
 * Il segreto da attivare: quello in sospeso, o uno nuovo se non ce n'è.
 *
 * La schermata di attivazione la si ricarica — si sbaglia app, si perde
 * l'inquadratura, si torna indietro col tasto del browser — e ogni volta
 * generare un segreto nuovo renderebbe inutile quello appena inquadrato. Chi
 * invece si è davvero impantanato preme il pulsante che chiama `iniziaTotp` e
 * ricomincia da capo.
 *
 * Un segreto in sospeso non è un secondo fattore: `totp_attivato_il` resta
 * nullo, e `verificaTotpDi` rifiuta finché non c'è.
 */
export function assicuraSegretoTotp(id: number): string {
  const d = dbSeEsiste();
  if (!d) return iniziaTotp(id);
  try {
    const r = d
      .select({ segreto: tabella.totpSecret, attivato: tabella.totpAttivatoIl })
      .from(tabella)
      .where(eq(tabella.id, id))
      .get();
    if (r?.segreto && !r.attivato) return decifra(r.segreto);
  } catch (errore) {
    solleva("utenti.assicuraSegretoTotp", errore);
  }
  return iniziaTotp(id);
}

/**
 * Conferma l'attivazione con il primo codice. Solo allora il fattore è attivo.
 *
 * Chiedere un codice prima di considerare attivo il segreto è ciò che impedisce
 * il caso peggiore: un account con il secondo fattore obbligatorio e un segreto
 * che nessuno ha davvero inquadrato, cioè un referente chiuso fuori senza rimedio.
 */
export function confermaTotp(id: number, codice: string, quandoMs = Date.now()): boolean {
  try {
    return transazione((d) => {
      const r = d
        .select({ segreto: tabella.totpSecret, attivato: tabella.totpAttivatoIl })
        .from(tabella)
        .where(eq(tabella.id, id))
        .get();
      if (!r?.segreto || r.attivato) return false;

      const esito = verificaCodice(decifra(r.segreto), codice, null, quandoMs);
      if (!esito.ok) return false;

      d.update(tabella)
        .set({
          totpAttivatoIl: sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
          totpUltimoPasso: esito.passo,
        })
        .where(eq(tabella.id, id))
        .run();
      return true;
    });
  } catch (errore) {
    solleva("utenti.confermaTotp", errore);
  }
}

/**
 * Verifica un codice all'accesso, e consuma il passo.
 *
 * Lettura, verifica e scrittura del passo stanno **nella stessa transazione**:
 * se stessero fuori, due richieste con lo stesso codice potrebbero leggere
 * entrambe un `totp_ultimo_passo` vecchio e passare entrambe — che è
 * esattamente il riuso che il passo serve a impedire.
 */
export function verificaTotpDi(id: number, codice: string, quandoMs = Date.now()): boolean {
  try {
    return transazione((d) => {
      const r = d
        .select({
          segreto: tabella.totpSecret,
          attivato: tabella.totpAttivatoIl,
          ultimo: tabella.totpUltimoPasso,
        })
        .from(tabella)
        .where(eq(tabella.id, id))
        .get();
      if (!r?.segreto || !r.attivato) return false;

      const esito = verificaCodice(decifra(r.segreto), codice, r.ultimo, quandoMs);
      if (!esito.ok) return false;

      d.update(tabella).set({ totpUltimoPasso: esito.passo }).where(eq(tabella.id, id)).run();
      return true;
    });
  } catch (errore) {
    solleva("utenti.verificaTotpDi", errore);
  }
}

/**
 * L'esito del secondo passo con il limite tentativi applicato.
 *
 *  - `ok`         il codice è giusto: si può entrare;
 *  - `bloccato`   troppi tentativi falliti di recente: si aspetta `minuti`;
 *  - `codiceErrato` il codice è sbagliato (e il tentativo è stato contato);
 *  - `nonValido`  la sessione non ha più un utente a cui appartenere.
 */
export type EsitoSecondoFattore =
  | { esito: "ok"; recupero?: boolean }
  | { esito: "bloccato"; minuti: number }
  | { esito: "codiceErrato" }
  | { esito: "nonValido" };

/**
 * Verifica il secondo fattore **applicando il limite tentativi**.
 *
 * Nasce dall'audit: prima il passo del codice non aveva alcun tetto, e chi già
 * conosceva la password poteva provare le sei cifre all'infinito rinnovando la
 * finestra da cinque minuti. Qui si riusa lo stesso conteggio del primo passo
 * (`lib/auth/tentativi.ts`, per nome utente e per IP): un codice sbagliato conta
 * come un accesso fallito, e dopo cinque falliti in quindici minuti si aspetta —
 * esattamente come per la password. Con `SEC-01` chiuso a monte (il proxy che
 * riscrive `X-Forwarded-For`), il conteggio per IP non è più aggirabile.
 *
 * Il controllo dell'attesa viene **prima** della verifica, così un tentativo
 * fatto da bloccati non consuma né rivela nulla. Il conteggio del solo nome
 * utente si azzera qui, al successo, e **soltanto** qui: il primo passo non lo
 * tocca, perché una password giusta senza codice non è un accesso (AUTH-01). La logica sta qui, in un
 * modulo di server senza `next/headers`, perché così è verificabile dalle prove
 * — la Server Action ci mette solo cookie, indirizzo e rimando.
 */
export function verificaSecondoFattoreLimitato(
  utenteId: number,
  ip: string,
  codice: string,
  quandoMs = Date.now(),
): EsitoSecondoFattore {
  const utente = utentePerId(utenteId);
  if (!utente || utente.stato !== "attivo") return { esito: "nonValido" };

  const minuti = attesa(utente.utente, ip);
  if (minuti !== null) return { esito: "bloccato", minuti };

  const recupero = /^[a-fA-F0-9]{32}$/.test(codice.replace(/[\s-]/g, ""));
  const ok = recupero
    ? consumaCodiceRecupero(utente.id, codice)
    : utente.totpAttivo
    ? verificaTotpDi(utente.id, codice, quandoMs)
    : confermaTotp(utente.id, codice, quandoMs);

  if (!ok) {
    segnaFallimento(utente.utente, ip);
    return { esito: "codiceErrato" };
  }

  azzera(utente.utente);
  return { esito: "ok", ...(recupero ? { recupero: true } : {}) };
}

/** Toglie il secondo fattore: il prossimo accesso ripassa dall'attivazione. */
export function azzeraTotp(id: number): void {
  try {
    transazione((d) => {
      d.update(tabella)
        .set({ totpSecret: null, totpAttivatoIl: null, totpUltimoPasso: null, totpInAttesa: null, totpInAttesaScadeIl: null, codiciRecupero: null })
        .where(eq(tabella.id, id))
        .run();
    });
  } catch (errore) {
    solleva("utenti.azzeraTotp", errore);
  }
}

// ==========================================================================
// Creazione e revoca
// ==========================================================================

/** L'identificativo di un'unità dalla sua chiave. `undefined` se non c'è. */
function idUnitaDaChiave(chiave: string): number | undefined {
  const d = dbSeEsiste();
  if (!d) return undefined;
  return d
    .select({ id: tabellaUnita.id })
    .from(tabellaUnita)
    .where(eq(tabellaUnita.chiave, chiave))
    .get()?.id;
}

export interface NuovoUtente {
  utente: string;
  ruolo: RuoloSessione;
  nome: string;
  iniziali: string;
  /** chiave d'unità: obbligatoria per i referenti di unità, vietata agli altri */
  unita?: string;
  email?: string;
  /** falso per un account a cui basta la password; predefinito vero */
  mfaRichiesto?: boolean;
}

/**
 * Crea un account senza password: entrerà con un invito.
 *
 * L'unità si traduce in `unita_id` qui. Se la chiave non esiste la riga viene
 * rifiutata dal `CHECK` dello schema — che è la risposta giusta: un referente di unità
 * il cui reparto non c'è è un account che non può fare il proprio lavoro, e
 * accomodarlo lo nasconderebbe soltanto.
 */
export function creaUtente(nuovo: NuovoUtente): number {
  if (!RUOLI_VALIDI.includes(nuovo.ruolo)) {
    throw new Error(`Ruolo non valido: ${nuovo.ruolo}`);
  }

  /*
   * La traduzione della chiave d'unità sta **fuori** dal `try`, e non è una
   * questione di stile. `solleva()` trasforma qualunque cosa esca da lì in un
   * `ErroreDatabase` con un messaggio generico — è il suo compito, perché il
   * dettaglio di un guasto SQLite non va mostrato a nessuno. Ma «l'unità
   * castorini non esiste» non è un guasto: è una cosa che chi ha chiamato deve
   * poter leggere e correggere. Dentro il try diventava «qualcosa non ha
   * funzionato sul server», e chi cerca l'errore di battitura non lo trova più.
   */
  const idUnita = nuovo.unita ? (idUnitaDaChiave(nuovo.unita) ?? null) : null;
  if (nuovo.unita && idUnita === null) {
    throw new Error(`Unità sconosciuta: ${nuovo.unita}`);
  }

  try {
    return transazione((d) => {
      const r = d
        .insert(tabella)
        .values({
          utente: nuovo.utente.trim().toLowerCase(),
          ruolo: nuovo.ruolo,
          nome: nuovo.nome,
          iniziali: nuovo.iniziali,
          unitaId: idUnita,
          email: nuovo.email ?? null,
          mfaRichiesto: nuovo.mfaRichiesto === false ? 0 : 1,
          stato: "invitato",
        })
        .returning({ id: tabella.id })
        .get();
      return r.id;
    });
  } catch (errore) {
    solleva("utenti.creaUtente", errore);
  }
}

/** Rilegge l'autorizzazione nella transazione, senza la cache della richiesta. */
function livelloUtentiIn(d: Handle, ruolo: string): Livello {
  const presente = d.select({ livello: tabellaPermessi.livello }).from(tabellaPermessi).where(and(eq(tabellaPermessi.funzione, "utenti"), eq(tabellaPermessi.ruolo, ruolo))).get();
  const configurata = !!d.select({ id: tabellaPermessi.id }).from(tabellaPermessi).limit(1).get();
  const scritto = presente?.livello ?? (configurata ? "nessuno" : FUNZIONI_INIZIALI.find((f) => f.id === "utenti")?.livelli[ruolo] ?? "nessuno");
  return livelloEffettivo("utenti", ruolo, scritto as Livello);
}

/**
 * Revoca un account: non entra più, e le sessioni aperte cadono.
 *
 * La cancellazione delle sessioni **non** è qui ma in chi chiama, perché
 * `lib/auth/sessioni.ts` è l'unico posto che tocca quella tabella. §7 del piano
 * dice «revoca immediata», e immediata vuol dire che chi era già dentro esce:
 * senza quella seconda mossa resterebbe dentro fino a dodici ore.
 */
export function revoca(id: number, autore?: string): boolean {
  try {
    return transazione((d) => {
      if (autore) {
        const attore = d.select().from(tabella).where(sql`lower(${tabella.utente}) = ${autore.toLowerCase()}`).get();
        const bersaglio = d.select().from(tabella).where(eq(tabella.id, id)).get();
        if (!attore || attore.stato !== "attivo" || !bersaglio || attore.id === id) return false;
        const livello = livelloUtentiIn(d, attore.ruolo);
        if (livello === "nessuno" || (livello === "limitato" && !["referente", "social"].includes(bersaglio.ruolo))) return false;
        if (bersaglio.ruolo === "sviluppatore") {
          const altri = d.select({ n: sql<number>`count(*)` }).from(tabella).where(and(
            sql`${tabella.id} <> ${id}`, eq(tabella.ruolo, "sviluppatore"), eq(tabella.stato, "attivo"),
            isNotNull(tabella.passwordHash), or(isNotNull(tabella.totpAttivatoIl), eq(tabella.mfaRichiesto, 0)), eq(tabella.passwordDaCambiare, 0),
          )).get()?.n ?? 0;
          if (!altri) return false;
        }
      }
      d.update(tabella)
        .set({ stato: "revocato", passwordHash: null })
        .where(eq(tabella.id, id))
        .run();
      return true;
    });
  } catch (errore) {
    solleva("utenti.revoca", errore);
  }
}

/**
 * Gli account che risultano **attivi** ma non hanno una password.
 *
 * Non possono entrare — `verificaCredenziali` rifiuta qualunque password
 * contro un hash assente, e lo fa spendendo lo stesso tempo di una verifica
 * vera — quindi non sono un buco. Sono però uno stato che in produzione non
 * dovrebbe esistere.
 *
 * Trovarne vuol dire che qualcuno ha copiato un database di sviluppo sulla
 * macchina di esercizio. Lo controlla `instrumentation.ts` all'avvio, e li
 * elenca `npm run db:conti`.
 *
 * Gli **invitati** restano fuori: sono senza password per costruzione.
 */
export function contiInutilizzabili(): { id: number; utente: string; ruolo: string }[] {
  const d = dbSeEsiste();
  if (!d) return [];
  try {
    return d
      .select({ id: tabella.id, utente: tabella.utente, ruolo: tabella.ruolo })
      .from(tabella)
      .where(and(eq(tabella.stato, "attivo"), isNull(tabella.passwordHash)))
      .all();
  } catch {
    // all'avvio un guasto qui non deve impedire di dire le altre cose
    return [];
  }
}

/** Vero se il database c'è ed è scrivibile: serve alle azioni che devono dirlo. */
export function databaseUtentiPronto(): boolean {
  try {
    db();
    return true;
  } catch {
    return false;
  }
}

/** Aggiornamento atomico, senza modificare credenziali o stato dell'account. */
export function modificaUtente(
  id: number,
  dati: Omit<NuovoUtente, "utente">,
  autore: string,
  livello: "completo" | "limitato",
  ruoloAtteso: RuoloSessione,
): "ok" | "cambiato" | "negato" | "ultimoAdmin" {
  const unitaId = dati.unita ? idUnitaDaChiave(dati.unita) : null;
  if (dati.ruolo === "referente" && (!unitaId || dati.unita === "gruppo")) return "negato";
  if (dati.ruolo !== "referente" && dati.unita) return "negato";
  try {
    return transazione((d) => {
      const bersaglio = d.select().from(tabella).where(eq(tabella.id, id)).get();
      const attore = d.select().from(tabella).where(sql`lower(${tabella.utente}) = ${autore.toLowerCase()}`).get();
      if (!attore || attore.stato !== "attivo" || !["sviluppatore", "gestore"].includes(attore.ruolo) || (livello === "completo" && attore.ruolo !== "sviluppatore")) return "negato";
      if (!bersaglio || bersaglio.stato === "revocato" || bersaglio.ruolo !== ruoloAtteso) return "cambiato";
      const corrente = livelloUtentiIn(d, attore.ruolo);
      if (corrente === "nessuno") return "negato";
      if ((corrente === "limitato" || livello === "limitato") && (!["referente", "social"].includes(bersaglio.ruolo) || !["referente", "social"].includes(dati.ruolo))) return "negato";
      if (bersaglio.utente.toLowerCase() === autore.toLowerCase() && (dati.ruolo !== bersaglio.ruolo || unitaId !== bersaglio.unitaId)) return "negato";
      if (bersaglio.ruolo === "sviluppatore" && bersaglio.stato === "attivo" && dati.ruolo !== "sviluppatore") {
        const altri = d.select({ n: sql<number>`count(*)` }).from(tabella).where(and(
          sql`${tabella.id} <> ${id}`, eq(tabella.ruolo, "sviluppatore"), eq(tabella.stato, "attivo"),
          isNotNull(tabella.passwordHash), or(isNotNull(tabella.totpAttivatoIl), eq(tabella.mfaRichiesto, 0)), eq(tabella.passwordDaCambiare, 0),
        )).get()?.n ?? 0;
        if (!altri) return "ultimoAdmin";
      }
      /*
       * Il secondo fattore lo sceglie solo chi ha `completo` sugli utenti, cioè
       * uno sviluppatore. Con `limitato` il campo si ignora, anche se arriva
       * dal modulo: un gestore non toglie il codice a nessuno.
       */
      const mfa =
        dati.mfaRichiesto !== undefined && livello === "completo" && corrente === "completo"
          ? { mfaRichiesto: dati.mfaRichiesto ? 1 : 0 }
          : {};
      d.update(tabella).set({ nome: dati.nome, iniziali: dati.iniziali, email: dati.email || null, ruolo: dati.ruolo, unitaId: unitaId ?? null, ...mfa }).where(eq(tabella.id, id)).run();
      return "ok";
    });
  } catch (errore) {
    solleva("utenti.modificaUtente", errore);
  }
}
