import type { MetadataRoute } from "next";
import { albumPubblicati } from "@/lib/album";
import { leggiCartelle } from "@/lib/cartelle-store";
import { documentiPubblicati } from "@/lib/documenti-store";
import { albumAttivi } from "@/lib/funzioni";
import { UNITA } from "@/lib/data";
import { indirizzoPubblico } from "@/lib/indirizzo-pubblico";
import { SLUG_LEGALI } from "@/lib/legale";

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
 * La mappa del sito, per i motori di ricerca.
 *
 * Ci sono **solo le pagine pubbliche**. Sotto `/area-riservata` e `/anteprima`
 * non c'è niente da indicizzare — chi ci arriva senza sessione viene rimandato
 * all'accesso — e `robots.ts` le esclude comunque; elencarle qui sarebbe la
 * contraddizione classica fra i due file, con la mappa che invita dove il
 * robots dice di non andare.
 *
 * Gli album seguono lo stato: `albumPubblicati()` è la stessa lettura che fa la
 * pagina Foto, quindi un album in bozza o in revisione non finisce in mappa.
 * Le unità invece vengono da `UNITA` e non dal database, per lo stesso motivo
 * per cui ci viene `generateStaticParams`: uno slug è un indirizzo pubblico, e
 * non deve poter sparire dalla mappa perché qualcuno ha modificato una riga.
 *
 * `/manutenzione` e `/legale/preferenze-cookie` restano fuori: la prima è un
 * approdo di servizio, la seconda è un pannello di comandi e non un testo da
 * trovare cercando.
 *
 * Senza `SITO_BASE_URL` la mappa **è vuota**, e non riempita con
 * `localhost`. Vedi `lib/indirizzo-pubblico.ts`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = indirizzoPubblico();
  if (!base) return [];

  const voce = (
    percorso: string,
    priorita: number,
    frequenza: "daily" | "weekly" | "monthly" | "yearly",
  ) => ({
    url: `${base}${percorso}`,
    changeFrequency: frequenza,
    priority: priorita,
  });

  const fotoAccese = await albumAttivi();
  const album = fotoAccese ? await albumPubblicati().catch(() => []) : [];
  // le cartelle con qualcosa dentro: sono le stesse che la pagina Documenti
  // mostra, e una cartella vuota in mappa sarebbe una pagina che dice «vuota»
  const [cartelle, documenti] = await Promise.all([
    leggiCartelle().catch(() => []),
    documentiPubblicati().catch(() => []),
  ]);
  const conDocumenti = cartelle.filter((c) => documenti.some((d) => d.categoria === c.chiave));

  return [
    voce("/", 1, "weekly"),
    voce("/chi-siamo", 0.8, "monthly"),
    voce("/unita", 0.8, "monthly"),
    ...UNITA.map((u) => voce(`/unita/${u.slug}`, 0.7, "monthly")),
    voce("/attivita", 0.9, "weekly"),
    ...(fotoAccese ? [voce("/foto", 0.6, "weekly")] : []),
    ...album.map((a) => voce(`/foto/${a.slug}`, 0.4, "monthly")),
    voce("/documenti", 0.8, "weekly"),
    ...conDocumenti.map((c) => voce(`/documenti/${c.chiave}`, 0.6, "monthly")),
    voce("/contatti", 0.9, "monthly"),
    ...SLUG_LEGALI.map((p) => voce(`/legale/${p.slug}`, 0.3, "yearly")),
  ];
}
