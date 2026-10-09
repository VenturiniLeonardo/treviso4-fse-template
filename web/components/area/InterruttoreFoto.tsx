"use client";

import { useActionState } from "react";
import { cambiaAlbum } from "@/app/(area)/area-riservata/funzioni/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";

/** L'interruttore della sezione «Foto», nella vista dello sviluppatore. */
export function InterruttoreFoto({ accesi }: { accesi: boolean }) {
  const [stato, invia, inCorso] = useActionState(cambiaAlbum, AZIONE_INIZIALE);
  return (
    <form action={invia} className="adm-form">
      <h2>Sezione «Foto»</h2>
      <p className="adm-note">
        {accesi
          ? "Accesa: la scheda «Foto» è nel menu del sito e gli album pubblicati sono online."
          : "Spenta: la scheda «Foto» non c’è, /foto risponde 404 e nell’area riservata la sezione album è nascosta. Gli album caricati restano in archivio."}
      </p>
      <input type="hidden" name="album" value={accesi ? "0" : "1"} />
      <Esito stato={stato} />
      <div className="adm-form__actions">
        <button
          className={accesi ? "adm-btn" : "adm-btn adm-btn--primary"}
          type="submit"
          disabled={inCorso}
        >
          {accesi ? "Spegni la sezione Foto" : "Accendi la sezione Foto"}
        </button>
      </div>
    </form>
  );
}
