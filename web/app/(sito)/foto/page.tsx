import type { Metadata } from "next";
import { metadatiPagina } from "@/lib/metadati";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Crumbs } from "@/components/site/Crumbs";
import { Galleria } from "@/components/site/Galleria";
import { trama } from "@/components/site/Photo";
import { albumPubblicati } from "@/lib/album";
import { fasciaDiUnita, INTRO } from "@/lib/data";
import { albumAttivi } from "@/lib/funzioni";
import { leggiIdentita } from "@/lib/gruppo";

export const metadata: Metadata = metadatiPagina(
  "Label",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.",
  "/foto",
);

export default async function Foto() {
  // album spenti: la pagina non c'è (vedi `lib/funzioni.ts`)
  if (!(await albumAttivi())) notFound();
  const g = await leggiIdentita();
  const album = await albumPubblicati();
  /*
   * L'album in evidenza è il più recente **che abbia fotografie**, non
   * semplicemente il più recente.
   *
   * Prima era `album[0]`, e con gli album ancora vuoti la pagina apriva con un
   * riquadro grande, un titolo, «0 foto» e un pulsante giallo «Apri l'album»
   * che portava a una schermata vuota: la promessa più visibile del sito era
   * quella che manteneva meno. Finché nessun album ha fotografie non c'è niente
   * da mettere in evidenza, e la pagina lo dice invece di riempire lo spazio.
   */
  const ev = album.find((a) => a.foto.length > 0);
  const colEv = ev ? fasciaDiUnita(ev.unita) : fasciaDiUnita("gruppo");

  return (
    <main id="contenuto">
      <div className="wrap section--tight stack gap-14" style={{ maxWidth: "1280px" }}>
        <Crumbs items={[{ label: "Home", href: "/" }, { label: "Label" }]} />
        <h1 className="h1">Label</h1>
        <p className="lead measure--sm">{INTRO.foto}</p>
      </div>

      <Galleria album={album}>
        {ev ? (
        <section
          className="wrap stack gap-18"
          style={{ paddingTop: "44px" }}
          aria-labelledby="titolo-evidenza"
        >
          <span className="eyebrow" id="titolo-evidenza">
            Label
          </span>
          <Link
            className="album-hero ph"
            href={`/foto/${ev.slug}`}
            style={trama(colEv.tinta, 0.1, 14)}
          >
            {/*
              La copertina vera, quando c'è.

              Prima qui c'era sempre il riquadro rigato con scritto «copertina
              dell'album», anche per un album pieno di fotografie: il posto più
              in vista della pagina era l'unico che non poteva mostrarne una, e
              caricarle non lo avrebbe cambiato. Adesso è la prima foto
              dell'album — la stessa che fa da copertina nella griglia — e il
              colore di fascia resta sotto, per i lati che la proporzione non
              copre e per il tempo che l'immagine ci mette ad arrivare.

              È pubblica anche se l'album ha la password: è l'unica fotografia
              che `/foto-file` serve senza, per scelta del gruppo.
            */}
            {ev.foto[0] ? (
              <img
                className="album-hero__foto"
                src={`/foto-file/${ev.foto[0].file}?l=1600`}
                srcSet={
                  `/foto-file/${ev.foto[0].file}?l=400 400w, ` +
                  `/foto-file/${ev.foto[0].file}?l=800 800w, ` +
                  `/foto-file/${ev.foto[0].file}?l=1600 1600w`
                }
                sizes="(max-width: 1280px) 100vw, 1280px"
                width={ev.foto[0].larghezza}
                height={ev.foto[0].altezza}
                alt=""
                aria-hidden="true"
              />
            ) : (
              <span className="ph__tag ph__tag--light ph__tag--tl">
                copertina dell’album
              </span>
            )}
            <span className="album-hero__scrim"></span>
            <span className="album-hero__body">
              <span className="stack gap-10" style={{ maxWidth: "720px" }}>
                <span className={`pill pill--${ev.unita}`}>{ev.tag}</span>
                <span className="album-hero__title">{ev.titolo}</span>
                <span className="album-hero__meta">
                  {ev.data} · {ev.foto.length} foto · {ev.sottotitolo}
                </span>
              </span>
              <span
                className="btn btn--yellow"
                style={{ minHeight: "48px", padding: "0 22px", fontSize: "16.5px" }}
              >
                Apri l’album
              </span>
            </span>
          </Link>
        </section>
        ) : album.length > 0 ? (
          <section className="wrap" style={{ paddingTop: "44px" }}>
            <div className="empty">
              <strong>Label</strong>
              <span>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod
                tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam,
                quis nostrud exercitation.
              </span>
            </div>
          </section>
        ) : null}
      </Galleria>

      <section
        className="band split split--privacy"
        style={{ marginTop: "72px", padding: "44px var(--gutter)" }}
        aria-labelledby="titolo-privacy"
      >
        <div className="stack gap-12" style={{ maxWidth: "700px" }}>
          <span className="eyebrow">Label</span>
          <h2 id="titolo-privacy" className="h2" style={{ fontSize: "30px" }}>
            Label
          </h2>
          <p className="note">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
            nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
            Duis aute irure dolor.
          </p>
        </div>
        <div
          className="card card--pad"
          style={{ gap: "10px", padding: "24px", borderRadius: "12px" }}
        >
          <span className="rows__key">Label</span>
          <span style={{ fontSize: "17px", lineHeight: 1.55, color: "var(--ink)" }}>
            Lorem ipsum{" "}
            <a href={`mailto:${g.email}`} style={{ fontWeight: 600 }}>
              {g.email}
            </a>{" "}
            dolor sit amet, consectetur adipiscing elit, sed do eiusmod.
          </span>
          <Link
            href="/legale/immagini-e-minori"
            style={{ paddingTop: "6px", fontSize: "16px", fontWeight: 600 }}
          >
            Label →
          </Link>
        </div>
      </section>
    </main>
  );
}
