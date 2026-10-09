/**
 * Il valore di `Content-Disposition` per un file da consegnare.
 *
 * Le intestazioni HTTP sono in Latin-1: un titolo con un carattere oltre il
 * 255 — «Ł», un'emoji, un alfabeto non latino — dentro `filename="…"` faceva
 * sollevare un `TypeError` alla costruzione della risposta, e il documento si
 * scaricava come un errore 500 (audit di sicurezza, FILE-01). Qui, come vuole
 * l'RFC 6266, ci sono due nomi: `filename` in ASCII per i client vecchi, e
 * `filename*` in UTF-8 codificato (RFC 5987) con il nome vero, che i browser
 * di oggi preferiscono.
 *
 * Il nome in ingresso deve essere già ripulito da virgolette e ritorni a capo:
 * la codifica qui sotto li renderebbe comunque innocui, ma il nome ASCII li
 * lascerebbe passare tra le virgolette.
 */
export function contentDisposition(nome: string, scarica: boolean): string {
  const ascii =
    nome
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]/g, "-")
      .replace(/["\\]/g, "-")
      .replace(/-{2,}/g, "-") || "documento";
  const utf8 = encodeURIComponent(nome).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${scarica ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
