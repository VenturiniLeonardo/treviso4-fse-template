/**
 * Le regole della password di un album, senza database né cookie.
 *
 * Sta in un file suo perché serve da tutte e due le parti: il server valida e
 * propone la password del modulo «Nuovo album», il browser la rigenera quando
 * un referente preme «Proponine un'altra». Usa solo `crypto.getRandomValues`, che
 * c'è in Node 22 come nei browser.
 */

/**
 * L'alfabeto delle password proposte: minuscole e cifre, **senza** i caratteri
 * che si confondono letti a voce o ricopiati da un foglio — `0`/`o`, `1`/`l`/`i`.
 * La password la detta un referente a una riunione, la ricopia un genitore dal
 * telefono: un carattere ambiguo è una famiglia che scrive per dire che «non
 * funziona».
 */
const ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789";

/** Lunghezza minima di una password scelta a mano. */
export const PASSWORD_ALBUM_MIN = 8;
/** Lunghezza massima: oltre, è un incollato sbagliato, non una password. */
export const PASSWORD_ALBUM_MAX = 64;

/**
 * Una password casuale nella forma `k7mq3-xr9tb`: dieci caratteri in due
 * gruppi da cinque, circa 49 bit. Contro un tentativo online limitato a dieci
 * per quarto d'ora per indirizzo è largamente sufficiente, e resta corta
 * abbastanza da scriverla su un avviso.
 *
 * Il rifiuto dei byte oltre il multiplo dell'alfabeto evita la distorsione del
 * modulo: con 31 simboli e un byte da 0 a 255, i primi otto uscirebbero più
 * spesso degli altri.
 */
export function proponiPasswordAlbum(): string {
  const limite = 256 - (256 % ALFABETO.length);
  const scelti: string[] = [];
  while (scelti.length < 10) {
    const byte = crypto.getRandomValues(new Uint8Array(16));
    for (const b of byte) {
      if (b < limite && scelti.length < 10) scelti.push(ALFABETO[b % ALFABETO.length]);
    }
  }
  return `${scelti.slice(0, 5).join("")}-${scelti.slice(5).join("")}`;
}

/** Il messaggio d'errore per una password non accettabile, o `null` se va bene. */
export function errorePasswordAlbum(password: string): string | null {
  if (password.length < PASSWORD_ALBUM_MIN) {
    return `La password dell’album deve avere almeno ${PASSWORD_ALBUM_MIN} caratteri.`;
  }
  if (password.length > PASSWORD_ALBUM_MAX) {
    return `La password dell’album non può superare ${PASSWORD_ALBUM_MAX} caratteri.`;
  }
  if (/\s/.test(password)) {
    return "La password dell’album non può contenere spazi: le famiglie la ricopiano, e uno spazio non si vede.";
  }
  return null;
}
