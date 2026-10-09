"use server";

import { revalidatePath } from "next/cache";
import type { StatoAzione } from "@/lib/contenuti";
import { COSE_ECCEZIONALI, type CosaEccezionale, segnoEccezione, serveEccezione } from "@/lib/eccezioni";
import { registra } from "@/lib/registro-store";
import { sessioneCorrente } from "@/lib/sessione-server";

/**
 * Apre un accesso eccezionale: scrive nel registro chi, a che cosa e perché.
 * Vedi `lib/eccezioni.ts`.
 *
 * Non passa da `contesto()` perché non concede niente che la matrice non dia
 * già: lo sviluppatore quei dati li può leggere. Aggiunge la traccia e il
 * motivo, che sono il punto.
 */
export async function apriEccezione(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const sessione = await sessioneCorrente();
  if (!sessione || !serveEccezione(sessione)) {
    return { stato: "errore", messaggio: "Non serve: questa lettura non è eccezionale per voi." };
  }

  const cosa = String(formData.get("cosa") ?? "") as CosaEccezionale;
  if (!Object.hasOwn(COSE_ECCEZIONALI, cosa)) {
    return { stato: "errore", messaggio: "Non riconosco che cosa volete aprire." };
  }
  const motivo = String(formData.get("motivo") ?? "").replace(/\s+/g, " ").trim();
  if (motivo.length < 10 || motivo.length > 300) {
    return {
      stato: "errore",
      campo: "motivo",
      messaggio: "Scrivete il motivo in una frase, fra 10 e 300 caratteri: resta nel registro.",
    };
  }

  await registra(sessione, "permessi", `${segnoEccezione(cosa)} — motivo: ${motivo}`, "eccezione");
  revalidatePath("/area-riservata", "layout");
  return { stato: "fatto", messaggio: "Accesso aperto per mezz’ora. La riga è nel registro." };
}
