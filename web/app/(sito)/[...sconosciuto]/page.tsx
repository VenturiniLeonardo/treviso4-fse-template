import type { Metadata } from "next";
import { notFound } from "next/navigation";

/**
 * Gli stessi metadati di `not-found.tsx`, ripetuti qui.
 *
 * Non è una duplicazione inutile: Next prende i metadati dalla **rotta**, non
 * dalla pagina che `notFound()` fa comparire. Senza questa riga il documento
 * partiva con il titolo giusto — quello della 404 renderizzata sul server — e
 * dopo l'idratazione il client lo riportava al titolo predefinito del sito: la
 * scheda del browser cambiava nome sotto gli occhi, e una 404 finiva indicizzata
 * come se fosse una pagina qualunque.
 */
export const metadata: Metadata = {
  title: "Pagina non trovata",
  robots: { index: false, follow: false },
};

/**
 * Cattura tutti gli indirizzi che non corrispondono a nessuna rotta e li manda
 * alla 404 del sito pubblico.
 *
 * Serve perché il progetto ha **due** radici — una per il sito, una per l'area
 * riservata — e in quel caso Next non accetta una `app/not-found.tsx` globale:
 * non avrebbe un layout in cui stare. Con questa rotta la 404 finisce dentro il
 * guscio del sito, con barra e piede, e non in una pagina nuda.
 *
 * Non ruba niente alle rotte vere: una rotta statica o dinamica più specifica
 * vince sempre su un catch-all, quindi l'area riservata continua a rispondere
 * dalle sue pagine.
 */
export default function Sconosciuta() {
  notFound();
}
