/**
 * L'indirizzo del client, difeso dallo spoofing di `X-Forwarded-For` — dentro
 * l'applicazione, non nel proxy.
 *
 * `X-Forwarded-For` è una catena `client, proxy1, proxy2, …`: ogni proxy accoda
 * a **destra** l'indirizzo di chi si è collegato a lui. Il valore fidato è
 * quindi quello all'estremo destro, non a sinistra — l'estremo sinistro è
 * scritto dal client, e un attaccante può metterci quello che vuole.
 *
 * Prima l'app prendeva il **primo** elemento (`split(",")[0]`), cioè proprio il
 * valore scelto dall'attaccante, e a salvarla era solo il Caddy di §6, che
 * sovrascrive la catena con l'IP reale del peer (`header_up X-Forwarded-For
 * {remote_host}`). Quella difesa però viveva nel file del proxy: un deploy
 * dietro un proxy diverso — che accoda invece di sovrascrivere — riapriva
 * l'aggiramento dei limiti per IP (tentativi di accesso, modulo contatti) e la
 * falsificazione degli IP nei log. Adesso la difesa è qui, e non dipende più da
 * come è configurato il proxy.
 *
 * `SITO_PROXY_FIDATI` dice quanti proxy fidati stanno davanti all'app: si
 * prende l'elemento a quel numero di posizioni dall'estremo destro. Il valore
 * predefinito è **1** — il Caddy di §6 —, e in quel caso è l'ultimo elemento.
 * Serve alzarlo solo se un giorno si aggiunge una CDN davanti a Caddy.
 *
 * ## Il confine di fiducia
 *
 * Con uno o più proxy, l'elemento fidato è fidato solo se la richiesta è
 * passata **davvero** dal proxy. Chi si collega direttamente al processo Node
 * scrive la catena intera, e l'ultimo elemento lo sceglie lui: undici tentativi
 * di password su un album, poi un indirizzo inventato e altri dieci (audit del
 * 7 ottobre, SEC-AUTH-002). L'app non vede il peer — Next mette il suo
 * indirizzo in `X-Forwarded-For` solo se l'intestazione manca, e una scritta
 * dal client vince —, quindi il confine lo tiene il deploy: Node ascolta solo
 * su 127.0.0.1 (`deploy/sito.service`) e Caddy sovrascrive la catena.
 *
 * Per chi fa girare l'app **senza** proxy davanti c'è `SITO_PROXY_FIDATI=0`:
 * le intestazioni non si leggono affatto e tutte le richieste contano su un
 * secchio solo. È prudente e non comodo — chi sbaglia dieci volte ferma anche
 * gli altri per un quarto d'ora —, ma è l'unica scelta onesta per un processo
 * che non sa da dove arriva la connessione.
 *
 * `X-Real-IP` non si legge più: Caddy non lo scrive, e senza `X-Forwarded-For`
 * la richiesta non è passata dal proxy — l'unico a mandarlo sarebbe il client.
 */

export const IP_SCONOSCIUTO = "sconosciuto";

/**
 * Quanti proxy fidati stanno davanti all'app. Predefinito 1: il Caddy di §6.
 * Zero vuol dire nessuno: si lavora senza fidarsi delle intestazioni.
 */
export function proxyFidati(): number {
  const grezzo = process.env.SITO_PROXY_FIDATI;
  if (grezzo === undefined || grezzo.trim() === "") return 1;
  const n = Number(grezzo);
  // un valore scritto male non deve aprire la catena: si torna al predefinito
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/**
 * L'IP del client da `X-Forwarded-For`, con `proxyFidati()` proxy davanti.
 *
 * Funzione pura, senza `next/headers`: prende il valore già letto, così si
 * prova senza montare una richiesta.
 */
export function ipDaCatena(
  xForwardedFor: string | null | undefined,
  hops: number = proxyFidati(),
): string {
  // senza proxy l'intestazione l'ha scritta il client: non vale niente
  if (hops < 1 || !xForwardedFor) return IP_SCONOSCIUTO;
  const parti = xForwardedFor
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parti.length === 0) return IP_SCONOSCIUTO;
  // l'(hops)-esimo elemento dall'estremo destro. Con un proxy è l'ultimo:
  // quello che il proxy fidato ha scritto e che il client non controlla.
  // Se la catena è più corta del previsto (proxy configurato male), ci si
  // ferma al primo elemento invece di uscire dai bordi.
  return parti[Math.max(0, parti.length - hops)];
}
