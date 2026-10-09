#!/usr/bin/env node
/**
 * Aggiunge alla matrice le funzioni che una versione nuova ha portato.
 *
 *   npm run db:permessi
 *
 * Da eseguire dopo un aggiornamento che aggiunge una funzione — la fase 5 ne ha
 * portate due (`pagine`, `archivio-anno`), la fase 8 una (`messaggi`). Su
 * un'installazione dove la tabella `permessi` è già popolata, quelle righe non
 * ci sono, e una riga assente vale «nessuno»: la funzione nuova resta chiusa a
 * tutti, in silenzio.
 *
 * **Non è automatico apposta.** Farlo scattare a ogni scrittura riporterebbe
 * indietro anche le funzioni che un amministratore ha tolto dalla matrice: un
 * permesso chiuso apposta che si riapre da solo. Vedi il commento su
 * `allineaSeme` in `lib/permessi-store.ts`.
 *
 * Idempotente, e non tocca i livelli già impostati.
 */
import { allineaSeme, leggiMatrice } from "@/lib/permessi-store";
import { percorsoDb } from "@/lib/db/percorso";

console.log(`database: ${percorsoDb()}`);

const esito = allineaSeme();

if (esito.aggiunte === 0) {
  console.log("La matrice è già allineata: niente da aggiungere.");
} else {
  console.log(`Aggiunte ${esito.aggiunte} righe per: ${esito.funzioni.join(", ")}`);
  console.log(
    "\nI livelli sono quelli predefiniti. Controllateli nella schermata\n" +
      "«Permessi» prima di considerare la cosa finita: da lì applicano davvero.",
  );
}

const matrice = await leggiMatrice();
console.log(`\nFunzioni nella matrice: ${matrice.length}`);
for (const f of matrice) {
  const livelli = Object.entries(f.livelli)
    .map(([r, l]) => `${r}=${l}`)
    .join(" · ");
  console.log(`  ${f.id.padEnd(16)} ${livelli}`);
}
