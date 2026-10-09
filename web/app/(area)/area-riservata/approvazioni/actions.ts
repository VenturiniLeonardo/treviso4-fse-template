"use server";

import { revalidatePath } from "next/cache";
import { albumPerIndirizzo, cambiaStatoAlbum, idAlbumPerIndirizzo } from "@/lib/album";
import { serraturaPerIndirizzo } from "@/lib/album-accesso";
import { attivitaPerId, cambiaStatoAttivita } from "@/lib/attivita-store";
import { displayInEtichetta } from "@/lib/db/mappa";
import { assenzeDichiarateDa, bloccantiPer, HA_DICHIARATO_CHI_PUBBLICA } from "@/lib/iscritti-store";
import type { StatoAzione } from "@/lib/contenuti";
import { cambiaStatoDocumento, documentoPerId } from "@/lib/documenti-store";
import { rigeneraPagineDocumenti } from "@/lib/rigenera";
import { registra } from "@/lib/registro-store";
import { contesto, esitoNegato, ingresso, Negato } from "@/lib/auth/contesto";
import { ErroreDatabase } from "@/lib/db/errori";
import { improntaDiRevisione } from "@/lib/impronta-revisione";
import { unitaPerCancello } from "@/lib/attivita";

/**
 * Approvazione e rinvio di quello che i referenti di unità hanno mandato in revisione.
 *
 * La coda non ha un archivio suo: legge lo stato di album e documenti. Un
 * secondo elenco da tenere allineato sarebbe il modo più rapido per avere una
 * coda che mostra cose già pubblicate — e per far sparire dalla coda cose che
 * aspettano ancora.
 */

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

/**
 * Traduce i due modi in cui un'operazione può non farsi.
 *
 * `Negato` viene dal cancello autorizzativo, `ErroreDatabase` dallo store: sono
 * le due eccezioni che un'azione deve saper trasformare in un esito per il
 * modulo, invece di lasciarle risalire come errore non gestito. Tutto il resto
 * si rilancia — `redirect` e `notFound` di Next funzionano lanciando.
 */
function comeEsito(errore: unknown): StatoAzione {
  if (errore instanceof Negato) return esitoNegato(errore);
  if (errore instanceof ErroreDatabase) {
    return { stato: "errore", messaggio: errore.message, codice: errore.codice };
  }
  throw errore;
}

function aggiorna(tipo: string, chiave: string) {
  revalidatePath("/area-riservata/gestore/approvazioni");
  revalidatePath("/area-riservata/sviluppatore/approvazioni");
  if (tipo === "album") {
    revalidatePath("/foto");
    revalidatePath(`/foto/${chiave}`);
  } else if (tipo === "attivita") {
    revalidatePath("/attivita");
  } else {
    revalidatePath("/documenti");
    // ogni cartella ha la sua pagina: vedi `aggiornaSito` in documenti/actions.ts
    rigeneraPagineDocumenti();
  }
  revalidatePath("/");
}

const CAMBIATO: StatoAzione = {
  stato: "errore",
  messaggio:
    "Il contenuto è cambiato da quando avete aperto questa pagina: ricaricatela e " +
    "ricontrollatelo prima di approvare.",
};

/**
 * Approva (→ pubblicato) o rimanda indietro (→ bozza).
 *
 * Il rinvio riporta in bozza e **non** cancella niente: chi ha preparato il
 * materiale se lo ritrova dov'era, con la nota di chi glielo ha rimandato nel
 * registro. Una coda che butta via il lavoro non la usa più nessuno.
 */
