import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CorniceAccesso } from "@/components/area/CorniceAccesso";
import { ModuloCodice } from "@/components/area/ModuloCodice";
import { qrSvg, segretoLeggibile } from "@/lib/auth/qr";
import { uriOtpauth } from "@/lib/auth/totp";
import { sessioneVivaCorrente } from "@/lib/sessione-server";
import { assicuraSegretoTotp, utentePerId } from "@/lib/utenti";
import { annulla, rigeneraSegreto } from "./actions";

export const metadata: Metadata = {
  title: "Verifica con codice",
  robots: { index: false, follow: false },
};

/**
 * Il secondo passo dell'accesso: attivazione del TOTP, o codice.
 *
 * La pagina **scrive**, se il segreto manca: `assicuraSegretoTotp` ne mette uno
 * in sospeso perché il QR non si può disegnare senza. È una scrittura in una
 * richiesta di lettura, che di regola è da evitare; qui è deliberata e limitata
 * a un caso solo — un account che non ha ancora un segreto — e l'alternativa
 * sarebbe stata una schermata vuota con un pulsante «genera», cioè un passaggio
 * in più per tutti per una purezza che non serve a nessuno. Ricaricare non
 * cambia il segreto: `assicuraSegretoTotp` restituisce quello in sospeso.
 */
export default async function SecondoFattore({
  searchParams,
}: {
  searchParams: Promise<{ da?: string }>;
}) {
  const { da } = await searchParams;

  const viva = await sessioneVivaCorrente();
  // il middleware ci arriva prima, ma questa pagina non deve dipendere dal fatto
  // che qualcuno se ne ricordi: senza mezza sessione non c'è niente da mostrare
  if (!viva || viva.stato !== "attesa_totp") redirect("/area-riservata/accedi");

  const utente = utentePerId(viva.utenteId);
  if (!utente) redirect("/area-riservata/accedi");

  if (utente.totpAttivo) {
    return (
      <CorniceAccesso
        titolo="Codice di verifica"
        sottotitolo={`Ciao ${utente.nome}. Aprite l’app di autenticazione e scrivete il codice che mostra per «Label».`}
        piede={<PiedeAnnulla />}
      >
        <ModuloCodice da={da} attivazione={false} />
      </CorniceAccesso>
    );
  }

  const segreto = assicuraSegretoTotp(utente.id);
  const uri = uriOtpauth(segreto, utente.utente);

  return (
    <CorniceAccesso
      titolo="Attivate il secondo fattore"
      sottotitolo="Quest’area contiene elenchi di iscritti e consensi: per entrarci serve anche un codice che cambia ogni trenta secondi. Si fa una volta sola."
      piede={<PiedeAnnulla />}
    >
      {/*
        Niente `flex` su questo elenco, e la numerazione messa nello stile.
        Un `<ol>` reso come contenitore flex perde i numeri: i suoi `<li>`
        diventano elementi flessibili e il marcatore non viene disegnato. Con
        `gap-2` sembrava la scelta ovvia per spaziare le righe, e il risultato
        erano tre istruzioni da seguire in ordine, senza l'ordine. Lo spazio lo
        fa il margine.
      */}
      <ol
        className="adm-note"
        style={{ listStyleType: "decimal", listStylePosition: "outside", paddingLeft: "1.4em" }}
      >
        <li className="mb-2">
          Installate un’app di autenticazione se non l’avete: vanno bene Aegis, Google
          Authenticator, o il gestore di password che già usate.
        </li>
        <li className="mb-2">Inquadrate questo codice.</li>
        <li>Scrivete qui sotto le sei cifre che compaiono.</li>
      </ol>

      <div
        className="mx-auto w-full max-w-[220px]"
        // il QR è un SVG costruito da noi in `lib/auth/qr.ts`: nessun contenuto
        // arriva da fuori, e il solo dato variabile — il segreto — è base32
        dangerouslySetInnerHTML={{ __html: qrSvg(uri, 4) }}
      />

      <details className="adm-note">
        <summary className="cursor-pointer">Non riesco a inquadrarlo</summary>
        <p className="pt-2">
          Scrivete a mano questa chiave nell’app, scegliendo «inserisci codice di
          configurazione»:
        </p>
        <p className="pt-1 font-mono text-[0.95em] break-all select-all">
          {segretoLeggibile(segreto)}
        </p>
        <form action={rigeneraSegreto} className="pt-2">
          <button type="submit" className="adm-btn">
            Genera una chiave nuova
          </button>
        </form>
      </details>

      <ModuloCodice da={da} attivazione />
    </CorniceAccesso>
  );
}

/** «Non sono io» — chiude la mezza sessione invece di lasciarla appesa. */
function PiedeAnnulla() {
  return (
    <form action={annulla}>
      Il codice arriva dall’app sul vostro telefono, non per posta o per messaggio.{" "}
      <button type="submit" className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline">
        Annulla e torna all’accesso
      </button>
    </form>
  );
}
