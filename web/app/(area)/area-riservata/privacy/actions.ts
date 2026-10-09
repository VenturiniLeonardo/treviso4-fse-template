"use server";

import { revalidatePath } from "next/cache";
import { contesto, esitoNegato, Negato } from "@/lib/auth/contesto";
import { dataValida } from "@/lib/attivita";
import { DESCRIZIONE_GDPR_MAX, type StatoAzione } from "@/lib/contenuti";
import { ErroreDatabase } from "@/lib/db/errori";
import {
  apri,
  cambiaStato,
  eDirittoValido,
  elimina,
  eStatoValido,
  perId,
} from "@/lib/gdpr-store";

/**
 * Il registro delle richieste degli interessati — §15 del piano.
 *
 * Aprire e seguire le richieste passa da `contesto("privacy")`, che dal 4
 * ottobre 2026 è anche del gestore (audit degli accessi, §7): le richieste
 * delle famiglie arrivano al gruppo, e prima poteva registrarle solo lo
 * sviluppatore. Togliere una riga resta `gdpr`, dello sviluppatore: una
 * richiesta registrata è anche la prova che è arrivata. E la cancellazione dei
 * dati (`cancellaDatiRagazzo`) si esegue solo su una richiesta aperta da
 * un'altra persona — la doppia firma.
 */

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

function comeEsito(errore: unknown): StatoAzione {
  if (errore instanceof Negato) return esitoNegato(errore);
  if (errore instanceof ErroreDatabase) {
    return { stato: "errore", messaggio: errore.message, codice: errore.codice };
  }
  throw errore;
}

function aggiorna() {
  revalidatePath("/area-riservata", "layout");
}

export async function nuovaRichiesta(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const arrivata = testo(formData, "arrivata");
  const diritto = testo(formData, "diritto");
  const descrizione = testo(formData, "descrizione");

  // una data che esiste nel calendario, non solo nella forma: `type="date"`
  // nel browser non protegge l'azione (report QA, BUG-009)
  if (!dataValida(arrivata)) {
    return {
      stato: "errore",
      campo: "arrivata",
      messaggio: "Scrivete la data in cui la richiesta è arrivata.",
    };
  }
  if (!eDirittoValido(diritto)) {
    return { stato: "errore", campo: "diritto", messaggio: "Scegliete di che cosa si tratta." };
  }
  if (descrizione.length < 5) {
    return {
      stato: "errore",
      campo: "descrizione",
      messaggio: "Scrivete che cosa è stato chiesto, anche in poche parole.",
    };
  }
  if (descrizione.length > DESCRIZIONE_GDPR_MAX) {
    return {
      stato: "errore",
      campo: "descrizione",
      messaggio:
        `La descrizione è troppo lunga: al massimo ${DESCRIZIONE_GDPR_MAX} caratteri. ` +
        "Riassumete la richiesta.",
    };
  }

  try {
    const ctx = await contesto("privacy");
    const { trovaUtente } = await import("@/lib/utenti");
    const chi = trovaUtente(ctx.utente);

    const id = apri(arrivata, diritto, descrizione, chi?.id ?? null);
    aggiorna();
    await ctx.registra(
      "configurazione",
      `Aperta richiesta GDPR #${id} (${diritto}), arrivata il ${arrivata}`,
      "privacy",
    );
    return {
      stato: "fatto",
      messaggio:
        `Richiesta #${id} registrata. Il termine dell'art. 12 è un mese ` +
        `dall'arrivo: ${arrivata}.`,
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

export async function segnaRichiesta(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  const stato = testo(formData, "stato");

  if (!Number.isInteger(id)) return { stato: "errore", messaggio: "Richiesta non trovata." };
  if (!eStatoValido(stato)) return { stato: "errore", messaggio: "Stato non valido." };

  try {
    const ctx = await contesto("privacy");
    const prima = perId(id);
    if (!prima) return { stato: "errore", messaggio: "Quella richiesta non c’è più." };

    if (!cambiaStato(id, stato)) {
      return { stato: "errore", messaggio: "Quella richiesta non c’è più." };
    }
    aggiorna();

    // il vecchio e il nuovo valore, come per le quote: «modificata una riga» non
    // è un audit trail
    await ctx.registra(
      "configurazione",
      `Richiesta GDPR #${id}: da «${prima.stato}» a «${stato}»`,
      "privacy",
    );
    return { stato: "fatto", messaggio: "Stato della richiesta aggiornato." };
  } catch (errore) {
    return comeEsito(errore);
  }
}

export async function rimuoviRichiesta(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isInteger(id)) return { stato: "errore", messaggio: "Richiesta non trovata." };

  try {
    const ctx = await contesto("gdpr");
    if (!elimina(id)) return { stato: "errore", messaggio: "Quella richiesta non c’è più." };
    aggiorna();
    await ctx.registra("configurazione", `Cancellata la richiesta GDPR #${id}`, "privacy");
    return {
      stato: "fatto",
      messaggio:
        "Riga cancellata. Che sia stata cancellata resta nel registro delle operazioni.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}
