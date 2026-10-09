/**
 * Forma dell'identità del gruppo, senza niente che tocchi il disco.
 *
 * Sta separata da `lib/gruppo.ts` perché la barra è un componente client e
 * quindi non può stare nella stessa catena di import di `node:fs`. Qui ci sono
 * i tipi e i valori predefiniti; la lettura e la scrittura stanno di là.
 */

import { GRUPPO } from "@/lib/data";

export interface Marchio {
  /** indirizzo da mettere in `src` */
  src: string;
  larghezza: number;
  altezza: number;
}

/**
 * I recapiti che compaiono nel piede, in Contatti e nelle informative.
 *
 * Sono tutti modificabili dall'area riservata: erano segnaposto e i referenti devono
 * poterli mettere a posto senza aprire il codice. Le chiavi corrispondono una a
 * una a quelle di `GRUPPO`, così i valori predefiniti restano lì.
 */
export interface Recapiti {
  indirizzo: string;
  citta: string;
  email: string;
  telefonoGestori: string;
}

export interface Identita extends Recapiti {
  nome: string;
  sottotitolo: string;
  marchio: Marchio;
}

/** Il marchio consegnato con il sito, quando nessuno ne ha caricato uno. */
export const MARCHIO_PREDEFINITO: Marchio = {
  src: "/assets/logo-marchio.png",
  larghezza: 277,
  altezza: 278,
};

export const IDENTITA_PREDEFINITA: Identita = {
  nome: GRUPPO.nome,
  sottotitolo: GRUPPO.sottotitolo,
  indirizzo: GRUPPO.indirizzo,
  citta: GRUPPO.citta,
  email: GRUPPO.email,
  telefonoGestori: GRUPPO.telefonoGestori,
  marchio: MARCHIO_PREDEFINITO,
};

/** I campi dei recapiti, nell'ordine in cui compaiono nel modulo. */
export const CAMPI_RECAPITI: {
  chiave: keyof Recapiti;
  label: string;
  tipo: "text" | "email" | "tel";
  hint: string;
  /**
   * Vero se non si può svuotare. Solo l'email: è l'unico recapito che il sito
   * pubblica sempre, quello a cui arriva il modulo contatti e che le
   * informative nominano. Gli altri si tolgono, e dove compaiono le pagine
   * semplicemente non li scrivono.
   */
  obbligatorio: boolean;
}[] = [
  {
    chiave: "indirizzo",
    label: "Indirizzo della sede",
    tipo: "text",
    hint: "Via e numero civico. Facoltativo: vuoto, la sede non compare.",
    obbligatorio: false,
  },
  {
    chiave: "citta",
    label: "CAP e città",
    tipo: "text",
    hint: "Per esempio «00100 Città di Esempio (XX)». Facoltativo.",
    obbligatorio: false,
  },
  /*
   * Un indirizzo solo. Erano tre — segreteria, gestori, privacy — e i referenti
   * gruppo hanno chiesto di pubblicare soltanto quello ufficiale (23 settembre
   * 2026). Le righe `gruppo.emailGestori` e `gruppo.emailPrivacy` che un
   * database avesse ancora non le legge più nessuno.
   */
  {
    chiave: "email",
    label: "Email del gruppo",
    tipo: "email",
    hint: "L’unico indirizzo pubblicato: piede, Contatti, schede delle unità, informative e modulo contatti. Obbligatorio.",
    obbligatorio: true,
  },
  {
    chiave: "telefonoGestori",
    label: "Telefono dei gestori",
    tipo: "tel",
    hint: "Il cellulare di riferimento, se ce n’è uno. Facoltativo.",
    obbligatorio: false,
  },
];

/**
 * La sede come si scrive in una riga: «Via Roma 1, 00100 Città di Esempio (XX)».
 *
 * Indirizzo e città si tolgono dal modulo (non sono obbligatori), quindi
 * ognuno dei due può mancare: la virgola si mette solo fra due pezzi che ci
 * sono, e senza nessuno dei due la stringa è vuota — chi la usa non scrive la
 * riga, invece di «Sede: , ».
 */
export const sede = (g: Pick<Recapiti, "indirizzo" | "citta">): string =>
  [g.indirizzo, g.citta]
    .map((v) => v.trim())
    .filter((v) => v !== "")
    .join(", ");

/** Limiti del caricamento: un marchio è un file piccolo, e deve restarlo. */
export const PESO_MAX = 1024 * 1024;
export const LATO_MAX = 2000;
export const TIPI_AMMESSI = ["image/png", "image/jpeg"] as const;

/**
 * Esito di un salvataggio, per `useActionState`.
 *
 * Sta qui e non accanto alle azioni perché un file `"use server"` può esportare
 * **solo funzioni**: una costante esportata da lì diventa un riferimento remoto,
 * e il componente si ritrova in mano una funzione al posto dello stato iniziale.
 * È la stessa ragione per cui `ACCESSO_INIZIALE` sta in `lib/accesso.ts` e
 * `STATO_INIZIALE` in `lib/contatti.ts`.
 */
export interface StatoIdentita {
  stato: "vuoto" | "salvato" | "errore";
  messaggio?: string;
  /** campo da segnalare come sbagliato */
  campo?: string;
}

export const IDENTITA_INIZIALE: StatoIdentita = { stato: "vuoto" };

/** Numero di telefono nella forma accettata da href="tel:". */
export const tel = (numero: string) => numero.replace(/\s/g, "");
