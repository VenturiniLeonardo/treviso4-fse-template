"use client";

import { useActionState, useState } from "react";
import { verificaSecondoFattore } from "@/app/(area)/area-riservata/accedi/totp/actions";
import { CODICE_INIZIALE } from "@/lib/accesso";

/**
 * Il campo delle sei cifre.
 *
 * `inputMode={recupero ? "text" : "numeric"}` e `autoComplete="one-time-code"` non sono decorazione:
 * il primo apre la tastiera numerica sul telefono, il secondo fa comparire il
 * codice nel suggerimento automatico su iOS e sui gestori di password. Chi deve
 * digitarlo lo fa con il telefono in mano, e sono i due dettagli che fanno la
 * differenza fra un passaggio scorrevole e uno seccante da ripetere ogni volta.
 */
export function ModuloCodice({ da, attivazione }: { da?: string; attivazione: boolean }) {
  const [recupero, setRecupero] = useState(false);
  const [stato, azione, inCorso] = useActionState(verificaSecondoFattore, CODICE_INIZIALE);

  return (
    <form action={azione} className="flex flex-col gap-4">
      {da ? <input type="hidden" name="da" value={da} /> : null}

      {stato.stato === "errore" ? (
        <div className="adm-notice" role="alert">
          <span className="adm-notice__tag">Attenzione</span>
          <p>{stato.messaggio}</p>
        </div>
      ) : null}

      <label className="adm-field">
        <span className="adm-field__label">{recupero ? "Codice di recupero" : "Codice a sei cifre"}</span>
        <input
          id="totp-codice"
          name="codice"
          type="text"
          inputMode={recupero ? "text" : "numeric"}
          autoComplete="one-time-code"
          pattern={recupero ? "[a-fA-F0-9 -]{32,40}" : "[0-9 ]{6,9}"}
          maxLength={recupero ? 40 : 9}
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
        />
      </label>

      {!attivazione ? <label className="adm-scelta"><input type="checkbox" checked={recupero} onChange={(e) => setRecupero(e.target.checked)} /><span>Ho perso il telefono: uso un codice di recupero</span></label> : null}

      <button type="submit" disabled={inCorso} className="adm-btn adm-btn--primary mt-1 h-11">
        {inCorso ? "Verifica in corso…" : attivazione ? "Attiva la verifica con codice e accedi" : "Verifica il codice e accedi"}
      </button>
    </form>
  );
}
