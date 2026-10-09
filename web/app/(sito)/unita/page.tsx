import type { Metadata } from "next";
import { metadatiPagina } from "@/lib/metadati";
import Link from "next/link";
import { Crumbs } from "@/components/site/Crumbs";
import { fascia, INTRO, ORGANIGRAMMA } from "@/lib/data";
import { leggiUnita } from "@/lib/unita-store";

export const metadata: Metadata = metadatiPagina(
  "Label",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do.",
  "/unita",
);

export default async function LeUnita() {
  // i nomi e i conteggi delle unità sono contenuto: arrivano dallo store, che è
  // `lib/data.ts` con sopra quello che i referenti hanno cambiato
  const tutte = await leggiUnita();

  return (
    <main id="contenuto">
      <div className="wrap section--tight stack gap-14" style={{ maxWidth: "1180px" }}>
        <Crumbs items={[{ label: "Home", href: "/" }, { label: "Label" }]} />
        <h1 className="h1">Label</h1>
        <p className="lead measure--sm">{INTRO.unita}</p>
      </div>

      <div className="wrap org" style={{ maxWidth: "1180px", paddingTop: "44px", paddingBottom: "88px" }}>
        <div className="org__levels">
          {/* in cima alla scala: dopo la fascia rossa si diventa referenti o R-S */}
          <Link className="org__top org__tappa" href="/chi-siamo">
            <span className="org__step" aria-hidden="true"></span>
            <img src="/assets/logo-marchio.png" width={277} height={278} alt="" />
            <span className="stack" style={{ gap: "2px" }}>
              <strong>Label</strong>
              <span>Label</span>
            </span>
            <span aria-hidden="true" style={{ fontSize: "19px", color: "rgba(255,255,255,0.6)" }}>
              ›
            </span>
          </Link>

          {ORGANIGRAMMA.map((livello, i) => {
            const col = fascia(livello.fascia);
            const sub =
              livello.fascia === "gialla" ? "rgba(0,33,68,0.7)" : "rgba(255,255,255,0.8)";
            return (
              <div key={i} className="org__level">
                <div className="org__row">
                  <div
                    className="org__group org__tappa"
                    style={{ background: col.colore, color: col.inchiostro }}
                  >
                    <span
                      className="org__step"
                      aria-hidden="true"
                      style={{ background: col.colore }}
                    ></span>
                    <strong>{livello.titolo}</strong>
                    <span style={{ color: sub }}>{livello.eta}</span>
                  </div>
                  {livello.slug.map((slug) => {
                    const u = tutte.find((x) => x.slug === slug);
                    if (!u) return null;
                    return (
                      <Link
                        key={slug}
                        className="unit-link"
                        href={`/unita/${slug}`}
                        style={{ borderLeftColor: col.colore }}
                      >
                        <img
                          src={`/assets/${u.logo}`}
                          width={240}
                          height={240}
                        alt=""
                        />
                        <span className="stack" style={{ gap: "2px", flex: 1 }}>
                          <strong>{u.nome}</strong>
                          {/* il numero solo se il gestore l'ha indicato:
                              zero vuol dire «non indicato» (vedi `iscritti`
                              in lib/data.ts) */}
                          <span>
                            {u.ramoPlurale}
                            {u.iscritti > 0 ? ` · ${u.iscrittiLabel}` : ""}
                          </span>
                        </span>
                        <span className="unit-link__chev" aria-hidden="true">
                          ›
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
