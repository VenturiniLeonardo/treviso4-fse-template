"use server";

import { redirect } from "next/navigation";
import type { StatoCodice } from "@/lib/accesso";
import { indirizzoRichiedente, tokenCorrente } from "@/lib/auth/cookie";
import { chiudiAltrePerUtente } from "@/lib/auth/sessioni";
import { primaSezioneDi } from "@/lib/data-area";
import { registra } from "@/lib/registro-store";
import { sessioneVivaCorrente } from "@/lib/sessione-server";
import { cambiaPassword, utentePerId } from "@/lib/utenti";

/**
 * L'ultimo passo del primo accesso di un account preparato con una password
 * provvisoria: se ne sceglie una propria.
 *
 * Ci si arriva con la sessione già piena — password e secondo fattore dati —
 * ma `sessioneCorrente` la tratta come assente finché il segno
 * `password_da_cambiare` resta acceso, quindi questa azione legge la sessione
 * viva da sé. Chiede di nuovo la password provvisoria per la stessa ragione del
 * profilo: una sessione lasciata aperta non deve bastare a scegliere la
 * password di qualcun altro. Il conteggio dei tentativi è quello di
 * `cambiaPassword`, condiviso con l'accesso.
 */

const SCADUTA: StatoCodice = {
  stato: "errore",
  messaggio: "La sessione è scaduta. Tornate alla schermata di accesso.",
};

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "");

export async function sostituisciPasswordProvvisoria(
  _precedente: StatoCodice,
  formData: FormData,
): Promise<StatoCodice> {
  const viva = await sessioneVivaCorrente();
  if (!viva || viva.stato !== "attiva") return SCADUTA;
  if (!viva.daCambiare) redirect(primaSezioneDi(viva.sessione.r));

  const utente = utentePerId(viva.utenteId);
  if (!utente) return SCADUTA;

  const attuale = testo(formData, "attuale");
  const nuova = testo(formData, "nuova");
  const ripetuta = testo(formData, "ripetuta");

  if (attuale === "") return { stato: "errore", messaggio: "Scrivete la password provvisoria." };
  if (nuova !== ripetuta) return { stato: "errore", messaggio: "Le due password nuove non coincidono." };

  const esito = await cambiaPassword(utente.utente, attuale, nuova, await indirizzoRichiedente());
  if (!esito.ok) return { stato: "errore", messaggio: esito.errore };

  // la password provvisoria la conoscevano altri: gli accessi aperti con quella
  // si chiudono, come dopo un cambio dal profilo
  const token = await tokenCorrente();
  if (token) chiudiAltrePerUtente(utente.id, token);
  await registra(viva.sessione, "accesso", "Password provvisoria sostituita", "accesso");

  redirect(primaSezioneDi(utente.ruolo));
}
