"use server";

import { revalidatePath } from "next/cache";
import { albumPerIndirizzo, cambiaStatoAlbum } from "@/lib/album";
import { campiAttivitaDa, unitaPerCancello } from "@/lib/attivita";
import {
  aggiornaAttivita,
  attivitaPerId,
  cambiaStatoAttivita,
  eliminaAttivita,
} from "@/lib/attivita-store";
import { contesto, esitoNegato, ingresso, Negato } from "@/lib/auth/contesto";
import type { StatoAzione } from "@/lib/contenuti";
import { TUTTE_LE_UNITA, type UnitaKey } from "@/lib/data";
import { ErroreDatabase } from "@/lib/db/errori";
import { eFasciaFaq, type VoceFaq } from "@/lib/faq-contenuti";
import { salvaFaq } from "@/lib/faq-store";
import { portaVia } from "@/lib/foto/porta-via";
import { nascondiImmagine, registraImmagine, togliImmagine } from "@/lib/immagini-store";
import { campoPagina } from "@/lib/pagine-contenuti";
import { salvaTestiPagine } from "@/lib/pagine-store";
import {
  chiedeDiMostrare,
  type DatiFotografia,
  eTipoProposta,
  motivoDelRitiro,
  type TipoProposta,
} from "@/lib/proposte";
import { improntaProposta, prendiProposta, rimettiProposta } from "@/lib/proposte-store";
import { rigeneraPagineUnita } from "@/lib/rigenera";
import { registra } from "@/lib/registro-store";
import { slotDi } from "@/lib/slot-immagini";
import {
  dimenticaCopertina,
  fileCopertina,
  nascondiCopertina,
  registraCopertina,
} from "@/lib/unita-store";

/**
 * Approvare, rimandare o ritirare una proposta di `proposte`: un testo di Home o
 * Chi siamo, le domande frequenti, la fotografia di un riquadro, la copertina di
 * un'unità, la modifica, la cancellazione o il ritiro di un'attività pubblicata,
 * il ritiro di un album pubblicato. Le prepara il social media manager; le
 * decidono gestore e sviluppatore.
 *
 * Una sola azione per i quattro tipi, come `approvazioni/actions.ts` ne ha una
 * per album, documenti e attività: la decisione è lo stesso gesto, e quattro
 * azioni gemelle sarebbero quattro posti in cui dimenticare il cancello.
 *
 * ## Il cancello è quello di chi possiede il contenuto
 *
 * Nessuna riga nuova nella matrice. Un testo di pagina passa da `pagine`, la
 * fotografia di un riquadro dal cancello del suo posto (come in
 * `immagini/actions.ts`), una copertina da `unita-anagrafica`. Chi può
 * scrivere quella cosa direttamente può approvarla; chi la può solo proporre
 * no — e per questo l'approvazione pretende `completo`, non solo «passa»:
 * il social media manager su quelle righe ha `limitato`, e senza questa
 * condizione approverebbe da sé le proprie proposte. Un'attività passa da
 * `attivita` con la sua unità, e per approvarla serve anche `album-pubblica`,
 * la riga «Approvare e pubblicare» che decide anche le attività in revisione
 * (`decidi` in `approvazioni/actions.ts`): pubblicare è pubblicare.
 *
 * Rimandare invece basta che passi: per chi approva è rimandare, per chi ha
 * proposto è ritirare, e in entrambi i casi sul sito non cambia niente.
 *
 * ## Si approva quello che è stato guardato
 *
 * Come per album e attività (audit di sicurezza, BIZ-02): la scheda porta
 * l'impronta della proposta che mostrava, e se nel frattempo è stata sostituita
 * da una più nuova l'approvazione si ferma e la rimette dov'era.
 */

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

function comeEsito(errore: unknown): StatoAzione {
  if (errore instanceof Negato) return esitoNegato(errore);
  if (errore instanceof ErroreDatabase) {
    return { stato: "errore", messaggio: errore.message, codice: errore.codice };
  }
  throw errore;
}

/**
 * Il cancello di una proposta, e che cosa riguarda in parole.
 *
 * `null` se la chiave non nomina niente che esista: un posto tolto dal disegno,
 * un'unità che non c'è, un campo uscito dal catalogo.
 */
