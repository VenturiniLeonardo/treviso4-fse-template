"use client";

import { useActionState } from "react";
import { apriEccezione } from "@/app/(area)/area-riservata/eccezione/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";

/**
 * Il modulo dell'accesso eccezionale: prima dei dati, il motivo.
 *
 * Lo vede soltanto l'amministratore, al posto di elenchi che contengono dati
 * di persone (vedi `lib/eccezioni.ts`). Dopo l'invio la pagina si ridisegna da
 * sé, perché l'azione invalida l'area.
 */
export function AccessoEccezionale({ cosa, descrizione }: { cosa: string; descrizione: string }) {
  const [stato, invia, inCorso] = useActionState(apriEccezione, AZIONE_INIZIALE);
  return (
    <form action={invia} className="adm-form">
      <h2>Accesso eccezionale</h2>
      <p className="adm-note">
        Qui ci sono {descrizione}. Per l’amministratore non è una lettura ordinaria: scrivete
        perché vi serve. Il motivo va nel registro, che legge anche il gestore, e
        l’accesso dura mezz’ora.
      </p>
      <input type="hidden" name="cosa" value={cosa} />
      <label className="adm-field">
        <span className="adm-field__label">Motivo</span>
        <input
          type="text"
          name="motivo"
          required
          minLength={10}
          maxLength={300}
          placeholder="Richiesta di rettifica della famiglia Rossi, #12"
          aria-invalid={stato.campo === "motivo" || undefined}
        />
      </label>
      <Esito stato={stato} />
      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
          {inCorso ? "Apertura…" : "Registra il motivo e apri i dati"}
        </button>
      </div>
    </form>
  );
}
