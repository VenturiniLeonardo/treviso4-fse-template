"use server";

import { revalidatePath } from "next/cache";
import { scriviCaricato } from "@/lib/archivio";
import { contesto, esitoNegato, Negato, vaInCoda } from "@/lib/auth/contesto";
import { nascondeSoltanto } from "@/lib/auth/decisione";
import type { StatoAzione } from "@/lib/contenuti";
import { labelDiUnita, TUTTE_LE_UNITA, type UnitaKey } from "@/lib/data";
import { ErroreDatabase } from "@/lib/db/errori";
import { rigeneraPagineUnita } from "@/lib/rigenera";
import { registra } from "@/lib/registro-store";
import { ErroreDerivate, generaDerivate, ripulisciOriginale } from "@/lib/foto/derivate";
import { contenitoreDi, ESTENSIONI, TIPI_MIME } from "@/lib/foto/formato";
import { portaVia } from "@/lib/foto/porta-via";
import { VALORE_MOSTRA } from "@/lib/proposte";
import { proponi } from "@/lib/proposte-store";
import {
  campoUnita,
  CAMPI_ANAGRAFICA,
  CAMPI_UNITA,
  COPERTINA_LATO_MAX,
  COPERTINA_PESO_MAX,
  type CampoUnita,
  righeDaUnita,
  serveApprovazione,
  type TipoPersona,
} from "@/lib/unita-contenuti";
import {
  approvaPersone,
  approvaProposta,
  dimenticaCopertina,
  fileCopertina,
  nascondiCopertina as scriviCopertinaNascosta,
  registraCopertina,
  salvaAnagraficaUnita,
  type PersonaImmessa,
  proponiCampiUnita,
  proponiPersone,
  pubblicaPersone,
  rifiutaPersone,
  rifiutaProposta,
  salvaCampiUnita,
  unitaSalvataPerChiave,
} from "@/lib/unita-store";

/**
 * Scritture sui contenuti delle unità.
 *
 * ## Il «metà e metà», e dove sta la sua unica copia
 *
 * La decisione del 31 agosto 2026 divide i campi in due: i testi liberi vanno
 * online appena salvati, i recapiti e i nomi di persone passano
 * dall'approvazione del gestore. Qui **non c'è nessun elenco** di quali
 * sono: si chiede a `serveApprovazione()`, in `lib/unita-contenuti.ts`, che è la
 * stessa funzione che l'interfaccia usa per dire a chi scrive che cosa succederà
 * al suo salvataggio.
 *
 * È deliberato e vale la pena dirlo: un secondo elenco qui dentro sarebbe la
 * cosa più naturale del mondo da scrivere, e il modo in cui se ne accorgerebbe
 * qualcuno è **un recapito finito online senza che nessuno l'abbia guardato**.
 *
 * ## L'ambito non arriva mai dal modulo
 *
 * L'unità su cui si scrive arriva dal `FormData`, quindi è manomettibile — è
 * esattamente il caso che la fase 14.2 ha provato dal vivo sugli album. Il
 * cancello la confronta con quella della sessione: `contesto("unita-scheda", {
 * unita })` con `limitato` passa solo se coincidono. Un gestore ha
 * `completo` e attraversa tutte e sei.
 */

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

/** Traduce i due modi in cui un'operazione può non farsi. Come in `approvazioni`. */
function comeEsito(errore: unknown): StatoAzione {
  if (errore instanceof Negato) return esitoNegato(errore);
  if (errore instanceof ErroreDatabase) {
    return { stato: "errore", messaggio: errore.message, codice: errore.codice };
  }
  throw errore;
}

/**
 * Rigenera tutto ciò che mostra un'unità.
 *
 * Sono **cinque** pagine, non una, e dimenticarne una è il difetto più
 * probabile di questa fase: un salvataggio che non rigenera la pagina sembra non
 * aver funzionato, e chi lo prova lo rifà tre volte prima di chiamare qualcuno.
 *
 *     /unita/<slug>   la pagina dell'unità
 *     /unita          l'organigramma, con nome e conteggio
 *     /chi-siamo      lo staff di ogni unità
 *     /contatti       referente, ruolo e telefono
 *     /               la home, che porta i contatori
 *
 * La ricerca no: `costruisciIndice` gira a ogni richiesta e legge lo store, non
 * una copia salvata.
 *
 * ## La pagina dell'unità si rigenera per rotta, non per indirizzo
 *
 * `rigeneraPagineUnita()` (lib/rigenera.ts) e non un indirizzo solo. Le sei
 * pagine si rigenerano tutte, e costa poco perché sono sei — ma il motivo vero è
 * che chi chiama **non deve conoscere lo slug**: la coda di approvazione decide
 * su un'unità e un campo, non su un indirizzo, e passarle lo slug dal modulo
 * avrebbe voluto dire un campo nascosto in più da ricordarsi di mettere. Un
 * `revalidatePath` dimenticato è il difetto più probabile di questa fase, e si
 * previene togliendo l'occasione di dimenticarlo.
 */
function aggiornaSito() {
  rigeneraPagineUnita();
  revalidatePath("/unita");
  revalidatePath("/chi-siamo");
  revalidatePath("/contatti");
  revalidatePath("/");
}

/**
 * Le sezioni dell'area che mostrano contenuti d'unità o la coda.
 *
 * Non prende l'unità: le sezioni sono le stesse per tutte e sei — la vista
 * `referente` è una, e mostra l'unità di chi è entrato. Rigenerarle tutte
 * costa una lista di sei percorsi e toglie un argomento che qualcuno prima o
 * poi passerebbe sbagliato.
 */