export async function decidi(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const tipo = testo(formData, "tipo");
  const chiave = testo(formData, "chiave");
  const verso = testo(formData, "verso");
  const versione = testo(formData, "versione");

  if (verso !== "pubblicato" && verso !== "bozza") {
    return { stato: "errore", messaggio: "Decisione non riconosciuta." };
  }

  /*
   * Si pubblica quello che è stato guardato, non quello che c'è adesso.
   *
   * La scheda della coda porta l'impronta del contenuto che mostrava; se nel
   * frattempo chi l'ha proposto l'ha cambiato, l'approvazione si ferma (audit
   * di sicurezza, BIZ-02). Vale solo per la pubblicazione: rimandare in bozza
   * una versione più nuova di quella vista non mette online niente.
   */
  const cambiato = (contenuto: object) =>
    verso === "pubblicato" && versione !== improntaDiRevisione(contenuto);

  /*
   * Il controllo qui sopra si fa su una copia letta prima delle attese del
   * cancello: una modifica arrivata nel mezzo passava (report QA, BUG-011).
   * Si ripete quindi dentro la transazione che cambia lo stato, sulla riga
   * com'è in quel momento; `nelFrattempo` dice se è stato lui a fermarla.
   */
  let nelFrattempo = false;
  const seUguale = (attuale: object) => {
    if (!cambiato(attuale)) return true;
    nelFrattempo = true;
    return false;
  };

  const adesso = Date.now();

  try {
  // Sessione e ruolo vengono prima di qualunque lettura, perché «non esiste
  // più» non arrivi a chi non è entrato (SEC-AUTH-003, vedi `ingresso()`).
  await ingresso("album-pubblica");

  if (tipo === "album") {
    // L'album si legge PRIMA del cancello sull'ambito perché quel cancello ha
    // bisogno della sua unità. Leggere non è autorizzare — la decisione arriva
    // subito dopo e nessuna scrittura è ancora avvenuta.
    const a = await albumPerIndirizzo(chiave);
    if (!a) return { stato: "errore", messaggio: "Quest’album non esiste più." };

    // «album-pubblica» è la riga «Approvare e pubblicare» della matrice di §8,
    // e vale per entrambi i tipi: pubblicare è pubblicare, e finora il codice
    // usava lo stesso `puoPubblicare` per album e documenti.
    const ctx = await contesto("album-pubblica", {
      unita: a.unita,
      descrizione: `album «${a.titolo}»`,
    });
    const sessione = ctx.sessione;
    if (cambiato(a)) return CAMBIATO;

    // Chi ha dichiarato delle assenze su quest'album non è chi lo pubblica
    // (audit degli accessi, SoD-1): è la stessa regola di `cambiaStato` negli
    // album, e questa è l'altra porta da cui un album si pubblica.
    if (verso === "pubblicato") {
      const id = await idAlbumPerIndirizzo(chiave);
      if (id !== null && assenzeDichiarateDa(id, sessione.u) > 0) {
        return { stato: "errore", messaggio: HA_DICHIARATO_CHI_PUBBLICA };
      }
    }

    /*
     * Qui il database può dire no, ed è l'unico posto del sistema dove lo dice
     * per una ragione che riguarda dei bambini.
     *
     * Il trigger `album_niente_pubblicazione_senza_consensi` blocca l'`UPDATE`
     * se in quell'anno e in quell'unità c'è un iscritto senza consenso che non è
     * stato dichiarato assente da quest'album. `mappaErroreDatabase` lo
     * riconosce come `genere: "trigger"` e produce «l'operazione è stata
     * bloccata da una regola del sistema» — vero, sicuro e inutile a chi lo
     * legge. Qui si sa **quale** regola, quindi si può dire i nomi.
     */
    // Lo stesso controllo di `cambiaStato` negli album: questa è l'altra porta
    // da cui un album si pubblica, e senza password resterebbe chiuso a tutti.
    if (verso === "pubblicato" && !serraturaPerIndirizzo(chiave)?.versione) {
      return {
        stato: "errore",
        messaggio:
          `«${a.titolo}» non ha ancora una password: impostatela dalla scheda dell’album ` +
          "prima di pubblicarlo, altrimenti le famiglie non possono aprirlo.",
      };
    }

    try {
      await cambiaStatoAlbum(chiave, verso, adesso, sessione.u, seUguale);
      if (nelFrattempo) return CAMBIATO;
    } catch (e) {
      if (e instanceof ErroreDatabase && e.genere === "trigger" && verso === "pubblicato") {
        const nomi = await nomiCheBloccano(chiave, a.anno, a.unita);
        await registra(
          sessione,
          "consenso",
          `Pubblicazione di «${a.titolo}» bloccata: consensi mancanti` +
            (nomi.length > 0 ? ` (${nomi.join(", ")})` : ""),
          "approvazioni",
          "rifiutato",
        );
        return {
          stato: "errore",
          codice: e.codice,
          messaggio:
            nomi.length > 0
              ? `Non si può pubblicare: ${nomi.join(", ")} ${nomi.length === 1 ? "non ha" : "non hanno"} ` +
                "il consenso alla pubblicazione delle immagini. Registrate il consenso, " +
                "oppure fate dichiarare dal referente di unità che non compaiono in queste fotografie."
              : "Non si può pubblicare: risultano consensi mancanti per quest’unità e " +
                "quest’anno. Controllate l’elenco degli iscritti.",
        };
      }
      throw e;
    }
    aggiorna(tipo, chiave);
    await registra(
      sessione,
      verso === "pubblicato" ? "pubblicazione" : "contenuto",
      verso === "pubblicato"
        ? `Approvato e pubblicato l’album «${a.titolo}» (${chiave})`
        : `Rimandato in bozza l’album «${a.titolo}»`,
      "approvazioni",
    );
    return {
      stato: "fatto",
      messaggio:
        verso === "pubblicato"
          ? `«${a.titolo}» è online nella pagina Foto, per chi ha la password.`
          : `«${a.titolo}» torna ai referenti dell’unità, con il materiale intatto.`,
    };
  }

  if (tipo === "documento") {
    const d = await documentoPerId(chiave);
    if (!d) return { stato: "errore", messaggio: "Questo documento non esiste più." };
    await contesto("documenti", { unita: d.unita });

    // l'unità del documento come ambito, come per gli album: oggi chi arriva
    // qui ha `completo`, ma il cancello non deve dipendere da questo (INFO-01)
    const ctx = await contesto("album-pubblica", {
      unita: d.unita,
      descrizione: `documento «${d.titolo}»`,
    });
    const sessione = ctx.sessione;
    if (cambiato(d)) return CAMBIATO;
    if (verso === "pubblicato" && !d.file) {
      return {
        stato: "errore",
        messaggio: "Manca il file: non si può approvare una voce che non scarica niente.",
      };
    }

    await cambiaStatoDocumento(chiave, verso, adesso, sessione.u, seUguale);
    if (nelFrattempo) return CAMBIATO;
    aggiorna(tipo, chiave);
    await registra(
      sessione,
      verso === "pubblicato" ? "pubblicazione" : "contenuto",
      verso === "pubblicato"
        ? `Approvato e pubblicato «${d.titolo}»`
        : `Rimandato in bozza «${d.titolo}»`,
      "approvazioni",
    );
    return {
      stato: "fatto",
      messaggio:
        verso === "pubblicato"
          ? `«${d.titolo}» è scaricabile dalla pagina Documenti.`
          : `«${d.titolo}» torna in bozza.`,
    };
  }

  if (tipo === "attivita") {
    const id = Number(chiave);
    const a = Number.isInteger(id) ? await attivitaPerId(id) : null;
    if (!a) return { stato: "errore", messaggio: "Quest’attività non esiste più." };
    await contesto("attivita", { unita: unitaPerCancello(a.unita) });

    /*
     * Stessa azione delle altre due: «album-pubblica» è la riga «Approvare e
     * pubblicare» della matrice, e pubblicare è pubblicare. L'ambito si passa
     * anche qui: chi arriva oggi ha `completo` su quella riga, ma un livello
     * cambiato dalla schermata «Permessi» non deve aprire le attività delle
     * altre unità (audit di sicurezza, INFO-01).
     */
    const ctx = await contesto("album-pubblica", {
      unita: unitaPerCancello(a.unita),
      descrizione: `attività «${a.titolo}»`,
    });
    const sessione = ctx.sessione;
    if (cambiato(a)) return CAMBIATO;

    await cambiaStatoAttivita(id, verso, sessione.u, seUguale);
    if (nelFrattempo) return CAMBIATO;
    aggiorna(tipo, chiave);
    await registra(
      sessione,
      verso === "pubblicato" ? "pubblicazione" : "contenuto",
      verso === "pubblicato"
        ? `Approvata e pubblicata l’attività «${a.titolo}» (attività ${id})`
        : `Rimandata in bozza l’attività «${a.titolo}»`,
      "approvazioni",
    );
    return {
      stato: "fatto",
      messaggio:
        verso === "pubblicato"
          ? `«${a.titolo}» è nel calendario pubblico.`
          : `«${a.titolo}» torna ai referenti dell’unità.`,
    };
  }

  return { stato: "errore", messaggio: "Tipo di contenuto non riconosciuto." };
  } catch (errore) {
    return comeEsito(errore);
  }
}

/**
 * I nomi che bloccano la pubblicazione di un album.
 *
 * Si ricalcolano **dopo** il rifiuto, non prima: prima sarebbe una previsione,
 * dopo è una spiegazione di un fatto avvenuto. E la lista che si mostra e quella
 * che ha rifiutato vengono dalla stessa domanda, posta al database due volte a
 * pochi millisecondi di distanza — non da due regole scritte in due posti.
 *
 * Se restituisce vuoto significa che fra il rifiuto e questa lettura è cambiato
 * qualcosa, oppure che il blocco veniva da un'altra regola. Il messaggio si
 * adatta invece di affermare un elenco che non ha.
 */
async function nomiCheBloccano(
  slug: string,
  anno: string,
  unita: string,
): Promise<string[]> {
  const etichetta = displayInEtichetta(anno);
  const id = await idAlbumPerIndirizzo(slug);
  if (!etichetta || id === null) return [];

  const bloccanti = bloccantiPer(
    id,
    etichetta,
    unita === "gruppo" ? undefined : (unita as Parameters<typeof bloccantiPer>[2]),
  );
  return (bloccanti ?? []).map((i) => `${i.cognome} ${i.nome}`);
}
