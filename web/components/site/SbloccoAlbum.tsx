"use client";

import { useActionState, useState } from "react";
import { apriAlbum, type StatoSblocco } from "@/app/(sito)/foto/actions";

/**
 * Il modulo che apre un album protetto.
 *
 * Funziona anche senza JavaScript: è un `<form>` con un'azione del server, e
 * `useActionState` aggiunge soltanto il messaggio d'errore senza ricaricare.
 * `autoComplete="off"` e non `current-password`: è la password di un album,
 * non di un account, e un gestore di password la salverebbe come credenziale
 * del sito intero.
 *
 * A puntini, come ogni password, con «Mostra» accanto: la si ricopia da un
 * messaggio, e con i trattini in mezzo vedere che cosa si è scritto evita il
 * terzo tentativo sbagliato.
 */
export function SbloccoAlbum({ slug, chiuso }: { slug: string; chiuso: boolean }) {
  const [stato, invia, inCorso] = useActionState<StatoSblocco, FormData>(apriAlbum, {});
  const [visibile, setVisibile] = useState(false);

  if (chiuso) {
    return (
      <div className="empty">
        <strong>Album non ancora accessibile</strong>
        <span>
          Le fotografie si aprono con una password, e per questo album non è ancora stata
          impostata. Riprovate fra qualche giorno.
        </span>
      </div>
    );
  }

  return (
    <div className="form-panel" style={{ maxWidth: "560px" }}>
      <form className="stack gap-14" action={invia}>
        <input type="hidden" name="slug" value={slug} />
        <p className="note">
          Le fotografie si aprono con la password che vi è stata consegnata. Una volta inserita, questo browser la
          ricorda per trenta giorni.
        </p>
        <label className="field">
          <span>Password dell’album</span>
          <span className="campo-password">
            <input
              name="password"
              type={visibile ? "text" : "password"}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="es. k7mq3-xr9tb"
              aria-invalid={stato.errore ? true : undefined}
              aria-describedby="sblocco-esito"
              maxLength={64}
              required
            />
            <button
              type="button"
              className="campo-password__mostra"
              onClick={() => setVisibile((v) => !v)}
              aria-pressed={visibile}
            >
              {visibile ? "Nascondi" : "Mostra"}
            </button>
          </span>
        </label>
        <div className="submit-row">
          <button className="btn-submit is-ready" type="submit" disabled={inCorso}>
            {inCorso ? "Controllo…" : "Apri l’album"}
          </button>
          <span
            id="sblocco-esito"
            className={stato.errore ? "form-hint is-error" : "form-hint"}
            role="status"
          >
            {stato.errore ?? "Non avete la password? Chiedetela a chi gestisce l’album."}
          </span>
        </div>
      </form>
    </div>
  );
}
