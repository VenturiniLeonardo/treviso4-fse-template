import type { Metadata } from "next";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { classiFont } from "@/lib/fonts";
import { albumAttivi } from "@/lib/funzioni";
import { leggiIdentita } from "@/lib/gruppo";
import { indirizzoPubblico } from "@/lib/indirizzo-pubblico";

// L'ordine conta: fonts.css ridefinisce --display/--text/--mono e deve venire
// dopo site.css. Tailwind non entra qui — il sito pubblico è tutto site.css.
import "@/styles/site.css";
import "@/styles/fonts.css";

/**
 * Titolo e icona seguono il nome e il marchio scelti dai referenti nell'area
 * riservata: sono generati a ogni compilazione della pagina, non fissi.
 *
 * ## I metadati di condivisione
 *
 * Aggiunti perché questo sito viaggerà soprattutto **incollato in una chat**:
 * un referente manda il collegamento al gruppo dei genitori, e senza `og:` quello
 * che compare è un rettangolo grigio con dentro l'indirizzo. Con questi, il
 * titolo e la riga di descrizione della pagina.
 *
 * L'immagine è il **marchio**, non la fotografia di gruppo della home. Non è
 * una scelta grafica: un'anteprima `og:image` viene scaricata e tenuta in copia
 * dai server di chi la mostra — WhatsApp, Facebook, Telegram — e una fotografia
 * con dentro i ragazzi finirebbe lì senza che nessuno l'abbia deciso. La stessa
 * fotografia sta sulla home ed è pubblica; una cosa è pubblicarla sul proprio
 * sito, un'altra è consegnarla a tre archivi che non si controllano. È la
 * lettura stretta di ciò che promette l'informativa immagini e minori.
 *
 * `metadataBase` viene da `SITO_BASE_URL`. Senza, Next non può rendere
 * assoluto `og:image` e i blocchi `openGraph`/`twitter` restano fuori invece di
 * annunciare un'immagine su `localhost`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { nome, sottotitolo, marchio } = await leggiIdentita();
  const base = indirizzoPubblico();
  const titolo = sottotitolo ? `${nome} — ${sottotitolo}` : nome;
  // «foto» solo con gli album accesi: senza, la descrizione prometteva ai
  // motori di ricerca una sezione che il sito non ha (vedi `lib/funzioni.ts`)
  const descrizione =
    `${nome}: lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod ` +
    `tempor incididunt ut labore, ${(await albumAttivi()) ? "et dolore, " : ""}magna aliqua.`;

  return {
    title: { default: titolo, template: `%s — ${nome}` },
    description: descrizione,
    icons: { icon: marchio.src },
    ...(base
      ? {
          metadataBase: new URL(base),
          // Niente `alternates` e niente `openGraph.url` qui: si erediterebbero
          // **identici** su ogni pagina, e un `canonical` che punta alla home
          // da tutte le pagine chiede ai motori di ricerca di tenere solo
          // quella. Li scrive ciascuna pagina con `metadatiPagina()`.
          openGraph: {
            type: "website",
            locale: "it_IT",
            siteName: nome,
            title: titolo,
            description: descrizione,
            images: [
              {
                url: marchio.src,
                width: marchio.larghezza,
                height: marchio.altezza,
                alt: `Marchio di ${nome}`,
              },
            ],
          },
          twitter: { card: "summary", title: titolo, description: descrizione },
        }
      : {}),
  };
}

export default async function LayoutSito({ children }: { children: React.ReactNode }) {
  const identita = await leggiIdentita();
  const album = await albumAttivi();

  return (
    <html lang="it" className={classiFont}>
      <body>
        <a className="skip-link" href="#contenuto">
          Vai al contenuto
        </a>
        <Navbar identita={identita} album={album} />
        {children}
        <Footer identita={identita} album={album} />
      </body>
    </html>
  );
}
