"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * L'errore dentro l'area riservata.
 *
 * Gemello di `app/(sito)/error.tsx`, e separato perché le due radici hanno
 * fogli di stile e `<body>` diversi: quello del sito qui non arriva.
 *
 * Il testo però è un altro, e non per stile. Chi lo legge è un referente che stava
 * salvando qualcosa, e la domanda che si fa è una sola: **è stato salvato?** La
 * risposta onesta è che non lo sappiamo — l'errore può essere avvenuto prima o
 * dopo la scrittura — e la cosa utile da dire è dove guardare per scoprirlo,
 * cioè ricaricare la sezione e controllare. Rifare l'operazione alla cieca è il
 * modo di ritrovarsi due album uguali.
 */
export default function ErroreArea({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Errore nell’area riservata:", error.digest ?? error.message);
  }, [error]);

  return (
    <main id="contenuto" className="adm-main">
      <div className="adm-head">
        <h1 className="adm-title">Qualcosa non ha funzionato</h1>
      </div>
      <p className="adm-note" style={{ maxWidth: "620px" }}>
        Il server non è riuscito a completare l’operazione.{" "}
        <strong>Prima di rifarla, ricaricate e controllate:</strong> l’errore può
        essere arrivato dopo il salvataggio, e ripetere alla cieca lascerebbe due
        copie della stessa cosa.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", paddingTop: "6px" }}>
        <button className="adm-btn adm-btn--primary" type="button" onClick={reset}>
          Ricarica la sezione
        </button>
        <Link className="adm-btn" href="/area-riservata">
          Torna alla mia area
        </Link>
      </div>
      {error.digest ? (
        <p className="adm-note" style={{ paddingTop: "10px" }}>
          Codice per il registro del server: <code>{error.digest}</code>
        </p>
      ) : null}
    </main>
  );
}
