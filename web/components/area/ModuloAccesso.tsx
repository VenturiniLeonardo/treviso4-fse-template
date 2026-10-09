"use client";

import { useActionState } from "react";
import { accedi } from "@/app/(area)/area-riservata/accedi/actions";
import { ACCESSO_INIZIALE } from "@/lib/accesso";

/**
 * Modulo di accesso all'area riservata.
 *
 * La schermata non esiste nel mockup, ma i suoi pezzi sì: campi (`adm-field`),
 * pulsanti (`adm-btn`) e avvisi (`adm-notice`) vengono da `admin.css`. Tailwind
 * fa solo la disposizione — nessun colore nuovo, nessun valore inventato.
 *
 * L'azione è una Server Action passata direttamente al form, così funziona anche
 * a JavaScript spento.
 */
export function ModuloAccesso({ da }: { da?: string }) {
  const [stato, azione, inCorso] = useActionState(accedi, ACCESSO_INIZIALE);
  const problema = stato.stato !== "vuoto";

  return (
    <form action={azione} className="flex flex-col gap-4">
      {da ? <input type="hidden" name="da" value={da} /> : null}

      {problema ? (
        <div className="adm-notice" role="alert">
          <span className="adm-notice__tag">Attenzione</span>
          <p>{stato.messaggio}</p>
        </div>
      ) : null}

      <label className="adm-field">
        <span className="adm-field__label">Nome utente</span>
        <input
          id="acc-utente"
          name="utente"
          type="text"
          autoComplete="username"
          defaultValue={stato.utente}
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
        />
      </label>

      <label className="adm-field">
        <span className="adm-field__label">Password</span>
        <input id="acc-password" name="password" type="password" autoComplete="current-password" required />
      </label>

      <button type="submit" disabled={inCorso} className="adm-btn adm-btn--primary mt-1 h-11">
        {inCorso ? "Verifica in corso…" : "Accedi all’area riservata"}
      </button>
    </form>
  );
}
