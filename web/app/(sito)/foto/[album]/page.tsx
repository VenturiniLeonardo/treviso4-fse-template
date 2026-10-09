import type { Metadata } from "next";
import { metadatiPagina } from "@/lib/metadati";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Crumbs } from "@/components/site/Crumbs";
import { trama } from "@/components/site/Photo";
import { GrigliaFoto } from "@/components/site/GrigliaFoto";
import { SbloccoAlbum } from "@/components/site/SbloccoAlbum";
import { albumPubblicati, albumPubblicoPerIndirizzo } from "@/lib/album";
import { albumAttivi } from "@/lib/funzioni";
import { serraturaPerIndirizzo } from "@/lib/album-accesso";
import { haAperto } from "@/lib/album-cookie";
import { puo } from "@/lib/auth/contesto";
import { fasciaDiUnita, labelDiUnita } from "@/lib/data";
import { leggiIdentita } from "@/lib/gruppo";

/**
 * Pagina di un album. Nel mockup le copertine puntavano a `#` perché la pagina
 * non esisteva: adesso esiste, ed è un unico modello per tutti gli album, come
 * già per le unità.
 *
 * Le fotografie sono quelle caricate dai referenti dall'area riservata. Un album
 * senza foto mostra ancora i segnaposto a righe del mockup, così la pagina non
 * resta vuota mentre l'unità sta preparando il materiale.
 */
/*
 * Dinamica, e non più prerenderizzata: la stessa pagina mostra le fotografie a
 * chi ha aperto l'album con la password e il modulo a chi no, e la differenza
 * sta nel cookie della richiesta. Le altre pagine pubbliche restano statiche.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ album: string }>;
}): Promise<Metadata> {
  if (!(await albumAttivi())) return {};
  const { album } = await params;
  const a = await albumPubblicoPerIndirizzo(album);
  if (!a || a.stato !== "pubblicato") return {};
  /*
   * La descrizione non dice «0 foto».
   *
   * È la riga che finisce nello snippet di una ricerca e nell'anteprima di un
   * collegamento incollato in una chat di genitori: undici album su dodici
   * annunciavano «0 foto» a chi non aveva ancora aperto la pagina. Il conteggio
   * si scrive quando c'è qualcosa da contare.
   */
  const quante = a.foto.length === 0 ? "album in preparazione" : `${a.foto.length} foto`;
  return metadatiPagina(
    a.titolo,
    `${a.titolo} — ${a.data}, ${quante}. ${a.sottotitolo}`,
    `/foto/${album}`,
  );
}

