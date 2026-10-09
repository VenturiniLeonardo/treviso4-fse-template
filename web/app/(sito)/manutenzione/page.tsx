import type { Metadata } from "next";
import Link from "next/link";
import { PaginaTesto } from "@/components/site/PaginaTesto";
import { leggiIdentita } from "@/lib/gruppo";
import { percorsoInterno } from "@/lib/percorso-interno";

export const metadata: Metadata = {
  title: "In lavorazione",
  description: "Questa parte del sito non è ancora disponibile.",
  robots: { index: false, follow: false },
};

/**
 * Approdo per i collegamenti che nel mockup finivano su `#` e che non possono
 * essere implementati perché manca il contenuto a cui puntano — oggi i PDF dei
 * documenti, che nessuno ha ancora caricato (fase F5 del piano).
 *
 * È una pagina, non un vicolo cieco: dice che cosa manca, che cosa si può fare
 * intanto e come tornare indietro. Fuori dagli indici dei motori di ricerca,
 * perché non è contenuto.
 */
export default async function Manutenzione({
  searchParams,
}: {
  searchParams: Promise<{ cosa?: string; da?: string }>;
}) {
  const p = await searchParams;
  const g = await leggiIdentita();

  // testo che arriva dall'indirizzo: si accorcia e si usa solo come etichetta
  const cosa = p.cosa?.slice(0, 120).trim() || null;
  // il ritorno è accettato solo se è un indirizzo interno
  const da = percorsoInterno(p.da);

  return (
    <PaginaTesto
      crumbs={[{ label: "Home", href: "/" }, { label: "In lavorazione" }]}
      titolo="Questa parte non è ancora disponibile"
      sommario={
        cosa
          ? "Il file richiesto non è ancora stato caricato sul sito: la pagina che lo " +
            "elenca è pronta, il documento no."
          : "La pagina che avete chiesto è prevista ma non è ancora stata pubblicata."
      }
    >
      {cosa ? (
        <div className="rows">
          <div className="rows__row">
            <span className="rows__key">Documento richiesto</span>
            <span className="rows__val">{cosa}</span>
          </div>
          <div className="rows__row">
            <span className="rows__key">Stato</span>
            <span className="rows__val">non ancora caricato</span>
          </div>
        </div>
      ) : null}

      <section className="stack gap-14" aria-label="Che cosa potete fare intanto">
        <div className="section-rule">
          <span className="eyebrow" style={{ whiteSpace: "nowrap" }}>
            Intanto
          </span>
          <span className="section-rule__line" aria-hidden="true"></span>
        </div>
        <p className="prose">
          I moduli cartacei sono disponibili in sede, e ne teniamo sempre una scorta. Se vi serve subito una copia digitale, scrivete in
          segreteria a{" "}
          <a href={`mailto:${g.email}`} style={{ fontWeight: 600 }}>
            {g.email}
          </a>{" "}
          indicando quale documento vi occorre: ve lo mandiamo per posta elettronica.
        </p>
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", paddingTop: "6px" }}>
        {da ? (
          <Link className="btn btn--primary" href={da}>
            ← Torna indietro
          </Link>
        ) : (
          <Link className="btn btn--primary" href="/documenti">
            Vai ai documenti
          </Link>
        )}
        <Link className="btn" href="/contatti">
          Sede e contatti
        </Link>
        <Link className="btn btn--ghost" href="/">
          Torna alla home
        </Link>
      </div>
    </PaginaTesto>
  );
}
