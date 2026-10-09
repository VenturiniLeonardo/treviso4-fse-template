import type { Metadata } from "next";
import { NonTrovata } from "@/components/site/NonTrovata";
import { albumAttivi } from "@/lib/funzioni";
import { leggiIdentita } from "@/lib/gruppo";

export const metadata: Metadata = {
  title: "Pagina non trovata",
  robots: { index: false, follow: false },
};

/**
 * 404 delle rotte del sito pubblico: è quella che risponde a `notFound()`
 * chiamata dalle pagine di unità, album e legali. Sta dentro il gruppo `(sito)`,
 * quindi eredita barra e piede dal suo layout.
 */
export default async function NonTrovataSito() {
  return <NonTrovata identita={await leggiIdentita()} album={await albumAttivi()} />;
}
