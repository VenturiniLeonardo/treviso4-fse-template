"use server";

import { revalidatePath } from "next/cache";
import { scriviCaricato } from "@/lib/archivio";
import { contesto, esitoNegato, Negato } from "@/lib/auth/contesto";
import { immagineInCoda, nascondeSoltanto } from "@/lib/auth/decisione";
import { ErroreDatabase } from "@/lib/db/errori";
import { ErroreDerivate, generaDerivate, ripulisciOriginale } from "@/lib/foto/derivate";
import { contenitoreDi, ESTENSIONI, TIPI_MIME } from "@/lib/foto/formato";
import { portaVia } from "@/lib/foto/porta-via";
import {
  immagineDi,
  nascondiImmagine as scriviNascosta,
  registraImmagine,
  slotViviDi,
  togliImmagine,
} from "@/lib/immagini-store";
import { VALORE_MOSTRA } from "@/lib/proposte";
import { proponi } from "@/lib/proposte-store";
import { rigeneraPagineUnita } from "@/lib/rigenera";
import type { UnitaKey } from "@/lib/data";
import type { StatoAzione } from "@/lib/contenuti";

/**
 * Le fotografie dei posti fissi del disegno: caricamento, rimozione, e — dal 6
 * ottobre 2026 — nascondere e rimettere.
 *
 * Una sola coppia di azioni per tutti e diciotto i posti, invece di una coppia
 * per tipo di riquadro. Quello che cambia da posto a posto — chi lo può
 * toccare, che forma ha, dove si vede — sta nel catalogo
 * (`lib/slot-immagini.ts`), e queste due funzioni lo leggono.
 *
 * La lavorazione del file è la stessa del caricamento di una copertina di
 * unità, e non per pigrizia: sono lo stesso problema. L'originale si riscrive
 * **ripulito dei metadati** prima di finire in archivio — la rotta che le serve
 * ripiega sull'originale quando una derivata manca, e senza quella riscrittura
 * in quella finestra uscirebbero il modello del telefono e le coordinate GPS.
 */

/** 8 MB: sono immagini di pagina, non fotografie d'archivio da conservare. */
const PESO_MAX = 8 * 1024 * 1024;
/** Oltre questo lato non serve a niente: la derivata più grande è 1600. */
const LATO_MAX = 6000;

const POSTO_IGNOTO: StatoAzione = {
  stato: "errore",
  messaggio: "Questo posto non esiste più nel disegno del sito.",
};

/**
 * Il cancello, che dipende dal posto — e non è uno solo.
 *
 * **Nessuna riga nuova nella matrice.** Ogni immagine passa dal cancello della
 * sezione che possiede già quel contenuto, che è l'unico modo di non far
 * divergere due autorizzazioni sulla stessa cosa: se domani un gestore
 * toglie a un referente di unità la scheda della sua pagina, gli toglie anche la
 * fotografia che ci sta dentro, senza doversene ricordare.
 *
 *  - un **ritratto** è una persona, e le persone stanno in «Referenti e recapiti»:
 *    cancello `referenti`;
 *  - la **foto d'archivio** di un'unità è contenuto della sua pagina, come il
 *    motto e la storia: cancello `unita-scheda`, quello che un referente di unità ha
 *    `limitato` sulla propria;
 *  - i posti di **home e «Chi siamo»** sono contenuto di quelle due pagine:
 *    cancello `pagine`, lo stesso dei loro testi, che il referente di unità non ha
 *    affatto. Fino al 3 ottobre 2026 era `identita` — nome, marchio e recapiti
 *    del gruppo — e per i tre ruoli di allora era la stessa cosa: entrambe
 *    `completo` o entrambe `nessuno`. Con il social media manager non lo è più.
 *    A lui le fotografie delle pagine servono, il marchio del gruppo no, e
 *    aprirgli `identita` per arrivare alle prime gli avrebbe aperto il secondo.
 *    I **ritratti** dei gestori restano su `identita`: sono persone;
 *  - chi ha `limitato` nel senso del social media manager (`vaInCoda`)
 *    **propone**: la fotografia si lavora e si scrive come sempre, e aspetta in
 *    `proposte` che un gestore la guardi.
 *
 * `unita-anagrafica` sarebbe stato quello sbagliato, ed è quello che avevo
 * scritto per primo: è `nessuno` per un referente di unità, quindi la fotografia della
 * *sua* pagina l'avrebbe potuta caricare solo un gestore.
 */
