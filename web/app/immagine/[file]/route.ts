import { leggiCaricato } from "@/lib/archivio";
import { LATI, nomeDerivata } from "@/lib/foto/derivate";
import { immagineRegistrata } from "@/lib/immagini-store";

/**
 * Serve l'immagine di uno dei posti fissi del disegno.
 *
 * Gemella di `/copertina/[file]`, e per le stesse ragioni: fuori da `public/`,
 * perché quella cartella si ricopia a ogni compilazione e un file scritto lì
 * mentre il sito gira sparirebbe al primo rilascio; e quello che esce è una
 * **derivata WebP**, non l'originale, perché queste sono fotografie scattate da
 * un telefono e l'originale porta con sé il modello dell'apparecchio e, se la
 * geolocalizzazione era accesa, le coordinate del posto.
 *
 * Nessun cancello di ambito, come per le copertine: quello che sta in un posto
 * del disegno è per definizione l'immagine di una pagina pubblica. L'unica
 * porta è che il nome sia **registrato in una riga**: nessun altro file
 * dell'archivio esce da qui, nemmeno indovinandone il nome.
 *
 * Sui **ritratti** vale la pena essere espliciti, perché è l'unico caso in cui
 * qualcuno potrebbe cercare un cancello. Un ritratto è la fotografia di un
 * adulto che ha accettato di comparire sul sito con nome e ruolo, e sta accanto
 * a quel nome: è pubblica quanto il nome. Le fotografie dei ragazzi sono
 * un'altra cosa e passano da un'altra strada — `/foto-file`, con lo stato
 * dell'album e il registro dei consensi davanti.
 */

/** Il lato chiesto, ricondotto a uno dei tre che esistono. Come in `/copertina`. */
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

  // una nascosta non esce più di qui: per il pubblico non c'è. Chi gestisce il
  // posto la guarda da `/in-attesa/`, senza cache e dietro il cancello
  const riga = await immagineRegistrata(file);
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
