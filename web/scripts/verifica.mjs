#!/usr/bin/env node
/**
 * Tutto quello che deve passare prima di un rilascio, in un comando solo.
 *
 *   npm run verifica
 *
 * §17 del piano chiede tre prove «e vanno in CI». Questo è il comando che una
 * CI esegue — e che si può eseguire anche senza CI, sul portatile, prima di
 * un rilascio. La CI c'è dal 2 ottobre 2026, quando il repository è andato su
 * GitHub: `.github/workflows/verifica.yml`.
 *
 * ## Perché un comando e non cinque nel file della CI
 *
 * Perché la lista viva nel repository e non nella configurazione di una forge.
 * Se un giorno si passa da GitHub a qualcos'altro, o si smette di usarne una,
 * la sequenza resta questa e non va ricostruita a memoria. La configurazione
 * della forge diventa una riga: `npm run verifica`.
 *
 * ## L'ordine non è casuale
 *
 * Prima le cose veloci che falliscono spesso (tipi, stile), poi le prove, poi
 * la compilazione che è la più lenta. Chi ha rotto qualcosa lo scopre nel primo
 * minuto invece che nel quinto.
 *
 * Esce con `1` al primo passo fallito, e dice quale.
 */
import { spawnSync } from "node:child_process";

const PASSI = [
  { nome: "tipi", comando: ["npx", "tsc", "--noEmit"] },
  { nome: "stile", comando: ["npx", "eslint", ".", "--max-warnings", "0"] },
  {
    nome: "prove",
    comando: [
      "node",
      "--experimental-strip-types",
      // gli stessi flag di `npm test`: senza, `mock.module` non esiste e le
      // prove che sostituiscono `next/headers` si fermano (report QA, BUG-010)
      "--experimental-test-module-mocks",
      "--import",
      "./scripts/registra-alias.mjs",
      "--test",
      "test/**/*.test.mjs",
      "test/**/*.test.mts",
    ],
    /*
     * Le prove girano su database temporanei che si creano da sé, quindi qui
     * `SITO_DB` non serve — ma se l'ambiente ne ha uno addosso, ogni suite
     * lo sovrascriverebbe con il proprio. Toglierlo esplicitamente evita che
     * una verifica lanciata a mano con `.env.local` caricato tocchi il
     * database di sviluppo.
     */
    senzaDb: true,
  },
  { nome: "compilazione", comando: ["npm", "run", "build"] },
];

let fallito = null;

for (const passo of PASSI) {
  process.stdout.write(`${passo.nome}… `);
  const inizio = Date.now();

  const ambiente = { ...process.env };
  if (passo.senzaDb) {
    delete ambiente.SITO_DB;
    delete ambiente.SITO_DATI_DIR;
  }

  const [comando, ...argomenti] = passo.comando;
  const esito = spawnSync(comando, argomenti, {
    stdio: ["ignore", "pipe", "pipe"],
    env: ambiente,
    encoding: "utf8",
  });

  const durata = ((Date.now() - inizio) / 1000).toFixed(1);

  if (esito.status === 0) {
    console.log(`ok (${durata}s)`);
    continue;
  }

  console.log(`FALLITO (${durata}s)\n`);
  // l'output solo di chi ha fallito: mille righe di prove riuscite prima di un
  // errore sono il modo di non far leggere l'errore
  process.stdout.write(esito.stdout ?? "");
  process.stderr.write(esito.stderr ?? "");
  fallito = passo.nome;
  break;
}

console.log("");
if (fallito) {
  console.error(`Verifica fallita al passo «${fallito}».`);
  process.exit(1);
}

console.log("Verifica passata: tipi, stile, prove e compilazione.");
