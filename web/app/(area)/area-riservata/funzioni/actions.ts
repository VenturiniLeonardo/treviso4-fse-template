"use server";

import { revalidatePath } from "next/cache";
import type { StatoAzione } from "@/lib/contenuti";
import { impostaAlbumAttivi } from "@/lib/funzioni";
import { registra } from "@/lib/registro-store";
import { sessioneCorrente } from "@/lib/sessione-server";

/**
 * Accende o spegne la sezione «Foto» (vedi `lib/funzioni.ts`). Solo lo
 * sviluppatore: è una decisione dei gestori, ma la esegue chi gestisce il
 * sito, e resta nel registro.
 */
export async function cambiaAlbum(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const sessione = await sessioneCorrente();
  if (!sessione || sessione.r !== "sviluppatore") {
    return { stato: "errore", messaggio: "Solo lo sviluppatore può accendere o spegnere le foto." };
  }

  const accesi = formData.get("album") === "1";
  await impostaAlbumAttivi(accesi);
  await registra(
    sessione,
    "configurazione",
    accesi ? "Sezione «Foto» accesa" : "Sezione «Foto» spenta",
    "funzioni",
  );
  // menu, piede, home, mappa del sito e area riservata: tutto il sito
  revalidatePath("/", "layout");
  return {
    stato: "fatto",
    messaggio: accesi
      ? "La sezione «Foto» è di nuovo online."
      : "La sezione «Foto» è spenta: sparisce dal sito e dall’area riservata.",
  };
}
