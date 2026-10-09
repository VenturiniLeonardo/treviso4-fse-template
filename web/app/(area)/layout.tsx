import type { Metadata } from "next";
import { classiFont } from "@/lib/fonts";
import { cookies } from "next/headers";
import { leggiIdentita } from "@/lib/gruppo";
import {
  classeTema,
  classiVista,
  leggiPreferenze,
  NOME_COOKIE_PREFERENZE,
} from "@/lib/preferenze";

/**
 * Guscio dell'area riservata.
 *
 * È una radice separata da quella del sito pubblico (due root layout, un route
 * group per ciascuno): serve un `body.admin` diverso e un insieme di fogli di
 * stile diverso, e il passaggio fra i due mondi è un caricamento pieno — che è
 * quello che si vuole, visto che qui entrerà l'autenticazione.
 *
 * Ordine dei fogli, come nelle pagine consegnate: site.css porta le variabili e
 * le basi, admin.css la parte densa, fonts.css sostituisce i caratteri.
 * Tailwind entra solo qui (§04) e senza preflight, per non azzerare le basi.
 */
import "@/styles/site.css";
import "@/styles/admin.css";
import "@/styles/area-routes.css";
import "@/styles/fonts.css";
import "@/styles/tailwind.css";

export async function generateMetadata(): Promise<Metadata> {
  const { nome, marchio } = await leggiIdentita();
  return {
    title: { default: `Area riservata — ${nome}`, template: `%s — ${nome}` },
    description: `Area riservata del ${nome}.`,
    icons: { icon: marchio.src },
    // contiene elenchi di iscritti: fuori dagli indici, in ogni caso
    robots: { index: false, follow: false },
  };
}

export default async function LayoutArea({ children }: { children: React.ReactNode }) {
  // le preferenze di visualizzazione diventano classi — il tema su <html>, il
  // resto sul body: la resa la decide il foglio di stile, qui si dice solo
  // quale preferenza è attiva
  const barattolo = await cookies();
  const preferenze = leggiPreferenze(barattolo.get(NOME_COOKIE_PREFERENZE)?.value);
  const vista = classiVista(preferenze);

  return (
    <html lang="it" className={`${classiFont} ${classeTema(preferenze)}`}>
      <body className={vista ? `admin ${vista}` : "admin"}>
        <a className="skip-link" href="#contenuto">
          Vai al contenuto
        </a>
        {children}
      </body>
    </html>
  );
}
