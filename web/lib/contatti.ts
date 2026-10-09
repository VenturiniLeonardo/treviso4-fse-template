import { MOTIVI_CONTATTO } from "@/lib/data";
import { EMAIL_MAX, emailValida } from "@/lib/email";

/**
 * Forma dello stato del modulo contatti.
 *
 * Sta qui e non accanto alla Server Action perché un file `"use server"` può
 * esportare soltanto funzioni async: tipi e costanti vanno in un modulo normale,
 * altrimenti la pagina non si carica affatto.
 */

export interface StatoModulo {
  /**
   * Gli stati possibili dopo un invio, e che cosa significano davvero.
   *
   *  - `ricevuto` — il messaggio è **salvato nel database** e i gestori lo
   *    trovano entrando nell'area riservata. Se la posta di §9 è configurata,
   *    hanno anche ricevuto un avviso, e `avvisati` lo dice. La differenza fra
   *    «qualcuno lo vedrà quando entra» e «qualcuno è stato avvisato» è
   *    esattamente quella che conta per chi aspetta una risposta, e la
   *    schermata dice quella vera invece di promettere sempre la seconda.
   *  - `nonRecapitato` — la scrittura non è riuscita, o il database non c'è.
   *    Resta la strada che funziona comunque: un messaggio di posta già
   *    scritto. Si chiama così e non `inviato` perché era proprio quel nome a
   *    produrre la schermata «Messaggio inviato» per un messaggio che non
   *    partiva.
   *  - `bloccato` — troppi invii dallo stesso indirizzo IP (§8).
   */
  stato: "vuoto" | "errore" | "ricevuto" | "nonRecapitato" | "bloccato";
  /** messaggio da mostrare accanto al pulsante */
  errore?: string;
  /** campi non validi, per marcarli con aria-invalid */
  campi?: string[];
  /** valori già scritti, per non farli perdere a JavaScript spento */
  valori?: ValoriContatti;
  /**
   * Vero se l'avviso per posta ai gestori è **partito davvero**.
   *
   * Non «la posta è configurata»: partito. Un server di posta fermo, delle
   * credenziali scadute o una casella piena danno `false`, e la schermata dice
   * la stessa cosa che diceva prima che la posta esistesse — «lo leggono
   * quando entrano». È l'unico modo di non promettere a una famiglia un
   * avviso che nessuno ha ricevuto.
   */
  avvisati?: boolean;
}

export const STATO_INIZIALE: StatoModulo = { stato: "vuoto" };

/**
 * Quanti messaggi si accettano da uno stesso indirizzo IP, e in quanto tempo.
 *
 * Cinque all'ora è largo per una famiglia che scrive — di solito ne scrive uno
 * — e stretto per chi prova a riempire la casella. Il conteggio sta in `limiti`
 * ed è separato da quello degli accessi: sarebbe assurdo che chi scrive cinque
 * volte al modulo pubblico si ritrovasse a non poter più entrare nell'area.
 */
export const CONTATTI_MAX = 5;
export const CONTATTI_FINESTRA_MINUTI = 60;

/**
 * Lunghezza massima di ciascun campo del modulo, in caratteri.
 *
 * Dall'audit di produzione: la validazione controllava che i campi ci fossero e
 * fossero nella forma giusta, ma **non** che non fossero enormi. L'unico tetto
 * era `serverActions.bodySizeLimit` (24 MB, alzato per le fotografie), quindi
 * una riga `messaggi` poteva pesare quanto una foto ed essere conservata due
 * anni. Ogni altra azione dell'area riservata i suoi limiti li ha; questi
 * riportano il modulo pubblico alla stessa regola.
 *
 * I valori sono larghi per una famiglia che scrive davvero — l'email al limite
 * di §4.5.3.1 dell'RFC 5321, il messaggio a cinquemila caratteri, cioè un paio
 * di pagine — e stretti per chi vuole usare la casella come deposito. Sono
 * riusati dal componente (`maxLength`) e dalla Server Action, così il limite è
 * uno solo e non due che possono divergere.
 */
export const LIMITI_CONTATTI = {
  nome: 120,
  email: EMAIL_MAX,
  telefono: 40,
  messaggio: 5000,
} as const;

/** I cinque campi che una persona scrive nel modulo, già ripuliti dagli spazi. */
export interface ValoriContatti {
  nome: string;
  email: string;
  telefono: string;
  motivo: string;
  messaggio: string;
}

export type EsitoValidazione =
  | { ok: true }
  | { ok: false; errore: string; campi: string[]; valori: ValoriContatti };

