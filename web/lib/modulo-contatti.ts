/**
 * Se questo sito ha un server capace di ricevere il modulo contatti.
 *
 * ## Perché esiste
 *
 * Il sito si pubblica in due modi. Quello previsto dal piano è il server Node
 * dietro Caddy (§06): lì il modulo funziona, l'azione salva il messaggio in
 * `messaggi` e i gestori lo trovano nell'area riservata. L'altro è una
 * **copia statica** — la produce `scripts/copia-cloudflare.py` e si carica
 * su Cloudflare Pages: lì di server non ce n'è, e una
 * Server Action non ha nessuno che la esegua.
 *
 * Nella copia statica il modulo non sarebbe «un po' meno funzionante»: è un
 * modulo che chiede nome, indirizzo, telefono e il motivo per cui una famiglia
 * scrive, e poi non ne fa niente. Chiedere quei dati sapendo di buttarli è la
 * cosa peggiore che questa pagina possa fare — peggio di non avere il modulo,
 * perché chi lo compila crede di aver scritto ai referenti e aspetta una risposta
 * che non arriverà.
 *
 * Quindi in quella copia il modulo non c'è, e restano gli indirizzi: sono già
 * in pagina — il recapito dei gestori nella stessa fascia, quello di ogni
 * unità nelle schede sopra — e `mailto:` funziona senza server, che è il punto.
 *
 * ## ATTENZIONE: si legge in fase di COMPILAZIONE, non di esecuzione
 *
 * `/contatti` è una pagina **prerenderizzata**: Next la scrive in
 * `contatti.html` durante `next build`, e un server che parte dopo serve quel
 * file senza rieseguire la pagina. Quindi questa funzione viene valutata quando
 * si compila, e mettere la variabile nell'ambiente del server **non fa niente**.
 *
 * Non è una deduzione: provato. Con la variabile solo a runtime la copia esce
 * con il modulo dentro. E non si rimedia togliendo il modulo dall'HTML dopo,
 * perché `ModuloContatti` è un componente client: React lo trova nel proprio
 * albero, non lo trova nel documento, e all'idratazione lo rimette in pagina
 * (errore React #418) — con JavaScript spento resterebbe comunque.
 *
 * È la stessa proprietà di `SITO_BASE_URL`, e `instrumentation.ts` la
 * dichiara con le stesse parole: «serve ANCHE all'ambiente di next build».
 *
 * Perché la variabile non sostituisca la build di produzione con una in cui il
 * modulo è spento, quella compilazione va in una cartella sua — vedi `distDir`
 * in `next.config.ts`. Le due cose vanno insieme, e le mette
 * `scripts/copia-cloudflare.py` (nella radice del repository), che poi ne
 * ricava il pacchetto per Cloudflare Pages:
 *
 *     SITO_DIST_DIR=.next-pubblico SITO_MODULO_CONTATTI=0 npm run build
 *
 * ## Il valore predefinito è quello sicuro
 *
 * Senza variabile il modulo c'è, perché il caso normale è il sito con il
 * server. Va spenta di proposito.
 */
export function moduloContattiAttivo(): boolean {
  return process.env.SITO_MODULO_CONTATTI !== "0";
}
