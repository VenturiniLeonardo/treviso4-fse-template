/**
 * Forma dello stato dei moduli di accesso.
 *
 * Modulo separato dalle Server Action perché un file `"use server"` può
 * esportare soltanto funzioni async.
 */

export interface StatoAccesso {
  stato: "vuoto" | "errore" | "bloccato" | "nonConfigurato";
  messaggio?: string;
  /** nome utente già scritto, per non farlo ridigitare */
  utente?: string;
}

export const ACCESSO_INIZIALE: StatoAccesso = { stato: "vuoto" };

/** Stato del passo del secondo fattore, e di quello dell'invito. */
export interface StatoCodice {
  stato: "vuoto" | "errore";
  messaggio?: string;
}

export const CODICE_INIZIALE: StatoCodice = { stato: "vuoto" };
