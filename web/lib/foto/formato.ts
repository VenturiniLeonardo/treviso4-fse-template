/**
 * Che cos'è davvero questo file, guardando i primi byte.
 *
 * §8 del piano: «il file viene accettato solo se è JPEG, PNG o HEIC… e se i
 * primi byte confermano il tipo dichiarato». Il tipo dichiarato arriva dal
 * browser ed è, letteralmente, quello che il browser ha indovinato dal nome:
 * chi carica un eseguibile chiamato `gita.jpg` dichiara `image/jpeg` in tutta
 * buona fede del browser. Quello che conta sono i byte.
 *
 * Modulo puro: non tocca il disco, non importa `sharp`, non importa `node:fs`.
 */

export type Contenitore = "jpeg" | "png" | "heic" | "avif";

/** Che cosa si accetta in caricamento, e come si chiama nelle risposte. */
export const TIPI_MIME: Record<Contenitore, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  avif: "image/avif",
};

/** L'estensione con cui si salva l'originale. */
export const ESTENSIONI: Record<Contenitore, string> = {
  jpeg: "jpg",
  png: "png",
  heic: "heic",
  avif: "avif",
};

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * I «brand» che compaiono nella scatola `ftyp` di un file HEIF.
 *
 * Un HEIF è un contenitore: dentro ci può stare un'immagine codificata in HEVC
 * — quello che producono gli iPhone, e che si chiama comunemente HEIC — oppure
 * in AV1, e allora si chiama AVIF. Sono lo stesso contenitore e due codificatori
 * diversi, e la differenza conta molto: `sharp` qui decodifica il secondo e non
 * il primo (vedi `lib/foto/derivate.ts`). Distinguerli **prima** di provare
 * permette di dire perché, invece di «file non valido».
 */
const BRAND_HEVC = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
const BRAND_AV1 = new Set(["avif", "avis"]);

/**
 * Il contenitore di questi byte, o `null` se non è nessuno di quelli ammessi.
 *
 * Guarda solo l'inizio del file: è abbastanza per escludere ciò che non è
 * un'immagine, e non pretende di garantire che il resto sia integro. Quello lo
 * dice la decodifica vera, che avviene nella coda.
 */
export function contenitoreDi(b: Buffer): Contenitore | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(FIRMA_PNG)) return "png";

  // JPEG: SOI, e l'ultimo marcatore prima dei dati è comunque 0xFF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";

  /*
   * ISO-BMFF: i byte 4–8 sono «ftyp», poi quattro byte di brand principale e,
   * più avanti, un elenco di brand compatibili. Si guardano entrambi perché i
   * file di alcune fotocamere dichiarano `mif1` come principale — che vuol dire
   * soltanto «immagine in un contenitore HEIF» — e mettono `heic` fra i
   * compatibili.
   */
  if (b.length >= 12 && b.subarray(4, 8).toString("latin1") === "ftyp") {
    const lunghezza = b.readUInt32BE(0);
    // il primo brand, più quelli compatibili che stanno fino a fine scatola
    const fine = Math.min(b.length, Number.isFinite(lunghezza) ? Math.max(16, lunghezza) : 32);
    const brand: string[] = [];
    for (let i = 8; i + 4 <= fine; i += 4) brand.push(b.subarray(i, i + 4).toString("latin1"));

    if (brand.some((x) => BRAND_AV1.has(x))) return "avif";
    if (brand.some((x) => BRAND_HEVC.has(x))) return "heic";
    // `mif1` da solo: contenitore HEIF senza dire come è codificato. Si tratta
    // come HEIC, che è il caso che arriva davvero — un telefono in mano a un referente
    if (brand.includes("mif1") || brand.includes("msf1")) return "heic";
  }

  return null;
}

/** Vero se questi byte sono un'immagine di un tipo che accettiamo. */
export const eImmagineAmmessa = (b: Buffer): boolean => contenitoreDi(b) !== null;
