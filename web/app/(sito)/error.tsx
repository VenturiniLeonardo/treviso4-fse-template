"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Che cosa si vede quando una pagina pubblica va in errore.
 *
 * Senza questo file c'era la schermata predefinita di Next: fondo bianco, il
 * testo inglese «Application error: a server-side exception has occurred» e un
 * codice esadecimale. Per chi la incontra — una famiglia che cerca il modulo
 * d'iscrizione — non è un messaggio, è un vicolo cieco senza barra, senza piede
 * e senza un collegamento per uscirne.
 *
 * Qui la pagina resta il sito: barra e piede li mette il layout del gruppo
 * `(sito)`, che questo confine non attraversa, e il corpo dice tre cose —
 * che è successo a noi e non a chi legge, che si può riprovare, e dove andare
 * se riprovare non basta.
 *
 * ## Il `digest`
 *
 * È l'unica cosa tecnica che resta a schermo, e c'è di proposito: Next non
 * manda al browser il messaggio dell'eccezione — è la sua difesa contro le
 * fughe di dati da un errore di database — ma mette la stessa impronta nel
 * registro del server. È il filo che unisce «ho visto un errore alle 18:40» a
 * `journalctl`. Sta in piccolo e con la sua etichetta, non come un codice
 * buttato lì.
 *
 * Deve essere un componente client: `reset` è un gestore di eventi, e la
 * pagina deve poter ritentare senza ricaricare tutto.
 */
export default function ErrorePagina({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // nella console del browser resta il minimo che serve a chi sviluppa; il
    // dettaglio vero è nel registro del server, associato allo stesso digest
    console.error("Errore di pagina:", error.digest ?? error.message);
  }, [error]);

  return (
    <main id="contenuto" className="wrap section--tight stack gap-18">
      <h1 className="h1">Qualcosa non ha funzionato</h1>
      <p className="lead measure--sm">
        Non è colpa di quello che avete cliccato: è il sito che non è riuscito a
        preparare questa pagina. Riprovando spesso passa; se insiste, ce lo dite
        scrivendoci e lo sistemiamo.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        <button className="btn btn--primary" type="button" onClick={reset}>
          Riprova
        </button>
        <Link className="btn" href="/">
          Torna alla home
        </Link>
        <Link className="btn" href="/contatti">
          Sede e contatti
        </Link>
      </div>
      {error.digest ? (
        <p className="tiny-note">
          Se ci scrivete, allegate questo codice: aiuta a ritrovare l’errore nel
          registro del server. <code>{error.digest}</code>
        </p>
      ) : null}
    </main>
  );
}
