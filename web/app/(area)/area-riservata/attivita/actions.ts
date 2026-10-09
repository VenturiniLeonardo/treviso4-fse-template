"use server";

import { revalidatePath } from "next/cache";
import {
  aggiornaAttivita,
  attivitaPerId,
  cambiaStatoAttivita,
  creaAttivita,
  eliminaAttivita,
  type AttivitaSalvata,
  creatoreAttivita,
} from "@/lib/attivita-store";
import {
  type CampiAttivita,
  dataValida,
  eTipoValido,
  LIMITI_ATTIVITA,
  tipoAmmessoPer,
  unitaPerCancello,
} from "@/lib/attivita";
import {
  contesto,
  type Contesto,
  esitoNegato,
  ingresso,
  Negato,
  puo,
  type Risorsa,
  vaInCoda,
} from "@/lib/auth/contesto";
import { eSuo } from "@/lib/auth/propri";
import type { Stato, StatoAzione } from "@/lib/contenuti";
import { TUTTE_LE_UNITA, type UnitaKey } from "@/lib/data";
import { ErroreDatabase } from "@/lib/db/errori";
import { MOTIVO_RITIRO_MAX, type RichiestaAttivita } from "@/lib/proposte";
import { prendiProposta, proponi, togliRitiro } from "@/lib/proposte-store";
import { fuPubblicato } from "@/lib/registro-store";

/**
 * Le attività del calendario: creare, modificare, mandare in revisione.
 *
 * Passano tutte da `contesto("attivita")`, che nella matrice è `limitato` per il
 * referente di unità e `completo` per gli altri due. «Limitato» vuol dire che l'ambito
 * conta, ed è la parte di questo file che merita di essere letta con attenzione:
 * vedi `ambitoDi`.
 *
 * ## Il social media manager, dal 6 ottobre 2026
 *
 * Tiene aggiornato il calendario al posto dei referenti di unità, quindi modifica e
 * cancella anche le attività degli altri — ma niente di quello che fa cambia il
 * calendario pubblico da sé (`vaInCoda`). Su un'attività pubblicata la modifica
 * e la cancellazione diventano una proposta (`proposte`, tipo `attivita`), e le
 * famiglie continuano a leggere quella di adesso finché un gestore non
 * decide. Le bozze e le attività in revisione invece le tocca direttamente: non
 * le vede nessuno, e per uscire passano comunque dalla coda. Cancella da sé
 * soltanto una bozza sua che non è mai stata online.
 *
 * Lo store non fa controlli di permesso e non deve farne: la stessa funzione la
 * chiamano le prove, lo script di importazione e queste azioni, e mettere il
 * cancello là dentro vorrebbe dire una sessione finta in ogni prova.
 */

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

/**
 * Traduce i due modi in cui un'operazione può non farsi.
 *
 * `Negato` viene dal cancello, `ErroreDatabase` dallo store. Tutto il resto si
 * rilancia: `redirect` e `notFound` di Next funzionano lanciando, e ingoiarli
 * qui li farebbe sparire in silenzio.
 */
function comeEsito(errore: unknown): StatoAzione {
  if (errore instanceof Negato) return esitoNegato(errore);
  if (errore instanceof ErroreDatabase) {
    return { stato: "errore", messaggio: errore.message, codice: errore.codice };
  }
  throw errore;
}

/**
 * L'ambito di un'attività, nella forma che il cancello capisce.
 *
 * La regola — e il perché un'attività di due unità non è di nessuna delle due —
 * sta in `unitaPerCancello`, in `lib/attivita.ts`, dove si può provare.
 */
function ambitoDi(a: AttivitaSalvata): Risorsa {
  return { unita: unitaPerCancello(a.unita), descrizione: `attività «${a.titolo}»` };
}

/** Le unità scelte nel form, ripulite da quelle che non esistono. */
function unitaDalForm(formData: FormData): UnitaKey[] {
  const scelte = formData
    .getAll("unita")
    .map((u) => String(u))
    .filter((u): u is UnitaKey => (TUTTE_LE_UNITA as readonly string[]).includes(u));
  // niente doppioni: due caselle con la stessa chiave produrrebbero
  // `u1,u1` nella colonna dell'ambito
  return [...new Set(scelte)];
}

