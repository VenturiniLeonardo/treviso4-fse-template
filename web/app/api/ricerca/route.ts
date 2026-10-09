import { NextResponse } from "next/server";
import { costruisciIndice } from "@/lib/ricerca-indice";

/**
 * L'indice della ricerca, in JSON.
 *
 * La tendina della lente lo scarica **al primo clic**, non a ogni pagina: sono
 * una ventina di kB di testo, e metterli nell'HTML di tutto il sito peserebbe su
 * chi non cerca niente — che è quasi tutti. Dopo il primo scaricamento il
 * componente lo tiene in memoria e filtra sul posto, quindi si digita senza una
 * richiesta per lettera.
 *
 * Niente cache: album e documenti compaiono qui appena i referenti li pubblicano, e
 * una copia salvata resterebbe indietro proprio nel momento in cui serve.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const voci = await costruisciIndice();
  return NextResponse.json({ voci }, { headers: { "cache-control": "no-store" } });
}
