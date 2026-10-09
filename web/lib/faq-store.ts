import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { adessoIso } from "@/lib/db/mappa";
import { faq as tabella, utenti } from "@/lib/db/schema";
import { type FasciaKey, FAQ } from "@/lib/data";
import { eFasciaFaq, type VoceFaq } from "@/lib/faq-contenuti";

/**
 * Le domande frequenti della pagina Contatti.
 *
 * Modulo di solo server. Stessa proprietà di tutti gli altri store del CMS: **si
 * conservano solo le differenze** — tabella vuota significa «usa le cinque
 * domande di `lib/data.ts`». Qui la regola prende una forma più semplice che
 * altrove, perché l'elenco si modifica come elenco: o è vuoto e vale il codice,
 * o c'è ed è quello che vale.
 *
 * ## Che cosa NON fa: non si semina
 *
 * `leggiFaq()` non scrive niente alla prima lettura, a differenza degli album e
 * dei documenti. Quelli si seminano perché i referenti devono ritrovare l'elenco che
 * il sito annuncia e lavorarci sopra; qui le cinque domande consegnate sono
 * **testi veri**, non segnaposto, e restano dove sono corrette con un rilascio
 * finché nessuno le tocca. Al primo salvataggio la tabella prende il posto del
 * codice per intero.
 *
 * La conseguenza da conoscere: chi apre la schermata trova le cinque domande del
 * codice nelle caselle, e salvandole senza modifiche le **copia** in tabella. È
 * il contrario della regola degli altri store, e qui è inevitabile — un elenco
 * ordinato non si può confrontare campo per campo con un predefinito senza
 * inventarsi un'identità per ogni voce. La schermata lo dice.
 */

/** Come la pagina le vuole: una lista ordinata, con il colore risolto. */
export const leggiFaq = cache(async (): Promise<VoceFaq[]> => {
  const d = dbSeEsiste();
  if (!d) return dalCodice();

  try {
    const righe = d
      .select({
        domanda: tabella.domanda,
        risposta: tabella.risposta,
        fascia: tabella.fascia,
        linkTesto: tabella.linkTesto,
        linkHref: tabella.linkHref,
        linkCoda: tabella.linkCoda,
      })
      .from(tabella)
      .orderBy(asc(tabella.ordine), asc(tabella.id))
      .all();

    if (righe.length === 0) return dalCodice();

    return righe.map((r): VoceFaq => ({
      domanda: r.domanda,
      risposta: r.risposta,
      // una fascia fuori elenco non può esistere: c'è un `CHECK`. Il ripiego è
      // per il caso in cui qualcuno scriva in tabella a mano.
      fascia: eFasciaFaq(r.fascia) ? r.fascia : "gruppo",
      ...(r.linkTesto && r.linkHref && r.linkCoda !== null
        ? { link: { testo: r.linkTesto, href: r.linkHref, coda: r.linkCoda } }
        : {}),
    }));
  } catch (errore) {
    solleva("faq-store.leggiFaq", errore);
  }
});

/**
 * Le cinque domande consegnate, nella forma di `VoceFaq`.
 *
 * `FAQ` in `lib/data.ts` porta il colore come esadecimale, perché è nato prima
 * della tabella. La traduzione inversa — dal colore alla fascia — sta qui e in
 * nessun altro posto, e serve solo a questo ripiego: dal primo salvataggio in
 * poi la fascia è quella salvata.
 */
function dalCodice(): VoceFaq[] {
  const perColore: Record<string, FasciaKey> = {
    "#ffcc00": "gialla",
    "#006633": "verde",
    "#a5342c": "rossa",
    "#002144": "gruppo",
  };
  return FAQ.map((f): VoceFaq => ({
    domanda: f.domanda,
    risposta: f.risposta,
    fascia: perColore[f.colore] ?? "gruppo",
    ...(f.link ? { link: f.link } : {}),
  }));
}

/** Vero se l'elenco è quello del codice: la schermata lo dichiara. */
export async function faqDalCodice(): Promise<boolean> {
  const d = dbSeEsiste();
  if (!d) return true;
  try {
    return d.select({ id: tabella.id }).from(tabella).limit(1).all().length === 0;
  } catch (errore) {
    solleva("faq-store.faqDalCodice", errore);
  }
}

// --------------------------------------------------------------------------
// Scrittura
// --------------------------------------------------------------------------

/**
 * Sostituisce l'elenco intero.
 *
 * Cancella e reinserisce, in una transazione. Non è pigrizia: l'elenco si
 * modifica **come elenco** — si aggiunge una domanda, si riordina, si toglie
 * quella che non serve più — e aggiornare per riga vorrebbe dire un'identità per
 * ogni voce che il modulo non ha, e una rinumerazione dell'ordine a ogni
 * cancellazione. È la stessa scelta di `scriviElenco` per le persone d'unità,
 * con lo stesso motivo.
 *
 * Un elenco **vuoto** riporta al codice, e la schermata lo dice: è l'unico modo
 * di annullare una personalizzazione, e vale la pena che ci sia.
 */
export async function salvaFaq(voci: readonly VoceFaq[], autore: string): Promise<void> {
  try {
    transazione((d) => {
      const autoreId = autore
        ? (d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, autore)).get()?.id ??
          null)
        : null;
      const quando = adessoIso();

      d.delete(tabella).run();

      voci.forEach((v, i) => {
        // una voce senza domanda non è una domanda: si scarta, come una riga di
        // persona senza nome
        if (v.domanda.trim() === "") return;
        d.insert(tabella)
          .values({
            domanda: v.domanda.trim(),
            risposta: v.risposta.trim(),
            fascia: v.fascia,
            linkTesto: v.link?.testo.trim() ?? null,
            linkHref: v.link?.href ?? null,
            linkCoda: v.link?.coda ?? null,
            ordine: i + 1,
            aggiornatoIl: quando,
            autoreId,
          })
          .run();
      });
    });
  } catch (errore) {
    solleva("faq-store.salvaFaq", errore);
  }
}
