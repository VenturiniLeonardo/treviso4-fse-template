"use server";

import { headers } from "next/headers";
import { ipDaCatena } from "@/lib/auth/indirizzo";
import {
  CONTATTI_FINESTRA_MINUTI,
  CONTATTI_MAX,
  oggettoMessaggioContatti,
  testoMessaggioContatti,
  validaContatti,
  type StatoModulo,
} from "@/lib/contatti";
import { MOTIVI_CONTATTO } from "@/lib/data";
import { consuma } from "@/lib/limiti";
import { salva } from "@/lib/messaggi-store";
import { inviaAvviso, postaConfigurata } from "@/lib/posta";

/**
 * Invio del modulo contatti.
 *
 * La validazione — presenza, forma e lunghezza — sta in `validaContatti`
 * (`lib/contatti.ts`), sul server: è quella che conta, perché il controllo lato
 * client si può aggirare. Il componente ripete gli stessi criteri solo per dare
 * la risposta immediata già presente nel sito consegnato.
 */

/** Il motivo in parole, per l'oggetto dell'avviso. */
const etichettaMotivo = (chiave: string) =>
  MOTIVI_CONTATTO.find((m) => m.chiave === chiave)?.label ?? chiave;

export async function inviaMessaggio(
  _precedente: StatoModulo,
  formData: FormData,
): Promise<StatoModulo> {
  const leggi = (nome: string) => String(formData.get(nome) ?? "").trim();

  const valori = {
    nome: leggi("nome"),
    email: leggi("email"),
    telefono: leggi("telefono"),
    motivo: leggi("motivo"),
    messaggio: leggi("messaggio"),
  };

  const validazione = validaContatti(valori, formData.get("privacy") !== null);
  if (!validazione.ok) {
    return {
      stato: "errore",
      errore: validazione.errore,
      campi: validazione.campi,
      valori: validazione.valori,
    };
  }

  /*
   * Il limite per indirizzo IP viene **dopo** la validazione, di proposito.
   *
   * Contare anche i moduli compilati male vorrebbe dire che una famiglia che
   * sbaglia tre volte l'indirizzo email si ritrova bloccata senza aver mandato
   * niente. Quello da cui ci si difende è chi riempie la casella dei referenti
   * gruppo, e per farlo deve mandare messaggi validi.
   *
   * Regge perché la validazione costa poco su qualunque input: i tetti di
   * lunghezza vengono prima di ogni espressione regolare, e quella dell'email
   * è lineare (`lib/email.ts`). Con la regex di prima, quadratica, un solo
   * invio enorme teneva occupato il processo prima di arrivare qui (DOS-01).
   */
  const intestazioni = await headers();
  const ip = ipDaCatena(intestazioni.get("x-forwarded-for"));

  const limite = consuma("contatti", ip, CONTATTI_MAX, CONTATTI_FINESTRA_MINUTI);
  if (!limite.ok) {
    return {
      stato: "bloccato",
      errore:
        `Avete già scritto ${CONTATTI_MAX} volte in poco tempo. ` +
        `Riprovate fra ${limite.attesaMinuti} minuti, oppure scriveteci direttamente per posta.`,
      valori,
    };
  }

  let id: number | undefined;
  try {
    id = salva(valori, ip);
  } catch (errore) {
    // Il database non risponde. Non si perde quello che la persona ha scritto:
    // torna al componente, che lo trasforma in un messaggio di posta già
    // pronto. È la stessa strada di prima della fase 8, tenuta come ripiego.
    console.error("contatti: non sono riuscito a salvare il messaggio:", errore);
    return { stato: "nonRecapitato", valori };
  }

  /*
   * La posta ai gestori — §9 del piano.
   *
   * Dal 6 ottobre 2026 il messaggio **intero** viaggia per posta, a un solo
   * indirizzo (`POSTA_A`, `segreteria@example.org`, su Microsoft 365): è dove i referenti
   * lavorano, e farli entrare nell'area riservata per leggere ogni messaggio
   * era un passaggio in più che nessuno faceva. L'area riservata resta la copia
   * di archivio, e la privacy policy lo dichiara. `Reply-To` è chi ha scritto.
   *
   * Arriva **dopo** il salvataggio, e il suo esito non tocca la risposta a chi
   * ha scritto. È la regola che tiene in piedi tutto il resto: il messaggio è
   * già al sicuro nel database, la posta è una comodità, e una comodità non
   * può trasformare un invio riuscito in un errore in faccia a una famiglia.
   * Se la posta è ferma, il messaggio resta e si legge dall'area riservata.
   *
   * Si aspetta l'esito invece di lasciarlo correre: una `Promise` non attesa
   * dentro una Server Action può essere interrotta quando la risposta parte, e
   * una posta che a volte parte e a volte no è peggio di una che non parte mai
   * — perché nessuno si accorge dei casi in cui non è partita. Il costo è al
   * massimo la decina di secondi del tempo limite.
   */
  const motivo = etichettaMotivo(valori.motivo);
  const esitoPosta = postaConfigurata()
    ? await inviaAvviso(
        oggettoMessaggioContatti(motivo, valori.nome),
        testoMessaggioContatti(valori, motivo, id, new Date()),
        { rispondiA: valori.email, nomeMittente: `${valori.nome} (dal sito)` },
      )
    : { ok: false, nonConfigurata: true };

  if (!esitoPosta.ok && !esitoPosta.nonConfigurata) {
    // l'identificativo della riga, non il contenuto: basta a ritrovarla, e non
    // trasforma il registro del servizio in una copia della casella
    console.error(
      `contatti: messaggio ${id} salvato, ma la posta non è partita (${esitoPosta.motivo}).`,
    );
  }

  return { stato: "ricevuto", valori, avvisati: esitoPosta.ok };
}
