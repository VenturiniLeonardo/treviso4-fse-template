import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminBar } from "@/components/area/AdminBar";
import { PannelloPreferenze, PannelloSecondoFattore, PannelloSessioni } from "@/components/area/Profilo";
import { primaSezioneDi, ruoloPerSlug } from "@/lib/data-area";
import { leggiIdentita } from "@/lib/gruppo";
import { leggiPreferenze, NOME_COOKIE_PREFERENZE } from "@/lib/preferenze";
import { sessioneCorrente } from "@/lib/sessione-server";
import { trovaUtente } from "@/lib/utenti";
import { tokenCorrente } from "@/lib/auth/cookie";
import { elencoSessioniPerUtente } from "@/lib/auth/sessioni";
import { numeroCodiciRecupero } from "@/lib/auth/profilo-sicurezza";

export const metadata: Metadata = {
  title: "Il mio profilo",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Il proprio profilo: preferenze, accessi aperti e secondo fattore.
 *
 * Sono le impostazioni che ognuno cambia per sé e che quindi non stanno in
 * nessuna sezione: si raggiungono dal menu in alto a destra, da qualunque
 * schermata.
 */
export default async function Profilo() {
  const sessione = await sessioneCorrente();
  if (!sessione) redirect("/area-riservata/accedi");

  const ruolo = ruoloPerSlug(sessione.r);
  const utente = trovaUtente(sessione.u);
  const token = await tokenCorrente();
  const sessioni = utente && token ? elencoSessioniPerUtente(utente.id, token) : [];
  const identita = await leggiIdentita();
  const barattolo = await cookies();
  const preferenze = leggiPreferenze(barattolo.get(NOME_COOKIE_PREFERENZE)?.value);

  return (
    <>
      {ruolo ? <AdminBar ruolo={ruolo} sessione={sessione} identita={identita} /> : null}
      <div className="adm-shell adm-shell--solo">
        <main className="adm-main" id="contenuto">
          <section className="adm-sec" aria-label="Il mio profilo">
            <div className="adm-head">
              <div className="adm-head__text">
                <span className="adm-crumb">Area riservata / il mio profilo</span>
                <h1 className="adm-title">{sessione.n}</h1>
                <span className="adm-note">
                  Le impostazioni che valgono solo per voi. Non toccano quello che vedono
                  gli altri referenti.
                </span>
              </div>
              <div className="adm-actions">
                <Link className="adm-btn" href={primaSezioneDi(sessione.r)}>
                  ← Torna alle sezioni
                </Link>
              </div>
            </div>

            <PannelloPreferenze preferenze={preferenze} />
            <PannelloSessioni sessioni={sessioni} />
            <PannelloSecondoFattore attivo={utente?.totpAttivo ?? false} richiesto={utente?.mfaRichiesto ?? true} rimanenti={utente ? numeroCodiciRecupero(utente.id) : 0} />
          </section>
        </main>
      </div>
    </>
  );
}
