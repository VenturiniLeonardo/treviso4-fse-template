import { fotoInterna, fotoPubblica } from "@/lib/album";
import { haAperto } from "@/lib/album-cookie";
import { leggiCaricato } from "@/lib/archivio";
import { puo } from "@/lib/auth/contesto";
import { puoSuAlbumId } from "@/lib/auth/propri";
import { LATI, nomeDerivata } from "@/lib/foto/derivate";
import { albumAttivi } from "@/lib/funzioni";

/**
 * Serve le fotografie degli album.
 *
 * Due porte, non una.
 *
 * La prima è lo **stato e la password**: un file di un album pubblicato esce
 * di qui per chi ha aperto l'album con la sua password (il cookie di
 * `lib/album-accesso.ts`), e per nessun altro — salvo la copertina, cioè la
 * prima fotografia, che è pubblica. Un album pubblicato senza password resta
 * chiuso al pubblico: la password non è facoltativa.
 *
 * La seconda è l'**ambito**: un file di un album in bozza o in revisione esce
 * solo per chi su quell'album potrebbe intervenire. Serve perché chi carica
 * deve rileggere quello che ha caricato prima di mandarlo in revisione, e
 * perché chi approva deve vedere che cosa sta approvando — sono fotografie di
 * minori, e «pubblica alla cieca» non è un controllo dei consensi.
 *
 * Il punto delicato è che «autenticato» non basta: senza il controllo di ambito
 * un referente di unità entrato per la propria unità potrebbe tirare fuori la bozza di
 * un'altra unità indovinando il nome del file. È lo stesso ambito di §05 che
 * vale per le pagine e per le Server Action, applicato anche qui.
 *
 * ## Chi decide, dalla fase 14
 *
 * Era `puoScrivereSu(sessione, interna.unita)`. Adesso è la riga
 * `album-carica` della matrice, con l'unità della fotografia come ambito: la
 * decisione è la stessa — `decidi()` con `limitato` fa esattamente quel
 * confronto — ma la prende la matrice che l'amministratore vede, invece di un
 * predicato scritto a parte. Fino a qui questa rotta era una delle sei che la
 * matrice non governava.
 *
 * `puo()` e non `contesto()` perché è una lettura, e un `contesto()` scriverebbe
 * nel registro una riga per ogni fotografia in bozza richiesta. Vedi la nota
 * sulla stessa scelta in `app/documento/[file]/route.ts`.
 *
 * ## Che cosa esce, dalla fase 7
 *
 * **Una derivata, non l'originale.** L'indirizzo resta quello del file
 * caricato, perché è ciò che le pagine hanno scritto nei loro `src`, ma quello
 * che esce è il WebP ricodificato senza metadati: §8 del piano dice che gli
 * originali «non sono mai raggiungibili dall'esterno», e questo è il punto in
 * cui smettono di esserlo. Le coordinate GPS del campo restano sul disco del
 * server e non sul telefono di chi guarda la pagina.
 *
 * Il lato si sceglie con `?l=`: 1600 se non si dice niente, poi 800 e 400.
 * Qualunque altro valore prende il più vicino fra quelli, invece di dare
 * errore — un parametro sbagliato in un `src` deve degradare in una fotografia
 * un po' più grande, non in un riquadro rotto.
 */

