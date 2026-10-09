/**
 * Le proposte che aspettano in `proposte`: solo tipi e costanti.
 *
 * Il modulo con il database è `lib/proposte-store.ts`; questo lo importano anche
 * i componenti client, che non possono stare nella catena di `node:fs`. È la
 * stessa divisione di `lib/unita-contenuti.ts` e `lib/unita-store.ts`.
 *
 * Che cosa ci aspetta, e perché in una tabella sola, sta nel commento sulla
 * tabella in `lib/db/schema.ts`.
 */

import type { CampiAttivita } from "@/lib/attivita";

export type TipoProposta = "pagina" | "faq" | "immagine" | "copertina" | "attivita" | "album";

export const TIPI_PROPOSTA: readonly TipoProposta[] = [
  "pagina",
  "faq",
  "immagine",
  "copertina",
  "attivita",
  "album",
];

export const eTipoProposta = (v: string): v is TipoProposta =>
  (TIPI_PROPOSTA as readonly string[]).includes(v);

/**
 * Le misure di una fotografia in attesa, come stanno in `valore`.
 *
 * Il file sta nella sua colonna, non qui: è il nome che il lavoro notturno e la
 * rotta di anteprima cercano, e cercarlo dentro un JSON vorrebbe dire leggerli
 * tutti.
 */
export interface DatiFotografia {
  tipo: string;
  larghezza: number;
  altezza: number;
  /** il testo alternativo, per i riquadri; le copertine non ne hanno */
  descrizione?: string;
}

/**
 * Che cosa chiede una proposta su un'attività (`tipo` attivita, `chiave` l'id).
 *
 * Il social media manager modifica e cancella anche le attività degli altri —
 * decisione del 6 ottobre 2026 — ma niente di quello che fa cambia il sito da
 * sé. Su un'attività già pubblicata la modifica aspetta qui, e nel calendario
 * resta quella di adesso; la cancellazione aspetta qui sempre, tranne per una
 * bozza sua che nessuno ha mai visto.
 */
export type RichiestaAttivita =
  | { azione: "modifica"; campi: CampiAttivita }
  | { azione: "elimina" }
  | RichiestaRitiro;

/**
 * La richiesta di **ritirare** un contenuto pubblicato — un album (`tipo`
 * album, `chiave` lo slug) o un'attività —, con il motivo.
 *
 * Il social media manager non ritira da sé quello che un gestore ha messo
 * online (audit degli accessi, M-1b); fino al 7 ottobre 2026 si sentiva dire
 * «chiedete a loro», fuori dal sito. Adesso lo chiede da qui, e la richiesta
 * aspetta nella coda come ogni sua proposta. Per togliere subito una
 * fotografia sbagliata non serve: la nasconde, e sparisce all'istante.
 */
export interface RichiestaRitiro {
  azione: "ritira";
  motivo: string;
}

/** Quanto può essere lungo il motivo di un ritiro. */
export const MOTIVO_RITIRO_MAX = 500;

/** Il motivo, se questa è una richiesta di ritiro; `null` altrimenti. */
export function motivoDelRitiro(valore: string): string | null {
  try {
    const r = JSON.parse(valore) as { azione?: unknown; motivo?: unknown };
    return r.azione === "ritira" && typeof r.motivo === "string" ? r.motivo : null;
  } catch {
    return null;
  }
}

/**
 * Il `valore` di una proposta che chiede di **rimettere** sul sito una
 * fotografia nascosta: un riquadro (`immagine`) o una copertina.
 *
 * Il social media manager le fotografie le nasconde subito — togliere non mette
 * online niente — ma per farle ricomparire serve un gestore, come per
 * metterne una nuova. `file` resta vuoto: il file è già quello registrato, e una
 * proposta con un file è una proposta che, rimandata, quel file lo porta via.
 */
export const VALORE_MOSTRA = JSON.stringify({ mostra: true });

/** Questa proposta chiede di rimettere una fotografia nascosta? */
export const chiedeDiMostrare = (p: { valore: string; file: string | null }): boolean =>
  p.file === null && p.valore === VALORE_MOSTRA;

/** Una proposta come la legge chi la mostra. */
export interface PropostaInAttesa {
  tipo: TipoProposta;
  chiave: string;
  /** il testo, o il JSON: lo interpreta chi conosce il tipo */
  valore: string;
  /**
   * il file in archivio, per le fotografie; `null` vuol dire «togliere», o
   * «rimettere» se `valore` è `VALORE_MOSTRA`
   */
  file: string | null;
  autore: string;
  quando: number;
}

/**
 * L'indirizzo da cui chi approva guarda una fotografia in attesa.
 *
 * Non è `/immagine/` né `/copertina/`: quelle due servono a chiunque, con una
 * cache di un anno, e un file in attesa non deve uscire da lì — chi lo vede
 * prima dell'approvazione è proprio quello che l'approvazione serve a evitare.
 * Questa risponde solo a chi è entrato nell'area, e senza cache.
 */
export const indirizzoInAttesa = (file: string, lato = 800): string =>
  `/in-attesa/${encodeURIComponent(file)}?l=${lato}`;