async function permesso(chiave: string) {
  const slot = await slotViviDi(chiave);
  if (!slot) return { ok: false as const, esito: POSTO_IGNOTO };

  const dove = { descrizione: `immagine «${slot.nome}»` };

  if (slot.persona && slot.unita) {
    const ctx = await contesto("referenti", { ...dove, unita: slot.unita as UnitaKey });
    return { ok: true as const, ctx, slot };
  }
  if (slot.persona) {
    // i gestori non appartengono a un'unità: restano affare del gruppo
    const ctx = await contesto("identita", dove);
    return { ok: true as const, ctx, slot };
  }
  if (slot.unita) {
    const ctx = await contesto("unita-scheda", { ...dove, unita: slot.unita as UnitaKey });
    return { ok: true as const, ctx, slot };
  }
  const ctx = await contesto("pagine", dove);
  return { ok: true as const, ctx, slot };
}

/** Le pagine pubbliche che possono mostrare questa immagine. */
/**
 * La fotografia di questo posto va in coda invece che online?
 *
 * Per chi ha `limitato` sul posto: il social media manager e, dal 4 ottobre
 * 2026, il referente di unità sui riquadri della propria pagina (audit degli accessi,
 * M-3) — prima le sue fotografie andavano online subito, l'unica strada per
 * cui una fotografia arrivava sul sito senza passare dal gestore, che è chi
 * fa rispettare la regola dei volti. I ritratti no: non si propongono, li
 * carica solo chi ha `referenti` completo (vedi sotto), e toglierli è sempre subito.
 */
function inCoda(p: { ctx: { livello: "completo" | "limitato" }; slot: { persona?: unknown } }) {
  return immagineInCoda(p.ctx.livello) && !p.slot.persona;
}

function aggiorna(unita: string | null) {
  revalidatePath("/");
  revalidatePath("/chi-siamo");
  if (unita) rigeneraPagineUnita();
  revalidatePath("/area-riservata/[ruolo]/[sezione]", "page");
}

