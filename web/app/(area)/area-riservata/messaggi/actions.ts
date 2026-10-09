"use server";

import { revalidatePath } from "next/cache";
import { contesto, esitoNegato, Negato } from "@/lib/auth/contesto";
import type { StatoAzione } from "@/lib/contenuti";
import { comeStatoAzione, ErroreDatabase, registraEMappa } from "@/lib/db/errori";
import {
  cambiaStato,
  elimina,
  type StatoMessaggio,
} from "@/lib/messaggi-store";

/**
 * I messaggi dal modulo contatti: segnarli e cancellarli.
 *
 * Passano dal cancello di fase 5 con l'azione `messaggi`, che nella matrice è
 * `completo` per gestore e sviluppatore e `nessuno` per il referente di unità —
 * come dice §6 del piano, dove `segnaMessaggio` è un'azione del gestore.
 *
 * Non c'è nessuna azione che li **legge**: la lettura la fa la pagina, che è
 * già dietro il middleware e la matrice.
 */

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "");

const STATI: StatoMessaggio[] = ["da_leggere", "letto", "risposto"];

function idDa(formData: FormData): number | null {
  const n = Number(testo(formData, "id"));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function segnaMessaggio(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const nuovo = testo(formData, "stato") as StatoMessaggio;
  if (!STATI.includes(nuovo)) {
    return { stato: "errore", messaggio: "Stato non valido." };
  }

  const id = idDa(formData);
  if (id === null) return { stato: "errore", messaggio: "Messaggio non trovato." };

  try {
    const ctx = await contesto("messaggi");
    if (!cambiaStato(id, nuovo)) {
      return { stato: "errore", messaggio: "Quel messaggio non c’è più." };
    }
    await ctx.registra("configurazione", `Messaggio #${id} segnato «${nuovo}»`, "messaggi");
  } catch (e) {
    if (e instanceof Negato) return esitoNegato(e);
    if (e instanceof ErroreDatabase) return comeStatoAzione(registraEMappa("segnaMessaggio", e));
    throw e;
  }

  revalidatePath("/area-riservata", "layout");
  return { stato: "fatto", messaggio: "Stato del messaggio aggiornato." };
}

/**
 * Cancella un messaggio, davvero.
 *
 * È la richiesta più comune di §15: qualcuno scrive e poi chiede che i propri
 * dati spariscano. Sparisce la riga, non un contrassegno — e resta nel registro
 * che qualcuno l'ha cancellato, con il nome di chi, che è ciò che deve restare.
 */
export async function eliminaMessaggio(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = idDa(formData);
  if (id === null) return { stato: "errore", messaggio: "Messaggio non trovato." };

  try {
    const ctx = await contesto("messaggi");
    if (!elimina(id)) return { stato: "errore", messaggio: "Quel messaggio non c’è più." };
    await ctx.registra("configurazione", `Messaggio #${id} cancellato`, "messaggi");
  } catch (e) {
    if (e instanceof Negato) return esitoNegato(e);
    if (e instanceof ErroreDatabase) {
      return comeStatoAzione(registraEMappa("eliminaMessaggio", e));
    }
    throw e;
  }

  revalidatePath("/area-riservata", "layout");
  return { stato: "fatto", messaggio: "Messaggio cancellato dal server." };
}
