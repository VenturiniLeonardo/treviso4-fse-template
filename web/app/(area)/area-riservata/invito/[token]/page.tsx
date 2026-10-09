import type { Metadata } from "next";
import Link from "next/link";
import { CorniceAccesso } from "@/components/area/CorniceAccesso";
import { ModuloInvito } from "@/components/area/ModuloInvito";
import { leggi } from "@/lib/auth/inviti";

export const metadata: Metadata = {
  title: "Invito",
  robots: { index: false, follow: false },
};

/**
 * L'accettazione di un invito.
 *
 * Il token sta nell'indirizzo, che vuol dire che finisce nei registri del server
 * e nella cronologia del browser. È il compromesso di tutti i collegamenti di
 * invito, e regge perché il token vale una volta sola e settantadue ore: dopo
 * che è stato usato, ritrovarlo in un log non serve a niente.
 */
export default async function Invito({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invito = leggi(token);

  if (!invito) {
    return (
      <CorniceAccesso
        titolo="Invito non valido"
        sottotitolo="Questo collegamento non funziona più."
      >
        <div className="adm-notice" role="alert">
          <span className="adm-notice__tag">Attenzione</span>
          <p>
            Un invito dura settantadue ore e si usa una volta sola. Se il vostro è
            scaduto, o se qualcuno l’ha già usato, chiedetene un altro ai gestori.
          </p>
        </div>
        <p className="adm-links">
          <Link href="/area-riservata/accedi">Ho già un account, vado all’accesso →</Link>
        </p>
      </CorniceAccesso>
    );
  }

  return (
    <CorniceAccesso
      titolo="Benvenuto"
      sottotitolo={
        <>
          {invito.nome}, questo è il vostro accesso all’area riservata come{" "}
          <strong>{invito.ruolo.replace("-", " ")}</strong>
          {invito.unita ? ` dell’unità ${invito.unita}` : ""}. Scegliete una password:
          dopo vi chiederemo di attivare la verifica con codice, e avrete finito.
        </>
      }
      piede={
        <>
          Il vostro nome utente è <strong>{invito.utente}</strong>: serve a ogni accesso,
          insieme alla password che state scegliendo adesso.
        </>
      }
    >
      <ModuloInvito token={token} />
    </CorniceAccesso>
  );
}
