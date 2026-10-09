import Link from "next/link";
import { PaginaTesto } from "@/components/site/PaginaTesto";
import type { Identita } from "@/lib/identita";
import { scorciatoie } from "@/lib/nav";

/**
 * Corpo della pagina 404. Sta in un componente perché serve in due punti: la
 * `not-found` del sito pubblico e quella globale, che per via delle due radici
 * (§«Due radici, non una» nel README) deve costruirsi il documento da sola.
 */
export function NonTrovata({ identita, album }: { identita: Identita; album: boolean }) {
  return (
    <PaginaTesto
      crumbs={[{ label: "Home", href: "/" }, { label: "Pagina non trovata" }]}
      titolo="Questa pagina non esiste"
      sommario={
        "L’indirizzo è sbagliato, oppure la pagina è stata spostata quando il sito " +
        "è stato rifatto. Da qui si torna dappertutto."
      }
    >
      <section className="stack gap-14" aria-label="Dove andare">
        <div className="section-rule">
          <span className="eyebrow" style={{ whiteSpace: "nowrap" }}>
            Le pagine del sito
          </span>
          <span className="section-rule__line" aria-hidden="true"></span>
        </div>
        <div className="grid grid--3">
          {scorciatoie(album).map((l) => (
            <Link key={l.href} className="card card--pad" href={l.href}>
              <span className="eyebrow">{l.label}</span>
              <span style={{ fontSize: "16.5px", lineHeight: 1.5 }}>{l.testo}</span>
            </Link>
          ))}
        </div>
      </section>

      <p className="note">
        Se ci siete arrivati da un collegamento nostro, segnalatecelo scrivendo a{" "}
        <a href={`mailto:${identita.email}`} style={{ fontWeight: 600 }}>
          {identita.email}
        </a>
        : lo sistemiamo.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        <Link className="btn btn--primary" href="/">
          Torna alla home
        </Link>
        <Link className="btn" href="/contatti">
          Sede e contatti
        </Link>
      </div>
    </PaginaTesto>
  );
}
