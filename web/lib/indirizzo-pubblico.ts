/**
 * L'indirizzo pubblico del sito, per le cose che devono essere assolute.
 *
 * Sono tre: la sitemap (lo standard vuole URL assoluti), `robots.txt` (che deve
 * indicare dove sta la sitemap) e i metadati di condivisione, perché
 * un'anteprima su WhatsApp o Facebook viene composta da un server che non sa
 * niente della richiesta originale e non può risolvere un percorso relativo.
 *
 * Viene da `SITO_BASE_URL`, la stessa variabile con cui `scripts/invita.mjs`
 * compone i collegamenti d'invito e con cui `middleware.ts` compone i rimandi.
 * Una definizione sola per tre usi: se il dominio cambia, cambia in un posto.
 *
 * ## Che cosa succede se non c'è
 *
 * Niente di rotto, e niente di inventato. `sitemap.ts` e `robots.ts` la
 * pretendono e senza di lei non pubblicano nulla — una sitemap con dentro
 * `http://localhost:3000` è peggio di una sitemap assente, perché la si
 * consegna a un motore di ricerca e ci si accorge dell'errore mesi dopo. I
 * metadati di condivisione fanno lo stesso: senza dominio non si scrive un
 * `og:url`.
 *
 * Non si compone dall'intestazione `Host`, per il motivo già scritto in
 * `middleware.ts`: sarebbe chi manda la richiesta a decidere che cosa il sito
 * dichiara di essere. Per una risposta di rimando è un fastidio; dentro una
 * sitemap è un invito a farsi indicizzare un dominio altrui.
 */
export function indirizzoPubblico(): string | null {
  const grezzo = process.env.SITO_BASE_URL;
  if (!grezzo) return null;
  try {
    // niente barra finale: chi compone gli indirizzi la mette come separatore
    return new URL(grezzo).origin;
  } catch {
    console.warn(`SITO_BASE_URL non è un indirizzo valido: «${grezzo}»`);
    return null;
  }
}
