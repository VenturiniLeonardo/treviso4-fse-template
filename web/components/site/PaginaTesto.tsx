import type { ReactNode } from "react";
import { Crumbs, type Crumb } from "@/components/site/Crumbs";

/**
 * Guscio delle pagine di solo testo: legali, manutenzione, 404.
 *
 * Nel mockup non esistevano — sono pagine nuove — ma non introducono un
 * linguaggio visivo nuovo: riusano `wrap`, `h1`, `lead`, `prose` e la colonna
 * di lettura stretta già definiti in `site.css`. L'unica aggiunta è la
 * larghezza di misura, che qui sta più stretta del resto del sito perché un
 * testo lungo si legge male su 1280 px.
 */
export function PaginaTesto({
  crumbs,
  titolo,
  sommario,
  aggiornamento,
  avviso,
  children,
}: {
  crumbs: Crumb[];
  titolo: string;
  sommario?: string;
  /** «ultimo aggiornamento», in fondo all'intestazione */
  aggiornamento?: string;
  /** riquadro giallo in cima: si usa per dire che il testo è una bozza */
  avviso?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="contenuto">
      <div className="wrap section--tight stack gap-14" style={{ maxWidth: "980px" }}>
        <Crumbs items={crumbs} />
        <h1 className="h1" style={{ fontSize: "44px" }}>
          {titolo}
        </h1>
        {sommario ? (
          <p className="lead measure--sm">{sommario}</p>
        ) : null}
        {aggiornamento ? (
          <span className="tiny-note">Ultimo aggiornamento: {aggiornamento}</span>
        ) : null}
      </div>

      <div className="wrap stack gap-26" style={{ maxWidth: "980px", paddingTop: "34px" }}>
        {avviso ? <div className="warnbox">{avviso}</div> : null}
        {children}
      </div>
    </main>
  );
}
