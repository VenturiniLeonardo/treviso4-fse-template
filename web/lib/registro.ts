/**
 * Registro delle operazioni: chi ha fatto che cosa, e quando.
 *
 * Solo tipi ed etichette — la scrittura sta in `lib/registro-store.ts`, che
 * tocca il disco e non può finire in un componente client.
 *
 * È l'unica tabella dell'area riservata che si riempie **da sola e di dati
 * veri**: ogni azione che scrive lascia una riga qui. Serve a due schermate —
 * «Ultime modifiche» nel riepilogo di un referente di unità, e «Log accessi e
 * modifiche» dello sviluppatore — che finora erano vuote perché non avevano
 * niente di onesto da mostrare.
 */

export type TipoOperazione =
  | "accesso"
  | "uscita"
  | "contenuto"
  | "pubblicazione"
  | "eliminazione"
  | "configurazione"
  | "permessi"
  /** consenso alla pubblicazione delle immagini: concesso o revocato */
  | "consenso"
  /** anagrafica degli iscritti: iscrizioni, quote, squadre */
  | "iscritti";

export interface Voce {
  /** millisecondi dall'epoca: si formatta al momento di mostrarla */
  quando: number;
  /** nome utente di chi ha agito */
  utente: string;
  /** nome mostrato, così il registro si legge senza incrociare gli account */
  nome: string;
  ruolo: string;
  tipo: TipoOperazione;
  /** che cosa è successo, in una riga */
  operazione: string;
  /** dove: la sezione o la pagina toccata */
  origine: string;
  /** esito, quando non è scontato */
  esito?: "ok" | "rifiutato";
  /**
   * L'IP da cui è partita l'operazione. C'è **solo** nelle voci lette per lo
   * sviluppatore (`leggiRegistro({ conIndirizzi: true })`): nelle altre manca
   * del tutto, così non arriva nemmeno nel payload della pagina del referente
   * gruppo. Manca anche nelle voci scritte prima di 0020.
   */
  indirizzo?: string;
}

/** Come si colora ogni tipo, fra gli stili di cella già in `admin.css`. */
export const STILE_TIPO: Record<TipoOperazione, string> = {
  accesso: "mono-dim",
  uscita: "mono-dim",
  contenuto: "mono",
  pubblicazione: "mono-ok",
  eliminazione: "mono-alert",
  configurazione: "mono",
  permessi: "mono-warn",
  // il consenso si vede da lontano: è la riga che si va a cercare
  consenso: "mono-warn",
  iscritti: "mono",
};

export const ETICHETTA_TIPO: Record<TipoOperazione, string> = {
  accesso: "accesso",
  uscita: "uscita",
  contenuto: "contenuto",
  pubblicazione: "pubblicazione",
  eliminazione: "eliminazione",
  configurazione: "configurazione",
  permessi: "permessi",
  consenso: "consenso immagini",
  iscritti: "iscritti",
};

/** Quante voci tenere: oltre, le più vecchie si perdono. */
export const VOCI_MAX = 500;

/**
 * Data e ora come le scrive il resto del sito: «15/08 21:14».
 *
 * Il fuso è quello del server, che è anche quello del gruppo (§03 mette tutto su
 * una macchina sola in Italia). Con utenti sparsi servirebbe la data in ISO e la
 * conversione nel browser.
 */
export function quandoLeggibile(ms: number): string {
  const d = new Date(ms);
  const due = (n: number) => String(n).padStart(2, "0");
  return `${due(d.getDate())}/${due(d.getMonth() + 1)} ${due(d.getHours())}:${due(d.getMinutes())}`;
}

/**
 * Data e ora per intero, secondi compresi: «15/08/2026 21:14:07».
 *
 * È la forma del registro dello sviluppatore e dell'esportazione: per
 * ricostruire un incidente «21:14» non basta, e senza l'anno una voce di
 * dodici mesi fa si confonde con una di ieri.
 */
export function quandoCompleto(ms: number): string {
  const d = new Date(ms);
  const due = (n: number) => String(n).padStart(2, "0");
  return (
    `${due(d.getDate())}/${due(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${due(d.getHours())}:${due(d.getMinutes())}:${due(d.getSeconds())}`
  );
}

/** Quanto tempo fa, per la colonna del riepilogo. */
export function quantoFa(ms: number, adesso: number): string {
  const min = Math.floor((adesso - ms) / 60000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min} min fa`;
  const ore = Math.floor(min / 60);
  if (ore < 24) return `${ore} h fa`;
  const giorni = Math.floor(ore / 24);
  return giorni === 1 ? "ieri" : `${giorni} giorni fa`;
}

/**
 * Le voci che il gestore deve vedere senza andarle a cercare.
 *
 * Audit degli accessi del 4 ottobre 2026 (SoD-3, M-5, M-8): lo sviluppatore
 * può cambiare la matrice, creare account di pari grado, cancellare i dati di
 * una persona e aprire in via eccezionale gli elenchi; ognuna di queste cose
 * finisce nel registro, ma un registro che nessuno guarda non controlla
 * niente. Queste voci vanno nel riquadro «Da sapere» della dashboard del referente
 * gruppo: è la notifica, dentro il sito, senza dipendere dalla posta.
 */
export function daSapere(voci: Voce[], adesso: number, giorni = 30): Voce[] {
  const da = adesso - giorni * 86_400_000;
  return voci.filter(
    (v) =>
      v.quando >= da &&
      (v.esito ?? "ok") === "ok" &&
      // matrice dei permessi e accessi eccezionali
      (v.tipo === "permessi" ||
        v.operazione.startsWith("Cancellati i dati di una persona") ||
        (v.origine === "utenti" &&
          (/^Creato l’account «[^»]*» \((gestore|sviluppatore)/.test(v.operazione) ||
            v.operazione.startsWith("Revocato") ||
            v.operazione.startsWith("Rifatto l’invito")))),
  );
}
