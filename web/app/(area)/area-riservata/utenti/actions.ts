"use server";

import { revalidatePath } from "next/cache";
import { contesto, esitoNegato, ingresso, Negato } from "@/lib/auth/contesto";
import { puoAgireSuRuolo } from "@/lib/auth/decisione";
import { crea as creaInvito, DURATA_ORE } from "@/lib/auth/inviti";
import { chiudiTuttePerUtente } from "@/lib/auth/sessioni";
import type { StatoAzione } from "@/lib/contenuti";
import { TUTTE_LE_UNITA, type UnitaKey } from "@/lib/data";
import { ErroreDatabase } from "@/lib/db/errori";
import { registra } from "@/lib/registro-store";
import { RUOLI_VALIDI, type RuoloSessione } from "@/lib/sessione";
import { creaUtente, elencoUtenti, modificaUtente, revoca, trovaUtente, utentePerId } from "@/lib/utenti";
import { emailValida } from "@/lib/email";
import { inviaA, postaConfigurata } from "@/lib/posta";

/**
 * Utenti e inviti.
 *
 * È il file più delicato del progetto, perché chi può invitare può **creare un
 * accesso**. Fino alla fase 14.9 questa funzione esisteva solo come comando —
 * `npm run db:invita` — e quindi chi amministrava doveva poter entrare nel
 * server. Il costo di quella prudenza era che a settembre, quando i referenti
 * cambiano, il ricambio non si fa: si telefona a chi ha le chiavi.
 *
 * ## La regola che regge tutto, e dove vive
 *
 * La riga di matrice è `utenti`. **`completo` significa qualunque account,
 * `limitato` significa i soli account dei referenti di unità e del social media
 * manager.** Un gestore fa il ricambio delle proprie unità e sceglie chi gli
 * prepara i contenuti, ma non si dà un pari grado; lo sviluppatore fa tutto.
 *
 * Quel `limitato` **non lo verifica `copre()`**: l'ambito non è un'unità, è un
 * insieme di ruoli, e `decidi()` con `limitato` e nessuna risorsa concede. Se
 * un'azione qui chiamasse `contesto("utenti")` da sola, un gestore
 * potrebbe creare uno sviluppatore — e la matrice sembrerebbe stretta mentre
 * non lo è.
 *
 * Per questo **nessuna azione di questo file chiama `contesto` direttamente**.
 * Passano tutte da `autorizzaSuUtente(ruoloBersaglio)`, che è l'unico posto in
 * cui quella regola è scritta. Aggiungere un'azione senza chiamarla si vede in
 * revisione: non ha il contesto, quindi non ha né l'autore né il registro.
 *
 * ## Il token si mostra una volta e non si registra
 *
 * `crea()` restituisce il token in chiaro una volta sola — nel database c'è la
 * sua impronta. Torna quindi nel messaggio dell'azione, che finisce a schermo e
 * da nessun'altra parte: il registro annota **che** un invito è stato creato e
 * per chi, mai il token. Un registro che li contenesse sarebbe un elenco di
 * credenziali valide per settantadue ore, in una tabella che si esporta in CSV.
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
  revalidatePath("/area-riservata/sviluppatore/utenti");
  revalidatePath("/area-riservata/gestore/utenti");
}

/**
 * Il cancello di questo file: la matrice, **più** il ruolo dell'account su cui
 * si sta agendo.
 *
 * `ruoloBersaglio` è obbligatorio e non ha un valore predefinito, per la stessa
 * ragione per cui `autorizzato()` in `documenti/actions.ts` pretende l'unità:
 * un predefinito è la scorciatoia che qualcuno prende senza accorgersene, e qui
 * la scorciatoia si chiama «un gestore ha creato uno sviluppatore».
 *
 * Il rifiuto per ruolo si **registra qui**, perché non viene dal cancello — è
 * una regola di questo file, e se non la scrivessimo noi non la scriverebbe
 * nessuno. Stessa scelta di `negaApprovazione` in `unita/actions.ts`.
 */
