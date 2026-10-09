"use server";

import { revalidatePath } from "next/cache";
import { contesto, esitoNegato, Negato, vaInCoda } from "@/lib/auth/contesto";
import type { StatoAzione } from "@/lib/contenuti";
import { ErroreDatabase } from "@/lib/db/errori";
import {
  DOMANDA_MAX,
  eFasciaFaq,
  ePaginaCollegabile,
  FAQ_MAX,
  LINK_CODA_MAX,
  LINK_TESTO_MAX,
  RISPOSTA_MAX,
  type VoceFaq,
} from "@/lib/faq-contenuti";
import { leggiFaq, salvaFaq } from "@/lib/faq-store";
import {
  CAMPI_PAGINE,
  type CampoPagina,
  inRighe,
  predefinitoDi,
} from "@/lib/pagine-contenuti";
import { leggiTestiPagine, salvaTestiPagine } from "@/lib/pagine-store";
import { prendiProposta, proponi } from "@/lib/proposte-store";

/**
 * I testi di Home e Chi siamo.
 *
 * Riga di matrice `pagine`, che il referente di unità non ha: sono i testi del sito, non
 * quelli della sua unità. Per gestore e sviluppatore nessuna coda — chi
 * scrive qui è chi approverebbe, e la coda serve a far guardare una modifica a
 * qualcuno che non è chi l'ha fatta. Per il social media manager sì, ed è
 * proprio quel caso: ogni campo che cambia aspetta in `proposte`, uno per uno,
 * così chi approva può prendere il titolo nuovo e lasciare la citazione.
 *
 * L'ambito **non si passa**, e per una volta è corretto: questi testi non
 * appartengono a nessuna unità, e `pagine` è `nessuno` per il referente di unità —
 * quindi il livello lo ferma prima che l'ambito conti. È la stessa situazione di
 * `identita`, e la differenza con `documenti`, dove l'ambito è obbligatorio, sta
 * tutta lì: là il referente di unità ha `limitato`, qui non ha niente.
 */

function comeEsito(errore: unknown): StatoAzione {
  if (errore instanceof Negato) return esitoNegato(errore);
  if (errore instanceof ErroreDatabase) {
    return { stato: "errore", messaggio: errore.message, codice: errore.codice };
  }
  throw errore;
}

/** Un testo come lo si confronta: a capo di Unix, senza spazi ai bordi. */
const normale = (t: string): string => t.replace(/\r\n?/g, "\n").trim();

/** Le schermate dell'area che mostrano questi testi, o che cosa aspetta. */
function aggiornaArea() {
  revalidatePath("/area-riservata/[ruolo]/[sezione]", "page");
}

/**
 * Rigenera le pagine che questi testi compongono.
 *
 * Home e Chi siamo, e nient'altro: a differenza dei contenuti d'unità questi
 * testi non compaiono in cinque posti. La ricerca legge lo store a ogni
 * richiesta e non ha bisogno di niente.
 */
function aggiornaSito() {
  revalidatePath("/");
  revalidatePath("/chi-siamo");
}