async function cancelloDi(tipo: TipoProposta, chiave: string) {
  if (tipo === "album") {
    // l'unica proposta su un album è il ritiro (M-1b): il cancello è quello
    // dell'album, e per approvarla serve anche `album-pubblica`, come qui sotto
    await ingresso("album-carica"); // prima della lettura: vedi `ingresso()`
    const a = await albumPerIndirizzo(chiave);
    if (!a) return null;
    const ctx = await contesto("album-carica", {
      unita: a.unita,
      descrizione: `album «${a.titolo}»`,
    });
    return { ctx, cosa: `il ritiro dell’album «${a.titolo}» (${chiave})`, unita: a.unita };
  }
  if (tipo === "attivita") {
    const id = Number(chiave);
    await ingresso("attivita"); // prima della lettura: vedi `ingresso()`
    const a = Number.isInteger(id) ? await attivitaPerId(id) : null;
    if (!a) return null;
    const unita = unitaPerCancello(a.unita);
    const ctx = await contesto("attivita", { unita, descrizione: `attività «${a.titolo}»` });
    return { ctx, cosa: `l’attività «${a.titolo}» (attività ${id})`, unita };
  }
  if (tipo === "pagina") {
    const campo = campoPagina(chiave);
    if (!campo) return null;
    const ctx = await contesto("pagine", { descrizione: `testo «${campo.label}»` });
    return { ctx, cosa: `il testo «${campo.label}»` };
  }
  if (tipo === "faq") {
    if (chiave !== "faq") return null;
    const ctx = await contesto("pagine", { descrizione: "domande frequenti" });
    return { ctx, cosa: "le domande frequenti" };
  }
  if (tipo === "immagine") {
    const slot = slotDi(chiave);
    // i ritratti non si propongono: sono persone, e passano da chi ha `referenti`
    if (!slot || slot.persona) return null;
    const dove = { descrizione: `immagine «${slot.nome}»` };
    const ctx = slot.unita
      ? await contesto("unita-scheda", { ...dove, unita: slot.unita as UnitaKey })
      : await contesto("pagine", dove);
    return { ctx, cosa: `l’immagine «${slot.nome}»`, unita: slot.unita };
  }
  const unita = chiave as UnitaKey;
  if (unita === "gruppo" || !TUTTE_LE_UNITA.includes(unita)) return null;
  const ctx = await contesto("unita-anagrafica", {
    unita,
    descrizione: `copertina dell’unità ${unita}`,
  });
  return { ctx, cosa: `la copertina di ${unita}`, unita };
}

/** Le pagine pubbliche e le schermate che una proposta di questo tipo tocca. */
function aggiorna(tipo: TipoProposta, chiave: string) {
  revalidatePath("/area-riservata/[ruolo]/[sezione]", "page");
  if (tipo === "album") {
    revalidatePath("/foto");
    revalidatePath(`/foto/${chiave}`);
    revalidatePath("/");
    return;
  }
  if (tipo === "attivita") {
    revalidatePath("/attivita");
    revalidatePath("/");
    return;
  }
  if (tipo === "faq") {
    revalidatePath("/contatti");
    return;
  }
  revalidatePath("/");
  revalidatePath("/chi-siamo");
  if (tipo === "immagine" || tipo === "copertina") {
    rigeneraPagineUnita();
    revalidatePath("/unita");
  }
}

/** Le misure di una fotografia proposta, lette dal JSON. Solleva se mancano. */
function fotografia(valore: string): DatiFotografia {
  const d = JSON.parse(valore) as Partial<DatiFotografia>;
  if (
    typeof d.tipo !== "string" ||
    typeof d.larghezza !== "number" ||
    typeof d.altezza !== "number"
  ) {
    throw new Error("proposta di fotografia senza misure");
  }
  return {
    tipo: d.tipo,
    larghezza: d.larghezza,
    altezza: d.altezza,
    descrizione: typeof d.descrizione === "string" ? d.descrizione : "",
  };
}

/**
 * Le domande frequenti di una proposta, ricontrollate.
 *
 * Erano già state controllate quando sono state proposte, una per una, da
 * `salvaDomande`. Si ricontrolla la forma lo stesso, a buon mercato: questo
 * JSON finisce in una pagina pubblica, e fra la proposta e l'approvazione è
 * passato da una tabella che qualcuno può aver toccato a mano.
 */
