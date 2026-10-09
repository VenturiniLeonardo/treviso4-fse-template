"use client";

import { useActionState } from "react";
import { sostituisciPasswordProvvisoria } from "@/app/(area)/area-riservata/accedi/password/actions";
import { CODICE_INIZIALE } from "@/lib/accesso";
import { PASSWORD_MIN } from "@/lib/password-regole";

/** La password provvisoria, e quella nuova due volte. */
export function ModuloPasswordProvvisoria() {
  const [stato, azione, inCorso] = useActionState(sostituisciPasswordProvvisoria, CODICE_INIZIALE);

  return (
    <form action={azione} className="flex flex-col gap-4">
      {stato.stato === "errore" ? (
        <div className="adm-notice" role="alert">
          <span className="adm-notice__tag">Attenzione</span>
          <p>{stato.messaggio}</p>
        </div>
      ) : null}

      <label className="adm-field">
        <span className="adm-field__label">Password provvisoria</span>
        <input
          id="pp-attuale"
          name="attuale"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
        />
        <span className="adm-field__hint">Quella con cui siete appena entrati.</span>
      </label>

      <label className="adm-field">
        <span className="adm-field__label">Password nuova</span>
        <input
          id="pp-nuova"
          name="nuova"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
        />
        <span className="adm-field__hint">
          Almeno {PASSWORD_MIN} caratteri. Tre o quattro parole a caso vanno benissimo e si
          ricordano meglio di una sigla.
        </span>
      </label>

      <label className="adm-field">
        <span className="adm-field__label">Ripeti la nuova password</span>
        <input
          id="pp-ripetuta"
          name="ripetuta"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
        />
      </label>

      <button type="submit" disabled={inCorso} className="adm-btn adm-btn--primary mt-1 h-11">
        {inCorso ? "Attendete…" : "Salva la password e accedi"}
      </button>
    </form>
  );
}