async function autorizzaSuUtente(ruoloBersaglio: RuoloSessione, descrizione: string) {
  const ctx = await contesto("utenti", { descrizione });

  // La regola sta in `lib/auth/decisione.ts`, con le altre: qui si applica e si
  // registra. Vedi il commento su `puoAgireSuRuolo` per il perché di entrambe le
  // cose — non è nel cancello, e non è in questo file.
  if (!puoAgireSuRuolo(ctx.livello, ruoloBersaglio)) {
    /*
     * `registra` diretta, non `ctx.registra`, e per una ragione trovata
     * provando: `Contesto.registra` scrive sempre con esito `ok`, perché è
     * legata alle operazioni **riuscite**. Un rifiuto scritto così finisce nel
     * registro come una riga «ok» il cui testo dice «Rifiutata…» — e in un
     * registro che si filtra per esito quella riga non si trova più. I rifiuti
     * del cancello usano `"rifiutato"`, e questo è un rifiuto quanto quelli.
     */
    await registra(
      ctx.sessione,
      "configurazione",
      `Rifiutata l’operazione su un account «${ruoloBersaglio}»${descrizione ? ` (${descrizione})` : ""} — ` +
        "con «limitato» si toccano i soli referenti di unità",
      "utenti",
      "rifiutato",
    );
    throw new Negato("ruolo", "utenti");
  }
  return ctx;
}

/** Il collegamento d'invito completo, da consegnare a mano. */
function collegamento(token: string): string {
  /*
   * La base arriva dall'ambiente, non dalla richiesta.
   *
   * Comporla dall'intestazione `Host` avrebbe funzionato in sviluppo e sarebbe
   * stata una via d'attacco in esercizio: chi manda una richiesta con un `Host`
   * suo si fa stampare un collegamento d'invito che punta al suo dominio, e chi
   * lo riceve consegna la password a lui. Senza la variabile si stampa il solo
   * percorso, e chi amministra ci mette davanti il dominio a mano — un fastidio
   * che vale l'assenza di quel rischio.
   */
  const base = process.env.SITO_BASE_URL;
  return `${base ?? ""}/area-riservata/invito/${token}`;
}

/**
 * Consegna un invito: per posta a chi lo deve usare, quando si può.
 *
 * Audit degli accessi del 4 ottobre 2026, SoD-4. Il collegamento d'invito
 * sceglie la password e attiva il secondo fattore: chi lo usa per primo
 * **diventa** quell'account. Mostrato sullo schermo di chi crea l'account, lo
 * metteva in mano a una persona che poteva usarlo prima dell'invitato e poi
 * agire, nel registro, con il suo nome. Se l'account ha un indirizzo e la posta
 * è configurata, adesso parte da lì e a schermo non compare.
 *
 * Quando non si può — nessun indirizzo, posta spenta o guasta — il collegamento
 * si mostra come prima, perché il ricambio di settembre non si deve fermare per
 * un server di posta. Il registro dice quale delle due strade è stata presa: chi
 * legge sa se l'invito è passato per le mani di chi l'ha creato.
 */
async function consegna(
  u: { nome: string; email?: string | null; mfaRichiesto?: boolean },
  token: string,
): Promise<{ messaggio: string; nota: string }> {
  const link = collegamento(token);
  if (u.email && postaConfigurata()) {
    const esito = await inviaA(
      u.email,
      "Il vostro accesso all’area riservata del sito",
      `Ciao ${u.nome},\n\n` +
        "è stato creato (o rinnovato) il vostro accesso all’area riservata del sito. " +
        (u.mfaRichiesto === false
          ? "Aprite questo collegamento per scegliere la password. "
          : "Aprite questo collegamento per scegliere la password e configurare l’app che genera i codici di accesso. ") +
        `Vale ${DURATA_ORE} ore e una volta sola:\n\n${link}\n\n` +
        "Se non vi aspettavate questo messaggio, non apritelo e avvisate i gestori.",
    );
    if (esito.ok) {
      return {
        messaggio:
          `Il collegamento è partito per posta all’indirizzo dell’account: vale ${DURATA_ORE} ` +
          "ore e una volta sola.",
        nota: "collegamento spedito all’indirizzo dell’account",
      };
    }
  }
  return {
    messaggio:
      `Consegnate questo collegamento a mano, vale ${DURATA_ORE} ore e una volta sola: ${link}` +
      (u.email ? " (la posta non è partita: per questo è qui)" : ""),
    nota: "collegamento mostrato a chi invita",
  };
}

// ==========================================================================
// Invitare
// ==========================================================================

/**
 * Crea un account e restituisce il collegamento d'invito.
 *
 * L'account nasce `invitato`: senza password, quindi
 * `verificaCredenziali` non fa entrare nessuno finché il collegamento non è
 * stato usato. Un invito non è una credenziale a metà.
 */
