import sharp, { type Metadata } from "sharp";
import { type Contenitore, contenitoreDi } from "@/lib/foto/formato";

/**
 * Le derivate: tre WebP senza metadati, con l'orientamento già applicato.
 *
 * §8 del piano, e in particolare il riquadro che spiega perché:
 *
 * > Una foto scattata al campo con un telefono porta con sé le coordinate GPS
 * > del posto in cui i ragazzi hanno dormito, oltre a data, ora e modello
 * > dell'apparecchio. Le derivate vengono ricodificate senza alcun metadato.
 *
 * Le due righe che contano non si vedono, perché sono righe che **non** ci
 * sono: `sharp` copia i metadati solo se glielo si chiede con `withMetadata()`,
 * e qui non glielo si chiede mai. È una di quelle protezioni che si perdono
 * aggiungendo una riga con le migliori intenzioni — «teniamo la data dello
 * scatto, è comoda» — quindi sta scritto qui che non si fa.
 *
 * `rotate()` senza argomenti applica l'orientamento EXIF e poi lo butta via.
 * Serve **prima** del ridimensionamento: dopo, una foto verticale scattata col
 * telefono di traverso verrebbe ridotta come se fosse orizzontale, e i lati
 * finirebbero scambiati.
 *
 * Modulo di solo server: importa `sharp`.
 */

/** I tre lati di §8. In ordine decrescente: il primo è quello predefinito. */
export const LATI = [1600, 800, 400] as const;
export type Lato = (typeof LATI)[number];

/**
 * Qualità del WebP.
 *
 * Ottantadue è il punto in cui, su fotografie di gruppo all'aperto, la
 * differenza smette di vedersi e il file smette di calare in fretta. Più in
 * alto si paga banda per niente; più in basso si vedono gli aloni sui cieli,
 * che è proprio quello che c'è dietro i ragazzi in metà degli scatti.
 */
const QUALITA = 82;

/**
 * Il nome di una derivata, ricavato da quello dell'originale.
 *
 *   foto-uscita-1730-42.jpg  →  foto-uscita-1730-42-800.webp
 *
 * Si ricava invece di essere salvato in una colonna perché così **le foto già
 * caricate prima della fase 7 non vanno rinominate**: il loro nome resta quello
 * che è, e le derivate gli si affiancano. Una migrazione che rinomina file su
 * disco è la specie di operazione che va storta a metà.
 */
export function nomeDerivata(originale: string, lato: number): string {
  const punto = originale.lastIndexOf(".");
  const base = punto > 0 ? originale.slice(0, punto) : originale;
  return `${base}-${lato}.webp`;
}

/** Vero se questo nome è quello di una derivata e non di un originale. */
export function eDerivata(nome: string): boolean {
  return new RegExp(`-(${LATI.join("|")})\\.webp$`).test(nome);
}

/**
 * Le misure vere di un'immagine, con l'orientamento già considerato.
 *
 * Si legge solo l'intestazione, quindi costa quanto aprire il file. Serve al
 * caricamento, che deve scrivere `larghezza` e `altezza` subito — sono
 * `NOT NULL` con `CHECK > 0` — molto prima che la coda arrivi a convertirla.
 *
 * È anche il punto in cui un HEIC viene rifiutato **mentre chi lo carica è
 * ancora davanti allo schermo**, con un messaggio che dice cosa fare, invece
 * che tre minuti dopo in una riga di coda che nessuno guarda.
 */
export async function misureVere(
  dati: Buffer,
): Promise<{ larghezza: number; altezza: number; contenitore: Contenitore }> {
  const contenitore = contenitoreDi(dati);
  if (!contenitore) {
    throw new ErroreDerivate("Il file non è un’immagine JPEG, PNG o HEIC.");
  }

  let meta: Metadata;
  try {
    meta = await sharp(dati).metadata();
  } catch (e) {
    throw new ErroreDerivate(spiega(contenitore, e));
  }
  if (!meta.width || !meta.height) throw new ErroreDerivate(spiega(contenitore, null));

  const girata = (meta.orientation ?? 1) >= 5;
  return {
    larghezza: girata ? meta.height : meta.width,
    altezza: girata ? meta.width : meta.height,
    contenitore,
  };
}

/**
 * L'originale, ricodificato **senza metadati**.
 *
 * Le derivate nascono già pulite — è la riga `withMetadata()` che non c'è, qui
 * sopra. L'originale a piena misura no: resta sul disco com'è arrivato, e
 * `/foto-file/[file]` lo serve come ripiego quando una derivata manca (una
 * conversione fallita, un ripristino parziale, un disco pieno a metà
 * scrittura). In quella finestra usciva con dentro il modello del telefono e,
 * se chi ha scattato non aveva spento la geolocalizzazione, le coordinate del
 * campo — cioè del posto in cui hanno dormito dei bambini.
 *
 * L'azione che carica la **copertina** di un'unità già faceva così, con un
 * commento che diceva la cosa giusta: «un compromesso che si può togliere con
 * una chiamata non si documenta, si toglie». Le fotografie degli album no, ed
 * era l'incoerenza al contrario: la regola stretta applicata all'immagine
 * decorativa e quella larga alle fotografie dei ragazzi.
 *
 * Qui **non si ridimensiona niente**: `rotate()` applica ai pixel
 * l'orientamento EXIF e poi lo butta via, così l'immagine resta girata come
 * deve. Il costo è una ricodifica per file, al caricamento, una volta sola.
 *
 * HEIC e AVIF diventano JPEG: sono i formati che gli iPhone producono, non
 * quelli che un browser apre, e il ripiego deve poter essere mostrato.
 * Restituisce anche il contenitore vero, perché chi chiama deve registrare il
 * tipo MIME di ciò che è **stato scritto**, non di ciò che è arrivato.
 */
