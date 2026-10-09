"use server";

import { revalidatePath } from "next/cache";
import { contesto, esitoNegato, ingresso, Negato } from "@/lib/auth/contesto";
import type { StatoAzione } from "@/lib/contenuti";
import { labelDiUnita, TUTTE_LE_UNITA, type UnitaKey } from "@/lib/data";
import { ErroreDatabase } from "@/lib/db/errori";
import { cambiaStato as cambiaStatoRichiesta, perId } from "@/lib/gdpr-store";
import {
  cambiaGruppoInterno,
  cambiaQuota,
  cancellaRagazzo,
  ETICHETTA_QUOTA,
  type EsitoVerifica,
  iscrittoPerId,
  MODULO_MAX,
  provenienzaDelRagazzo,
  type Quota,
  QUOTE,
  registraConsenso,
  revocaConsenso,
  registraIscrizione,
  segnaModulo,
  togliIscrizione,
  verificaConsenso,
} from "@/lib/iscritti-store";

/**
 * Gli iscritti: anagrafica, consensi, quote.
 *
 * Tutte passano da `contesto("iscritti")`, che nella matrice è `limitato` per il
 * referente di unità — governa i propri, non quelli delle altre unità. L'unica
 * eccezione è la cancellazione dei dati di una persona, che passa da `gdpr`:
 * §6 del piano la assegna al solo sviluppatore.
 *
 * ## Perché ogni scrittura lascia una riga di registro
 *
 * Consensi e quote non sono contenuti editoriali. Il consenso è ciò su cui
 * poggia la pubblicazione di fotografie di minori, e la quota è un dato
 * economico di una famiglia: schema-decisions.md §3 riporta la decisione del
 * committente del 22 agosto 2026 — «ogni variazione dello stato quota produce
 * una voce di registro, con autore e orario, allo stesso titolo dei consensi».
 *
 * E la riga dice **da che cosa a che cosa**. «Modificata una riga di Elenco
 * iscritti» — quello che scriveva l'azione generica delle tabelle — non è un
 * audit trail: dice che qualcosa è cambiato, non che cosa.
 */

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

function comeEsito(errore: unknown): StatoAzione {
  if (errore instanceof Negato) return esitoNegato(errore);
  if (errore instanceof ErroreDatabase) {
    return { stato: "errore", messaggio: errore.message, codice: errore.codice };
  }
  // un errore di convalida dello store porta già un messaggio scritto per chi
  // legge: «Unità sconosciuta: castorini» è più utile di «errore del server»
  if (errore instanceof Error) return { stato: "errore", messaggio: errore.message };
  throw errore;
}

function aggiorna() {
  revalidatePath("/area-riservata", "layout");
}

/** L'iscrizione, più l'ambito nella forma che il cancello capisce. */
async function conPermesso(id: number) {
  // sessione e ruolo prima della lettura: vedi `ingresso()`
  await ingresso("iscritti");
  const i = iscrittoPerId(id);
  if (!i) return null;
  const ctx = await contesto("iscritti", {
    unita: i.unita,
    descrizione: `iscrizione di ${i.cognome} ${i.nome}`,
  });
  return { i, ctx };
}

// --------------------------------------------------------------------------

