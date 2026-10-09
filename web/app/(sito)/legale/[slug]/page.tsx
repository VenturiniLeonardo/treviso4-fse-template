import type { Metadata } from "next";
import { metadatiPagina } from "@/lib/metadati";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PaginaTesto } from "@/components/site/PaginaTesto";
import { leggiIdentita } from "@/lib/gruppo";
import {
  legaleApprovato,
  legaleMancante,
  paginaLegalePerSlug,
  SLUG_LEGALI,
} from "@/lib/legale";

/**
 * Le pagine legali del piede nascono da un unico modello: i testi (segnaposto)
 * stanno in `lib/legale.ts`, qui c'è solo la resa.
 * «Preferenze cookie» non passa di qui — è un pannello con dei comandi e ha una
 * rotta statica sua, che in App Router vince su questa dinamica.
 */
export function generateStaticParams() {
  return SLUG_LEGALI.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = paginaLegalePerSlug(slug, await leggiIdentita());
  if (!p) return {};
  return metadatiPagina(p.breve, p.sommario, `/legale/${slug}`);
}

export default async function PaginaLegaleView({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const g = await leggiIdentita();
  const p = paginaLegalePerSlug(slug, g);
  if (!p) notFound();

  return (
    <PaginaTesto
      crumbs={[{ label: "Home", href: "/" }, { label: p.breve }]}
      titolo={p.titolo}
      sommario={p.sommario}
      aggiornamento={p.aggiornamento}
      /*
       * Il riquadro di bozza resta finché `legaleApprovato()` è falso: sparisce
       * da sé quando in `GRUPPO` ci sono codice fiscale e data di approvazione.
       */
      avviso={
        legaleApprovato() ? undefined : (
          <>
            <strong>Label.</strong> Lorem ipsum dolor sit amet, consectetur adipiscing
            elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua:{" "}
            {legaleMancante().join(", ")}.
          </>
        )
      }
    >
      {p.sezioni.map((s, n) => (
        <section className="stack gap-14" key={n} aria-label={s.titolo}>
          <div className="section-rule">
            {/* niente `nowrap`: i titoli di sezione sono lunghi e sul telefono
                sfondavano lo schermo invece di andare a capo */}
            <span className="eyebrow">
              {s.titolo}
            </span>
            <span className="section-rule__line" aria-hidden="true"></span>
          </div>

          {s.paragrafi?.map((t, i) => (
            <p key={i} className="prose">
              {t}
            </p>
          ))}

          {s.elenco ? (
            <dl className="deflist">
              {s.elenco.map((v, i) => (
                <div className="deflist__row" key={i}>
                  <dt>{v.voce}</dt>
                  <dd>{v.testo}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {s.nota ? <p className="callout">{s.nota}</p> : null}
        </section>
      ))}

      <section
        className="card card--pad"
        style={{ gap: "10px", padding: "24px", borderRadius: "12px" }}
        aria-label="Label"
      >
        <span className="rows__key">Label</span>
        <span style={{ fontSize: "17px", lineHeight: 1.6, color: "var(--ink)" }}>
          Lorem ipsum dolor sit amet:{" "}
          <a href={`mailto:${g.email}`} style={{ fontWeight: 600 }}>
            {g.email}
          </a>{" "}
          ·{" "}
          <Link href="/contatti" style={{ fontWeight: 600 }}>
            Label
          </Link>
          .
        </span>
      </section>

      <nav className="legal-nav" aria-label="Label">
        {SLUG_LEGALI.filter((a) => a.slug !== p.slug).map((a) => (
          <Link key={a.slug} href={`/legale/${a.slug}`}>
            {a.breve}
          </Link>
        ))}
        <Link href="/legale/preferenze-cookie">Label</Link>
      </nav>
    </PaginaTesto>
  );
}
