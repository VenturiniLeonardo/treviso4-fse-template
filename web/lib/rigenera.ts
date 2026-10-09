import { revalidatePath } from "next/cache";
import { UNITA } from "@/lib/data";

/**
 * Le pagine pubbliche con un segmento dinamico, da rigenerare dopo una modifica.
 *
 * ## Perché non basta `revalidatePath("/unita/[slug]", "page")`
 *
 * Le pagine pubbliche stanno nel gruppo di rotte `(sito)`, e per Next quel gruppo
 * fa parte del nome della pagina: la sua etichetta di cache è
 * `/(sito)/unita/[slug]/page`. Un `revalidatePath("/unita/[slug]", "page")` scritto
 * senza il gruppo non nomina nessuna pagina — non dà errore e non rigenera niente.
 * Il sintomo l'hanno visto i referenti di unità: un testo salvato, un elenco di responsabili
 * approvato o una fotografia d'archivio approvata, e sul sito pubblico restava la
 * pagina di prima finché non si riavviava il server.
 *
 * Per questo ogni funzione qui fa **due** cose: nomina la rotta con il gruppo, e
 * nomina uno per uno gli indirizzi veri, che non dipendono da come sono raggruppate
 * le cartelle. Basta che una delle due strade regga perché la pagina si rigeneri; se
 * un domani le cartelle si riorganizzano, resta quella per indirizzo.
 *
 * `test/rigenera.test.mjs` controlla che il gruppo scritto qui esista davvero fra
 * le cartelle di `app/`.
 */

/** Le sei pagine `/unita/<slug>`. */
export function rigeneraPagineUnita(): void {
  revalidatePath("/(sito)/unita/[slug]", "page");
  for (const u of UNITA) revalidatePath(`/unita/${u.slug}`);
}

/** Le pagine `/documenti/<cartella>`: le cartelle sono righe di database, qui non si elencano. */
export function rigeneraPagineDocumenti(): void {
  revalidatePath("/(sito)/documenti/[cartella]", "page");
}