export async function caricaImmagine(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const chiave = String(formData.get("slot") ?? "");
  const descrizione = String(formData.get("descrizione") ?? "");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { stato: "errore", campo: "file", messaggio: "Scegliete una fotografia da caricare." };
  }
  if (file.size > PESO_MAX) {
    return {
      stato: "errore",
      campo: "file",
      messaggio:
        `La fotografia pesa ${Math.round(file.size / 1024 / 1024)} MB: il massimo è ` +
        `${PESO_MAX / 1024 / 1024} MB.`,
    };
  }

  try {
    const p = await permesso(chiave);
    if (!p.ok) return p.esito;

    /*
     * Il ritratto di una persona lo mette online un gestore.
     *
     * Dall'audit di sicurezza (BIZ-04): i nomi dei referenti passano dalla coda di
     * approvazione — `referenti` è `limitato` per il referente di unità proprio per questo —
     * ma il loro ritratto andava online subito, con il solo cancello della
     * scheda. Il referente di unità può ancora **togliere** un ritratto, che è il lato
     * sicuro; caricarlo è di chi ha la riga `referenti` completa.
     */
    if (p.slot.persona && p.ctx.livello !== "completo") {
      return {
        stato: "errore",
        campo: "file",
        messaggio:
          "Il ritratto di una persona lo carica un gestore: mandategli la " +
          "fotografia, insieme al consenso di chi vi compare.",
      };
    }

    const dati = Buffer.from(await file.arrayBuffer());

    // Il tipo dichiarato dal browser non fa fede: conta l'intestazione.
    const contenitore = contenitoreDi(dati);
    if (!contenitore) {
      return {
        stato: "errore",
        campo: "file",
        messaggio: "Il file non è una fotografia JPEG o PNG. Convertitelo e riprovate.",
      };
    }

    const adesso = Date.now();
    // il nome lo genera il server e porta la marca temporale: sostituire
    // un'immagine non lascia in cache quella di prima
    const nome = `immagine-${chiave.replace(/[^a-z0-9]+/gi, "-")}-${adesso}.${ESTENSIONI[contenitore]}`;

    let esito;
    try {
      esito = await generaDerivate(dati, nome);
    } catch (e) {
      // `ErroreDerivate` porta già una frase scritta per chi ha caricato
      if (e instanceof ErroreDerivate) {
        return { stato: "errore", campo: "file", messaggio: e.message };
      }
      throw e;
    }

    if (esito.larghezza > LATO_MAX || esito.altezza > LATO_MAX) {
      return {
        stato: "errore",
        campo: "file",
        messaggio:
          `La fotografia è ${esito.larghezza}×${esito.altezza}: il lato massimo è ${LATO_MAX} px.`,
      };
    }

    /*
     * L'originale ripulito, come per le copertine e per gli album. La funzione
     * è la stessa: tre strade che scrivono immagini in archivio, una sola che
     * decide che cosa ci finisce dentro.
     */
    const pulito = (await ripulisciOriginale(dati, contenitore)).dati;
    await scriviCaricato(nome, pulito);
    for (const d of esito.derivate) await scriviCaricato(d.nome, d.dati);

    if (inCoda(p)) {
      let sostituita: string | null;
      try {
        sostituita = await proponi(
          "immagine",
          chiave,
          JSON.stringify({
            tipo: TIPI_MIME[contenitore],
            larghezza: esito.larghezza,
            altezza: esito.altezza,
            descrizione: descrizione.trim(),
          }),
          nome,
          p.ctx.utente,
        );
      } catch (e) {
        await portaVia(nome);
        throw e;
      }
      // la proposta di prima per lo stesso posto: nessuno la guarderà più
      if (sostituita) await portaVia(sostituita);

      aggiorna(p.slot.unita);
      await p.ctx.registra("contenuto", `Proposta l’immagine «${p.slot.nome}»`, "immagini");
      return {
        stato: "fatto",
        messaggio:
          `«${p.slot.nome}» è stata inviata ai gestori. Sul sito resta quella di ` +
          "adesso finché non la approvano.",
      };
    }

    let precedente: string | null;
    try {
      precedente = await registraImmagine(
        chiave,
        nome,
        TIPI_MIME[contenitore] as string,
        { larghezza: esito.larghezza, altezza: esito.altezza },
        descrizione,
        p.ctx.utente,
      );
    } catch (e) {
      // la riga non c'è: si portano via subito i file appena scritti, invece di
      // lasciarli in archivio senza niente che li nomini
      await portaVia(nome);
      throw e;
    }

    if (precedente) await portaVia(precedente);

    aggiorna(p.slot.unita);
    await p.ctx.registra("contenuto", `Caricata l’immagine «${p.slot.nome}»`, "immagini");

    return { stato: "fatto", messaggio: `«${p.slot.nome}» è online.` };
  } catch (e) {
    if (e instanceof Negato) return esitoNegato(e);
    if (e instanceof ErroreDatabase) {
      return { stato: "errore", messaggio: "Non è stato possibile salvare. Riprovate." };
    }
    throw e;
  }
}

export async function rimuoviImmagine(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const chiave = String(formData.get("slot") ?? "");

  try {
    const p = await permesso(chiave);
    if (!p.ok) return p.esito;

    // il social media manager le fotografie le nasconde, non le elimina: il file
    // resta, e se va eliminato lo fa un gestore (6 ottobre 2026)
    if (nascondeSoltanto(p.ctx.sessione.r, p.ctx.livello)) return SOLO_NASCONDERE;

    // anche togliere è una modifica, e chi propone le fotografie propone anche di
    // toglierle. Un ritratto invece lo si toglie subito: togliere la fotografia
    // di una persona non mette online niente
    if (inCoda(p)) {
      if (!(await immagineDi(chiave))) {
        return { stato: "errore", messaggio: "In questo posto non c’è nessuna immagine." };
      }
      const sostituita = await proponi("immagine", chiave, "{}", null, p.ctx.utente);
      if (sostituita) await portaVia(sostituita);
      aggiorna(p.slot.unita);
      await p.ctx.registra(
        "contenuto",
        `Proposto di togliere l’immagine «${p.slot.nome}»`,
        "immagini",
      );
      return {
        stato: "fatto",
        messaggio:
          `Richiesta inviata ai gestori: «${p.slot.nome}» resta online finché non ` +
          "la approvano.",
      };
    }

    const file = await togliImmagine(chiave);
    if (!file) {
      return { stato: "errore", messaggio: "In questo posto non c’è nessuna immagine." };
    }
    await portaVia(file);

    aggiorna(p.slot.unita);
    await p.ctx.registra("contenuto", `Tolta l’immagine «${p.slot.nome}»`, "immagini");

    return {
      stato: "fatto",
      messaggio: `«${p.slot.nome}» è stata tolta: al suo posto torna il riquadro vuoto.`,
    };
  } catch (e) {
    if (e instanceof Negato) return esitoNegato(e);
    if (e instanceof ErroreDatabase) {
      return { stato: "errore", messaggio: "Non è stato possibile salvare. Riprovate." };
    }
    throw e;
  }
}

