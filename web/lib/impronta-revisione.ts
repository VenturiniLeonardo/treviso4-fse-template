import { createHash } from "node:crypto";

/**
 * L'impronta di un contenuto in revisione: che cosa ha visto chi lo approva.
 *
 * Dall'audit di sicurezza (BIZ-02): l'approvazione era legata alla sola
 * chiave, e pubblicava lo stato **corrente** del contenuto. Fra il momento in
 * cui il gestore apriva la coda e quello in cui premeva «Approva», chi
 * l'aveva proposto poteva cambiarlo — titolo, testo, fotografie — e andava
 * online la versione che nessuno aveva guardato. La coda ora porta con sé
 * l'impronta di ciò che mostra, e `decidi()` la ricalcola prima di pubblicare:
 * se non coincide, si ricarica e si riguarda.
 *
 * Si tengono fuori i campi che cambiano senza che cambi il contenuto: lo stato
 * del ciclo, chi l'ha toccato e quando, e l'avanzamento della conversione
 * delle fotografie, che va avanti da sola mentre la coda è aperta.
 *
 * Modulo di solo server.
 */
const FUORI = new Set([
  "stato",
  "aggiornato",
  "autore",
  "conversione",
  "motivo",
  "lavoroId",
  // le misure le riscrive la conversione, quando ha letto il file
  "larghezza",
  "altezza",
]);

export function improntaDiRevisione(contenuto: object): string {
  const testo = JSON.stringify(contenuto, (chiave, valore) =>
    FUORI.has(chiave) ? undefined : valore,
  );
  return createHash("sha256").update(testo).digest("base64url").slice(0, 22);
}
