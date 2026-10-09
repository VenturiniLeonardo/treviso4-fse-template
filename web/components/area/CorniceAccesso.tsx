import Link from "next/link";
import { leggiIdentita } from "@/lib/gruppo";

/**
 * La cornice delle schermate che stanno **fuori** dall'area riservata pur
 * portandoci dentro: accesso, secondo fattore, invito.
 *
 * Riusa i pezzi di `admin.css` — la barra, i campi, i pulsanti, gli avvisi —
 * così assomiglia alla cosa in cui si sta entrando e non introduce un colore che
 * non sia già nella tavolozza del gruppo. Tailwind fa solo la disposizione.
 *
 * Era il corpo di `accedi/page.tsx`. È diventata un componente quando le
 * schermate sono passate da una a tre: tre copie della stessa cornice sono tre
 * posti in cui cambiare il marchio, e due che qualcuno dimenticherà.
 */
export async function CorniceAccesso({
  titolo,
  sottotitolo,
  children,
  piede,
}: {
  titolo: string;
  sottotitolo?: React.ReactNode;
  children: React.ReactNode;
  piede?: React.ReactNode;
}) {
  const identita = await leggiIdentita();

  return (
    <main id="contenuto" className="flex min-h-screen items-center justify-center p-5">
      <div className="w-full max-w-[380px]">
        <div className="border border-adm-line bg-adm-superficie">
          <div className="adm-bar">
            <span className="adm-bar__brand">
              <img
                src={identita.marchio.src}
                width={identita.marchio.larghezza}
                height={identita.marchio.altezza}
                alt=""
              />
              <span>{identita.nome} / area riservata</span>
            </span>
          </div>

          <div className="flex flex-col gap-5 p-5">
            <div className="flex flex-col gap-1.5">
              <h1 className="adm-title">{titolo}</h1>
              {sottotitolo ? <p className="adm-note">{sottotitolo}</p> : null}
            </div>

            {children}
          </div>

          <div className="border-t border-adm-line bg-adm-head px-5 py-3">
            {/* un `div` e non un `p`: il piede del secondo fattore e del cambio
                password è un `<form>`, che dentro un paragrafo non è HTML valido
                e fa fallire l'idratazione */}
            <div className="adm-note">
              {piede ?? (
                <>
                  Le credenziali le consegnano i gestori. Se non riuscite a entrare,
                  scrivete a{" "}
                  <a href={`mailto:${identita.email}`}>{identita.email}</a>
                  .
                </>
              )}
            </div>
          </div>
        </div>

        <p className="adm-links mt-4 items-center">
          <Link href="/">← torna al sito</Link>
        </p>
      </div>
    </main>
  );
}
