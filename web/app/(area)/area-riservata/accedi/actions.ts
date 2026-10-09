"use server";

import { redirect } from "next/navigation";
import type { StatoAccesso } from "@/lib/accesso";
import {
  cancellaCookieSessione,
  indirizzoRichiedente,
  scriviCookieSessione,
  tokenCorrente,
} from "@/lib/auth/cookie";
import { apri, ATTESA_TOTP_S, chiudi, DURATA_MASSIMA_S } from "@/lib/auth/sessioni";
import { azzera } from "@/lib/auth/tentativi";
import { primaSezioneDi } from "@/lib/data-area";
import { PASSWORD_MAX } from "@/lib/password-regole";
import { registraAccesso } from "@/lib/registro-store";
import { sessioneCorrente } from "@/lib/sessione-server";
import {
  configurazioneMancante,
  type Utente,
  verificaCredenzialiLimitate,
} from "@/lib/utenti";

/**
 * L'accesso, in due passi.
 *
 * Il primo passo è qui: nome utente e password. Non porta dentro — apre una
 * **mezza sessione** (`attesa_totp`) che dura cinque minuti e non permette di
 * aprire nessuna pagina. Il secondo passo sta in `accedi/totp/actions.ts`.
 *
 * §7 del piano vuole il secondo fattore obbligatorio, e la nota sotto la tabella
 * spiega perché senza eccezioni: «se l'account non ha il TOTP, il primo accesso
 * porta alla schermata di attivazione e non prosegue. È più semplice da spiegare
 * che da rimediare». Quindi non esiste una strada che salti quel passo — nemmeno
 * per chi il TOTP non l'ha ancora attivato, che infatti lo attiva lì.
 *
 * La limitazione dei tentativi non è più una `Map` in memoria: sta in
 * `lib/auth/tentativi.ts`, su database, e non si azzera a ogni riavvio.
 */

/**
 * Il nome utente più lungo che si prende in considerazione. Gli inviti li
 * vogliono di 3–32 caratteri (`utenti/actions.ts`); qui il margine è largo
 * per i nomi travasati dal vecchio elenco, che quella regola non la seguivano.
 */
const UTENTE_MAX = 64;

/** Dove mandare l'utente dopo l'accesso, ripulito da destinazioni esterne. */
function destinazione(da: string | null): string | null {
  if (da && da.startsWith("/area-riservata/") && !da.startsWith("//") && !da.includes(".."))
    return da;
  return null;
}

/**
 * Chiude il primo passo: apre la mezza sessione e manda al secondo fattore.
 *
 * Non registra ancora niente nel registro degli accessi. Una password giusta non
 * è un accesso: se si fermasse qui, il registro direbbe «è entrato» di qualcuno
 * che dentro non è mai arrivato. L'accesso lo registra il secondo passo.
 */
async function apriMezzaSessione(utenteId: number, da: string | null): Promise<never> {
  const token = apri(utenteId, await indirizzoRichiedente(), "attesa_totp");
  await scriviCookieSessione(token, ATTESA_TOTP_S);

  const dove = destinazione(da);
  redirect(dove ? `/area-riservata/accedi/totp?da=${encodeURIComponent(dove)}` : "/area-riservata/accedi/totp");
}

/**
 * Chiude l'accesso di chi non ha il secondo fattore, per scelta di chi amministra.
 *
 * È la sola strada che porta a una sessione piena senza passare dal codice, e
 * vale soltanto per gli account a cui un amministratore ha tolto
 * `mfa_richiesto` dalla schermata degli utenti: tutti gli altri — i nuovi e chi
 * esisteva già — hanno il segno a 1 e passano da `apriMezzaSessione`.
 *
 * Fa le stesse cose del secondo passo (`entra` in `accedi/totp/actions.ts`): il
 * conteggio dei tentativi per utente si azzera adesso, l'accesso finisce nel
 * registro, e con la password provvisoria si entra solo per cambiarla.
 */
async function entraConLaSolaPassword(utente: Utente, da: string | null): Promise<never> {
  azzera(utente.utente);
  const token = apri(utente.id, await indirizzoRichiedente(), "attiva");
  await scriviCookieSessione(token, DURATA_MASSIMA_S);
  await registraAccesso(utente.utente, utente.nome, utente.ruolo, "accesso");
  if (utente.passwordDaCambiare) redirect("/area-riservata/accedi/password");
  redirect(destinazione(da) ?? primaSezioneDi(utente.ruolo));
}

