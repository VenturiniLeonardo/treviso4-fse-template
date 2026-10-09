import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminBar } from "@/components/area/AdminBar";
import { primaSezioneDi, ruoloPerSlug } from "@/lib/data-area";
import { leggiIdentita } from "@/lib/gruppo";
import { sessioneCorrente } from "@/lib/sessione-server";

export const metadata: Metadata = {
  title: "Funzione non ancora attiva",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Approdo dei comandi dell'area riservata che nel mockup erano pulsanti inerti.
 *
 * Le scritture arrivano con la fase F4 del piano — servono il database e il
 * controllo di ambito su ogni Server Action — quindi oggi nessuno di quei
 * pulsanti può fare quello che promette. Invece di lasciarli morti, portano
 * qui: si dice quale comando è stato premuto, perché non funziona ancora e si
 * torna esattamente da dove si veniva.
 *
 * Rotta statica, quindi vince su `[ruolo]`; il middleware la protegge come il
 * resto dell'area.
 */
export default async function ManutenzioneArea({
  searchParams,
}: {
  searchParams: Promise<{ cosa?: string; da?: string }>;
}) {
  const sessione = await sessioneCorrente();
  if (!sessione) redirect("/area-riservata/accedi");

  const p = await searchParams;
  const cosa = p.cosa?.slice(0, 120).trim() || null;
  const da =
    p.da && p.da.startsWith("/area-riservata/") && !p.da.startsWith("//") && !p.da.includes("..")
      ? p.da
      : primaSezioneDi(sessione.r);

  // la barra in alto resta quella del ruolo di chi è entrato, per non perdere
  // il contesto: si sta ancora dentro l'area riservata, non altrove
  const ruolo = ruoloPerSlug(sessione.r);
  const identita = await leggiIdentita();

  return (
    <>
      {ruolo ? <AdminBar ruolo={ruolo} sessione={sessione} identita={identita} /> : null}
      <div className="adm-shell adm-shell--solo">
        <main className="adm-main" id="contenuto">
          <section className="adm-sec" aria-label="Funzione non ancora attiva">
            <div className="adm-head">
              <div className="adm-head__text">
                <span className="adm-crumb">Area riservata / in lavorazione</span>
                <h1 className="adm-title">Questa funzione non è ancora attiva</h1>
                <span className="adm-note">
                  Questo comando non è disponibile. Le altre funzioni dell’area riservata
                  restano utilizzabili.
                </span>
              </div>
            </div>

            <div className="adm-notice">
              <span className="adm-notice__tag">In lavorazione</span>
              <p>
                {cosa ? (
                  <>
                    Il comando «{cosa}» non è disponibile da questa pagina. Nessuna
                    operazione è stata eseguita.
                  </>
                ) : (
                  <>
                    La funzione richiesta non è disponibile da questa pagina. Tornate
                    alla panoramica per aprire le sezioni disponibili.
                  </>
                )}
              </p>
            </div>

            <div className="adm-form">
              <h2>Che cosa fare intanto</h2>
              <span className="adm-note">
                Per modificare i contenuti, tornate alla panoramica e aprite la sezione
                corrispondente. Se il comando che vi serve non è disponibile, contattate
                i gestori.
              </span>
              <div className="adm-form__actions">
                <Link className="adm-btn adm-btn--primary" href={da}>
                  ← Torna indietro
                </Link>
                <Link className="adm-btn" href={primaSezioneDi(sessione.r)}>
                  Vai alla panoramica
                </Link>
                <Link className="adm-btn" href="/">
                  Vai al sito pubblico
                </Link>
              </div>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