function aggiornaArea() {
  // tutte le sezioni di tutti i ruoli: la coda del gestore, la scheda del
  // referente di unità, e le due del social media manager che mostrano che cosa aspetta
  revalidatePath("/area-riservata/[ruolo]/[sezione]", "page");
  revalidatePath("/area-riservata/referente/presentazione");
  revalidatePath("/area-riservata/gestore/unita");
  revalidatePath("/area-riservata/gestore/referenti");
  revalidatePath("/area-riservata/sviluppatore/pagine");
  revalidatePath("/area-riservata/gestore/approvazioni");
  revalidatePath("/area-riservata/sviluppatore/approvazioni");
}

/** L'unità indicata nel modulo, se è una delle sei. Mai «gruppo». */
function unitaDelModulo(formData: FormData): UnitaKey | null {
  const chiave = testo(formData, "unita") as UnitaKey;
  // «gruppo» è nell'elenco perché è la voce delle attività comuni, ma non è
  // un'unità e non ha una pagina: qui va rifiutata come un nome inventato
  if (chiave === "gruppo" || !TUTTE_LE_UNITA.includes(chiave)) return null;
  return chiave;
}

const NON_TROVATA: StatoAzione = {
  stato: "errore",
  messaggio: "Quest’unità non esiste.",
};

// ==========================================================================
// I campi della scheda
// ==========================================================================

/**
 * Salva i campi della scheda di un'unità.
 *
 * Un modulo solo, e due destinazioni: i testi liberi finiscono nella tabella,
 * i recapiti e i nomi in coda. Il messaggio di ritorno lo dice, perché «salvato»
 * senza altro farebbe credere a un referente di unità di aver pubblicato un recapito
 * che invece sta aspettando.
 */
