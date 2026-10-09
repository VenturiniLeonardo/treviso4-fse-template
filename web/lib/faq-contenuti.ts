import type { FasciaKey } from "@/lib/data";
import { scorciatoie } from "@/lib/nav";

/**
 * Forma e limiti delle domande frequenti. Niente che tocchi il disco.
 *
 * Le FAQ erano l'ultimo contenuto editoriale del sito a stare nel codice.
 * Aggiunte alla fase 14.12.
 */

/** Una FAQ come la mostra la pagina, e come la compila il modulo. */
export interface VoceFaq {
  domanda: string;
  risposta: string;
  /** una delle quattro fasce: decide il colore della striscia a sinistra */
  fascia: FasciaKey;
  /** collegamento in coda alla risposta: le tre parti stanno o cadono insieme */
  link?: { testo: string; href: string; coda: string };
}

/**
 * Il colore della striscia, per fascia.
 *
 * **Non è `FASCE`**, e la differenza è di un valore: per la fascia «gruppo»
 * qui c'è `#002144` e in `FASCE` c'è `#003366`. Il mockup usa il primo per la
 * FAQ blu, e il secondo per i riquadri di gruppo altrove. Sono due navy vicini
 * ma non lo stesso, e allinearli avrebbe cambiato il colore di una domanda in
 * una pagina approvata — una modifica al disegno che nessuno ha chiesto.
 */
export const COLORI_FAQ: Record<FasciaKey, string> = {
  gialla: "#ffcc00",
  verde: "#006633",
  rossa: "#a5342c",
  gruppo: "#002144",
};

/** Le quattro scelte, come le mostra il modulo. */
export const FASCE_FAQ: { chiave: FasciaKey; label: string }[] = [
  { chiave: "gialla", label: "Giallo — fascia gialla" },
  { chiave: "verde", label: "Verde — fascia verde" },
  { chiave: "rossa", label: "Rosso — fascia rossa" },
  { chiave: "gruppo", label: "Blu — tutto il gruppo" },
];

export const eFasciaFaq = (v: string): v is FasciaKey =>
  FASCE_FAQ.some((b) => b.chiave === v);

/**
 * Le pagine del sito a cui una risposta può rimandare.
 *
 * Un **menù chiuso**, non una casella di testo, e non è una comodità: un campo
 * libero per un indirizzo in una pagina pubblica è un posto dove mettere un
 * collegamento che porta altrove, e un link che parte dal sito del gruppo si
 * porta dietro la fiducia del gruppo. Il `CHECK` `faq_link_interno` lo garantisce
 * comunque nel database; questo elenco fa in modo che nessuno debba provarci.
 *
 * Arriva da `SCORCIATOIE` in `lib/nav.ts`, che è l'elenco delle pagine del sito
 * già usato dalla 404 e dalla ricerca: una seconda copia sarebbe divergita al
 * primo indirizzo nuovo.
 */
export const PAGINE_COLLEGABILI: { href: string; label: string }[] = scorciatoie(true).map(
  (s) => ({ href: s.href, label: s.label }),
);

export const ePaginaCollegabile = (href: string): boolean =>
  PAGINE_COLLEGABILI.some((p) => p.href === href);

/** Limiti, dichiarati nel modulo e verificati dall'azione. */
export const FAQ_MAX = 20;
export const DOMANDA_MAX = 200;
export const RISPOSTA_MAX = 2000;
export const LINK_TESTO_MAX = 80;
export const LINK_CODA_MAX = 40;