function domande(valore: string): VoceFaq[] {
  const elenco = JSON.parse(valore) as unknown;
  if (!Array.isArray(elenco)) throw new Error("proposta di domande che non è un elenco");
  return elenco.map((v: Partial<VoceFaq>) => {
    if (
      typeof v.domanda !== "string" ||
      typeof v.risposta !== "string" ||
      typeof v.fascia !== "string" ||
      !eFasciaFaq(v.fascia)
    ) {
      throw new Error("proposta di domande con una voce malformata");
    }
    return {
      domanda: v.domanda,
      risposta: v.risposta,
      fascia: v.fascia,
      ...(v.link ? { link: v.link } : {}),
    };
  });
}

/**
 * Applica una proposta presa: la scrive dove va, e porta via la fotografia che
 * sostituisce. I file si cancellano **dopo** la scrittura della riga, come in
 * ogni altro caricamento del sito: se la riga non si scrive, quella vecchia è
 * ancora online e il suo file deve esserci.
 */
async function applica(
  tipo: TipoProposta,
  chiave: string,
  valore: string,
  file: string | null,
  utente: string,
) {
  /*
   * Il ritiro riporta in bozza, e solo se il contenuto è ancora online: se nel
   * frattempo l'ha ritirato qualcun altro — o la revoca di un consenso —,
   * approvare non deve rimetterlo in un altro stato.
   */
  if (tipo === "album") {
    if (motivoDelRitiro(valore) === null) throw new Error("proposta su un album malformata");
    const a = await albumPerIndirizzo(chiave);
    if (!a) throw new Error("album che non c’è più");
    if (a.stato === "pubblicato") await cambiaStatoAlbum(chiave, "bozza", Date.now(), utente);
    return;
  }
  if (tipo === "attivita") {
    const id = Number(chiave);
    const richiesta = JSON.parse(valore) as { azione?: unknown; campi?: unknown };
    if (richiesta.azione === "ritira") {
      const a = await attivitaPerId(id);
      if (!a) throw new Error("attività che non c’è più");
      if (a.stato === "pubblicato") await cambiaStatoAttivita(id, "bozza", utente);
      return;
    }
    if (richiesta.azione === "elimina") {
      if (!(await eliminaAttivita(id, utente))) throw new Error("attività che non c’è più");
      return;
    }
    // ricontrollati: vedi `campiAttivitaDa`
    const campi =
      richiesta.azione === "modifica" ? campiAttivitaDa(richiesta.campi, TUTTE_LE_UNITA) : null;
    if (!campi) throw new Error("proposta di attività malformata");
    if (!(await aggiornaAttivita(id, campi, utente))) throw new Error("attività che non c’è più");
    return;
  }
  if (tipo === "pagina") {
    await salvaTestiPagine({ [chiave]: valore }, utente);
    return;
  }
  if (tipo === "faq") {
    await salvaFaq(domande(valore), utente);
    return;
  }
  if (tipo === "immagine") {
    // rimettere una fotografia nascosta: il file è già quello registrato
    if (chiedeDiMostrare({ valore, file })) {
      if (!(await nascondiImmagine(chiave, false))) throw new Error("immagine che non c’è più");
      return;
    }
    if (file === null) {
      const tolto = await togliImmagine(chiave);
      if (tolto) await portaVia(tolto);
      return;
    }
    const f = fotografia(valore);
    const precedente = await registraImmagine(
      chiave,
      file,
      f.tipo,
      { larghezza: f.larghezza, altezza: f.altezza },
      f.descrizione ?? "",
      utente,
    );
    if (precedente) await portaVia(precedente);
    return;
  }

  const unita = chiave as UnitaKey;
  if (chiedeDiMostrare({ valore, file })) {
    if (!(await nascondiCopertina(unita, false))) throw new Error("copertina che non c’è più");
    return;
  }
  if (file === null) {
    const tolta = await dimenticaCopertina(unita);
    if (tolta) await portaVia(tolta);
    return;
  }
  const f = fotografia(valore);
  const prima = await fileCopertina(unita);
  await registraCopertina(
    unita,
    file,
    f.tipo,
    { larghezza: f.larghezza, altezza: f.altezza },
    utente,
  );
  if (prima && prima !== file) await portaVia(prima);
}

