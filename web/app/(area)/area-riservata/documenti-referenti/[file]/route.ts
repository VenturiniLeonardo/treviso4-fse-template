import { leggiCaricato } from "@/lib/archivio";
import { puo } from "@/lib/auth/contesto";
import { definizioneDi, nomeDaScaricare } from "@/lib/documenti-referenti";
import { documentoReferentiPerFile } from "@/lib/documenti-referenti-store";
import { contentDisposition } from "@/lib/nome-file";

/**
 * Serve i documenti per i referenti. Soltanto a chi è entrato e ha la riga
 * `documenti-referenti-leggi` della matrice: referenti di unità, gestore, sviluppatore.
 *
 * Due porte, come per ogni rotta sotto `/area-riservata`: il proxy rimanda
 * all'accesso chi non ha una sessione (la cartella è in `NON_SONO_RUOLI`, così
 * non la scambia per la vista di un ruolo), e qui si chiede la matrice. La
 * seconda non si fida della prima: se un domani il proxy cambia, questa resta
 * chiusa.
 *
 * ## «Non trovato» per tutto
 *
 * Stessa risposta per «non esiste» e «non ti compete»: distinguerle direbbe a
 * chi tira a indovinare che quel file c'è. E la matrice si chiede **prima** di
 * guardare il database, così chi non può leggere non misura nemmeno, dal tempo
 * di risposta, quali nomi esistono.
 *
 * ## `puo()` e non `contesto()`
 *
 * È una lettura, e le letture non si registrano: un referente che apre dieci verbali
 * non deve lasciare dieci righe nel registro. Vedi `app/documento/[file]/route.ts`.
 *
 * ## Le intestazioni
 *
 * Il tipo lo decide il formato riconosciuto al caricamento, non chi ha caricato
 * il file. Un PDF si apre nel browser, a meno di `?scarica=1`; tutti gli altri
 * scendono sempre come allegato, perché il browser non sa mostrarli. Mai in una
 * cache condivisa: `private, no-store`.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const nonTrovato = () => new Response("Non trovato", { status: 404 });

  if (!(await puo("documenti-referenti-leggi"))) return nonTrovato();

  const { file } = await params;
  // i nomi li generiamo noi, e cominciano tutti così: il resto non si cerca
  if (!/^referenti-[A-Za-z0-9.-]+$/.test(file)) return nonTrovato();

  const documento = await documentoReferentiPerFile(file);
  if (!documento) return nonTrovato();

  const dati = await leggiCaricato(documento.file);
  if (!dati) return nonTrovato();

  const definizione = definizioneDi(documento.formato);
  const scarica =
    documento.formato !== "PDF" || new URL(req.url).searchParams.get("scarica") === "1";

  return new Response(new Uint8Array(dati), {
    headers: {
      "Content-Type": definizione?.mime ?? "application/octet-stream",
      "Content-Length": String(dati.length),
      "Content-Disposition": contentDisposition(
        nomeDaScaricare(documento.titolo, documento.formato),
        scarica,
      ),
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
