"use server";

import { redirect } from "next/navigation";
import type { StatoAccesso } from "@/lib/accesso";
import { indirizzoRichiedente, scriviCookieSessione } from "@/lib/auth/cookie";
import { consuma, leggi } from "@/lib/auth/inviti";
import { apri, ATTESA_TOTP_S, chiudiAltrePerUtente, DURATA_MASSIMA_S } from "@/lib/auth/sessioni";
import { primaSezioneDi } from "@/lib/data-area";
import { registraAccesso } from "@/lib/registro-store";
import { impostaPassword, passwordAccettabile, utentePerId } from "@/lib/utenti";
import { inviaA } from "@/lib/posta";

/**
 * L'invito: si sceglie la password e si prosegue verso il secondo fattore.
 *
 * §7 del piano chiede che l'invito «imposti password e TOTP in un passaggio».
 * Qui il passaggio è uno solo dal punto di vista di chi lo usa: si scrive la
 * password e ci si trova davanti al QR, senza aver mai visto una schermata di
 * accesso. Sotto sono due azioni, perché la seconda è la stessa che usa
 * l'accesso normale — e riusarla è meglio che averne una copia che si comporta
 * quasi allo stesso modo.
 */

const NON_VALIDO: StatoAccesso = {
  stato: "errore",
  messaggio:
    "Questo invito non è più valido: potrebbe essere scaduto o già usato. " +
    "Chiedetene un altro ai gestori.",
};

export async function accettaInvito(
  _precedente: StatoAccesso,
  formData: FormData,
): Promise<StatoAccesso> {
  const token = String(formData.get("token") ?? "");
  const nuova = String(formData.get("nuova") ?? "");
  const ripetuta = String(formData.get("ripetuta") ?? "");

  // si rilegge l'invito **adesso**, non ci si fida di quello che la pagina ha
  // mostrato: fra il disegno del modulo e l'invio possono passare minuti, e in
  // quei minuti l'invito può essere stato revocato o usato da qualcun altro
  const invito = leggi(token);
  if (!invito) return NON_VALIDO;

  if (nuova !== ripetuta) {
    return { stato: "errore", messaggio: "Le due password non coincidono." };
  }
  const problema = passwordAccettabile(nuova);
  if (problema) return { stato: "errore", messaggio: problema };

  /*
   * Prima si consuma l'invito, poi si imposta la password.
   *
   * In quest'ordine, due invii simultanei dello stesso invito vedono uno solo
   * `consuma` restituire vero: il secondo si ferma qui. All'ordine inverso
   * entrambi imposterebbero una password — e vincerebbe l'ultima arrivata, cioè
   * non necessariamente quella di chi ha ricevuto l'invito.
   */
  if (!consuma(invito.id)) return NON_VALIDO;

  const esito = await impostaPassword(invito.utenteId, nuova);
  if (!esito.ok) return { stato: "errore", messaggio: esito.errore };

  const utente = utentePerId(invito.utenteId);
  if (utente) {
    await registraAccesso(utente.utente, utente.nome, utente.ruolo, "accesso");
    /*
     * L'avviso all'indirizzo dell'account: «è stata scelta la vostra password».
     * Se a usare il collegamento non è stata la persona giusta — chi l'ha creato,
     * qualcuno a cui è stato inoltrato — lei lo viene a sapere (audit degli
     * accessi, SoD-4). Non ferma niente se la posta non parte: è un avviso.
     */
    if (utente.email) {
      await inviaA(
        utente.email,
        "Accesso all’area riservata: password impostata",
        `Ciao ${utente.nome},\n\nè appena stata scelta la password del vostro account ` +
          `«${utente.utente}» nell’area riservata del sito, con un collegamento d’invito.\n\n` +
          "Se siete stati voi, non serve fare niente. Se non siete stati voi, avvisate " +
          "subito i gestori: qualcuno ha usato il vostro invito.",
      );
    }
  }

  // A chi non ha il secondo fattore per scelta di chi amministra, la password
  // scelta adesso basta: si entra e si va alla prima sezione.
  if (utente && !utente.mfaRichiesto) {
    const piena = apri(invito.utenteId, await indirizzoRichiedente(), "attiva");
    chiudiAltrePerUtente(invito.utenteId, piena);
    await scriviCookieSessione(piena, DURATA_MASSIMA_S);
    redirect(primaSezioneDi(utente.ruolo));
  }

  // dritti al secondo fattore: l'account è attivo ma senza TOTP, e la schermata
  // del codice mostra il QR dell'attivazione
  const sessione = apri(invito.utenteId, await indirizzoRichiedente(), "attesa_totp");
  // Un reinvito arriva spesso dopo un problema — una password dimenticata, un
  // dispositivo perso: le sessioni di prima si chiudono, come quando si cambia
  // la password dal profilo (audit di sicurezza, AUTH-02).
  chiudiAltrePerUtente(invito.utenteId, sessione);
  await scriviCookieSessione(sessione, ATTESA_TOTP_S);
  redirect("/area-riservata/accedi/totp");
}