export async function nuovoIscritto(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const unitaScelta = testo(formData, "unita");
  if (!(TUTTE_LE_UNITA as readonly string[]).includes(unitaScelta)) {
    return { stato: "errore", campo: "unita", messaggio: "Scegliete l’unità." };
  }
  const anno = testo(formData, "anno");
  if (!/^\d{4}-\d{4}$/.test(anno)) {
    return { stato: "errore", campo: "anno", messaggio: "Scegliete l’anno sociale." };
  }

  const ragazzoGia = testo(formData, "ragazzo");
  const nome = testo(formData, "nome");
  const cognome = testo(formData, "cognome");

  if (ragazzoGia === "" && (nome === "" || cognome === "")) {
    return { stato: "errore", campo: "cognome", messaggio: "Servono nome e cognome." };
  }

  /*
   * Un ragazzo già in anagrafica porta con sé la sua unità.
   *
   * Dall'audit di sicurezza (AUTHZ-01): il cancello guardava solo l'unità di
   * destinazione, scelta dal modulo, e lo store solo che il ragazzo esistesse.
   * Un referente di unità poteva così iscrivere nella propria unità — e da lì leggere e
   * modificare — un ragazzo di un'altra. Ora si passa dal cancello due volte:
   * per l'unità dove lo si iscrive e per quella da cui viene, ricavata
   * dall'archivio. Un ragazzo senza iscrizioni non è di nessuna unità, e
   * collegarlo resta a chi ha l'ambito di gruppo.
   */
  const ragazzoId = ragazzoGia === "" ? undefined : Number(ragazzoGia);

  try {
    // l'anagrafica si consulta solo dopo sessione e ruolo: vedi `ingresso()`
    await ingresso("iscritti");
    const provenienza =
      ragazzoId !== undefined && Number.isInteger(ragazzoId) && ragazzoId > 0
        ? provenienzaDelRagazzo(ragazzoId)
        : undefined;
    if (ragazzoId !== undefined && !provenienza) {
      return { stato: "errore", messaggio: "Quel ragazzo non è in anagrafica." };
    }

    const ctx = await contesto("iscritti", {
      unita: unitaScelta as UnitaKey,
      descrizione: `iscrizione di ${cognome} ${nome}`.trim(),
    });
    if (provenienza) {
      await contesto("iscritti", {
        unita: provenienza.unita ?? "gruppo",
        descrizione: `iscrizione del ragazzo ${ragazzoId}`,
      });
    }

    const id = registraIscrizione({
      ragazzoId,
      nome: nome || undefined,
      cognome: cognome || undefined,
      natoIl: testo(formData, "natoIl") || undefined,
      unita: unitaScelta as UnitaKey,
      anno,
      gruppoInterno: testo(formData, "gruppoInterno") || undefined,
    });

    const i = iscrittoPerId(id);
    aggiorna();
    await ctx.registra(
      "iscritti",
      `Iscritto ${i?.cognome} ${i?.nome} in ${unitaScelta} per l’anno ${anno}`,
      "iscritti",
    );
    return {
      stato: "fatto",
      messaggio:
        "Iscrizione registrata. Il consenso alle immagini si registra a parte, " +
        "con la data in cui è stato firmato.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Registra o revoca il consenso alla pubblicazione delle immagini.
 *
 * La data si chiede sempre e non si mette «oggi» da sola: è la data in cui il
 * modulo è stato **firmato**, che quasi mai è il giorno in cui qualcuno lo
 * inserisce nel sito. Un consenso datato al giorno dell'inserimento è un
 * consenso che non si può dimostrare.
 */
export async function segnaConsenso(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isInteger(id)) return { stato: "errore", messaggio: "Iscrizione non trovata." };

  const concesso = testo(formData, "concesso") === "1";
  const data = testo(formData, "data");

  if (concesso && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return {
      stato: "errore",
      campo: "data",
      messaggio: "Serve la data in cui il modulo è stato firmato.",
    };
  }

  try {
    const p = await conPermesso(id);
    if (!p) return { stato: "errore", messaggio: "Quell’iscrizione non c’è più." };

    /*
     * La revoca passa da `revocaConsenso`, non da `registraConsenso(false)`.
     *
     * Le due non sono simmetriche, e la differenza è la fase 11: revocare deve
     * anche **ritirare dalla pubblicazione** gli album già online che di
     * conseguenza non potrebbero più esserlo. Il trigger impedisce di pubblicare
     * mentre un consenso manca; senza questo, la stessa regola valeva solo per
     * il futuro e restavano online le fotografie di chi aveva appena revocato.
     *
     * Le due operazioni stanno in una transazione sola dentro lo store: revoca
     * scritta e ritiro no sarebbe la combinazione peggiore — illecita e
     * invisibile, perché la schermata direbbe che tutto è a posto.
     */
    let ritirati: string[] = [];
    if (concesso) {
      if (!registraConsenso(id, true, data || undefined, p.ctx.utente)) {
        return { stato: "errore", messaggio: "Quell’iscrizione non c’è più." };
      }
    } else {
      const esito = revocaConsenso(id);
      if (!esito.ok) return { stato: "errore", messaggio: "Quell’iscrizione non c’è più." };
      ritirati = esito.ritirati;
    }

    aggiorna();
    // le pagine pubbliche degli album ritirati: senza, resterebbero servite da
    // una copia salvata anche dopo che il database li ha riportati in bozza
    for (const slug of ritirati) revalidatePath(`/foto/${slug}`);
    if (ritirati.length > 0) revalidatePath("/foto");

    await p.ctx.registra(
      "consenso",
      concesso
        ? `Consenso immagini registrato per ${p.i.cognome} ${p.i.nome} (firmato il ${data})`
        : `Consenso immagini REVOCATO per ${p.i.cognome} ${p.i.nome}` +
          (ritirati.length > 0
            ? ` — ritirati dalla pubblicazione: ${ritirati.join(", ")}`
            : " — nessun album pubblicato da ritirare"),
      "iscritti",
    );

    return {
      stato: "fatto",
      messaggio: concesso
        ? "Consenso registrato."
        : ritirati.length === 0
          ? "Consenso revocato: le fotografie di questo ragazzo non vanno pubblicate. " +
            "Nessun album pubblicato riguardava questa unità e quest’anno."
          : // l'elenco si accorcia: revocare un consenso può ritirare tutti gli
            // album pubblicati di quell'unità e di quell'anno, e venti indirizzi
            // in un messaggio non li legge nessuno. Il registro li ha tutti.
            `Consenso revocato. ${ritirati.length === 1 ? "Un album è" : `${ritirati.length} album sono`} ` +
            `${ritirati.length === 1 ? "stato ritirato" : "stati ritirati"} dalla pubblicazione ` +
            `e ${ritirati.length === 1 ? "torna" : "tornano"} in bozza ai referenti di unità: ` +
            `${ritirati.slice(0, 5).join(", ")}` +
            (ritirati.length > 5 ? ` e altri ${ritirati.length - 5}` : "") +
            ". Per rimetterli online serve il consenso, oppure la dichiarazione che " +
            "questo ragazzo non compare in quelle fotografie.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Dove sta il modulo di carta del consenso: «raccoglitore in sede, 2026-27».
 *
 * È quello che serve a chi fa la verifica a campione per trovarlo senza
 * telefonare (audit degli accessi, I-1). Facoltativo; lo scrive chi registra i
 * consensi, con lo stesso cancello.
 */
export async function segnaModuloConsenso(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isInteger(id)) return { stato: "errore", messaggio: "Iscrizione non trovata." };

  const dove = testo(formData, "modulo");
  if (dove.length > MODULO_MAX) {
    return {
      stato: "errore",
      campo: "modulo",
      messaggio: `Bastano poche parole: al massimo ${MODULO_MAX} caratteri.`,
    };
  }

  try {
    const p = await conPermesso(id);
    if (!p) return { stato: "errore", messaggio: "Quell’iscrizione non c’è più." };
    if (!segnaModulo(id, dove)) {
      return { stato: "errore", messaggio: "Prima va registrato il consenso." };
    }
    aggiorna();
    await p.ctx.registra(
      "consenso",
      `Modulo del consenso di ${p.i.cognome} ${p.i.nome}: «${dove || "non indicato"}»`,
      "iscritti",
    );
    return { stato: "fatto", messaggio: "Salvato." };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * L'esito della verifica a campione di un consenso: il modulo c'è, o no.
 *
 * Passa da `consensi-verifica` e non da `iscritti`: chi verifica non registra
 * consensi, e chi li registra non li verifica (lo controlla lo store). Un
 * modulo non trovato **non** revoca il consenso — può essere fuori posto, e la
 * revoca ritira gli album —: lo vede il referente di unità nel suo elenco, e il
 * registro lo tiene come consenso.
 */
export async function verificaModulo(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isInteger(id)) return { stato: "errore", messaggio: "Iscrizione non trovata." };
  const esito = testo(formData, "esito") as EsitoVerifica;
  if (esito !== "conforme" && esito !== "mancante") {
    return { stato: "errore", messaggio: "Esito non riconosciuto." };
  }

  try {
    await ingresso("consensi-verifica"); // prima della lettura: vedi `ingresso()`
    const i = iscrittoPerId(id);
    if (!i) return { stato: "errore", messaggio: "Quell’iscrizione non c’è più." };
    const ctx = await contesto("consensi-verifica", {
      descrizione: `consenso di ${i.cognome} ${i.nome}`,
    });

    const r = verificaConsenso(id, esito, ctx.utente);
    if (!r.ok) {
      return {
        stato: "errore",
        messaggio:
          r.perche === "sua"
            ? "Questo consenso l’avete registrato voi: lo verifica un’altra persona."
            : r.perche === "senza-consenso"
              ? "Il consenso nel frattempo è stato revocato: non c’è niente da verificare."
              : "Quell’iscrizione non c’è più.",
      };
    }
    revalidatePath("/area-riservata/[ruolo]/[sezione]", "page");
    await ctx.registra(
      "consenso",
      esito === "conforme"
        ? `Verificato il consenso di ${i.cognome} ${i.nome} (${labelDiUnita(i.unita)}): modulo trovato`
        : `Verificato il consenso di ${i.cognome} ${i.nome} (${labelDiUnita(i.unita)}): ` +
          "modulo NON trovato",
      "privacy",
    );
    return {
      stato: "fatto",
      messaggio:
        esito === "conforme"
          ? "Segnato: il modulo c’è."
          : "Segnato come non trovato. Il referente di unità lo vede accanto al nome, nel suo elenco.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/** Cambia la quota, e scrive nel registro da che cosa a che cosa. */
export async function segnaQuota(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  const quota = testo(formData, "quota") as Quota;
  if (!Number.isInteger(id)) return { stato: "errore", messaggio: "Iscrizione non trovata." };
  if (!QUOTE.includes(quota)) return { stato: "errore", messaggio: "Stato quota non valido." };

  try {
    const p = await conPermesso(id);
    if (!p) return { stato: "errore", messaggio: "Quell’iscrizione non c’è più." };
    if (p.i.quota === quota) return { stato: "fatto", messaggio: "Era già così." };

    const prima = p.i.quota;
    if (!cambiaQuota(id, quota)) {
      return { stato: "errore", messaggio: "Quell’iscrizione non c’è più." };
    }
    aggiorna();
    await p.ctx.registra(
      "iscritti",
      `Quota di ${p.i.cognome} ${p.i.nome}: da «${ETICHETTA_QUOTA[prima]}» a ` +
        `«${ETICHETTA_QUOTA[quota]}»`,
      "iscritti",
    );
    return { stato: "fatto", messaggio: "Quota aggiornata." };
  } catch (errore) {
    return comeEsito(errore);
  }
}

export async function segnaSquadra(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isInteger(id)) return { stato: "errore", messaggio: "Iscrizione non trovata." };

  try {
    const p = await conPermesso(id);
    if (!p) return { stato: "errore", messaggio: "Quell’iscrizione non c’è più." };

    const gruppo = testo(formData, "gruppoInterno");
    cambiaGruppoInterno(id, gruppo);
    aggiorna();
    await p.ctx.registra(
      "iscritti",
      `Squadra di ${p.i.cognome} ${p.i.nome}: «${gruppo || "nessuna"}»`,
      "iscritti",
    );
    return { stato: "fatto", messaggio: "Salvato." };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Toglie l'iscrizione di quest'anno. Il ragazzo resta in anagrafica.
 *
 * Serve a chi si ritira a metà anno. **Non** è la cancellazione dell'art. 17:
 * quella è `cancellaDatiRagazzo`, e passa da un'altra riga della matrice.
 */
export async function rimuoviIscrizione(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "id"));
  if (!Number.isInteger(id)) return { stato: "errore", messaggio: "Iscrizione non trovata." };

  try {
    const p = await conPermesso(id);
    if (!p) return { stato: "errore", messaggio: "Quell’iscrizione non c’è più." };

    if (!togliIscrizione(id)) {
      return { stato: "errore", messaggio: "Quell’iscrizione non c’è più." };
    }
    aggiorna();
    await p.ctx.registra(
      "iscritti",
      `Tolta l’iscrizione di ${p.i.cognome} ${p.i.nome} per l’anno ${p.i.anno}`,
      "iscritti",
    );
    return {
      stato: "fatto",
      messaggio:
        "Iscrizione tolta per quest’anno. I dati anagrafici restano, e gli anni " +
        "precedenti anche.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Cancella una persona e tutta la sua storia. Art. 17.
 *
 * Passa da `gdpr`, che nella matrice è del solo sviluppatore: §6 del piano
 * assegna `cancellaRagazzo` a lui. Non è diffidenza verso i referenti — è che una
 * cancellazione irreversibile su richiesta di una famiglia va fatta da chi può
 * anche verificare che la richiesta ci sia stata, e che la copia di sicurezza
 * non la riporti indietro.
 *
 * Nel registro resta che è avvenuta, con il nome di **chi l'ha eseguita** e non
 * di chi è stato cancellato: scriverci il nome del ragazzo vorrebbe dire
 * conservare in un altro posto proprio il dato che si è appena cancellato.
 */
export async function cancellaDatiRagazzo(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = Number(testo(formData, "ragazzo"));
  if (!Number.isInteger(id)) return { stato: "errore", messaggio: "Persona non trovata." };
  const idRichiesta = Number(testo(formData, "richiesta"));

  try {
    const ctx = await contesto("gdpr", { descrizione: "cancellazione di una persona" });

    /*
     * La doppia firma (audit degli accessi del 4 ottobre 2026, SoD-3).
     *
     * Cancellare i dati di un minore è irreversibile, e lo sviluppatore che lo
     * esegue ha le mani su tutto il resto — matrice, account, registro. Da qui
     * in poi lo fa solo dando seguito a una richiesta di cancellazione ancora
     * aperta, e aperta da **un'altra persona**: chi riceve la richiesta della
     * famiglia la registra, chi ha accesso al database la esegue. La richiesta
     * diventa «eseguita» nella stessa operazione, e il registro le lega.
     */
    const richiesta = Number.isInteger(idRichiesta) ? perId(idRichiesta) : null;
    if (
      !richiesta ||
      richiesta.diritto !== "cancellazione" ||
      (richiesta.stato !== "ricevuta" && richiesta.stato !== "in_corso")
    ) {
      return {
        stato: "errore",
        messaggio:
          "Serve una richiesta di cancellazione aperta, registrata nella sezione «Privacy».",
      };
    }
    if (richiesta.apertaDa === null || richiesta.apertaDa === ctx.utente) {
      return {
        stato: "errore",
        messaggio:
          "La richiesta l’avete aperta voi: a eseguire la cancellazione dev’essere un’altra " +
          "persona, o a registrare la richiesta il gestore.",
      };
    }

    const esito = cancellaRagazzo(id);
    if (!esito.cancellato) return { stato: "errore", messaggio: "Quella persona non c’è più." };
    cambiaStatoRichiesta(richiesta.id, "eseguita");

    aggiorna();
    await ctx.registra(
      "eliminazione",
      `Cancellati i dati di una persona (art. 17), su richiesta GDPR #${richiesta.id} ` +
        `aperta da ${richiesta.apertaDa}: ${esito.iscrizioni} ` +
        `${esito.iscrizioni === 1 ? "iscrizione cancellata" : "iscrizioni cancellate"}`,
      "iscritti",
    );
    return {
      stato: "fatto",
      messaggio:
        `Cancellata, insieme a ${esito.iscrizioni} ` +
        `${esito.iscrizioni === 1 ? "iscrizione" : "iscrizioni"}. ` +
        "Ricordate che le copie di sicurezza vanno oltre: la cancellazione è " +
        "completa quando scade la loro conservazione.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}