export async function salvaPagine(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  try {
    const ctx = await contesto("pagine", { descrizione: "testi delle pagine pubbliche" });

    /*
     * I valori si leggono dal catalogo, non dal `FormData`.
     *
     * È la stessa regola di `salvaScheda` in `unita/actions.ts`, e qui pesa di
     * più: `pagine_testi` contiene anche le chiavi `gruppo.*` — nome, marchio e
     * recapiti del gruppo — che stanno su un'**altra riga di matrice**.
     * Scorrere le chiavi inviate avrebbe aperto una porta laterale su
     * `identita` a chi ha soltanto `pagine`.
     */
    const valori: Partial<Record<CampoPagina, string>> = {};
    const troppoLunghi: string[] = [];

    for (const campo of CAMPI_PAGINE) {
      const grezzo = formData.get(campo.chiave);
      if (grezzo === null) continue;
      const valore = String(grezzo);

      if (valore.trim().length > campo.max) {
        troppoLunghi.push(campo.label);
        continue;
      }
      if (campo.tipo === "righe" && inRighe(valore).length > 3) {
        return {
          stato: "errore",
          campo: campo.chiave,
          messaggio:
            `«${campo.label}»: al massimo tre righe. Con più righe il titolo esce dal ` +
            "riquadro giallo, e su un telefono copre il resto della schermata.",
        };
      }
      valori[campo.chiave] = valore;
    }

    if (troppoLunghi.length > 0) {
      return {
        stato: "errore",
        messaggio:
          troppoLunghi.length === 1
            ? `«${troppoLunghi[0]}» è troppo lungo: accorciatelo e riprovate.`
            : `Questi campi sono troppo lunghi: ${troppoLunghi.join(", ")}.`,
      };
    }
    if (Object.keys(valori).length === 0) {
      return { stato: "errore", messaggio: "Non c’è niente da salvare." };
    }

    if (vaInCoda(ctx.sessione.r, ctx.livello)) {
      /*
       * Si propone solo quello che cambia. Il modulo manda dieci caselle e nove
       * sono invariate: metterle tutte in coda sarebbe chiedere a chi approva di
       * guardare nove non-modifiche — e di imparare a premere senza guardare.
       * Una casella svuotata vale il testo del progetto, come nello store.
       * Rimettere il testo di adesso ritira la proposta che c'era.
       */
      const attuali = await leggiTestiPagine();
      let inviati = 0;
      for (const [chiave, grezzo] of Object.entries(valori) as [CampoPagina, string][]) {
        const proposto = normale(grezzo);
        const efficace = proposto === "" ? normale(predefinitoDi(chiave)) : proposto;
        if (efficace === normale(attuali[chiave])) {
          await prendiProposta("pagina", chiave);
          continue;
        }
        await proponi("pagina", chiave, proposto, null, ctx.utente);
        inviati++;
      }

      aggiornaArea();
      await ctx.registra(
        "contenuto",
        `Testi delle pagine: ${inviati} ${inviati === 1 ? "campo proposto" : "campi proposti"}`,
        "pagine",
      );
      return {
        stato: "fatto",
        messaggio:
          inviati === 0
            ? "Niente da inviare: i testi sono uguali a quelli online."
            : `${inviati} ${inviati === 1 ? "modifica inviata" : "modifiche inviate"} ai referenti ` +
              "gruppo. Sul sito restano i testi di adesso finché non le approvano.",
      };
    }

    await salvaTestiPagine(valori, ctx.utente);
    aggiornaSito();
    revalidatePath("/area-riservata/gestore/pagine");
    revalidatePath("/area-riservata/sviluppatore/pagine");
    await ctx.registra(
      "contenuto",
      `Testi delle pagine: ${Object.keys(valori).length} campi salvati`,
      "pagine",
    );

    return { stato: "fatto", messaggio: "Salvato: i testi sono già online." };
  } catch (errore) {
    return comeEsito(errore);
  }
}

// ==========================================================================
// Le domande frequenti
// ==========================================================================

/**
 * Sostituisce l'elenco delle FAQ.
 *
 * Stessa riga di matrice dei testi delle pagine, `pagine`: le domande frequenti
 * sono il testo della pagina Contatti. Nessuna riga nuova per una cosa che
 * appartiene allo stesso permesso.
 *
 * L'elenco arriva come `domanda-0`, `risposta-0`, `fascia-0`, `link-0`,
 * `linkTesto-0`, `linkCoda-0`, e così via. L'ordine in pagina è l'ordine in cui
 * il modulo le manda, come per le persone d'unità.
 */
