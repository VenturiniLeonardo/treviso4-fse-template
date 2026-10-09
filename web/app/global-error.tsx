"use client";

/**
 * L'ultima rete: l'errore che avviene **nel layout radice**, prima che esistano
 * barra, piede e fogli di stile.
 *
 * I due `error.tsx` dentro `(sito)` e `(area)` coprono le pagine, e sono quelli
 * che si vedranno quasi sempre. Non coprono però il layout stesso: se salta
 * `leggiIdentita()` — il database irraggiungibile mentre si compone la barra —
 * l'errore nasce sopra di loro, e senza questo file Next serve la sua schermata
 * inglese con il codice esadecimale.
 *
 * Sostituisce il documento per intero, `<html>` e `<body>` compresi: è il
 * contratto di `global-error`, ed è anche il motivo per cui gli stili sono
 * scritti qui dentro. Non si può importare `site.css`, perché il guasto che
 * porta qui può benissimo essere proprio nella catena che lo carica. Poche
 * regole in linea, i colori del sito scritti a mano, e nessuna dipendenza.
 *
 * Il testo non nomina il database e non nomina niente: chi legge è un
 * visitatore, e l'unica cosa che gli serve sapere è che deve riprovare più
 * tardi. La diagnosi sta nel registro del server, che il `digest` permette di
 * ritrovare.
 */
export default function ErroreGlobale({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="it">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px",
          background: "#f4f2ed",
          color: "#002144",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          lineHeight: 1.55,
        }}
      >
        <main style={{ maxWidth: "34rem" }}>
          <h1 style={{ fontSize: "28px", margin: "0 0 12px", lineHeight: 1.2 }}>
            Il sito non risponde come dovrebbe
          </h1>
          <p style={{ margin: "0 0 20px", fontSize: "17px" }}>
            Si è verificato un problema sul sito. Riprovate fra qualche minuto.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "11px 18px",
              border: "1px solid #003366",
              borderRadius: "4px",
              background: "#003366",
              color: "#fff",
              fontSize: "15px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Riprova
          </button>
          {error.digest ? (
            <p style={{ margin: "20px 0 0", fontSize: "13px", color: "#5b6470" }}>
              Codice dell’errore: <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
