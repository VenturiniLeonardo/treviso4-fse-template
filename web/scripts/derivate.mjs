#!/usr/bin/env node
/**
 * Genera le derivate mancanti, e aspetta che abbia finito.
 *
 *   npm run db:derivate
 *
 * Il server lo fa da sé all'avvio — `instrumentation.ts` chiama
 * `accodaMancanti()` e `avvia()` — quindi questo script non è necessario. Serve
 * quando si vuole che sia **già fatto** prima di aprire il sito al pubblico:
 * finché una fotografia non è convertita esce dall'originale, con dentro i suoi
 * metadati, ed è la finestra che §8 del piano vuole chiusa.
 *
 * Da eseguire con il server fermo, o almeno sapendo che non lo è: due esecutori
 * sullo stesso database non si rompono a vicenda — la presa di un lavoro è
 * atomica — ma si contendono la memoria, che è la cosa che l'esecutore unico
 * esiste per non fare.
 */
import { accodaMancanti, attendiCoda, lavoriFalliti, riprendiInterrotti } from "@/lib/foto/coda";
import { percorsoDb } from "@/lib/db/percorso";

console.log(`database: ${percorsoDb()}`);

const ripresi = riprendiInterrotti();
if (ripresi > 0) console.log(`  ${ripresi} lavori interrotti rimessi in attesa`);

const nuovi = accodaMancanti();
console.log(`  ${nuovi} fotografie da convertire`);

if (nuovi > 0 || ripresi > 0) {
  console.log("  conversione in corso, una alla volta…");
  await attendiCoda();
}

const falliti = lavoriFalliti();
if (falliti.length === 0) {
  console.log("\nFatto: nessuna fotografia in errore.");
} else {
  console.log(`\n${falliti.length} non si sono convertite:`);
  for (const f of falliti) console.log(`  ! ${f.file} — ${f.motivo}`);
  console.log(
    "\nSi vedono lo stesso, servite dall'originale. Il pulsante «Riprova» sta\n" +
      "nella schermata dell'album, sotto la fotografia.",
  );
}