export async function salvaDomande(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  try {
    const ctx = await contesto("pagine", { descrizione: "domande frequenti" });

    const voci: VoceFaq[] = [];
    for (let i = 0; formData.has(`domanda-${i}`); i++) {
      const domanda = String(formData.get(`domanda-${i}`) ?? "").trim();
      if (domanda === "") continue;

      const risposta = String(formData.get(`risposta-${i}`) ?? "").trim();
      const fascia = String(formData.get(`fascia-${i}`) ?? "gruppo");
      const href = String(formData.get(`link-${i}`) ?? "").trim();
      const linkTesto = String(formData.get(`linkTesto-${i}`) ?? "").trim();
      const linkCoda = String(formData.get(`linkCoda-${i}`) ?? "").trim();

      if (domanda.length > DOMANDA_MAX) {
        return {
          stato: "errore",
          campo: `domanda-${i}`,
          messaggio: `La domanda ${i + 1} è troppo lunga: al massimo ${DOMANDA_MAX} caratteri.`,
        };
      }
      if (risposta === "") {
        return {
          stato: "errore",
          campo: `risposta-${i}`,
          messaggio: `Alla domanda ${i + 1} manca la risposta. Una domanda senza risposta in pagina si apre su un riquadro vuoto.`,
        };
      }
      if (risposta.length > RISPOSTA_MAX) {
        return {
          stato: "errore",
          campo: `risposta-${i}`,
          messaggio: `La risposta ${i + 1} è troppo lunga: al massimo ${RISPOSTA_MAX} caratteri.`,
        };
      }
      if (!eFasciaFaq(fascia)) {
        return { stato: "errore", messaggio: "Colore non riconosciuto." };
      }

      /*
       * Il collegamento: o tutto o niente, e l'indirizzo solo fra le pagine del
       * sito.
       *
       * `ePaginaCollegabile` confronta con l'elenco di `lib/nav.ts`, non con un
       * modello di indirizzo. Un `CHECK` nel database garantisce comunque che
       * sia un percorso interno, ma qui si può essere più stretti — e più
       * stretti è meglio: un collegamento che parte dal sito del gruppo si porta
       * dietro la fiducia del gruppo.
       */
      let link: VoceFaq["link"];
      if (href !== "") {
        if (!ePaginaCollegabile(href)) {
          return {
            stato: "errore",
            campo: `link-${i}`,
            messaggio: "Il collegamento può puntare solo a una pagina di questo sito.",
          };
        }
        if (linkTesto === "" || linkTesto.length > LINK_TESTO_MAX) {
          return {
            stato: "errore",
            campo: `linkTesto-${i}`,
            messaggio: `Alla domanda ${i + 1} serve il testo del collegamento, al massimo ${LINK_TESTO_MAX} caratteri.`,
          };
        }
        if (linkCoda.length > LINK_CODA_MAX) {
          return {
            stato: "errore",
            campo: `linkCoda-${i}`,
            messaggio: `La coda del collegamento ${i + 1} è troppo lunga.`,
          };
        }
        link = { testo: linkTesto, href, coda: linkCoda };
      }

      voci.push({ domanda, risposta, fascia, ...(link ? { link } : {}) });
    }

    if (voci.length > FAQ_MAX) {
      return {
        stato: "errore",
        messaggio: `Potete inserire al massimo ${FAQ_MAX} domande. Riducete l’elenco e riprovate.`,
      };
    }

    if (vaInCoda(ctx.sessione.r, ctx.livello)) {
      /*
       * L'elenco intero, come per le persone d'unità: togliere la terza domanda
       * di cinque non ha una riga in cui aspettare, e tre modifiche separate si
       * approverebbero in un ordine che conta. Si confronta nella stessa forma
       * in cui si scrive, così un elenco rimandato uguale ritira la proposta.
       */
      const inForma = (elenco: readonly VoceFaq[]) =>
        JSON.stringify(
          elenco.map((v) => ({
            domanda: v.domanda,
            risposta: v.risposta,
            fascia: v.fascia,
            ...(v.link
              ? { link: { testo: v.link.testo, href: v.link.href, coda: v.link.coda } }
              : {}),
          })),
        );
      const proposto = inForma(voci);
      if (proposto === inForma(await leggiFaq())) {
        await prendiProposta("faq", "faq");
        aggiornaArea();
        return {
          stato: "fatto",
          messaggio: "Niente da inviare: le domande sono uguali a quelle online.",
        };
      }

      await proponi("faq", "faq", proposto, null, ctx.utente);
      aggiornaArea();
      await ctx.registra(
        "contenuto",
        `Domande frequenti: proposto un elenco di ${voci.length} ${voci.length === 1 ? "domanda" : "domande"}`,
        "pagine",
      );
      return {
        stato: "fatto",
        messaggio:
          "Domande inviate ai gestori. Nella pagina Contatti restano quelle di adesso " +
          "finché non le approvano.",
      };
    }

    await salvaFaq(voci, ctx.utente);
    revalidatePath("/contatti");
    revalidatePath("/area-riservata/gestore/pagine");
    revalidatePath("/area-riservata/sviluppatore/pagine");
    await ctx.registra(
      "contenuto",
      `Domande frequenti: ${voci.length} ${voci.length === 1 ? "domanda" : "domande"}`,
      "pagine",
    );

    return {
      stato: "fatto",
      messaggio:
        voci.length === 0
          ? "Elenco svuotato: la pagina Contatti torna alle domande del progetto."
          : `Salvate ${voci.length} domande. Sono già online nella pagina Contatti.`,
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}
