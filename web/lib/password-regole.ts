/**
 * Che cosa si accetta come password. Nient'altro.
 *
 * Sta in un file suo, senza importare niente, perché lo leggono **anche i
 * componenti del browser**: il modulo che le password le calcola davvero usa
 * `node:crypto` e argon2id, e importarlo da un componente client trascina un
 * pezzo di server dentro il pacchetto — che è esattamente l'errore che ha fatto
 * fallire la prima compilazione della fase 6.
 *
 * Il controllo qui vale come cortesia: la stessa regola la riapplica il server
 * prima di scrivere. Un minimo di lunghezza scritto nel `minLength` di un campo
 * non protegge niente da chi spedisce il modulo a mano.
 */

/** Dodici caratteri. Non ci sono requisiti di maiuscole o simboli, ed è voluto:
 * fanno scegliere password peggiori e più difficili da ricordare. Una frase di
 * quattro parole a caso vale più di `Tr3v!so` in ogni misura che conti. */
export const PASSWORD_MIN = 12;

/** Il tetto, oltre il quale nessuna password è stata mai accettata. All'accesso
 * vale anche come filtro: un valore più lungo non può essere giusto, e lo si
 * scarta prima di calcolare un argon2 o di contarlo fra i tentativi. */
export const PASSWORD_MAX = 200;

export function passwordAccettabile(p: string): string | null {
  if (p.length < PASSWORD_MIN) {
    return `La password deve avere almeno ${PASSWORD_MIN} caratteri.`;
  }
  if (p.length > PASSWORD_MAX) {
    return `La password è troppo lunga (massimo ${PASSWORD_MAX} caratteri).`;
  }
  if (/^\s|\s$/.test(p)) return "La password non può iniziare o finire con uno spazio.";
  return null;
}
