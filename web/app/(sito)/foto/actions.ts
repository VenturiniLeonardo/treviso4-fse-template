"use server";

import { redirect } from "next/navigation";
import { serraturaPubblica } from "@/lib/album-accesso";
import { apriConPassword } from "@/lib/album-cookie";
import { indirizzoRichiedente } from "@/lib/auth/cookie";
import { albumAttivi } from "@/lib/funzioni";
import { consuma } from "@/lib/limiti";

/**
 * L'apertura di un album con la sua password.
 *
 * Il limite è per indirizzo e non per album, di proposito: per album vorrebbe
 * dire che chiunque, sbagliando apposta dieci volte, chiude l'album del campo
 * a tutte le famiglie per un quarto d'ora. Per indirizzo, chi prova a
 * indovinare si ferma da solo e gli altri non se ne accorgono. Si contano tutti
 * i tentativi e non solo quelli sbagliati: a chi ha la password ne basta uno.
 */

const TENTATIVI_ALBUM = 10;
const FINESTRA_MINUTI = 15;

export interface StatoSblocco {
  errore?: string;
}

export async function apriAlbum(
  _precedente: StatoSblocco,
  formData: FormData,
): Promise<StatoSblocco> {
  const slug = String(formData.get("slug") ?? "");
  // gli spazi ai bordi sono quelli di un copia-e-incolla da un messaggio: una
  // password proposta non ne ha, e una scelta a mano non li può contenere
  const password = String(formData.get("password") ?? "").trim();

  // Album spenti, in bozza o in revisione: per il pubblico non esistono, e la
  // risposta è la stessa di un indirizzo inventato (SEC-AUTH-001).
  const serratura = (await albumAttivi()) ? serraturaPubblica(slug) : null;
  if (!serratura) return { errore: "Questo album non esiste più." };
  if (!serratura.versione) {
    return { errore: "La password di questo album non è ancora stata impostata." };
  }
  if (password === "") return { errore: "Scrivete la password che vi è stata data." };

  const limite = consuma("album", await indirizzoRichiedente(), TENTATIVI_ALBUM, FINESTRA_MINUTI);
  if (!limite.ok) {
    return {
      errore: `Troppi tentativi. Riprovate fra ${limite.attesaMinuti} minuti, oppure chiedete di nuovo la password.`,
    };
  }

  if (!(await apriConPassword(slug, password))) {
    return { errore: "Password non corretta. Controllate maiuscole e trattini, e riprovate." };
  }
  redirect(`/foto/${slug}`);
}
