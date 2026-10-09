/**
 * Risolutore dell'alias `@/` per Node: test e script di servizio.
 *
 * I moduli dell'applicazione importano con `@/lib/…`, che è l'alias dichiarato
 * in `tsconfig.json` e risolto da Next. Node non lo conosce: senza questo hook,
 * `import "@/lib/db/db"` fuori da Next fallisce con ERR_MODULE_NOT_FOUND.
 *
 * Serve ai test e agli script di servizio (`db:riferimenti`), che girano su Node
 * nudo. Sta in `scripts/` e non in `test/` proprio per questo: uno script di
 * esercizio non deve dipendere da un file di prova.
 *
 * L'alternativa sarebbe stata riscrivere gli import dei moduli in forma
 * relativa: cinquanta file toccati per far girare i test, e una convenzione in
 * meno nel codice. Venti righe qui costano meno.
 *
 * Aggiunge anche l'estensione: `@/lib/db/db` diventa `<radice>/lib/db/db.ts`,
 * perché gli import di TypeScript non la portano e Node la pretende.
 */

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve as risolviPercorso } from "node:path";

const RADICE = risolviPercorso(dirname(fileURLToPath(import.meta.url)), "..");

/** Le estensioni da provare, nell'ordine in cui le prova anche Next. */
const ESTENSIONI = ["", ".ts", ".tsx", ".mts", ".js", ".mjs"];

function primoCheEsiste(base) {
  for (const est of ESTENSIONI) {
    const candidato = base + est;
    if (existsSync(candidato) && !candidato.endsWith("/")) return candidato;
  }
  // una cartella con index
  for (const est of ESTENSIONI.slice(1)) {
    const candidato = join(base, `index${est}`);
    if (existsSync(candidato)) return candidato;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  /*
   * `next/headers` e simili: il pacchetto non li dichiara in `exports`, Next li
   * risolve da sé aggiungendo `.js`, Node no (ERR_MODULE_NOT_FOUND).
   */
  if (/^next\/[a-z-]+$/.test(specifier)) {
    try {
      return await next(specifier, context);
    } catch {
      return next(`${specifier}.js`, context);
    }
  }
  if (!specifier.startsWith("@/")) return next(specifier, context);

  const base = join(RADICE, specifier.slice(2));
  const trovato = primoCheEsiste(base);
  if (!trovato) {
    throw new Error(
      `alias @/: non trovo un file per «${specifier}» (cercato a partire da ${base})`,
    );
  }
  return next(pathToFileURL(trovato).href, context);
}