export default async function PaginaAlbum({
  params,
}: {
  params: Promise<{ album: string }>;
}) {
  // album spenti: nessun album esiste, per il pubblico (vedi `lib/funzioni.ts`)
  if (!(await albumAttivi())) notFound();
  const { album: slug } = await params;
  const a = await albumPubblicoPerIndirizzo(slug);
  // un album in bozza o in revisione non esiste, per il pubblico; e delle
  // fotografie arrivano solo quelle visibili
  if (!a || a.stato !== "pubblicato") notFound();

  /*
   * Aperto per chi ha il cookie della password, e per i referenti che l'album lo
   * gestiscono — che altrimenti dovrebbero chiedersi la password da soli per
   * controllare che cosa hanno pubblicato. La serratura vera è comunque in
   * `/foto-file`: questa è solo la pagina che decide se mostrare la griglia.
   */
  const serratura = serraturaPerIndirizzo(a.slug);
  const aperto =
    !!serratura &&
    ((await haAperto(serratura)) || (await puo("album-carica", { unita: a.unita })));

  const g = await leggiIdentita();
  const col = fasciaDiUnita(a.unita);
  const pubblicati = await albumPubblicati();

  const indice = pubblicati.findIndex((x) => x.slug === a.slug);
  const precedente = indice > 0 ? pubblicati[indice - 1] : null;
  const successivo =
    indice >= 0 && indice < pubblicati.length - 1 ? pubblicati[indice + 1] : null;

  return (
    <main id="contenuto">
      <section
        className="page-hero ph"
        style={{ height: "380px", ...trama(col.tinta, 0.1, 14) }}
        aria-labelledby="titolo-album"
      >
        {/*
          La copertina vera, quando l'album ne ha una.

          È `page-hero__foto`, la stessa regola con cui una pagina di unità
          mostra la sua copertina: sta sotto lo scrim e sopra il colore di
          fascia. Finché non ci sono fotografie resta il riquadro rigato con
          l'etichetta, che qui è ancora onesta — dice che cosa andrà lì.
        */}
        {/* la copertina si vede anche prima della password: è pubblica */}
        {a.foto[0] ? (
          <img
            className="page-hero__foto"
            src={`/foto-file/${a.foto[0].file}?l=1600`}
            srcSet={
              `/foto-file/${a.foto[0].file}?l=400 400w, ` +
              `/foto-file/${a.foto[0].file}?l=800 800w, ` +
              `/foto-file/${a.foto[0].file}?l=1600 1600w`
            }
            sizes="100vw"
            width={a.foto[0].larghezza}
            height={a.foto[0].altezza}
            alt=""
            // decorativa: il titolo dell'album è già nell'h1 qui sotto, e la
            // didascalia vera della fotografia sta nella griglia
            aria-hidden="true"
          />
        ) : null}
        <div className="page-hero__scrim"></div>
        <div className="page-hero__body">
          <Crumbs
            onPhoto
            items={[
              { label: "Home", href: "/" },
              { label: "Foto", href: "/foto" },
              { label: a.titolo },
            ]}
          />
          <h1 id="titolo-album" className="page-hero__title" style={{ fontSize: "48px" }}>
            {a.titolo}
          </h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", paddingTop: "4px" }}>
            <span className={`pill pill--${a.unita}`}>{labelDiUnita(a.unita)}</span>
            <span className="hero-chip">{a.data}</span>
            <span className="hero-chip">
              {a.foto.length > 0 ? `${a.foto.length} foto` : "in preparazione"}
            </span>
            <span className="hero-chip">Label {a.anno}</span>
          </div>
        </div>
      </section>

      <div className="wrap section--tight stack gap-14" style={{ maxWidth: "1280px" }}>
        <p className="lead measure--sm">{a.sottotitolo}</p>
      </div>

      <div className="wrap stack gap-18" style={{ maxWidth: "1280px", paddingTop: "34px" }}>
        <div className="section-rule">
          <span className="eyebrow" style={{ whiteSpace: "nowrap" }}>
            Label
          </span>
          <span className="section-rule__line" aria-hidden="true"></span>
          <span className="section-rule__count">
            {a.foto.length === 0
              ? "nessuna ancora"
              : `${a.foto.length} ${a.foto.length === 1 ? "fotografia" : "fotografie"}`}
          </span>
        </div>

        {!aperto ? (
          <SbloccoAlbum slug={a.slug} chiuso={!serratura?.versione} />
        ) : a.foto.length > 0 ? (
          <GrigliaFoto foto={a.foto} titolo={a.titolo} />
        ) : (
          /*
           * L'album senza fotografie: un vuoto dichiarato, non una parete finta.
           *
           * Qui c'erano dodici riquadri rigati numerati da 1 a 12, con le
           * altezze alternate «come una parete di stampe». Nel mockup erano il
           * modo di far vedere il disegno di una galleria piena; su un sito
           * vero, sotto la riga «nessuna ancora», sono dodici fotografie che
           * non esistono — e chi arriva conta i riquadri e crede che le foto ci
           * siano e non si carichino. La frase che stava sotto la griglia era
           * già quella giusta: adesso è tutto quello che c'è.
           */
          <div className="empty">
            <strong>Label</strong>
            <span>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
              incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.
            </span>
          </div>
        )}

        {a.escluse > 0 ? (
          <p className="tiny-note">
            {a.escluse}{" "}
            {a.escluse === 1 ? "fotografia è stata esclusa" : "fotografie sono state escluse"}{" "}
            da questo album perché prive del consenso alla pubblicazione.
          </p>
        ) : null}
      </div>

      <section
        className="band split split--privacy"
        style={{ marginTop: "72px", padding: "44px var(--gutter)" }}
        aria-labelledby="titolo-privacy-album"
      >
        <div className="stack gap-12" style={{ maxWidth: "700px" }}>
          <span className="eyebrow">Label</span>
          <h2 id="titolo-privacy-album" className="h2" style={{ fontSize: "30px" }}>
            Label
          </h2>
          <p className="note">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
            nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
            Duis aute irure dolor in reprehenderit in voluptate velit esse.
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
            dolor sit amet ({a.titolo}), consectetur adipiscing elit.
          </span>
          <Link
            href="/legale/immagini-e-minori"
            style={{ paddingTop: "6px", fontSize: "16px", fontWeight: 600 }}
          >
            Label →
          </Link>
        </div>
      </section>

      <nav className="band" style={{ marginTop: 0 }} aria-label="Altri album">
        <div className="unit-switch">
          <Link className="btn" href="/foto">
            ← Label
          </Link>
          <div className="unit-switch__list">
            {precedente ? (
              <Link className="btn btn--ghost" href={`/foto/${precedente.slug}`}>
                ← {precedente.titolo}
              </Link>
            ) : null}
            {successivo ? (
              <Link className="btn btn--ghost" href={`/foto/${successivo.slug}`}>
                {successivo.titolo} →
              </Link>
            ) : null}
          </div>
        </div>
      </nav>
    </main>
  );
}