function aggiorna() {
  revalidatePath("/attivita");
  revalidatePath("/area-riservata", "layout");
  revalidatePath("/");
}

/**
 * I campi comuni a creazione e modifica, già validati.
 *
 * La data arriva da un `<input type="date">`, quindi è già ISO — ma il campo si
 * può spedire a mano, e `creaAttivita` la rifiuterebbe con un errore che parla
 * di formati. Meglio dirlo qui, dove si sa che è un campo di un modulo.
 */
function campiDaForm(
  formData: FormData,
): { ok: true; campi: CampiAttivita } | { ok: false; esito: StatoAzione } {
  const titolo = testo(formData, "titolo");
  if (titolo === "") {
    return {
      ok: false,
      esito: { stato: "errore", campo: "titolo", messaggio: "Scrivete un titolo." },
    };
  }

  const data = testo(formData, "data");
  if (!dataValida(data)) {
    return {
      ok: false,
      esito: { stato: "errore", campo: "data", messaggio: "Scegliete una data." },
    };
  }

  const tipo = testo(formData, "tipo");
  if (!eTipoValido(tipo)) {
    return {
      ok: false,
      esito: { stato: "errore", campo: "tipo", messaggio: "Scegliete che cosa è." },
    };
  }

  const unita = unitaDalForm(formData);
  if (!tipoAmmessoPer(tipo, unita)) {
    return {
      ok: false,
      esito: {
        stato: "errore",
        campo: "tipo",
        messaggio:
          "L’attività di squadra è solo della fascia verde: spuntate l’unità 3, " +
          "l’unità 4 o tutte e due.",
      },
    };
  }

  const nota = testo(formData, "nota");
  const luogo = testo(formData, "luogo");
  const durata = testo(formData, "durata");
  const lunghezze = { titolo, nota, luogo, durata };
  const troppoLungo = (Object.keys(LIMITI_ATTIVITA) as (keyof typeof LIMITI_ATTIVITA)[]).find(
    (campo) => lunghezze[campo].length > LIMITI_ATTIVITA[campo],
  );
  if (troppoLungo) {
    return {
      ok: false,
      esito: {
        stato: "errore",
        campo: troppoLungo,
        messaggio: `Il campo «${troppoLungo}» è troppo lungo: al massimo ${LIMITI_ATTIVITA[troppoLungo]} caratteri.`,
      },
    };
  }

  return {
    ok: true,
    campi: { titolo, data, tipo, unita, nota, luogo, durata },
  };
}

/**
 * Crea un'attività: in revisione, o in bozza se chi la crea lo chiede
 * (`invio=bozza`, il secondo pulsante del modulo).
 *
 * L'ambito si controlla su quello che si **sta per** creare, non su quello che
 * esiste: senza, un referente di unità potrebbe creare un'attività di gruppo e poi
 * scoprire di non poterla più toccare. Peggio, l'avrebbe messa nel calendario di
 * tutti.
 */
