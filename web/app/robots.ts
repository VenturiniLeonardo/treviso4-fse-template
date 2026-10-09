import type { MetadataRoute } from "next";
import { indirizzoPubblico } from "@/lib/indirizzo-pubblico";

/**
 * Calcolata a ogni richiesta, non in compilazione.
 *
 * `next build` gira su una macchina d'integrazione che non conosce
 * `SITO_BASE_URL` e non ha il database (§06 del piano: si compila altrove e
 * si copia il risultato). Prerenderizzata, questa rotta congelerebbe quel
 * momento — cioè risponderebbe per sempre con il vuoto — e nessuno se ne
 * accorgerebbe, perché una risposta vuota è una risposta valida. Sono due
 * richieste alla settimana da parte di un crawler: il costo non esiste.
 */
export const dynamic = "force-dynamic";

/**
 * `robots.txt`.
 *
 * Le tre esclusioni non sono un controllo di sicurezza — quello è
 * `middleware.ts`, e sta in piedi da solo — ma servono comunque:
 *
 *  - `/area-riservata` e `/anteprima` rispondono a un motore di ricerca con un
 *    rimando all'accesso, quindi indicizzarle vuol dire riempire i risultati di
 *    copie della stessa schermata di login sotto indirizzi diversi;
 *  - `/foto-file`, `/documento` e `/copertina` servono file, non pagine. Un
 *    crawler che li segue scarica fotografie di minori e PDF di modulistica per
 *    tenerne una copia nella propria cache, che è esattamente ciò che
 *    l'informativa immagini promette di non far accadere più del necessario. La
 *    porta vera resta lo stato di pubblicazione, controllato in quelle rotte;
 *    questa riga toglie il traffico che non ha motivo di esserci.
 *
 * Senza `SITO_BASE_URL` non si dichiara la sitemap: indicarne una su un
 * dominio sbagliato è peggio che non averla. Le regole restano.
 */
export default function robots(): MetadataRoute.Robots {
  const base = indirizzoPubblico();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/area-riservata",
        "/anteprima",
        "/foto-file/",
        "/documento/",
        "/copertina/",
        "/immagine/",
      ],
    },
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
