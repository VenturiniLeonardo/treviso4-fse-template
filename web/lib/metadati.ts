import type { Metadata } from "next";

/**
 * Le due voci di metadati che **ogni pagina deve dire per sé**: l'indirizzo
 * canonico e l'anteprima di condivisione.
 *
 * Il resto — nome del sito, lingua, immagine, `metadataBase` — sta nel layout,
 * si eredita, ed è giusto che si erediti perché è del sito e non della pagina.
 * Queste due no, e metterle nel layout è un errore che si vede solo guardando
 * il sorgente di una pagina interna:
 *
 *  - un `canonical` ereditato dice a **ogni** pagina «l'originale è la home»,
 *    cioè chiede ai motori di ricerca di non tenere le altre. È la riga che
 *    fa sparire un sito da Google restando perfettamente valida;
 *  - un `og:url` ereditato manda alla home chi apre l'anteprima di un
 *    collegamento a Contatti.
 *
 * Next **non** ricava `og:title` e `og:description` da `title` e
 * `description`: se non si scrivono, un collegamento a una pagina interna
 * incollato in una chat mostra il titolo della home. Questa funzione li scrive,
 * partendo dagli stessi due valori, così non c'è niente da tenere allineato a
 * mano.
 *
 * Il titolo passato è quello **breve** della pagina — «Chi siamo», non
 * «Chi siamo — Label»: il nome del gruppo lo aggiunge `template` nel
 * layout per la scheda del browser, e qui `og:site_name` lo dice già.
 */
export function metadatiPagina(
  titolo: string,
  descrizione: string,
  percorso: string,
): Metadata {
  return {
    title: titolo,
    description: descrizione,
    alternates: { canonical: percorso },
    openGraph: { title: titolo, description: descrizione, url: percorso },
  };
}