export async function invita(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const nomeUtente = testo(formData, "utente").toLowerCase();
  const ruolo = testo(formData, "ruolo") as RuoloSessione;
  const nome = testo(formData, "nome");
  const iniziali = testo(formData, "iniziali").toUpperCase();
  const unita = testo(formData, "unita") as UnitaKey | "";
  const email = testo(formData, "email");
  // «0» = a quest'account basta la password. Vale solo se lo chiede chi ha
  // `completo` (sotto); qualunque altro valore, o un campo assente, è «richiesto».
  const senzaMfa = testo(formData, "mfa") === "0";

  // Il ruolo si valida **prima** del cancello: `autorizzaSuUtente` lo confronta
  // con il livello, e un valore inventato non deve arrivarci.
  if (!RUOLI_VALIDI.includes(ruolo)) {
    return { stato: "errore", campo: "ruolo", messaggio: "Scegliete un ruolo." };
  }

  try {
    const ctx = await autorizzaSuUtente(ruolo, `invito per «${nomeUtente}»`);

    if (!/^[a-z0-9._-]{3,32}$/.test(nomeUtente)) {
      return {
        stato: "errore",
        campo: "utente",
        messaggio:
          "Il nome utente va da 3 a 32 caratteri, minuscole, cifre, punto, trattino " +
          "o sottolineato. Per esempio «ref1» o «referente.unita1».",
      };
    }
    if (nome.length < 3 || nome.length > 80) {
      return { stato: "errore", campo: "nome", messaggio: "Il nome mostrato va da 3 a 80 caratteri." };
    }
    if (!/^[A-Z]{1,3}$/.test(iniziali)) {
      return {
        stato: "errore",
        campo: "iniziali",
        messaggio: "Le iniziali sono una, due o tre lettere: compaiono nella pastiglia in barra.",
      };
    }
    if (email && !emailValida(email)) {
      return { stato: "errore", campo: "email", messaggio: "Questo indirizzo non è valido." };
    }

    /*
     * L'unità: obbligatoria per un referente di unità, vietata agli altri.
     *
     * Non è una preferenza di questo modulo: è il `CHECK`
     * `utenti_unita_solo_referente` dello schema, che rifiuterebbe la riga
     * comunque. Si controlla qui per poterlo **spiegare** — un referente di unità senza
     * unità è un account che non può fare il proprio lavoro, e l'errore del
     * database direbbe soltanto che una regola ha bloccato l'operazione.
     */
    if (ruolo === "referente") {
      if (!unita || !TUTTE_LE_UNITA.includes(unita as UnitaKey) || unita === "gruppo") {
        return {
          stato: "errore",
          campo: "unita",
          messaggio:
            "Un referente di unità ha un’unità, sempre: senza, non può gestire né album né " +
            "circolari. Scegliete quale.",
        };
      }
    } else if (unita) {
      return {
        stato: "errore",
        campo: "unita",
        messaggio: "Solo un referente di unità ha un’unità. Lasciate il campo su «nessuna».",
      };
    }

    if (trovaUtente(nomeUtente)) {
      return {
        stato: "errore",
        campo: "utente",
        messaggio:
          `«${nomeUtente}» esiste già. Per rimandargli l’invito usate «Rifai l’invito» ` +
          "nella riga del suo account.",
      };
    }

    /*
     * Il secondo fattore lo sceglie solo chi ha `completo` sugli utenti — lo
     * sviluppatore. Un gestore che spedisse `mfa=0` a mano ottiene un
     * account con il codice richiesto, come tutti: non è un errore da
     * segnalare, è il solo valore che può dare.
     */
    const mfaRichiesto = !(senzaMfa && ctx.livello === "completo");

    const id = creaUtente({
      utente: nomeUtente,
      ruolo,
      nome,
      iniziali,
      mfaRichiesto,
      ...(ruolo === "referente" ? { unita } : {}),
      ...(email ? { email } : {}),
    });
    const token = creaInvito(id);
    const consegnato = await consegna({ nome, email: email || null, mfaRichiesto }, token);

    aggiorna();
    // il token **non** entra nel registro: vedi la nota in cima
    await ctx.registra(
      "configurazione",
      `Creato l’account «${nomeUtente}» (${ruolo}${ruolo === "referente" ? `, ${unita}` : ""}) ` +
        `e generato l’invito — ${consegnato.nota}` +
        (mfaRichiesto ? "" : " — secondo fattore NON richiesto: basta la password"),
      "utenti",
    );

    return { stato: "fatto", messaggio: `Account creato. ${consegnato.messaggio}` };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Rifà l'invito a chi c'è già.
 *
 * `crea()` cancella gli inviti aperti dello stesso utente: se si reinvita
 * qualcuno è perché il primo collegamento non è arrivato o si è perso, e
 * lasciarne due in giro raddoppia le occasioni che uno finisca nelle mani
 * sbagliate.
 */
export async function rifaiInvito(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    return { stato: "errore", messaggio: "Account non riconosciuto." };
  }

  try {
    // sessione e ruolo prima di cercare l'account: vedi `ingresso()`
    await ingresso("utenti");
    const u = utentePerId(id);
    if (!u) return { stato: "errore", messaggio: "Questo account non esiste più." };

    const ctx = await autorizzaSuUtente(u.ruolo, `nuovo invito per «${u.utente}»`);

    if (u.stato === "revocato") {
      return {
        stato: "errore",
        messaggio:
          "Quest’account è revocato: un invito non lo riaprirebbe. Créatene uno nuovo, " +
          "oppure chiedete a chi amministra di riattivarlo.",
      };
    }

    /*
     * Un invito nuovo su un account **già attivo** azzera la password di chi lo
     * usa e ne chiude le sessioni; su un account che il secondo fattore non l'ha
     * ancora attivato, chi usa il collegamento ne prende il posto. Con
     * «limitato» il gestore rifà gli inviti mai usati — il caso di
     * settembre, il collegamento scaduto — e per un account in uso chiede a chi
     * amministra (audit degli accessi, M-6).
     */
    if (ctx.livello !== "completo" && u.stato === "attivo") {
      return {
        stato: "errore",
        messaggio:
          `«${u.utente}» ha già un accesso attivo. Se ha perso la password o il telefono, ` +
          "il nuovo invito lo fa chi amministra il sito.",
      };
    }

    const token = creaInvito(id);
    const consegnato = await consegna(u, token);
    aggiorna();
    await ctx.registra(
      "configurazione",
      `Rifatto l’invito per «${u.utente}» — ${consegnato.nota}`,
      "utenti",
    );

    return {
      stato: "fatto",
      messaggio: `Invito nuovo per «${u.utente}»; quello di prima è annullato. ${consegnato.messaggio}`,
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

// ==========================================================================
// Revocare
// ==========================================================================

/**
 * Revoca un account: non entra più, e chi era dentro esce.
 *
 * Le due mosse sono entrambe necessarie. `revoca()` mette lo stato a `revocato`
 * e cancella l'impronta della password; `chiudiTuttePerUtente` butta le sessioni
 * aperte. §7 del piano dice «revoca immediata», e senza la seconda mossa chi era
 * già dentro resterebbe dentro fino alla scadenza del cookie — dodici ore in cui
 * un account revocato guarda gli elenchi degli iscritti.
 */
export async function revocaUtente(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    return { stato: "errore", messaggio: "Account non riconosciuto." };
  }

  try {
    // sessione e ruolo prima di cercare l'account: vedi `ingresso()`
    await ingresso("utenti");
    const u = utentePerId(id);
    if (!u) return { stato: "errore", messaggio: "Questo account non esiste più." };

    const ctx = await autorizzaSuUtente(u.ruolo, `revoca di «${u.utente}»`);

    /*
     * Nessuno revoca sé stesso.
     *
     * Non è una gentilezza: se l'ultimo sviluppatore si revoca, la schermata
     * degli utenti non è più raggiungibile da nessuno e si rientra solo dalla
     * riga di comando sul server. Il caso «ho cliccato sulla riga sbagliata» è
     * poi il più probabile di tutti, perché la propria è la prima dell'elenco.
     */
    // Il confronto è sul **nome utente**, non su un identificativo: `Sessione.i`
    // sono le iniziali per la pastiglia in barra, non l'id, e la sessione non
    // porta l'id. `utenti_utente` è un indice unico su `lower(utente)`, quindi
    // il nome identifica l'account quanto un numero.
    if (u.utente === ctx.sessione.u.trim().toLowerCase()) {
      return {
        stato: "errore",
        messaggio:
          "Non si revoca il proprio account: se fosse l’ultimo amministratore, " +
          "quest’area non sarebbe più raggiungibile da nessuno.",
      };
    }

    if (u.stato === "revocato") {
      return { stato: "errore", messaggio: `«${u.utente}» è già revocato.` };
    }

    if (!revoca(id, ctx.utente)) return { stato: "errore", messaggio: "La revoca non è consentita: serve un altro amministratore attivo, oppure il vostro accesso è cambiato." };
    const chiuse = chiudiTuttePerUtente(id);
    aggiorna();
    await ctx.registra(
      "configurazione",
      `Revocato «${u.utente}» (${u.ruolo})${chiuse > 0 ? `, ${chiuse} sessioni chiuse` : ""}`,
      "utenti",
    );

    return {
      stato: "fatto",
      messaggio:
        `«${u.utente}» non entra più.` +
        (chiuse > 0
          ? ` ${chiuse === 1 ? "Una sessione aperta è stata chiusa" : `${chiuse} sessioni aperte sono state chiuse`}.`
          : ""),
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/** Verifica sia il ruolo attuale sia quello richiesto, prima di aggiornare. */
export async function salvaAccount(_precedente: StatoAzione, formData: FormData): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isSafeInteger(id) || id <= 0) return { stato: "errore", messaggio: "Account non riconosciuto." };
  try {
    // sessione e ruolo prima di cercare l'account: vedi `ingresso()`
    await ingresso("utenti");
    const u = utentePerId(id);
    if (!u) return { stato: "errore", messaggio: "Account non trovato." };
    const ctx = await autorizzaSuUtente(u.ruolo, `modifica di «${u.utente}»`);
    const ruolo = testo(formData, "ruolo") as RuoloSessione;
    if (!RUOLI_VALIDI.includes(ruolo)) return { stato: "errore", campo: "ruolo", messaggio: "Scegliete un ruolo valido." };
    await autorizzaSuUtente(ruolo, `ruolo richiesto per «${u.utente}»`);
    const nome = testo(formData, "nome");
    const iniziali = testo(formData, "iniziali").toUpperCase();
    const email = testo(formData, "email");
    const unita = testo(formData, "unita");
    if (!nome || nome.length > 80) return { stato: "errore", campo: "nome", messaggio: "Il nome deve contenere da 1 a 80 caratteri." };
    if (!/^[A-ZÀ-ÖØ-Ý]{1,3}$/.test(iniziali)) return { stato: "errore", campo: "iniziali", messaggio: "Scrivete da una a tre lettere per le iniziali." };
    if (email && (email.length > 120 || !emailValida(email))) return { stato: "errore", campo: "email", messaggio: "Indirizzo email non valido." };
    if (email && elencoUtenti().some((x) => x.id !== id && x.email?.toLowerCase() === email.toLowerCase())) return { stato: "errore", campo: "email", messaggio: "Questo indirizzo è già associato a un account." };
    if (ruolo === "referente" ? (!TUTTE_LE_UNITA.includes(unita as UnitaKey) || unita === "gruppo") : !!unita) return { stato: "errore", campo: "unita", messaggio: "Assegnate un’unità soltanto ai referenti di unità." };
    // Il secondo fattore: presente nel modulo solo per chi ha `completo`;
    // `modificaUtente` lo ignora per chiunque altro.
    const mfaRichiesto = formData.has("mfa") ? testo(formData, "mfa") !== "0" : undefined;
    const esito = modificaUtente(id, { nome, iniziali, email, ruolo, ...(mfaRichiesto !== undefined ? { mfaRichiesto } : {}), ...(unita ? { unita } : {}) }, ctx.utente, ctx.livello, u.ruolo);
    if (esito !== "ok") return { stato: "errore", messaggio: esito === "ultimoAdmin" ? "Serve un altro amministratore attivo prima di cambiare questo ruolo." : esito === "cambiato" ? "L’account è cambiato: ricaricate la pagina." : "Non potete cambiare il ruolo o l’unità di questo account." };
    // Un nuovo ambito richiede un nuovo accesso; nome ed email non interrompono il lavoro.
    const chiuse = ruolo !== u.ruolo || (unita || undefined) !== u.unita ? chiudiTuttePerUtente(id) : 0;
    const cambioMfa =
      mfaRichiesto !== undefined && ctx.livello === "completo" && mfaRichiesto !== u.mfaRichiesto;
    await ctx.registra(
      "configurazione",
      `Aggiornato l’account «${u.utente}» (${u.ruolo} → ${ruolo})` +
        (cambioMfa
          ? mfaRichiesto
            ? " — secondo fattore di nuovo richiesto"
            : " — secondo fattore tolto: basta la password"
          : ""),
      "utenti",
    );
    revalidatePath("/area-riservata", "layout");
    aggiorna();
    return { stato: "fatto", messaggio: "Account aggiornato." + (chiuse ? " Le sessioni aperte sono state chiuse: la persona deve rientrare." : "") };
  } catch (errore) { return comeEsito(errore); }
}
