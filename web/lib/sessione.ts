/**
 * Che cos'è una sessione, e che cosa permette di fare.
 *
 * Fino alla fase 6 questo file conteneva anche **come** una sessione veniva
 * fabbricata: un JSON firmato con HMAC-SHA256 e messo nel cookie, con il
 * commento «provvisorio per costruzione». Adesso le sessioni stanno nella
 * tabella `sessioni` e il cookie porta soltanto un numero casuale: la parte
 * crittografica è sparita di qui e sta in `lib/auth/sessioni.ts`.
 *
 * Quello che resta è la forma della sessione e i tre predicati d'ambito, cioè
 * le cose che anche le pagine e i componenti devono poter leggere. Il file non
 * importa niente, di proposito: chiunque lo può usare senza tirarsi dietro il
 * database.
 */

export const RUOLI_VALIDI = ["referente", "gestore", "sviluppatore", "social"] as const;
export type RuoloSessione = (typeof RUOLI_VALIDI)[number];

export const NOME_COOKIE = "sito_sessione";

/**
 * Percorso del cookie di sessione: tutto il sito, non solo `/area-riservata`.
 *
 * Ristretto all'area, il browser non lo mandava a `/foto-file/…` né a
 * `/documento/…`, che sono le due rotte che servono i file: chi aveva appena
 * caricato una fotografia si vedeva un riquadro rotto, e chi doveva approvarla
 * non poteva guardarla. Le due rotte fanno il proprio controllo di ambito, e
 * rispondono `private, no-store` quando il contenuto non è pubblicato.
 *
 * Sta qui in una costante sola perché scrittura e cancellazione devono usare lo
 * stesso valore: un `delete` con un percorso diverso non cancella niente, e
 * l'uscita lascerebbe un cookie orfano — è già successo con il vecchio valore,
 * nel ramo del middleware che butta i cookie non validi.
 */
export const PERCORSO_COOKIE = "/";

/**
 * Il percorso con cui il cookie veniva scritto prima.
 *
 * Non si può cancellare insieme a quello nuovo dalla stessa risposta: la mappa
 * dei cookie di Next è indicizzata per **nome**, quindi due `delete` dello
 * stesso cookie con percorsi diversi non emettono due intestazioni — il secondo
 * sostituisce il primo, e si finisce per cancellare quello sbagliato. Verificato.
 *
 * Per questo la ripulitura sta nel middleware, che può scrivere l'intestazione a
 * mano. Una sessione vecchia dura al massimo dodici ore: passate quelle, questa
 * costante e il blocco che la usa si possono togliere.
 */
export const PERCORSO_COOKIE_VECCHIO = "/area-riservata";

export interface Sessione {
  /** nome utente */
  u: string;
  /** ruolo */
  r: RuoloSessione;
  /** nome mostrato nella barra */
  n: string;
  /** iniziali per l'avatar */
  i: string;
  /**
   * Unità di competenza, per i soli referenti di unità: è l'ambito di §05.
   *
   * Sta nella sessione e non si ricava dal ruolo perché il ruolo dice *che cosa*
   * si può fare, non *su che cosa*. Un referente di unità senza questo campo non può
   * modificare nessun album: è il valore prudente, non un caso da tollerare.
   *
   * Dalla fase 6 questo campo viene riletto da `utenti.unita_id` a ogni
   * richiesta, non più copiato dentro un cookie che dura ore: spostare un referente
   * da un'unità all'altra ha effetto subito.
   */
  un?: string;
  /** scadenza assoluta, in secondi dall'epoca */
  exp: number;
}

/**
 * L'unità su cui questa sessione può scrivere, o `null` se può scrivere su
 * tutte (gestore, sviluppatore e social media manager) — la distinzione la
 * fa chi chiama.
 */
export function ambitoUnita(sessione: Sessione): string | null {
  return sessione.r === "referente" ? (sessione.un ?? "") : null;
}

/**
 * Questa sessione può toccare un contenuto di questa unità?
 *
 * Il social media manager sì, su tutte: prepara contenuti per ogni unità e per
 * il gruppo. «Toccare» non è «pubblicare» — quello lo dice `puoPubblicare`, e
 * per lui è no.
 */
export function puoScrivereSu(sessione: Sessione, unita: string): boolean {
  if (sessione.r === "gestore" || sessione.r === "sviluppatore") return true;
  if (sessione.r === "social") return true;
  return sessione.r === "referente" && sessione.un === unita;
}

/**
 * Solo i gestori (e l'admin) pubblicano: §05, il controllo dei consensi.
 * Il social media manager no: tutto quello che prepara passa da loro.
 */
export function puoPubblicare(sessione: Sessione): boolean {
  return sessione.r === "gestore" || sessione.r === "sviluppatore";
}

/** Un ruolo può aprire la vista di un altro ruolo? Solo l'admin. */
export function puoVedere(sessione: Sessione, ruoloRichiesto: string): boolean {
  return sessione.r === ruoloRichiesto || sessione.r === "sviluppatore";
}