/** Il lato chiesto, ricondotto a uno dei tre che esistono. */
function latoChiesto(url: string): number {
  const grezzo = Number(new URL(url).searchParams.get("l"));
  if (!Number.isFinite(grezzo) || grezzo <= 0) return LATI[0];
  // il più piccolo che basta a coprire quello chiesto, o il più grande che c'è
  return [...LATI].reverse().find((l) => l >= grezzo) ?? LATI[0];
}

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  // album spenti (`lib/funzioni.ts`): nessuna fotografia esce, nemmeno la
  // copertina e nemmeno ai referenti. Stessa risposta di un file che non c'è.
  if (!(await albumAttivi())) return new Response("Non trovata", { status: 404 });

  const { file } = await params;

  /*
   * Pubblicata non vuol dire più «di tutti»: le fotografie di un album si
   * vedono con il cookie che la sua password lascia (`lib/album-accesso.ts`),
   * oppure da un referente che quell'album lo gestisce. Senza nessuno dei due la
   * risposta è la stessa di un file che non esiste — dire «c'è ma è chiuso»
   * confermerebbe a chi tira a indovinare che il nome è giusto.
   *
   * Un'eccezione sola, decisa dal gruppo il 23 settembre 2026: la **prima**
   * fotografia di un album pubblicato è la sua copertina, e la vede chiunque —
   * nella pagina Foto e in cima all'album, prima della password. Chi ordina le
   * fotografie sceglie quale mettere prima sapendo che è quella pubblica.
   */
  const trovata = await fotoPubblica(file);
  const pubblica =
    trovata &&
    (trovata.copertina ||
      (await haAperto(trovata.serratura)) ||
      (await puo("album-carica", { unita: trovata.unita })))
      ? trovata
      : null;
  let riga = pubblica ? { derivate: pubblica.derivate, tipo: pubblica.tipo } : null;

  if (!pubblica) {
    const interna = await fotoInterna(file);
    if (!interna) return new Response("Non trovata", { status: 404 });

    // Stessa risposta per «non esiste» e «non è tua»: distinguerle direbbe a
    // chi tira a indovinare che il file c'è, e in quale unità. Qui escono anche
    // bozze e fotografie nascoste, a chi l'album lo gestisce: per il social
    // media manager, dal 6 ottobre 2026, sono tutti gli album
    if (!(await puoSuAlbumId(interna.albumId, interna.unita))) {
      return new Response("Non trovata", { status: 404 });
    }
    // una fotografia nel cestino la vede solo chi la può rimettere o
    // cancellare per sempre: chi pubblica l'album (audit degli accessi, A-1)
    if (interna.eliminata && !(await puo("album-pubblica", { unita: interna.unita }))) {
      return new Response("Non trovata", { status: 404 });
    }
    riga = { derivate: interna.derivate, tipo: interna.tipo };
  }

  let dati: Buffer | null = null;
  let tipo = riga!.tipo;

  if (riga!.derivate) {
    dati = await leggiCaricato(nomeDerivata(file, latoChiesto(req.url)));
    tipo = "image/webp";
  }

  /*
   * Ripiego sull'originale.
   *
   * Succede per le fotografie caricate prima della fase 7, nei minuti fra
   * l'avvio del server e il momento in cui la coda le ha convertite tutte —
   * `accodaMancanti()` le mette in fila da sola. Succede anche se una derivata
   * si perde: un ripristino parziale, un disco pieno a metà scrittura.
   *
   * Servire l'originale in quella finestra costa **banda, non privacy**:
   * dall'audit di produzione l'originale viene scritto già ricodificato senza
   * metadati (`ripulisciOriginale`), quindi non porta più né il modello
   * dell'apparecchio né le coordinate GPS. Prima le portava, e questo commento
   * lo dichiarava come compromesso accettato: era la protezione stretta
   * applicata alla copertina — un'immagine decorativa — e quella larga alle
   * fotografie dei ragazzi. La riga nel registro del server dice quali file
   * sono in questa condizione, così se ne accorge qualcuno invece di restare
   * così per mesi.
   */
  if (!dati) {
    if (riga!.derivate) {
      console.warn(
        `foto-file: «${file}» risulta convertita ma la derivata non si trova. ` +
          "Servo l'originale: è già senza metadati, ma è a piena misura.",
      );
    }
    dati = await leggiCaricato(file);
    tipo = riga!.tipo;
  }
  if (!dati) return new Response("Non trovata", { status: 404 });

  return new Response(new Uint8Array(dati), {
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(dati.length),
      // Nessuna fotografia finisce in una cache condivisa: la stessa URL
      // risponde in modo diverso a seconda del cookie — della password
      // dell'album o della sessione di un referente — e una copia salvata da un
      // intermediario la servirebbe a chiunque. Un giorno nella cache del
      // browser di chi l'album l'ha aperto, e le bozze nemmeno lì.
      "Cache-Control": pubblica ? "private, max-age=86400" : "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
