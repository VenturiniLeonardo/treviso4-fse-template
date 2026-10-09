import { leggiCaricato } from "@/lib/archivio";
import { LATI, nomeDerivata } from "@/lib/foto/derivate";
import { copertinaRegistrata } from "@/lib/unita-store";

/**
 * Serve la fotografia di copertina di un'unità.
 *
 * Gemella di `/marchio/[file]` e di `/foto-file/[file]`, e prende da entrambe:
 *
 *  - come il marchio, **non sta in `public/`**. Quella cartella si ricopia a
 *    ogni compilazione (`postbuild`), quindi un file scritto lì mentre il sito
 *    gira sparirebbe al primo rilascio;
 *  - come le fotografie degli album, quello che esce è una **derivata WebP**,
 *    non l'originale. §8 del piano dice che gli originali «non sono mai
 *    raggiungibili dall'esterno», e una copertina è una fotografia scattata da
 *    un telefono: porta con sé il modello dell'apparecchio e, se il referente non ha
 *    spento la geolocalizzazione, le coordinate del posto.
 *
 * ## Che cosa NON c'è, rispetto alle fotografie degli album
 *
 * Nessun controllo di stato e nessun controllo di ambito. Una copertina è
 * l'immagine di una pagina pubblica: è pubblica appena registrata, e non ha una
 * bozza in cui aspettare. Le fotografie degli album ce l'hanno perché ritraggono
 * minori e non escono finché i consensi non tornano; qui il paragone non regge,
 * e aggiungere un cancello che non protegge niente insegnerebbe soltanto a non
 * fidarsi dei cancelli che proteggono qualcosa.
 *
 * L'unica porta è che il nome sia **registrato in una riga**: nessun altro file
 * dell'archivio esce da qui, nemmeno indovinandone il nome.
 */

/** Il lato chiesto, ricondotto a uno dei tre che esistono. Come in `/foto-file`. */
function latoChiesto(url: string): number {
  const grezzo = Number(new URL(url).searchParams.get("l"));
  if (!Number.isFinite(grezzo) || grezzo <= 0) return LATI[0];
  return [...LATI].reverse().find((l) => l >= grezzo) ?? LATI[0];
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  // una copertina nascosta per il pubblico non c'è: chi la gestisce la guarda
  // da `/in-attesa/`, senza cache e dietro il cancello
  const riga = await copertinaRegistrata(file);
  if (!riga || riga.nascosta) return new Response("Non trovata", { status: 404 });

  const derivata = nomeDerivata(file, latoChiesto(req.url));
  let dati = await leggiCaricato(derivata);
  // `nomeDerivata` produce sempre un `.webp`: se il file c'è, il tipo è quello
  let tipo = "image/webp";

  /*
   * Se la derivata non c'è, si serve l'originale.
   *
   * Succede se il caricamento è stato interrotto fra la scrittura della riga e
   * quella dei file, o se un ripristino ha riportato il database senza
   * l'archivio. **Anche l'originale è senza metadati**: l'azione che carica lo
   * riscrive ripulito prima di metterlo in archivio, proprio perché questo
   * ripiego esiste. Quindi qui non c'è un compromesso fra un riquadro rotto e
   * le coordinate del campo — c'è solo un file più grande del necessario.
   *
   * Cache breve e non lunga: questa è una situazione da riparare, e non deve
   * fossilizzarsi nei proxy. `npm run db:orfani` la trova come «riga senza
   * file».
   */
  if (!dati) {
    dati = await leggiCaricato(file);
    tipo = riga.tipo;
  }
  if (!dati) return new Response("Non trovata", { status: 404 });

  const conDerivata = tipo === "image/webp";

  return new Response(new Uint8Array(dati), {
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(dati.length),
      // Il nome porta la marca temporale del caricamento: a parità di nome il
      // contenuto non cambia mai, quindi la scadenza può essere lunga.
      "Cache-Control": conDerivata
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
