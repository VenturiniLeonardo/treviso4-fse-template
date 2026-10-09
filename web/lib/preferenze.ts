/**
 * Preferenze di visualizzazione dell'area riservata.
 *
 * Stanno in un cookie e non in un archivio: sono di *questo* browser, non della
 * persona. Un referente che entra dal portatile della sede e dal proprio non ha le
 * stesse esigenze di lettura, e legarle all'utente vorrebbe dire imporgli la
 * scelta fatta altrove. Quando ci sarà il database si potrà offrire anche la
 * versione legata all'account, come impostazione predefinita.
 *
 * Nessun dato personale: quattro valori scelti da un elenco chiuso. Per questo il
 * cookie è tecnico e non richiede consenso — è la stessa categoria del cookie
 * di sessione, ed è dichiarato nella cookie policy.
 */

export const NOME_COOKIE_PREFERENZE = "sito_vista";

/** Un anno: è una preferenza, non una sessione. */
export const DURATA_PREFERENZE_S = 365 * 24 * 60 * 60;

export interface Preferenze {
  /** chiaro, scuro, o quello che chiede il sistema operativo */
  tema: "sistema" | "chiaro" | "scuro";
  /** quanto sono fitte le righe delle tabelle */
  densita: "comoda" | "compatta";
  /** dimensione del testo dell'area riservata */
  testo: "normale" | "grande";
  /** ferma le animazioni anche se il sistema non lo chiede */
  fermo: boolean;
}

export const PREFERENZE_PREDEFINITE: Preferenze = {
  tema: "sistema",
  densita: "comoda",
  testo: "normale",
  fermo: false,
};

/** Le scelte offerte dal pannello, con la spiegazione che si legge accanto. */
export const SCELTE = {
  tema: [
    {
      valore: "sistema",
      label: "Come il sistema",
      nota: "Chiaro di giorno e scuro di sera, se il telefono o il computer fanno così.",
    },
    { valore: "chiaro", label: "Chiaro", nota: "Sempre chiaro, qualunque cosa chieda il sistema." },
    { valore: "scuro", label: "Scuro", nota: "Sempre scuro: riposa gli occhi con poca luce." },
  ],
  densita: [
    { valore: "comoda", label: "Comoda", nota: "Righe spaziose, come sono adesso." },
    {
      valore: "compatta",
      label: "Compatta",
      nota: "Righe più fitte: ci stanno più iscritti in una schermata.",
    },
  ],
  testo: [
    { valore: "normale", label: "Normale", nota: "La dimensione consegnata." },
    {
      valore: "grande",
      label: "Grande",
      nota: "Un paio di punti in più ovunque, per leggere senza avvicinarsi.",
    },
  ],
} as const;

/**
 * Legge le preferenze dal valore del cookie. Qualunque cosa non riconosciuta
 * torna al valore predefinito: un cookie manomesso non deve rompere la pagina.
 */
export function leggiPreferenze(grezzo: string | undefined): Preferenze {
  if (!grezzo) return PREFERENZE_PREDEFINITE;

  const parti = new URLSearchParams(grezzo);
  const densita = parti.get("d");
  const testo = parti.get("t");
  const tema = parti.get("c");

  return {
    // un cookie scritto prima che il tema esistesse non ha «c»: vale il sistema
    tema: tema === "chiaro" || tema === "scuro" ? tema : "sistema",
    densita: densita === "compatta" ? "compatta" : "comoda",
    testo: testo === "grande" ? "grande" : "normale",
    fermo: parti.get("f") === "1",
  };
}

export function scriviPreferenze(p: Preferenze): string {
  return new URLSearchParams({
    c: p.tema,
    d: p.densita,
    t: p.testo,
    f: p.fermo ? "1" : "0",
  }).toString();
}

/**
 * Le classi da mettere sul `body` dell'area riservata.
 *
 * Sono classi e non stili in linea perché la resa la decide il foglio di stile:
 * qui si dice *quale* preferenza è attiva, non come si traduce in pixel.
 */
export function classiVista(p: Preferenze): string {
  return [
    p.densita === "compatta" && "vista-compatta",
    p.testo === "grande" && "vista-grande",
    p.fermo && "vista-ferma",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * La classe da mettere su `<html>` per il tema: il foglio di stile ne ricava
 * `color-scheme`, e da quello ogni `light-dark()` sceglie il suo valore.
 *
 * Sta su `<html>` e non sul `body` perché è lì che il browser legge
 * `color-scheme` per le barre di scorrimento e per i comandi di sistema — il
 * calendario di un campo data, la tendina aperta di un `<select>`.
 */
export function classeTema(p: Preferenze): string {
  return `tema-${p.tema}`;
}
