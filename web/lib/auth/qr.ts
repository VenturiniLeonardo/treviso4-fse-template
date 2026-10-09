import qr from "qrcode-generator";

/**
 * Un QR come SVG, disegnato sul server.
 *
 * Serve a una cosa sola: far inquadrare l'`otpauth://` dell'attivazione senza
 * che nessuno debba ricopiare trentadue caratteri a mano. Ricopiarli si può — la
 * schermata li mostra comunque — ma su quattordici persone qualcuno sbaglia una
 * lettera, e il fallimento arriva molto dopo, sotto forma di codice che non
 * funziona e di cui non si capisce il perché.
 *
 * **SVG e non PNG, e disegnato qui e non nel browser.** Un `<img>` verso una
 * rotta che genera l'immagine metterebbe il segreto TOTP in un indirizzo, cioè
 * nei log del server e nella cronologia; un disegno lato client vorrebbe dire
 * spedire il segreto al JavaScript della pagina e caricare una libreria in più.
 * Un SVG inline nella risposta è il percorso più corto: il segreto sta nella
 * pagina — dove comunque deve stare, per essere inquadrato — e da nessun'altra
 * parte.
 *
 * La correzione d'errore è la più bassa. È il rovescio giusto: più correzione
 * significa più moduli, cioè un disegno più fitto da inquadrare, e questo QR si
 * legge da venti centimetri su uno schermo pulito, non stampato su un cartone.
 */
export function qrSvg(testo: string, modulo = 6): string {
  // tipo 0 = «scegli la versione più piccola che basta»
  const codice = qr(0, "L");
  codice.addData(testo);
  codice.make();

  const n = codice.getModuleCount();
  // un margine di quattro moduli: è la «quiet zone» che la specifica richiede,
  // e senza cui molti lettori non trovano il codice
  const bordo = 4;
  const lato = (n + bordo * 2) * modulo;

  let percorso = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!codice.isDark(r, c)) continue;
      percorso += `M${(c + bordo) * modulo} ${(r + bordo) * modulo}h${modulo}v${modulo}h-${modulo}z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lato}" height="${lato}" ` +
    `viewBox="0 0 ${lato} ${lato}" shape-rendering="crispEdges" role="img" ` +
    `aria-label="Codice QR per l'attivazione del secondo fattore">` +
    `<rect width="${lato}" height="${lato}" fill="#fff"/>` +
    `<path d="${percorso}" fill="#000"/>` +
    `</svg>`
  );
}

/** Il segreto a gruppi di quattro, per chi lo ricopia a mano senza perdersi. */
export function segretoLeggibile(segreto: string): string {
  return (segreto.match(/.{1,4}/g) ?? []).join(" ");
}
