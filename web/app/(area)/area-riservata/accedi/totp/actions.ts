"use server";

import { redirect } from "next/navigation";
import type { StatoCodice } from "@/lib/accesso";
import { indirizzoRichiedente, scriviCookieSessione, tokenCorrente } from "@/lib/auth/cookie";
import { chiudi, DURATA_MASSIMA_S, promuovi } from "@/lib/auth/sessioni";
import { primaSezioneDi } from "@/lib/data-area";
import { registra, registraAccesso } from "@/lib/registro-store";
import { sessioneVivaCorrente } from "@/lib/sessione-server";
import { iniziaTotp, utentePerId, verificaSecondoFattoreLimitato } from "@/lib/utenti";

/**
 * Il secondo passo dell'accesso: il codice a sei cifre.
 *
 * Ci si arriva con una mezza sessione (`attesa_totp`) che il primo passo ha
 * aperto e che da sola non apre nessuna pagina. Qui succede una di due cose: chi
 * il secondo fattore non ce l'ha lo attiva, chi ce l'ha lo usa. Poi la sessione
 * viene promossa e l'accesso finisce nel registro.
 *
 * **L'accesso si registra qui e non nel primo passo**, perché una password
 * giusta non è un accesso: se il registro segnasse «è entrato» a chi si ferma
 * davanti al codice, direbbe una cosa falsa proprio nel documento che serve a
 * ricostruire chi ha visto cosa.
 */

const SCADUTA: StatoCodice = {
  stato: "errore",
  messaggio: "Il tempo è scaduto. Tornate alla schermata di accesso e ridate la password.",
};

/**
 * Porta dentro: promuove la sessione, allunga il cookie, registra.
 *
 * Il cookie va riscritto anche se il token non cambia: era stato messo con
 * cinque minuti di `Max-Age`, e senza questa riga il browser lo butterebbe via
 * cinque minuti dopo essere entrati — con la riga di sessione ancora viva nel
 * database, cioè un'uscita che nessuno ha chiesto e che sembra un guasto.
 */
async function entra(idSessione: number, utenteId: number, da: string | null): Promise<StatoCodice> {
  // La sessione può essere scaduta o revocata dopo la lettura iniziale.
  if (!promuovi(idSessione)) return SCADUTA;
  const token = await tokenCorrente();
  if (token) await scriviCookieSessione(token, DURATA_MASSIMA_S);

  const utente = utentePerId(utenteId);
  if (utente) await registraAccesso(utente.utente, utente.nome, utente.ruolo, "accesso");
  // con la password provvisoria si entra solo per cambiarla (vedi `proxy.ts`)
  if (utente?.passwordDaCambiare) redirect("/area-riservata/accedi/password");

  const pulita =
    da && da.startsWith("/area-riservata/") && !da.startsWith("//") && !da.includes("..")
      ? da
      : primaSezioneDi(utente?.ruolo ?? "referente");
  redirect(pulita);
}

/**
 * Verifica il codice: conferma l'attivazione, oppure autentica.
 *
 * Le due strade sono la stessa azione perché per chi la usa sono la stessa cosa
 * — «scrivi il codice che vedi sul telefono» — e perché tenerle separate
 * significherebbe che una schermata sbagliata può chiamare quella sbagliata.
 * Quale delle due valga lo decide lo stato dell'account, non il form.
 */
export async function verificaSecondoFattore(
  _precedente: StatoCodice,
  formData: FormData,
): Promise<StatoCodice> {
  const viva = await sessioneVivaCorrente();
  if (!viva || viva.stato !== "attesa_totp") return SCADUTA;

  const utente = utentePerId(viva.utenteId);
  if (!utente) return SCADUTA;

  const codice = String(formData.get("codice") ?? "").trim();
  if (codice === "") {
    return { stato: "errore", messaggio: "Scrivete il codice a sei cifre." };
  }

  /*
   * Il conteggio dei tentativi vale **anche** qui, dall'audit di produzione.
   *
   * Prima un codice sbagliato non costava niente e la finestra da cinque minuti
   * si rinnovava: chi aveva la password poteva provare le sei cifre a raffica.
   * Adesso il passo passa da `verificaSecondoFattoreLimitato`, che riusa il
   * conteggio del primo passo (`lib/auth/tentativi.ts`) — un codice errato conta
   * come un accesso fallito, e dopo cinque in quindici minuti si aspetta.
   */
  const ip = await indirizzoRichiedente();
  const esito = verificaSecondoFattoreLimitato(viva.utenteId, ip, codice);

  if (esito.esito === "nonValido") return SCADUTA;

  if (esito.esito === "bloccato") {
    await registraAccesso(utente.utente, utente.nome, utente.ruolo, "accesso", "rifiutato");
    return {
      stato: "errore",
      messaggio: `Troppi tentativi. Riprovate fra ${esito.minuti} minuti.`,
    };
  }

  if (esito.esito === "codiceErrato") {
    return {
      stato: "errore",
      messaggio: utente.totpAttivo
        ? "Codice non valido. Controllate l’ora del telefono e riprovate."
        : "Codice non valido. Inquadrate di nuovo il QR e riprovate.",
    };
  }

  if (esito.recupero) await registra(viva.sessione, "configurazione", "Usato un codice di recupero del secondo fattore", "accesso");
  return entra(viva.id, viva.utenteId, esito.recupero ? "/area-riservata/profilo" : String(formData.get("da") ?? "") || null);
}

/**
 * Ricomincia l'attivazione con un segreto nuovo.
 *
 * Serve a chi si è impantanato: app sbagliata, telefono cambiato, QR inquadrato
 * a metà. Funziona **solo** se il secondo fattore non è ancora attivo — se no
 * sarebbe il modo di togliersi il secondo fattore avendo soltanto la password,
 * cioè di non averlo.
 */
export async function rigeneraSegreto(): Promise<void> {
  const viva = await sessioneVivaCorrente();
  if (!viva || viva.stato !== "attesa_totp") redirect("/area-riservata/accedi");

  const utente = utentePerId(viva.utenteId);
  if (utente && !utente.totpAttivo) iniziaTotp(utente.id);
  redirect("/area-riservata/accedi/totp");
}

/** Torna indietro senza entrare: chiude la mezza sessione. */
export async function annulla(): Promise<void> {
  chiudi(await tokenCorrente());
  redirect("/area-riservata/accedi");
}
