/**
 * Un indirizzo di posta plausibile: il controllo severo lo fa il server di posta.
 *
 * Prima era la regex `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`, copiata in cinque punti.
 * Dopo la `@`, `[^\s@]+` e `\.[^\s@]{2,}` possono dividersi in molti modi una
 * sequenza di punti, e su un indirizzo che non chiude il motore le prova tutte:
 * il costo cresceva con il quadrato della lunghezza (audit di sicurezza,
 * DOS-01). Sul modulo contatti, pubblico, bastava un campo da qualche megabyte
 * per tenere occupato l'unico processo del sito per minuti.
 *
 * Qui il lavoro è lineare e senza ambiguità: prima il tetto di lunghezza, poi
 * una sola `@`, poi un dominio fatto di etichette separate da punti — le
 * etichette non contengono punti, quindi c'è un solo modo di leggerlo.
 */

/** Il tetto dell'RFC 5321 (§4.5.3.1) per un indirizzo intero. */
export const EMAIL_MAX = 254;

const DOMINIO = /^[^\s@.]+(\.[^\s@.]+)+$/;

export function emailValida(indirizzo: string): boolean {
  if (indirizzo.length < 6 || indirizzo.length > EMAIL_MAX) return false;
  const chiocciola = indirizzo.indexOf("@");
  if (chiocciola < 1 || chiocciola !== indirizzo.lastIndexOf("@")) return false;
  const locale = indirizzo.slice(0, chiocciola);
  const dominio = indirizzo.slice(chiocciola + 1);
  if (/\s/.test(locale) || !DOMINIO.test(dominio)) return false;
  return dominio.length - dominio.lastIndexOf(".") - 1 >= 2;
}
