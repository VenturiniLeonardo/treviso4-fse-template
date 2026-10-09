/**
 * Lettura delle misure di un'immagine dall'intestazione del file.
 *
 * Sta in un modulo proprio e non dentro uno store perché è una funzione **pura**
 * e la usano in tre: il caricamento del marchio (`lib/gruppo.ts`), il
 * caricamento delle fotografie (`lib/album.ts`) e l'azione che valida il
 * marchio. Prima stava in `lib/gruppo.ts`, e `lib/album.ts` importava uno store
 * per prenderla: un accoppiamento fra due store che non avevano niente da
 * dirsi.
 *
 * Non tocca il disco e non importa `node:fs`: è importabile da qualunque parte.
 */

/**
 * Larghezza e altezza lette dall'intestazione del file, senza librerie.
 *
 * Servono per scrivere `width` e `height` sull'`img`: senza, l'immagine non
 * riserva il suo spazio e la pagina sobbalza al caricamento — è la soglia CLS
 * di §04. Sono anche la verifica che il file sia davvero l'immagine che dice di
 * essere: chi carica un eseguibile rinominato `.png` non supera questo passo.
 *
 * Riconosce l'intestazione, non l'intero flusso: un PNG con l'intestazione
 * giusta e i dati rovinati passa di qui e poi non si vede nel browser. Per
 * accorgersene servirebbe decodificarlo davvero, cioè una libreria nativa —
 * che è la stessa che servirà per generare le derivate (§04), e arriva con
 * quella.
 */
export function misureImmagine(
  b: Buffer,
): { tipo: "image/png" | "image/jpeg"; larghezza: number; altezza: number } | null {
  // PNG: firma di 8 byte, poi il blocco IHDR con le due misure a 32 bit
  if (
    b.length > 24 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    b.subarray(12, 16).toString("latin1") === "IHDR"
  ) {
    return { tipo: "image/png", larghezza: b.readUInt32BE(16), altezza: b.readUInt32BE(20) };
  }

  // JPEG: si scorrono i marcatori fino a un SOF, che porta le misure
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      // SOF0–SOF15, esclusi i marcatori che non descrivono un fotogramma
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return {
          tipo: "image/jpeg",
          altezza: b.readUInt16BE(i + 5),
          larghezza: b.readUInt16BE(i + 7),
        };
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }

  return null;
}