export async function decidiPropostaSito(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const tipo = testo(formData, "tipo");
  const chiave = testo(formData, "chiave");
  const verso = testo(formData, "verso");
  const versione = testo(formData, "versione");

  if (!eTipoProposta(tipo))
    return { stato: "errore", messaggio: "Tipo di proposta non riconosciuto." };
  if (verso !== "approva" && verso !== "rimanda") {
    return { stato: "errore", messaggio: "Decisione non riconosciuta." };
  }
  const approva = verso === "approva";

  try {
    const cancello = await cancelloDi(tipo, chiave);
    if (!cancello) {
      return {
        stato: "errore",
        messaggio: "Questa proposta non riguarda niente che esista ancora.",
      };
    }
    const { ctx, cosa } = cancello;

    if (approva && ctx.livello !== "completo") {
      // non viene dal cancello, quindi lo scrive chi lo decide — con l'esito
      // giusto, come in `negaApprovazione` di `unita/actions.ts`
      await registra(
        ctx.sessione,
        "configurazione",
        `Rifiutata l’approvazione — ${cosa} — chi propone non approva`,
        "approvazioni",
        "rifiutato",
      );
      throw new Negato(
        "ruolo",
        tipo === "copertina"
          ? "unita-anagrafica"
          : tipo === "attivita"
            ? "attivita"
            : tipo === "album"
              ? "album-carica"
              : "pagine",
      );
    }

    // un'attività o il ritiro di un album li approva chi pubblica: il cancello
    // registra da sé il rifiuto
    if (approva && (tipo === "attivita" || tipo === "album")) {
      const unita = "unita" in cancello ? (cancello.unita as UnitaKey) : undefined;
      await contesto("album-pubblica", { unita, descrizione: cosa });
    }

    const presa = await prendiProposta(tipo, chiave);
    if (!presa) {
      return {
        stato: "errore",
        messaggio: "Questa proposta non c’è più: qualcun altro l’ha già decisa.",
      };
    }

    if (!approva) {
      // rimandare o ritirare: la proposta sparisce, e con lei la sua fotografia
      if (presa.file) await portaVia(presa.file);
      aggiorna(tipo, chiave);
      await ctx.registra(
        "contenuto",
        ctx.livello === "completo" ? `Proposta rimandata: ${cosa}` : `Proposta ritirata: ${cosa}`,
        "approvazioni",
      );
      return {
        stato: "fatto",
        messaggio:
          ctx.livello === "completo"
            ? "Rimandata. Sul sito non è cambiato niente."
            : "Proposta ritirata. Sul sito non è cambiato niente.",
      };
    }

    if (versione !== improntaProposta(presa)) {
      // se nel frattempo ne è arrivata una nuova, vince quella: la presa è
      // superata, e la sua fotografia non la nomina più nessuno (QA BUG-014)
      if (!(await rimettiProposta(presa)) && presa.file) await portaVia(presa.file);
      return {
        stato: "errore",
        messaggio:
          "La proposta è cambiata da quando avete aperto questa pagina: ricaricatela e " +
          "ricontrollatela prima di approvare.",
      };
    }

    try {
      await applica(tipo, chiave, presa.valore, presa.file, ctx.utente);
    } catch (e) {
      // il lavoro di chi l'ha preparata non si perde per un errore di chi approva.
      // Se intanto ne è arrivata una nuova, `rimettiProposta` la lascia stare; il
      // file della presa resta dov'è, perché `applica` potrebbe averlo già messo
      // online prima di cadere — se è orfano lo trova `orfani.mjs`.
      await rimettiProposta(presa);
      throw e;
    }

    aggiorna(tipo, chiave);
    // un ritiro non pubblica niente: nel registro è un contenuto tolto
    const ritiro = motivoDelRitiro(presa.valore) !== null;
    await ctx.registra(
      ritiro ? "contenuto" : "pubblicazione",
      // «il ritiro del» + «l’attività…» = «il ritiro dell’attività…»; per gli
      // album `cosa` dice già «il ritiro»
      `Proposta approvata: ${ritiro && tipo === "attivita" ? "il ritiro del" : ""}${cosa}` +
        (presa.autore ? ` (di ${presa.autore})` : ""),
      "approvazioni",
    );
    return {
      stato: "fatto",
      messaggio:
        motivoDelRitiro(presa.valore) !== null
          ? tipo === "album"
            ? "Approvato: l’album è tornato in bozza e non è più online."
            : "Approvato: l’attività è tornata in bozza e non è più nel calendario."
          : tipo === "attivita" && JSON.parse(presa.valore).azione === "elimina"
            ? "Approvato: l’attività è stata cancellata."
            : "Approvato: è online.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}