const SOLO_NASCONDERE: StatoAzione = {
  stato: "errore",
  messaggio:
    "Le fotografie non si eliminano da qui: nascondetela, e sparisce subito dal sito. " +
    "Se va eliminata del tutto, lo fa un gestore.",
};

/**
 * Nasconde la fotografia di un posto: sparisce subito dal sito, il file resta.
 *
 * Subito per tutti, social media manager compreso: togliere una fotografia dal
 * sito non mette online niente, ed è proprio il gesto che deve essere rapido —
 * una fotografia sbagliata si toglie adesso, non quando qualcuno guarda la coda.
 * I ritratti no: sono persone, e si tolgono da «Referenti» come sempre.
 */
export async function nascondiImmagine(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const chiave = String(formData.get("slot") ?? "");

  try {
    const p = await permesso(chiave);
    if (!p.ok) return p.esito;
    if (p.slot.persona) {
      return { stato: "errore", messaggio: "I ritratti non si nascondono: si tolgono da «Referenti»." };
    }
    const immagine = await immagineDi(chiave);
    if (!immagine) {
      return { stato: "errore", messaggio: "In questo posto non c’è nessuna immagine." };
    }
    if (immagine.nascosta) return { stato: "fatto", messaggio: "Era già nascosta." };

    if (!(await scriviNascosta(chiave, true))) {
      return { stato: "errore", messaggio: "Non è stato possibile nasconderla. Riprovate." };
    }
    aggiorna(p.slot.unita);
    await p.ctx.registra("contenuto", `Nascosta l’immagine «${p.slot.nome}»`, "immagini");
    return {
      stato: "fatto",
      messaggio:
        `«${p.slot.nome}» è nascosta: sul sito torna il riquadro vuoto. La fotografia resta ` +
        "qui, e si può rimettere.",
    };
  } catch (e) {
    if (e instanceof Negato) return esitoNegato(e);
    if (e instanceof ErroreDatabase) {
      return { stato: "errore", messaggio: "Non è stato possibile salvare. Riprovate." };
    }
    throw e;
  }
}

/**
 * Rimette sul sito una fotografia nascosta.
 *
 * Questo invece mette online qualcosa, quindi segue la regola di ogni altra
 * fotografia: chi propone (`immagineInCoda`, il social media manager e il referente
 * unità) chiede a un gestore, chi pubblica la rimette da sé.
 */
export async function mostraImmagine(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const chiave = String(formData.get("slot") ?? "");

  try {
    const p = await permesso(chiave);
    if (!p.ok) return p.esito;
    const immagine = await immagineDi(chiave);
    if (!immagine?.nascosta) {
      return { stato: "errore", messaggio: "In questo posto non c’è nessuna immagine nascosta." };
    }

    if (inCoda(p)) {
      const sostituita = await proponi("immagine", chiave, VALORE_MOSTRA, null, p.ctx.utente);
      if (sostituita) await portaVia(sostituita);
      aggiorna(p.slot.unita);
      await p.ctx.registra(
        "contenuto",
        `Proposto di rimettere l’immagine «${p.slot.nome}»`,
        "immagini",
      );
      return {
        stato: "fatto",
        messaggio:
          `Richiesta inviata ai gestori: «${p.slot.nome}» torna sul sito quando la ` +
          "approvano.",
      };
    }

    if (!(await scriviNascosta(chiave, false))) {
      return { stato: "errore", messaggio: "Non è stato possibile rimetterla. Riprovate." };
    }
    aggiorna(p.slot.unita);
    await p.ctx.registra("contenuto", `Rimessa l’immagine «${p.slot.nome}»`, "immagini");
    return { stato: "fatto", messaggio: `«${p.slot.nome}» è di nuovo sul sito.` };
  } catch (e) {
    if (e instanceof Negato) return esitoNegato(e);
    if (e instanceof ErroreDatabase) {
      return { stato: "errore", messaggio: "Non è stato possibile salvare. Riprovate." };
    }
    throw e;
  }
}