export async function nuovaAttivita(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const letti = campiDaForm(formData);
  if (!letti.ok) return letti.esito;
  const campi = letti.campi;

  try {
    const ctx = await contesto("attivita", {
      unita: unitaPerCancello(campi.unita),
      descrizione: `attività «${campi.titolo}»`,
    });

    const id = await creaAttivita(campi, ctx.utente);
    // Il pulsante principale del modulo la manda subito in revisione. Prima
    // nasceva sempre in bozza e andava mandata con un secondo clic, dall'elenco:
    // chi non lo sapeva usciva credendo di averla inviata, e nella coda dei
    // gestori non arrivava niente (prova del 6 ottobre 2026).
    const inRevisione = testo(formData, "invio") !== "bozza";
    if (inRevisione) await cambiaStatoAttivita(id, "in-revisione", ctx.utente);
    aggiorna();
    await ctx.registra(
      "contenuto",
      inRevisione
        ? `Creata e mandata in revisione l’attività «${campi.titolo}»`
        : `Creata l’attività «${campi.titolo}»`,
      "attivita",
    );
    return {
      stato: "fatto",
      messaggio: inRevisione
        ? "Attività creata e mandata ai gestori: compare nella loro coda di " +
          `approvazione, e nel calendario pubblico quando l’approvano. (#${id})`
        : "Attività salvata in bozza: la vedete solo voi. Quando è pronta, " +
          `mandatela ai gestori con «Manda in revisione». (#${id})`,
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

export async function modificaAttivita(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isInteger(id)) {
    return { stato: "errore", messaggio: "Attività non trovata." };
  }

  const letti = campiDaForm(formData);
  if (!letti.ok) return letti.esito;
  const campi = letti.campi;

  try {
    await ingresso("attivita");
    const prima = await attivitaPerId(id);
    if (!prima) return { stato: "errore", messaggio: "Quest’attività non esiste più." };

    /*
     * Due cancelli, non uno.
     *
     * Il primo sull'attività com'è adesso — se no un referente di unità potrebbe
     * modificare quella di un'altra unità purché la sposti nella propria. Il
     * secondo su come diventerebbe: se no potrebbe prendere la propria e
     * regalarla al gruppo, o a un'altra unità.
     */
    const ctx = await contesto("attivita", ambitoDi(prima));

    await contesto("attivita", {
      unita: unitaPerCancello(campi.unita),
      descrizione: `attività «${campi.titolo}»`,
    });

    /*
     * Il social media manager, su un'attività pubblicata, propone.
     *
     * Ritirarla in revisione come per il referente di unità (qui sotto) l'avrebbe tolta
     * dal calendario delle famiglie a ogni virgola corretta, e il suo lavoro è
     * proprio correggere le attività degli altri. La modifica aspetta accanto a
     * quella online, e il gestore la vede come confronto prima/dopo.
     */
    if (vaInCoda(ctx.sessione.r, ctx.livello) && prima.stato === "pubblicato") {
      const richiesta: RichiestaAttivita = { azione: "modifica", campi };
      await proponi("attivita", String(id), JSON.stringify(richiesta), null, ctx.utente);
      aggiorna();
      await ctx.registra(
        "contenuto",
        `Proposta una modifica all’attività «${prima.titolo}» (attività ${id})`,
        "attivita",
      );
      return {
        stato: "fatto",
        messaggio:
          "Modifiche inviate ai gestori. Nel calendario pubblico resta la versione di " +
          "adesso finché non le approvano.",
      };
    }

    // Un'attività nel calendario pubblico, modificata da chi non pubblica,
    // torna ai gestori prima che la modifica entri: data, luogo e testo
    // sono ciò che le famiglie leggono (stessa regola delle fotografie, BIZ-01).
    const ritirata =
      prima.stato === "pubblicato" &&
      !(await puo("album-pubblica", { unita: unitaPerCancello(prima.unita) }));
    if (ritirata) await cambiaStatoAttivita(id, "in-revisione", ctx.utente);

    if (!(await aggiornaAttivita(id, campi, ctx.utente))) {
      return { stato: "errore", messaggio: "Quest’attività non esiste più." };
    }
    aggiorna();
    await ctx.registra(
      "contenuto",
      `Modificata l’attività «${campi.titolo}»` + (ritirata ? ", che torna in revisione" : ""),
      "attivita",
    );
    return {
      stato: "fatto",
      messaggio: ritirata
        ? "Modifiche salvate. Era nel calendario pubblico: torna ai gestori per " +
          "l’approvazione, e fino ad allora le famiglie non la vedono."
        : "Modifiche salvate.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Manda in revisione, oppure ritira in bozza.
 *
 * **Non pubblica.** Pubblicare è la coda di approvazione, che passa da
 * `album-pubblica` — la riga «Approvare e pubblicare» della matrice — e che un
 * referente di unità non ha. Se questa azione accettasse `pubblicato`, il ciclo di
 * approvazione lo si scavalcherebbe da qui.
 */
export async function inviaAttivita(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  const verso = testo(formData, "verso");

  if (verso !== "in-revisione" && verso !== "bozza") {
    return { stato: "errore", messaggio: "Passaggio non riconosciuto." };
  }
  if (!Number.isInteger(id)) {
    return { stato: "errore", messaggio: "Attività non trovata." };
  }

  try {
    await ingresso("attivita");
    const a = await attivitaPerId(id);
    if (!a) return { stato: "errore", messaggio: "Quest’attività non esiste più." };

    const ctx = await contesto("attivita", ambitoDi(a));

    /*
     * Ritirare un'attività pubblicata la toglie subito dal calendario delle
     * famiglie: per il social media manager è una decisione di chi pubblica,
     * come per gli album (audit degli accessi, M-1b). Per toglierla chiede di
     * cancellarla, e la richiesta va ai gestori.
     */
    if (verso === "bozza" && a.stato === "pubblicato" && vaInCoda(ctx.sessione.r, ctx.livello)) {
      return {
        stato: "errore",
        messaggio:
          "Un’attività pubblicata la ritirano i gestori: usate «Chiedi il ritiro», " +
          "dicendo perché. La richiesta arriva a loro.",
      };
    }

    if (!(await cambiaStatoAttivita(id, verso as Stato, ctx.utente))) {
      return { stato: "errore", messaggio: "Quest’attività non esiste più." };
    }
    // ritirata da chi può: una richiesta di ritiro in coda non ha più oggetto
    if (verso === "bozza") await togliRitiro("attivita", String(id));

    aggiorna();
    await ctx.registra(
      "contenuto",
      verso === "in-revisione"
        ? `Mandata in revisione l’attività «${a.titolo}»`
        : `Ritirata in bozza l’attività «${a.titolo}»`,
      "attivita",
    );
    return {
      stato: "fatto",
      messaggio:
        verso === "in-revisione"
          ? "Mandata ai gestori. Compare nella loro coda di approvazione."
          : "Tornata in bozza: potete rimetterci mano.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Il social media manager può cancellare da sé quest'attività?
 *
 * Solo una bozza **sua** che non è mai stata online: non l'ha vista nessuno, e
 * non è lavoro di altri. Tutto il resto lo chiede ai gestori (vedi
 * `rimuoviAttivita`). Per gli altri ruoli la domanda non si pone — `eSuo` dice
 * sempre sì — e restano le regole di sotto.
 */
function cancellaDaSe(ctx: Contesto, a: AttivitaSalvata): boolean {
  return (
    eSuo(ctx.sessione, ctx.livello, creatoreAttivita(a.id)) &&
    a.stato !== "pubblicato" &&
    !fuPubblicato([`(attività ${a.id})`, `l’attività «${a.titolo}»`])
  );
}

export async function rimuoviAttivita(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isInteger(id)) {
    return { stato: "errore", messaggio: "Attività non trovata." };
  }

  try {
    await ingresso("attivita");
    const a = await attivitaPerId(id);
    if (!a) return { stato: "errore", messaggio: "Quest’attività non esiste più." };

    const ctx = await contesto("attivita", ambitoDi(a));

    /*
     * Il social media manager chiede, invece di cancellare.
     *
     * Può cancellare le attività di chiunque (6 ottobre 2026), ma come ogni altra
     * sua modifica la cancellazione la decide un gestore: fino ad allora
     * l'attività resta dov'è, anche nel calendario pubblico. Senza questa coda
     * il lavoro di un referente di unità sparirebbe senza che nessuno lo veda — era il
     * rilievo A-4 dell'audit degli accessi, e resta vero.
     */
    if (vaInCoda(ctx.sessione.r, ctx.livello) && !cancellaDaSe(ctx, a)) {
      const richiesta: RichiestaAttivita = { azione: "elimina" };
      await proponi("attivita", String(id), JSON.stringify(richiesta), null, ctx.utente);
      aggiorna();
      await ctx.registra(
        "contenuto",
        `Chiesta la cancellazione dell’attività «${a.titolo}» (attività ${id})`,
        "attivita",
      );
      return {
        stato: "fatto",
        messaggio:
          "Richiesta inviata ai gestori: l’attività resta dov’è finché non la approvano.",
      };
    }

    /*
     * Un'attività pubblicata non si cancella da qui.
     *
     * Sparirebbe dal calendario delle famiglie senza che nessuno di quelli che
     * l'hanno pubblicata lo sappia. Si ritira prima — che è una decisione
     * visibile e reversibile — e poi si cancella.
     */
    if (a.stato === "pubblicato") {
      return {
        stato: "errore",
        messaggio:
          "È pubblicata: le famiglie la vedono nel calendario. Ritiratela in bozza, " +
          "poi si può cancellare.",
      };
    }

    /*
     * E un'attività che **è stata** pubblicata la cancella chi pubblica.
     *
     * Ritirarla resta di chiunque la possa modificare; cancellarla dopo averla
     * ritirata era la scorciatoia per togliere da soli ciò che era stato
     * approvato in due (audit di sicurezza, BIZ-03). Lo dice il registro.
     */
    if (
      fuPubblicato([`(attività ${id})`, `l’attività «${a.titolo}»`]) &&
      !(await puo("album-pubblica", { unita: unitaPerCancello(a.unita) }))
    ) {
      return {
        stato: "errore",
        messaggio: "Quest’attività è stata pubblicata: la cancella un gestore. Chiedete a loro.",
      };
    }

    if (!(await eliminaAttivita(id, ctx.utente))) {
      return { stato: "errore", messaggio: "Quest’attività non esiste più." };
    }
    // una modifica o una cancellazione proposta su quest'attività non riguarda
    // più niente: in coda resterebbe una voce che nessuno può decidere
    await prendiProposta("attivita", String(id));
    aggiorna();
    await ctx.registra("contenuto", `Cancellata l’attività «${a.titolo}»`, "attivita");
    return { stato: "fatto", messaggio: "Attività cancellata." };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Chiede ai gestori di ritirare dal calendario un'attività pubblicata.
 *
 * Del social media manager (audit degli accessi, M-1b), come per gli album:
 * ritirare toglie subito l'attività alle famiglie, e per lui è una decisione di
 * chi pubblica. La richiesta va in `proposte` — al posto di una modifica che
 * aspettasse già, perché ritirare la supera — e fino alla decisione l'attività
 * resta dov'è. Ritirare non è cancellare: approvata, torna in bozza.
 */
export async function chiediRitiroAttivita(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isInteger(id)) return { stato: "errore", messaggio: "Attività non trovata." };

  try {
    await ingresso("attivita");
    const a = await attivitaPerId(id);
    if (!a) return { stato: "errore", messaggio: "Quest’attività non esiste più." };

    const ctx = await contesto("attivita", ambitoDi(a));
    if (!vaInCoda(ctx.sessione.r, ctx.livello)) {
      return { stato: "errore", messaggio: "Potete ritirarla voi: usate «Ritira in bozza»." };
    }
    if (a.stato !== "pubblicato") {
      return {
        stato: "errore",
        messaggio: "Non è nel calendario pubblico: non c’è niente da ritirare.",
      };
    }

    const motivo = testo(formData, "motivo");
    if (motivo === "") {
      return {
        stato: "errore",
        campo: "motivo",
        messaggio: "Scrivete perché va ritirata: è quello che i gestori leggono.",
      };
    }
    if (motivo.length > MOTIVO_RITIRO_MAX) {
      return {
        stato: "errore",
        campo: "motivo",
        messaggio: `Il motivo è troppo lungo: al massimo ${MOTIVO_RITIRO_MAX} caratteri.`,
      };
    }

    const richiesta: RichiestaAttivita = { azione: "ritira", motivo };
    await proponi("attivita", String(id), JSON.stringify(richiesta), null, ctx.utente);
    aggiorna();
    await ctx.registra(
      "contenuto",
      `Chiesto il ritiro dell’attività «${a.titolo}» (attività ${id}): ${motivo.slice(0, 200)}`,
      "attivita",
    );
    return {
      stato: "fatto",
      messaggio:
        "Richiesta inviata ai gestori: l’attività resta nel calendario finché non decidono.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}