export async function accedi(
  _precedente: StatoAccesso,
  formData: FormData,
): Promise<StatoAccesso> {
  const da = String(formData.get("da") ?? "") || null;

  if (configurazioneMancante()) {
    /*
     * Due destinatari, due messaggi.
     *
     * Il messaggio di prima era uno solo, e nominava `scripts/importa-utenti.mjs`
     * e `scripts/invita.mjs` **a chiunque** avesse premuto «Entra» su un'
     * installazione nuova — cioè a un visitatore non autenticato. Non è un buco
     * grave, ma è divulgazione gratuita (nomi di file del server, e il fatto che
     * l'installazione è appena nata) rivolta a qualcuno che con
     * quell'informazione non può fare niente: chi legge la schermata è un referente,
     * non chi amministra la macchina.
     *
     * Il dettaglio operativo va dove serve, cioè nel registro del servizio, che
     * chi installa sta già guardando.
     */
    console.error(
      "Accesso rifiutato: nessun account attivo con una password. " +
        "Creane uno con «npm run db:invita -- <utente> <ruolo> \"<nome>\" <iniziali> [unita]» " +
        "(le sei unità vanno seminate prima con «npm run db:riferimenti»), " +
        "oppure travasa un elenco esistente con «npm run db:importa-utenti».",
    );
    return {
      stato: "nonConfigurato",
      messaggio:
        "Nessun accesso è ancora attivo su questo sito. Se aspettate le vostre " +
        "credenziali, chiedetele ai gestori: arrivano come collegamento " +
        "d’invito, valido una volta sola.",
    };
  }

  const utente = String(formData.get("utente") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (utente === "" || password === "") {
    return { stato: "errore", messaggio: "Inserite nome utente e password.", utente };
  }

  /*
   * Un valore fuori misura non può essere una credenziale giusta: si scarta
   * qui, prima di contarlo fra i tentativi e prima del registro.
   *
   * Dall'audit di sicurezza (DOS-02): il nome utente di un accesso fallito
   * finiva intero in `tentativi_accesso` e due volte nel registro, che si
   * conserva dodici mesi e che le dashboard rileggono a cinquecento voci per
   * volta. Con i 24 MB ammessi per richiesta, una ventina di tentativi bastava a
   * far uscire il processo dal suo tetto di memoria. Non si conta il tentativo
   * perché non serve: il limite per IP protegge dall'indovinare, e un valore
   * che non può essere giusto non insegna niente a chi lo manda. Il nome utente
   * non si rimanda indietro, per la stessa ragione.
   */
  if (utente.length > UTENTE_MAX || password.length > PASSWORD_MAX) {
    return {
      stato: "errore",
      messaggio: "Nome utente o password non corretti. Controllate i dati e riprovate.",
    };
  }

  const ip = await indirizzoRichiedente();

  const esito = await verificaCredenzialiLimitate(utente, password, ip);
  if (esito.esito === "bloccato") {
    return {
      stato: "bloccato",
      messaggio: `Troppi tentativi. Riprovate fra ${esito.minuti} minuti.`,
      utente,
    };
  }

  if (esito.esito === "errore") {
    // anche i tentativi falliti finiscono nel registro: è il motivo per cui un
    // registro degli accessi esiste
    await registraAccesso(utente, utente, "sconosciuto", "accesso", "rifiutato");
    // un solo messaggio per entrambi i casi: non si dice quali nomi utente esistono
    return {
      stato: "errore",
      messaggio: "Nome utente o password non corretti. Controllate i dati e riprovate.",
      utente,
    };
  }

  // Il conteggio per utente **non** si azzera qui: una password giusta non è
  // un accesso. Azzerarlo prima del secondo fattore lasciava ripresentare
  // all'infinito una password trapelata senza che il blocco per utente
  // scattasse mai (audit di sicurezza, AUTH-01). Lo azzera
  // `verificaSecondoFattoreLimitato`, quando l'accesso è davvero concluso.
  if (!esito.utente.mfaRichiesto) return entraConLaSolaPassword(esito.utente, da);
  return apriMezzaSessione(esito.utente.id, da);
}

export async function esci() {
  const sessione = await sessioneCorrente();
  if (sessione) await registraAccesso(sessione.u, sessione.n, sessione.r, "uscita");

  // la riga sparisce dal database, non solo il cookie dal browser: è la
  // differenza fra un'uscita e un cookie buttato via che resterebbe valido
  chiudi(await tokenCorrente());
  await cancellaCookieSessione();
  redirect("/");
}