export async function salvaScheda(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const unita = unitaDelModulo(formData);
  if (!unita) return NON_TROVATA;

  try {
    const ctx = await contesto("unita-scheda", {
      unita,
      descrizione: `scheda dell’unità ${unita}`,
    });

    /*
     * I valori si leggono dal catalogo, non dal `FormData`.
     *
     * Scorrere le chiavi inviate avrebbe accettato qualunque nome, e con esso
     * qualunque colonna che un domani finisse nella mappa dello store: è la
     * mass assignment di §15. Scorrendo `CAMPI_UNITA` si legge solo ciò che il
     * catalogo dichiara, e un campo in più nel modulo non è un campo in più nel
     * database.
     *
     * Un campo **assente** dal modulo non è un campo vuoto: si salta, invece di
     * azzerarlo. Serve perché la stessa azione serve moduli diversi — la scheda
     * del referente di unità non mostra gli stessi campi di quella del gestore — e
     * un modulo parziale non deve cancellare quello che non mostra.
     */
    const subito: Partial<Record<CampoUnita, string>> = {};
    const inCoda: Partial<Record<CampoUnita, string>> = {};
    const troppoLunghi: string[] = [];
    const personali: string[] = [];

    /*
     * Il social media manager propone **tutto**: per lui non c'è metà e metà,
     * ogni campo aspetta il gestore (`vaInCoda`). E propone soltanto i
     * testi (`contenuto` nel catalogo): recapiti e nomi dei referenti sono la riga
     * `referenti`, che per lui è `nessuno` — sono dati personali, e chi li pubblica
     * risponde dell'elenco — e il ritrovo è l'indirizzo dove le famiglie portano
     * i figli. La sua scheda non li mostra; questo è il controllo per chi li
     * spedisce a mano.
     */
    const tuttoInCoda = vaInCoda(ctx.sessione.r, ctx.livello);

    for (const campo of CAMPI_UNITA) {
      const grezzo = formData.get(campo.chiave);
      if (grezzo === null) continue;
      if (tuttoInCoda && !campo.contenuto) {
        personali.push(campo.label);
        continue;
      }
      const valore = String(grezzo).trim();

      if (valore.length > campo.max) {
        troppoLunghi.push(campo.label);
        continue;
      }
      if (tuttoInCoda || serveApprovazione(campo.chiave, ctx.livello)) {
        inCoda[campo.chiave] = valore;
      } else {
        subito[campo.chiave] = valore;
      }
    }

    if (personali.length > 0) {
      return {
        stato: "errore",
        messaggio:
          `${personali.join(", ")}: ritrovo, recapiti e nomi dei referenti li cambiano i referenti ` +
          "gruppo, da «Referenti».",
      };
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

    if (Object.keys(subito).length === 0 && Object.keys(inCoda).length === 0) {
      return { stato: "errore", messaggio: "Non c’è niente da salvare." };
    }

    if (Object.keys(subito).length > 0) await salvaCampiUnita(unita, subito, ctx.utente);
    const proposte =
      Object.keys(inCoda).length > 0
        ? await proponiCampiUnita(unita, inCoda, ctx.utente)
        : 0;

    aggiornaSito();
    aggiornaArea();

    const quantiSubito = Object.keys(subito).length;
    await ctx.registra(
      "contenuto",
      `Scheda di ${unita}: ${quantiSubito} ${quantiSubito === 1 ? "campo" : "campi"} salvati` +
        (proposte > 0 ? `, ${proposte} in attesa di approvazione` : ""),
      "unita",
    );

    if (tuttoInCoda) {
      // `proposte` conta anche quelle già in coda e rimandate uguali: il numero
      // giusto da dire è quante aspettano, non quante sono cambiate adesso
      return {
        stato: "fatto",
        messaggio:
          proposte === 0
            ? "Niente da inviare: i testi sono uguali a quelli online."
            : `Inviato ai gestori: ${proposte} ${proposte === 1 ? "modifica" : "modifiche"} ` +
              `alla scheda ${proposte === 1 ? "aspetta" : "aspettano"} la loro approvazione. ` +
              "Sul sito resta il testo di adesso.",
      };
    }

    return {
      stato: "fatto",
      messaggio:
        proposte === 0
          ? "Salvato: le modifiche sono già online."
          : quantiSubito === 0
            ? `${proposte} ${proposte === 1 ? "modifica inviata" : "modifiche inviate"} ai referenti ` +
              `gruppo. ${proposte === 1 ? "Compare" : "Compaiono"} sul sito quando ` +
              `${proposte === 1 ? "la approvano" : "le approvano"}.`
            : `Testi salvati e già online. ${proposte} ${proposte === 1 ? "modifica" : "modifiche"} ` +
              `— recapiti o nomi — ${proposte === 1 ? "aspetta" : "aspettano"} ` +
              "l’approvazione dei gestori.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

// ==========================================================================
// Gli elenchi di persone
// ==========================================================================

const TIPI: TipoPersona[] = ["responsabile", "staff", "storico"];

/**
 * Legge un elenco di persone dal modulo.
 *
 * Le righe arrivano come `nome-0`, `ruolo-0`, `periodo-0`, `nota-0`, `nome-1`, …
 * L'indice serve solo a tenerle insieme: l'ordine in pagina lo decide la
 * posizione nell'array, che è l'ordine in cui il modulo le manda.
 *
 * Una riga **senza nome** si scarta. Non è un errore da segnalare: è la riga
 * vuota che ogni editor di elenchi lascia in fondo, e trattarla come un errore
 * vorrebbe dire chiedere a chi salva di ripulire un modulo che si è sporcato da
 * solo.
 */
function personeDelModulo(formData: FormData): PersonaImmessa[] {
  const persone: PersonaImmessa[] = [];
  for (let i = 0; formData.has(`nome-${i}`); i++) {
    const nome = testo(formData, `nome-${i}`);
    if (nome === "") continue;
    persone.push({
      nome,
      ruolo: testo(formData, `ruolo-${i}`),
      periodo: testo(formData, `periodo-${i}`),
      nota: testo(formData, `nota-${i}`),
    });
  }
  return persone;
}

/**
 * Salva un elenco di persone: subito se si può pubblicare, in coda altrimenti.
 *
 * `referenti` è la riga di matrice, e per il referente di unità è `limitato` **con
 * approvazione**: sono nomi di persone pubblicati sul sito, e chi risponde della
 * privacy è chi ha l'elenco completo. Vedi il commento sulla riga `referenti` in
 * `lib/permessi.ts`.
 */
export async function salvaPersone(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const unita = unitaDelModulo(formData);
  if (!unita) return NON_TROVATA;

  const tipo = testo(formData, "tipo") as TipoPersona;
  if (!TIPI.includes(tipo)) {
    return { stato: "errore", messaggio: "Tipo di elenco non riconosciuto." };
  }

  try {
    const ctx = await contesto("referenti", { unita, descrizione: `${tipo} di ${unita}` });
    const persone = personeDelModulo(formData);

    if (persone.length > 40) {
      return { stato: "errore", messaggio: "Sono troppe: un elenco arriva a quaranta nomi." };
    }
    const lungo = persone.find((p) => p.nome.length > 80 || p.ruolo.length > 60);
    if (lungo) {
      return {
        stato: "errore",
        messaggio: `«${lungo.nome.slice(0, 30)}…»: nome o ruolo troppo lunghi.`,
      };
    }

    // `completo` pubblica, `limitato` propone. È la stessa distinzione dei campi,
    // presa dalla stessa fonte: il livello che il cancello ha riconosciuto.
    const pubblica = ctx.livello === "completo";
    if (pubblica) await pubblicaPersone(unita, tipo, persone, ctx.utente);
    else await proponiPersone(unita, tipo, persone, ctx.utente);

    aggiornaSito();
    aggiornaArea();
    await ctx.registra(
      "contenuto",
      `${tipo} di ${unita}: ${persone.length} ${persone.length === 1 ? "nome" : "nomi"}` +
        (pubblica ? " pubblicati" : " inviati in revisione"),
      "unita",
    );

    return {
      stato: "fatto",
      messaggio: pubblica
        ? "Elenco salvato: è già online."
        : "Elenco inviato ai gestori. Quello online resta quello di prima " +
          "finché non lo approvano.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

// ==========================================================================
// Un referente alla volta: la sezione «Referenti»
// ==========================================================================

/**
 * I due elenchi che la sezione «Referenti» tocca: chi guida l'unità e il suo staff.
 * Lo storico è un'altra cosa — un archivio di predecessori — e sta in «Unità».
 */
const TIPI_REFERENTI: TipoPersona[] = ["responsabile", "staff"];

/** L'elenco di adesso, quello che la pagina pubblica mostra. */
async function elencoCorrente(unita: UnitaKey, tipo: TipoPersona): Promise<PersonaImmessa[]> {
  const u = await unitaSalvataPerChiave(unita);
  return u ? righeDaUnita(u, tipo) : [];
}

const SOLO_COMPLETO: StatoAzione = {
  stato: "errore",
  messaggio:
    "Aggiungere un referente o spostarlo di unità lo fanno i gestori: i nomi dei referenti " +
    "sono dati personali pubblicati sul sito, e passano da chi ne risponde.",
};

/**
 * Salva **un** referente: lo aggiunge, ne corregge i dati, o lo sposta in un'altra
 * unità.
 *
 * Le tre cose sono lo stesso gesto — «questo referente, in questa unità, con questi
 * dati» — e arrivano dallo stesso modulo: `indice` assente vuol dire «nuovo»,
 * `unita` e `tipo` sono dove stava, `unitaNuova` e `tipoNuovo` dove deve stare.
 * Sotto, gli elenchi restano quelli di sempre (`unita_persone`, uno per unità e
 * tipo): questa azione legge quelli toccati, cambia una riga, e li ripubblica.
 *
 * ## Il controllo sul nome
 *
 * `nomeAtteso` è il nome che la pagina mostrava alla posizione `indice`. Se
 * non coincide, qualcun altro ha cambiato l'elenco nel frattempo e un indice è
 * soltanto un numero: salvare scriverebbe sulla persona sbagliata. Si risponde
 * di ricaricare, senza toccare niente.
 *
 * ## Chi può
 *
 * Solo `completo` sulla riga `referenti`, per **tutte** le unità coinvolte: spostare
 * un referente da una unità a un'altra tocca due elenchi, e il cancello lo chiede per
 * ciascuno. Un referente di unità (`limitato`) continua a proporre il proprio elenco dalla
 * sua schermata.
 */
export async function salvaReferente(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const nuovo = testo(formData, "indice") === "";
  const indice = Number(testo(formData, "indice"));
  const origine = testo(formData, "unita") as UnitaKey;
  const tipoOrigine = testo(formData, "tipo") as TipoPersona;
  const destinazione = testo(formData, "unitaNuova") as UnitaKey;
  const tipoDestinazione = testo(formData, "tipoNuovo") as TipoPersona;

  if (destinazione === "gruppo" || !TUTTE_LE_UNITA.includes(destinazione)) {
    return { stato: "errore", campo: "unitaNuova", messaggio: "Scegliete l’unità." };
  }
  if (!TIPI_REFERENTI.includes(tipoDestinazione)) {
    return { stato: "errore", campo: "tipoNuovo", messaggio: "Scegliete il ruolo del referente." };
  }
  if (!nuovo) {
    if (
      !Number.isInteger(indice) ||
      indice < 0 ||
      origine === ("gruppo" as UnitaKey) ||
      !TUTTE_LE_UNITA.includes(origine) ||
      !TIPI_REFERENTI.includes(tipoOrigine)
    ) {
      return { stato: "errore", messaggio: "Referente non riconosciuto." };
    }
  }

  const persona: PersonaImmessa = {
    nome: testo(formData, "nome"),
    ruolo: testo(formData, "ruolo"),
    periodo: testo(formData, "periodo"),
    nota: "",
  };
  if (persona.nome.length < 2 || persona.nome.length > 80) {
    return { stato: "errore", campo: "nome", messaggio: "Il nome va da 2 a 80 caratteri." };
  }
  if (persona.ruolo.length > 60) {
    return { stato: "errore", campo: "ruolo", messaggio: "Il ruolo sta in 60 caratteri." };
  }
  if (persona.periodo.length > 40) {
    return { stato: "errore", campo: "periodo", messaggio: "«Da quando» sta in 40 caratteri." };
  }

  try {
    const descrizione = `referente «${persona.nome}» (${destinazione})`;
    const ctxDest = await contesto("referenti", { unita: destinazione, descrizione });
    if (ctxDest.livello !== "completo") return SOLO_COMPLETO;
    if (!nuovo && origine !== destinazione) {
      const ctxOrig = await contesto("referenti", { unita: origine, descrizione });
      if (ctxOrig.livello !== "completo") return SOLO_COMPLETO;
    }

    if (nuovo) {
      const elenco = await elencoCorrente(destinazione, tipoDestinazione);
      if (elenco.length >= 40) {
        return { stato: "errore", messaggio: "Sono troppi: un elenco arriva a quaranta nomi." };
      }
      await pubblicaPersone(destinazione, tipoDestinazione, [...elenco, persona], ctxDest.utente);
    } else {
      const elenco = await elencoCorrente(origine, tipoOrigine);
      if (elenco[indice]?.nome !== testo(formData, "nomeAtteso")) {
        return {
          stato: "errore",
          messaggio: "L’elenco è cambiato nel frattempo: ricaricate la pagina e riprovate.",
        };
      }
      if (origine === destinazione && tipoOrigine === tipoDestinazione) {
        elenco[indice] = { ...persona, nota: elenco[indice].nota };
        await pubblicaPersone(origine, tipoOrigine, elenco, ctxDest.utente);
      } else {
        elenco.splice(indice, 1);
        const arrivo = await elencoCorrente(destinazione, tipoDestinazione);
        if (arrivo.length >= 40) {
          return { stato: "errore", messaggio: "Sono troppi: un elenco arriva a quaranta nomi." };
        }
        // partenza e arrivo sono due elenchi diversi (unità o tipo diversi): si
        // scrivono uno dopo l'altro, e l'ordine non cambia il risultato
        await pubblicaPersone(origine, tipoOrigine, elenco, ctxDest.utente);
        await pubblicaPersone(destinazione, tipoDestinazione, [...arrivo, persona], ctxDest.utente);
      }
    }

    aggiornaSito();
    aggiornaArea();
    await ctxDest.registra(
      "contenuto",
      nuovo
        ? `Aggiunto il referente «${persona.nome}» a ${destinazione}`
        : origine !== destinazione
          ? `Spostato il referente «${persona.nome}» da ${origine} a ${destinazione}`
          : `Modificato il referente «${persona.nome}» di ${destinazione}`,
      "unita",
    );
    return {
      stato: "fatto",
      messaggio: nuovo
        ? "Referente aggiunto: è già online."
        : origine !== destinazione
          ? `Spostato in ${labelDiUnita(destinazione)}: è già online.`
          : "Salvato: la modifica è già online.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Toglie un referente da un elenco.
 *
 * Stesso controllo di `salvaReferente` — `completo`, e il nome alla posizione
 * indicata. Se è l'ultimo dell'elenco la pagina pubblica torna ai nomi segnaposto
 * del progetto (un elenco vuoto vale «non compilato»): la schermata lo dice prima
 * di chiedere conferma.
 */
export async function togliReferente(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const unita = unitaDelModulo(formData);
  if (!unita) return NON_TROVATA;
  const tipo = testo(formData, "tipo") as TipoPersona;
  const indice = Number(testo(formData, "indice"));
  if (!TIPI_REFERENTI.includes(tipo) || !Number.isInteger(indice) || indice < 0) {
    return { stato: "errore", messaggio: "Referente non riconosciuto." };
  }

  try {
    const ctx = await contesto("referenti", { unita, descrizione: `togliere un referente da ${unita}` });
    if (ctx.livello !== "completo") return SOLO_COMPLETO;

    const elenco = await elencoCorrente(unita, tipo);
    const nome = elenco[indice]?.nome;
    if (!nome || nome !== testo(formData, "nomeAtteso")) {
      return {
        stato: "errore",
        messaggio: "L’elenco è cambiato nel frattempo: ricaricate la pagina e riprovate.",
      };
    }
    elenco.splice(indice, 1);
    await pubblicaPersone(unita, tipo, elenco, ctx.utente);

    aggiornaSito();
    aggiornaArea();
    await ctx.registra("contenuto", `Tolto il referente «${nome}» da ${unita}`, "unita");
    return { stato: "fatto", messaggio: `«${nome}» non compare più.` };
  } catch (errore) {
    return comeEsito(errore);
  }
}

// ==========================================================================
// La coda: approvare o rimandare
// ==========================================================================

/**
 * Decide su una proposta — un campo o un elenco di persone.
 *
 * Una sola azione per i due tipi, come `approvazioni/actions.ts` ne ha una per
 * album, documenti e attività: la decisione è la stessa gesto, e due azioni
 * gemelle sarebbero due posti in cui dimenticare il cancello.
 *
 * L'ambito **si passa**: `unita-scheda` e `referenti` sono `completo` per chi approva,
 * quindi non cambierebbe l'esito — ma passarlo mette l'unità nel registro, che è
 * ciò che serve a chi legge il log fra sei mesi.
 */
export async function decidiProposta(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const unita = unitaDelModulo(formData);
  if (!unita) return NON_TROVATA;

  const verso = testo(formData, "verso");
  if (verso !== "approva" && verso !== "rimanda") {
    return { stato: "errore", messaggio: "Decisione non riconosciuta." };
  }
  const approva = verso === "approva";
  const tipoPersone = testo(formData, "tipo") as TipoPersona;
  /*
   * I campi, **tutti** quelli della voce.
   *
   * La coda raggruppa le proposte di un'unità in una voce sola — «3 modifiche
   * alla scheda» — e fino al 3 ottobre 2026 il modulo ne spediva soltanto la
   * prima: «Approva e pubblica» approvava un campo, e gli altri due tornavano
   * in coda come se niente fosse. Con un referente di unità che proponeva un recapito
   * alla volta non si vedeva; il social media manager ne propone sei insieme.
   */
  const campi = [...new Set(formData.getAll("campo").map((c) => String(c).trim()))].filter(
    (c) => c !== "",
  );
  const campo = campi.join(", ");
  const perPersone = TIPI.includes(tipoPersone);

  if (!perPersone && (campi.length === 0 || campi.some((c) => !campoUnita(c)))) {
    return { stato: "errore", messaggio: "Questa proposta non riguarda un campo noto." };
  }

  try {
    const azione = perPersone ? "referenti" : "unita-scheda";
    const ctx = await contesto(azione, {
      unita,
      descrizione: perPersone ? `${tipoPersone} di ${unita}` : `campo «${campo}» di ${unita}`,
    });

    /*
     * Chi approva non è chi propone — e il cancello da solo non lo garantisce.
     *
     * Un referente di unità ha `limitato` su entrambe le righe, e sulla **propria**
     * unità `copre()` lo lascia passare: senza questa riga potrebbe approvare la
     * proposta che ha appena scritto, e la coda diventerebbe un giro a vuoto.
     * L'approvazione è un permesso di pubblicare, e quello è `completo`.
     */
    if (ctx.livello !== "completo") {
      throw await negaApprovazione(ctx, unita, perPersone ? tipoPersone : campo);
    }

    let fatto: boolean;
    if (perPersone) {
      fatto = approva
        ? await approvaPersone(unita, tipoPersone, ctx.utente)
        : await rifiutaPersone(unita, tipoPersone);
    } else {
      // uno per uno, e basta che uno ci fosse: se qualcun altro ne ha già
      // deciso una parte, il resto si decide lo stesso
      fatto = false;
      for (const c of campi) {
        const questo = approva
          ? await approvaProposta(unita, c, ctx.utente)
          : await rifiutaProposta(unita, c);
        fatto = fatto || questo;
      }
    }

    if (!fatto) {
      return {
        stato: "errore",
        messaggio: "Questa proposta non c’è più: qualcun altro l’ha già decisa.",
      };
    }

    aggiornaSito();
    aggiornaArea();

    const cosa = perPersone
      ? `l’elenco «${tipoPersone}» di ${unita}`
      : campi.length === 1
        ? `il campo «${campo}» di ${unita}`
        : `i campi «${campo}» di ${unita}`;
    await ctx.registra(
      approva ? "pubblicazione" : "contenuto",
      approva
        ? `${!perPersone && campi.length > 1 ? "Approvati" : "Approvato"} ${cosa}`
        : `Rimandata la proposta su ${cosa}`,
      "approvazioni",
    );

    return {
      stato: "fatto",
      messaggio: approva
        ? "Approvato: è online."
        : "Rimandato a chi l’ha proposto. Quello che era online non è cambiato.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Registra il rifiuto di un'auto-approvazione e restituisce l'errore.
 *
 * Si registra **prima** di sollevare, per la stessa ragione per cui lo fa il
 * cancello: sollevare interrompe, e un rifiuto che non finisce nel log è
 * proprio il caso in cui il log serviva. E questo rifiuto non viene dal
 * cancello — è una regola di questa azione — quindi se non lo scrivessimo qui
 * non lo scriverebbe nessuno.
 */
async function negaApprovazione(
  ctx: Awaited<ReturnType<typeof contesto>>,
  unita: UnitaKey,
  cosa: string,
): Promise<Negato> {
  /*
   * `registra` diretta, non `ctx.registra`: quella scrive sempre con esito
   * `ok`, perché è legata alle operazioni riuscite. Un rifiuto scritto con
   * `ok` finisce nel registro come una riga il cui testo dice «Rifiutata…» ma
   * il cui esito dice il contrario — e chi filtra il registro per esito non la
   * trova. Difetto trovato nella fase 14.9, corretto in entrambi i posti che
   * lo avevano.
   */
  await registra(
    ctx.sessione,
    "configurazione",
    `Rifiutata l’approvazione di «${cosa}» (unità ${unita}) — chi propone non approva`,
    "approvazioni",
    "rifiutato",
  );
  return new Negato("ruolo", "referenti");
}

// ==========================================================================
// L'anagrafica, e la fotografia di copertina
// ==========================================================================

/**
 * Salva nome, fascia d'età, iscritti e sigla di un'unità.
 *
 * Riga di matrice `unita-anagrafica`, che il referente di unità **non** ha: è l'identità
 * con cui l'unità compare nel gruppo, non un testo che la racconta. Il perché sta
 * nel commento su quella riga in `lib/permessi.ts`.
 *
 * Non passa da `salvaCampiUnita` e non potrebbe: quella filtra su `COLONNA_DI`,
 * dove `nome` non c'è. Sono due funzioni e due mappe di colonne separate, così
 * la barriera fra i due permessi dipende da quale funzione si chiama — che si
 * vede in revisione — e non da un elenco di campi ammessi che si può dimenticare.
 */
export async function salvaAnagrafica(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const unita = unitaDelModulo(formData);
  if (!unita) return NON_TROVATA;

  try {
    const ctx = await contesto("unita-anagrafica", {
      unita,
      descrizione: `anagrafica dell’unità ${unita}`,
    });

    /*
     * Il social media manager ha questa riga per la sola copertina (vedi il
     * commento su `unita-anagrafica` in `lib/permessi.ts`). Nome, età, iscritti
     * e sigla non sono contenuto: sono come l'unità compare nel gruppo, e non
     * si mettono in coda — si dice chi li cambia.
     */
    if (vaInCoda(ctx.sessione.r, ctx.livello)) {
      return {
        stato: "errore",
        messaggio:
          "Nome, fascia d’età, iscritti e sigla li cambia un gestore. Da qui si " +
          "propone la fotografia di copertina.",
      };
    }

    const valori: { nome?: string; eta?: string; sigla?: string; iscritti?: string } = {};
    for (const campo of CAMPI_ANAGRAFICA) {
      const grezzo = formData.get(campo.chiave);
      if (grezzo === null) continue;
      const valore = String(grezzo).trim();
      if (valore.length > campo.max) {
        return {
          stato: "errore",
          campo: campo.chiave,
          messaggio: `«${campo.label}» è troppo lungo: al massimo ${campo.max} caratteri.`,
        };
      }
      valori[campo.chiave] = valore;
    }

    if (valori.nome !== undefined && valori.nome.length < 3) {
      return {
        stato: "errore",
        campo: "nome",
        messaggio:
          valori.nome === ""
            ? "Il nome non si può svuotare: è quello con cui l’unità compare in ogni pagina."
            : "Il nome è troppo corto.",
      };
    }

    /*
     * Il numero si verifica qui, dove si può spiegare.
     *
     * La colonna è `INTEGER` con un `CHECK` che vuole `>= 0`, e lo `STRICT` del
     * database rifiuterebbe una stringa — ma con un errore che parla di tipi
     * SQLite, a un gestore che ha scritto «quaranta» nella casella. Meglio
     * dirglielo qui.
     */
    if (valori.iscritti !== undefined && valori.iscritti !== "") {
      const n = Number(valori.iscritti);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        return {
          stato: "errore",
          campo: "iscritti",
          messaggio: "Gli iscritti sono un numero intero, zero compreso. Vuoto = quello del progetto.",
        };
      }
    }

    if (Object.keys(valori).length === 0) {
      return { stato: "errore", messaggio: "Non c’è niente da salvare." };
    }

    await salvaAnagraficaUnita(unita, valori, ctx.utente);
    aggiornaSito();
    aggiornaArea();
    await ctx.registra("contenuto", `Anagrafica di ${unita} aggiornata`, "unita");

    return { stato: "fatto", messaggio: "Salvato: la modifica è online su tutto il sito." };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Carica la fotografia di copertina di un'unità.
 *
 * ## L'ordine, che conta
 *
 *     1. si legge il file e si verifica che sia un'immagine
 *     2. `generaDerivate` produce i tre WebP **senza metadati**
 *     3. si scrivono originale e derivate su disco
 *     4. si scrive la riga
 *     5. si portano via i file della copertina precedente
 *
 * Il passo 3 prima del 4 perché §18 vieta una transazione aperta durante
 * un'operazione su filesystem, e perché se il passo 4 fallisce restano file
 * senza riga — spazio occupato — invece di una riga senza file, che in cima alla
 * pagina di un'unità è un riquadro rotto. Il passo 5 **dopo** il commit, per la
 * ragione opposta: cancellare dentro una transazione significherebbe, in caso di
 * annullamento, aver perso i file e riavuto la riga vecchia.
 *
 * ## Perché sincrono e non nella coda dei lavori
 *
 * Le fotografie degli album passano dalla coda (`lavori`) perché arrivano a
 * centinaia e la conversione va fatta una alla volta. Qui l'immagine è **una per
 * unità**, sei in tutto, e si sostituisce una volta all'anno: una coda avrebbe
 * significato un tipo di lavoro nuovo, una migrazione per il `CHECK` su
 * `lavori.tipo`, e una schermata che dice «la copertina sarà pronta fra poco» —
 * per un'attesa di due secondi. Chi carica vede subito se il file va bene, che
 * è il ricavo vero.
 */
export async function caricaCopertina(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const unita = unitaDelModulo(formData);
  if (!unita) return NON_TROVATA;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { stato: "errore", campo: "file", messaggio: "Scegliete una fotografia da caricare." };
  }
  if (file.size > COPERTINA_PESO_MAX) {
    return {
      stato: "errore",
      campo: "file",
      messaggio:
        `La fotografia pesa ${Math.round(file.size / 1024 / 1024)} MB: il massimo è ` +
        `${COPERTINA_PESO_MAX / 1024 / 1024} MB.`,
    };
  }

  try {
    const ctx = await contesto("unita-anagrafica", {
      unita,
      descrizione: `copertina dell’unità ${unita}`,
    });

    const dati = Buffer.from(await file.arrayBuffer());

    // Il tipo dichiarato dal browser non fa fede: conta l'intestazione del file.
    const contenitore = contenitoreDi(dati);
    if (!contenitore) {
      return {
        stato: "errore",
        campo: "file",
        messaggio: "Il file non è una fotografia JPEG o PNG. Convertitelo e riprovate.",
      };
    }

    const adesso = Date.now();
    const nome = `copertina-${unita}-${adesso}.${ESTENSIONI[contenitore]}`;

    let esito;
    try {
      esito = await generaDerivate(dati, nome);
    } catch (e) {
      // `ErroreDerivate` porta già una frase scritta per chi ha caricato: è lì
      // che vive la spiegazione dell'HEIC dell'iPhone, e riscriverla qui
      // vorrebbe dire tenerne due copie
      if (e instanceof ErroreDerivate) {
        return { stato: "errore", campo: "file", messaggio: e.message };
      }
      throw e;
    }

    if (esito.larghezza > COPERTINA_LATO_MAX || esito.altezza > COPERTINA_LATO_MAX) {
      return {
        stato: "errore",
        campo: "file",
        messaggio:
          `La fotografia è ${esito.larghezza}×${esito.altezza}: il lato massimo è ` +
          `${COPERTINA_LATO_MAX} px.`,
      };
    }

    /*
     * L'originale si scrive **ripulito**, non come è arrivato: vedi
     * `ripulisciOriginale`, che è la stessa funzione usata dal caricamento
     * delle fotografie degli album. Era una `sharp(...)` scritta qui, e le due
     * strade non facevano la stessa cosa — la copertina veniva ripulita, le
     * fotografie dei ragazzi no.
     */
    const pulito = (await ripulisciOriginale(dati, contenitore)).dati;

    await scriviCaricato(nome, pulito);
    for (const d of esito.derivate) await scriviCaricato(d.nome, d.dati);

    /*
     * Il social media manager propone: la fotografia è già lavorata e in
     * archivio, e aspetta in `proposte` che un gestore la guardi. Quella
     * online non si muove. Approvare sarà spostare un nome in una riga.
     */
    if (vaInCoda(ctx.sessione.r, ctx.livello)) {
      let sostituita: string | null;
      try {
        sostituita = await proponi(
          "copertina",
          unita,
          JSON.stringify({
            tipo: TIPI_MIME[contenitore],
            larghezza: esito.larghezza,
            altezza: esito.altezza,
          }),
          nome,
          ctx.utente,
        );
      } catch (e) {
        await portaVia(nome);
        throw e;
      }
      if (sostituita) await portaVia(sostituita);

      aggiornaArea();
      await ctx.registra(
        "contenuto",
        `Proposta la copertina di ${unita} (${esito.larghezza}×${esito.altezza})`,
        "unita",
      );
      return {
        stato: "fatto",
        messaggio:
          "Copertina inviata ai gestori. In cima alla pagina dell’unità resta quella " +
          "di adesso finché non la approvano.",
      };
    }

    const precedente = await copertinaPrecedente(unita);
    try {
      await registraCopertina(
        unita,
        nome,
        TIPI_MIME[contenitore],
        { larghezza: esito.larghezza, altezza: esito.altezza },
        ctx.utente,
      );
    } catch (e) {
      // la riga non c'è: si portano via subito i file appena scritti, invece di
      // lasciarli a far compagnia a quelli vecchi
      await portaVia(nome);
      throw e;
    }

    if (precedente && precedente !== nome) await portaVia(precedente);

    aggiornaSito();
    aggiornaArea();
    await ctx.registra(
      "contenuto",
      `Caricata la copertina di ${unita} (${esito.larghezza}×${esito.altezza})`,
      "unita",
    );

    return {
      stato: "fatto",
      messaggio:
        `Copertina caricata (${esito.larghezza}×${esito.altezza}). È già in cima alla ` +
        "pagina dell’unità, ricodificata e senza i dati del telefono.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/** Toglie la copertina: la pagina torna all’immagine predefinita. */
export async function rimuoviCopertina(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const unita = unitaDelModulo(formData);
  if (!unita) return NON_TROVATA;

  try {
    const ctx = await contesto("unita-anagrafica", {
      unita,
      descrizione: `copertina dell’unità ${unita}`,
    });

    /*
     * Il social media manager la copertina la nasconde, non la elimina (6
     * ottobre 2026): fino ad allora qui proponeva di toglierla, e un gestore
     * approvando cancellava il file. Adesso nasconderla è subito e il file
     * resta; eliminarlo, se serve, è di un gestore.
     */
    if (nascondeSoltanto(ctx.sessione.r, ctx.livello)) {
      return {
        stato: "errore",
        messaggio:
          "Le fotografie non si eliminano da qui: nascondete la copertina, e sparisce " +
          "subito dalla pagina. Se va eliminata del tutto, lo fa un gestore.",
      };
    }

    const tolto = await dimenticaCopertina(unita);
    if (tolto) await portaVia(tolto);

    aggiornaSito();
    aggiornaArea();
    await ctx.registra("contenuto", `Rimossa la copertina di ${unita}`, "unita");
    return {
      stato: "fatto",
      messaggio: "Copertina rimossa: la pagina torna all’immagine predefinita.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Il nome della copertina attuale, prima di sostituirla — anche nascosta: è un
 * file in archivio come l'altra, e chi la sostituisce la porta via.
 */
async function copertinaPrecedente(unita: UnitaKey): Promise<string | null> {
  return fileCopertina(unita);
}

/**
 * Nasconde la copertina di un'unità: la pagina torna al segnaposto, il file
 * resta. Subito per chiunque abbia la riga, social media manager compreso —
 * togliere dal sito non mette online niente. Come `nascondiImmagine`.
 */
export async function nascondiCopertina(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const unita = unitaDelModulo(formData);
  if (!unita) return NON_TROVATA;

  try {
    const ctx = await contesto("unita-anagrafica", {
      unita,
      descrizione: `copertina dell’unità ${unita}`,
    });
    if (!(await scriviCopertinaNascosta(unita, true))) {
      return { stato: "errore", messaggio: "Quest’unità non ha una copertina da nascondere." };
    }
    aggiornaSito();
    aggiornaArea();
    await ctx.registra("contenuto", `Nascosta la copertina di ${unita}`, "unita");
    return {
      stato: "fatto",
      messaggio:
        "Copertina nascosta: la pagina mostra l’immagine predefinita. La fotografia resta " +
        "qui, e si può rimettere.",
    };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * Rimette la copertina nascosta. Questo mette online qualcosa: il social media
 * manager lo chiede a un gestore (`vaInCoda`, come per una copertina nuova),
 * chi pubblica la rimette da sé.
 */
export async function mostraCopertina(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const unita = unitaDelModulo(formData);
  if (!unita) return NON_TROVATA;

  try {
    const ctx = await contesto("unita-anagrafica", {
      unita,
      descrizione: `copertina dell’unità ${unita}`,
    });
    if (!(await unitaSalvataPerChiave(unita))?.copertinaNascosta) {
      return { stato: "errore", messaggio: "Quest’unità non ha una copertina nascosta." };
    }

    if (vaInCoda(ctx.sessione.r, ctx.livello)) {
      const sostituita = await proponi("copertina", unita, VALORE_MOSTRA, null, ctx.utente);
      if (sostituita) await portaVia(sostituita);
      aggiornaArea();
      await ctx.registra("contenuto", `Proposto di rimettere la copertina di ${unita}`, "unita");
      return {
        stato: "fatto",
        messaggio: "Richiesta inviata ai gestori: la copertina torna quando la approvano.",
      };
    }

    if (!(await scriviCopertinaNascosta(unita, false))) {
      return { stato: "errore", messaggio: "Non è stato possibile rimetterla. Riprovate." };
    }
    aggiornaSito();
    aggiornaArea();
    await ctx.registra("contenuto", `Rimessa la copertina di ${unita}`, "unita");
    return { stato: "fatto", messaggio: "Copertina rimessa: è di nuovo sulla pagina dell’unità." };
  } catch (errore) {
    return comeEsito(errore);
  }
}
