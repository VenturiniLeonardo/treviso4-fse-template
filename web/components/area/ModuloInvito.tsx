"use client";

import { useActionState } from "react";
import { accettaInvito } from "@/app/(area)/area-riservata/invito/[token]/actions";
import { ACCESSO_INIZIALE } from "@/lib/accesso";
import { PASSWORD_MIN } from "@/lib/password-regole";

/** Scelta della password all'accettazione di un invito. */
export function ModuloInvito({ token }: { token: string }) {
  const [stato, azione, inCorso] = useActionState(accettaInvito, ACCESSO_INIZIALE);

  return (
    <form action={azione} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      {stato.stato === "errore" ? (
        <div className="adm-notice" role="alert">
          <span className="adm-notice__tag">Attenzione</span>
          <p>{stato.messaggio}</p>
        </div>
      ) : null}

      <label className="adm-field">
        <span className="adm-field__label">Password nuova</span>
        <input
          id="inv-nuova"
          name="nuova"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
          autoFocus
        />
        <span className="adm-field__hint">
          Almeno {PASSWORD_MIN} caratteri. Tre o quattro parole a caso vanno benissimo e si
          ricordano meglio di una sigla.
        </span>
      </label>

      <label className="adm-field">
        <span className="adm-field__label">Ripeti la nuova password</span>
        <input
          id="inv-ripetuta"
          name="ripetuta"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
        />
      </label>

      <button type="submit" disabled={inCorso} className="adm-btn adm-btn--primary mt-1 h-11">
        {inCorso ? "Attendete…" : "Continua"}
      </button>
    </form>
  );
}
