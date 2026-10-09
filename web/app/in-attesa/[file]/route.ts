import { leggiCaricato } from "@/lib/archivio";
import { LATI, nomeDerivata } from "@/lib/foto/derivate";
import { puo } from "@/lib/auth/contesto";
import type { UnitaKey } from "@/lib/data";
import { immagineRegistrata } from "@/lib/immagini-store";
import { fileInAttesa } from "@/lib/proposte-store";
import { slotDi } from "@/lib/slot-immagini";
import { copertinaRegistrata } from "@/lib/unita-store";

/**
 * Il cancello di una proposta: la riga di matrice di ciò che propone, con la
 * sua unità — lo stesso di `cancelloDi` in `proposte/actions.ts`, che decide chi
 * la approva. Lo passano chi approva (`completo`) e chi propone (`limitato`
 * nel suo ambito): il social media manager ovunque, il referente di unità sui riquadri
 * della sua pagina.
 *
 * Era `puoPubblicare(sessione) || sessione.r === "social"`, scritto sui ruoli:
 * la matrice non c'entrava, e una riga chiusa dalla schermata non chiudeva
 * questi file (audit degli accessi, M-2).
 */
async function puoVederla(proposta: string, chiave: string): Promise<boolean> {
  if (proposta === "copertina") return puo("unita-anagrafica", { unita: chiave as UnitaKey });
  if (proposta === "immagine") {
    const slot = slotDi(chiave);
    if (!slot) return false;
    return slot.unita
      ? puo("unita-scheda", { unita: slot.unita as UnitaKey })
      : puo("pagine");
  }
  return puo("pagine");
}

/**
 * Il file chiesto, se è uno di quelli che escono da qui: una fotografia in
 * attesa d'approvazione, oppure un riquadro o una copertina **nascosti**.
 *
 * Le nascoste (6 ottobre 2026) non escono più da `/immagine/` né da
 * `/copertina/`, che hanno una cache pubblica di un anno; ma chi gestisce quel
 * posto deve vederle per decidere se rimetterle o eliminarle. Stesse regole di
 * una proposta: il cancello del posto, e niente cache.
 */
async function fileDaServire(
  file: string,
): Promise<{ tipo: string; proposta: string; chiave: string } | null> {
  const inAttesa = await fileInAttesa(file);
  if (inAttesa) return inAttesa;
  const immagine = await immagineRegistrata(file);
  if (immagine?.nascosta) return { tipo: immagine.tipo, proposta: "immagine", chiave: immagine.chiave };
  const copertina = await copertinaRegistrata(file);
  if (copertina?.nascosta) return { tipo: copertina.tipo, proposta: "copertina", chiave: copertina.unita };
  return null;
}

/**
 * Serve una fotografia che aspetta l'approvazione — un riquadro o una copertina
 * proposti dal social media manager — o che è stata nascosta.
 *
 * Gemella di `/immagine/[file]` e `/copertina/[file]`, con due differenze che
 * sono tutto il suo motivo d'esistere:
 *
 *  - **c'è un cancello.** Quelle due servono immagini già pubbliche; questa
 *    serve immagini che nessuno ha ancora guardato, e le vede solo chi le
 *    decide (chi può pubblicare) e chi le ha proposte (il social media
 *    manager). Un referente di unità no: non ha niente da decidere qui;
 *  - **niente cache.** `private, no-store`: un file in attesa può essere
 *    rimandato fra un minuto, e una copia salvata da un proxy o dal browser
 *    resterebbe in giro dopo il rifiuto.
 *
 * La porta resta la stessa delle altre due: il nome deve essere **registrato in
 * una riga** di `proposte`, o in una riga nascosta di `immagini` o di `unita`.
 * Nessun altro file dell'archivio esce da qui.
 *
 * Fuori da `/area-riservata` perché il cookie di sessione vale su tutto il sito
 * (`PERCORSO_COOKIE`), e il middleware non serve: il controllo è qui.
 */

/** Il lato chiesto, ricondotto a uno dei tre che esistono. Come in `/immagine`. */
function latoChiesto(url: string): number {
  const grezzo = Number(new URL(url).searchParams.get("l"));
  if (!Number.isFinite(grezzo) || grezzo <= 0) return LATI[0];
  return [...LATI].reverse().find((l) => l >= grezzo) ?? LATI[0];
}

const NON_TROVATA = () =>
  new Response("Non trovata", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;

  // 404 e non 403 anche senza sessione: a chi tira a indovinare non si dice
  // che il file esiste
  const riga = await fileDaServire(file);
  if (!riga || !(await puoVederla(riga.proposta, riga.chiave))) return NON_TROVATA();

  const derivata = nomeDerivata(file, latoChiesto(req.url));
  let dati = await leggiCaricato(derivata);
  let tipo = "image/webp";

  // la derivata può mancare solo se la lavorazione si è interrotta a metà: si
  // ripiega sull'originale, che è già stato riscritto senza metadati
  if (!dati) {
    dati = await leggiCaricato(file);
    tipo = riga.tipo;
  }
  if (!dati) return NON_TROVATA();

  return new Response(new Uint8Array(dati), {
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(dati.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
