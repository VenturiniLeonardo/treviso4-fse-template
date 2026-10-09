import { fileMarchio } from "@/lib/gruppo";

/**
 * Serve il marchio caricato dai referenti.
 *
 * Non sta in `public/` di proposito: quella cartella viene ricopiata a ogni
 * compilazione (`postbuild` in package.json), quindi un file scritto lì mentre
 * il sito gira sparirebbe al primo rilascio. I dati caricati stanno in `dati/`,
 * insieme al resto di quello che il sito scrive, e li serve questa rotta.
 *
 * Il nome del file contiene la marca temporale del caricamento, quindi cambia a
 * ogni sostituzione: si può mettere una scadenza lunga senza rischiare che i
 * browser mostrino il marchio vecchio.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  // `fileMarchio` confronta il nome con quello registrato nell'archivio: solo
  // il marchio in uso è servibile, e nessun altro percorso è raggiungibile
  const trovato = await fileMarchio(file);
  if (!trovato) return new Response("Non trovato", { status: 404 });

  return new Response(new Uint8Array(trovato.dati), {
    headers: {
      "Content-Type": trovato.tipo,
      "Content-Length": String(trovato.dati.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