/**
 * La validazione del modulo contatti, come funzione pura.
 *
 * Sta qui, e non dentro la Server Action, per lo stesso motivo di
 * `verificaSecondoFattoreLimitato`: senza `next/headers` è verificabile dalle
 * prove, e la Server Action ci mette solo l'indirizzo IP, il limite e il
 * salvataggio. `privacyPresente` è un booleano perché la spunta del consenso, in
 * `FormData`, o c'è o non c'è — leggerla è compito dell'azione.
 *
 * Due passaggi in ordine: prima presenza e forma (il messaggio «manca
 * qualcosa»), poi la **lunghezza** (dall'audit: prima nessun campo aveva un
 * tetto, e una riga `messaggi` poteva pesare quanto una foto). Un campo troppo
 * lungo torna **tagliato al limite**, così non si rispedisce nella risposta un
 * corpo enorme mandato apposta.
 */
export function validaContatti(
  valori: ValoriContatti,
  privacyPresente: boolean,
): EsitoValidazione {
  const campi: string[] = [];
  if (valori.nome === "") campi.push("nome");
  // L'email nella stessa forma dei recapiti del gruppo (`lib/email.ts`): il
  // solo `includes("@")` di un tempo accettava «@», e chi sbagliava l'indirizzo
  // riceveva la conferma d'invio e nessuna risposta. Un'email oltre il tetto non
  // si guarda qui ma nel passaggio della lunghezza, che la chiama col suo nome.
  if (valori.email.length <= LIMITI_CONTATTI.email && !emailValida(valori.email)) {
    campi.push("email");
  }
  if (valori.messaggio.length <= 8) campi.push("messaggio");
  if (!privacyPresente) campi.push("privacy");
  if (!MOTIVI_CONTATTO.some((m) => m.chiave === valori.motivo)) campi.push("motivo");

  if (campi.length > 0) {
    return {
      ok: false,
      errore: "Controllate i campi evidenziati: nome, email, motivo, messaggio di almeno 9 caratteri e lettura dell’informativa privacy.",
      campi,
      valori,
    };
  }

  const troppoLunghi = (Object.keys(LIMITI_CONTATTI) as (keyof typeof LIMITI_CONTATTI)[]).filter(
    (campo) => valori[campo].length > LIMITI_CONTATTI[campo],
  );
  if (troppoLunghi.length > 0) {
    const tagliati = { ...valori };
    for (const campo of troppoLunghi) {
      tagliati[campo] = valori[campo].slice(0, LIMITI_CONTATTI[campo]);
    }
    return {
      ok: false,
      errore: "Un campo è troppo lungo: accorciatelo e riprovate.",
      campi: troppoLunghi,
      valori: tagliati,
    };
  }

  return { ok: true };
}

/**
 * L'oggetto e il testo della posta che porta il messaggio ai gestori.
 *
 * Funzioni pure, qui e non nella Server Action, per poterle provare senza
 * `next/headers`. Il corpo contiene **tutto** quello che la persona ha scritto:
 * dal 6 ottobre 2026 la casella `segreteria@example.org` è dove i referenti leggono, e
 * l'area riservata resta la copia di archivio. La privacy policy lo dice
 * (`lib/legale.ts`).
 *
 * L'oggetto porta il motivo e il nome, ripuliti da ogni a capo: sono i due dati
 * che servono a riconoscere il messaggio nell'elenco di Outlook, e il nome
 * l'ha scritto una persona qualsiasi.
 */
export function oggettoMessaggioContatti(motivo: string, nome: string): string {
  const pulito = nome.replace(/\s+/g, " ").trim().slice(0, 80);
  return `[Label] ${motivo} — ${pulito}`;
}

export function testoMessaggioContatti(
  v: ValoriContatti,
  motivo: string,
  id: number | undefined,
  quando: Date,
): string {
  return [
    "È arrivato un messaggio dal modulo contatti del sito.",
    "Per rispondere basta usare «Rispondi»: l'indirizzo è quello di chi ha scritto.",
    "",
    `Nome:      ${v.nome}`,
    `Email:     ${v.email}`,
    `Telefono:  ${v.telefono || "—"}`,
    `Motivo:    ${motivo}`,
    `Ricevuto:  ${quando.toLocaleString("it-IT", { timeZone: "Europe/Rome" })}`,
    "",
    "Messaggio:",
    "",
    v.messaggio,
    "",
    "—",
    id === undefined
      ? "Una copia è anche in «Messaggi dal sito», nell'area riservata."
      : `Una copia è anche in «Messaggi dal sito», nell'area riservata (n. ${id}).`,
  ].join("\n");
}