export async function ripulisciOriginale(
  dati: Buffer,
  contenitore: Contenitore,
): Promise<{ dati: Buffer; contenitore: Contenitore }> {
  const uscita: Contenitore = contenitore === "png" ? "png" : "jpeg";
  const pulito = await sharp(dati)
    .rotate()
    // NIENTE `withMetadata()`: vale qui la nota in cima al file
    .toFormat(uscita, uscita === "png" ? {} : { quality: 90 })
    .toBuffer();
  return { dati: pulito, contenitore: uscita };
}

export interface Derivata {
  lato: Lato;
  nome: string;
  dati: Buffer;
  larghezza: number;
  altezza: number;
}

export interface EsitoDerivate {
  /** misure dell'originale **dopo** l'orientamento, che sono quelle vere */
  larghezza: number;
  altezza: number;
  derivate: Derivata[];
}

/**
 * Errore che porta un messaggio già scritto per chi ha caricato il file.
 *
 * La coda lo salva in `lavori.motivo`, e l'amministrazione lo mostra. Un
 * messaggio tecnico di libvips in quella colonna non aiuterebbe nessuno: chi lo
 * legge è un referente che vuole sapere se rifare la foto o chiamare qualcuno.
 */
export class ErroreDerivate extends Error {}

/**
 * Genera le tre derivate, e restituisce anche le misure vere dell'originale.
 *
 * Non scrive niente su disco: chi chiama decide dove. È l'unica funzione di
 * questa fase che consuma memoria in modo apprezzabile, e per questo la coda ne
 * fa girare **una alla volta** (vedi `lib/foto/coda.ts`).
 */
export async function generaDerivate(originale: Buffer, nome: string): Promise<EsitoDerivate> {
  const contenitore = contenitoreDi(originale);
  if (!contenitore) {
    throw new ErroreDerivate("Il file non è un’immagine JPEG, PNG o HEIC.");
  }

  let meta: Metadata;
  try {
    meta = await sharp(originale).metadata();
  } catch (e) {
    throw new ErroreDerivate(spiega(contenitore, e));
  }
  if (!meta.width || !meta.height) {
    throw new ErroreDerivate(spiega(contenitore, null));
  }

  /*
   * Le misure vere sono quelle **dopo** la rotazione.
   *
   * L'EXIF `Orientation` da 5 a 8 significa «questa immagine va girata di un
   * quarto»: i pixel sul disco sono larghi 4032 e alti 3024, ma la foto è
   * verticale. Senza questo scambio, l'`img` della pagina riserverebbe uno
   * spazio orizzontale per una foto verticale, e la pagina sobbalzerebbe al
   * caricamento — la soglia CLS di §4.
   */
  const girata = (meta.orientation ?? 1) >= 5;
  const larghezza = girata ? meta.height : meta.width;
  const altezza = girata ? meta.width : meta.height;

  const derivate: Derivata[] = [];
  for (const lato of LATI) {
    try {
      const { data, info } = await sharp(originale)
        // prima l'orientamento, poi la riduzione: al contrario i lati si
        // scambiano su ogni foto scattata col telefono di traverso
        .rotate()
        .resize({ width: lato, height: lato, fit: "inside", withoutEnlargement: true })
        // NIENTE `withMetadata()`. Vedi la nota in cima al file: è la riga che
        // non c'è a togliere le coordinate GPS del campo.
        .webp({ quality: QUALITA })
        .toBuffer({ resolveWithObject: true });

      derivate.push({
        lato,
        nome: nomeDerivata(nome, lato),
        dati: data,
        larghezza: info.width,
        altezza: info.height,
      });
    } catch (e) {
      throw new ErroreDerivate(spiega(contenitore, e));
    }
  }

  return { larghezza, altezza, derivate };
}

/**
 * Traduce un guasto di decodifica in una frase che dice che cosa fare.
 *
 * Il caso che vale la pena distinguere è **HEIC**. Il pacchetto `sharp` porta
 * con sé un libvips già compilato, e quel libvips sa aprire i file HEIF
 * codificati in AV1 (che si chiamano AVIF) ma **non** quelli codificati in HEVC
 * — che sono esattamente quelli che escono da un iPhone, e che tutti chiamano
 * HEIC. Il decodificatore HEVC non è incluso per ragioni di brevetti.
 *
 * Verificato su questa installazione: `sharp.format.heif.input.fileSuffix` vale
 * `['.avif']` e basta. Se un giorno comparissero anche `.heic`, questo ramo
 * smetterebbe di servire da solo — la decodifica riuscirebbe e non si
 * arriverebbe mai qui.
 *
 * Senza questa distinzione, un referente con l'iPhone appena comprato riceverebbe
 * «il file non è valido» su una foto che sul telefono si vede benissimo, e non
 * avrebbe modo di capire.
 */
function spiega(contenitore: string, _errore: unknown): string {
  if (contenitore === "heic") {
    return (
      "Le fotografie in formato HEIC non si possono ancora convertire sul " +
      "server. Sull’iPhone: Impostazioni › Fotocamera › Formati › «Massima " +
      "compatibilità», e le foto successive saranno JPEG. Per quelle già " +
      "scattate, condividerle per posta le converte in JPEG."
    );
  }
  return "Il file è rovinato o incompleto: non si riesce ad aprirlo come immagine.";
}
