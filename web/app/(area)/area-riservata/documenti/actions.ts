"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AVVISO_MAX,
  CARICO_MAX,
  CARTELLA_CIRCOLARI,
  DOC_PER_INVIO,
  DOC_PESO_MAX,
  pesoLeggibile,
  SEMPRE_VALIDO,
  type Stato,
  type StatoAzione,
  titoloDaNomeFile,
} from "@/lib/contenuti";
import { TUTTE_LE_UNITA, type UnitaKey } from "@/lib/data";
import {
  cartellaPerChiave,
  creaCartella,
  eliminaCartella,
  modificaCartella,
  spostaCartella,
} from "@/lib/cartelle-store";
import {
  aggiornaDocumento,
  aggiungiDocumentoConFile,
  cambiaStatoDocumento,
  caricaFileDocumento,
  creaDocumento,
  documentoPerId,
  eliminaDocumento,
} from "@/lib/documenti-store";
import { contesto, ingresso, Negato } from "@/lib/auth/contesto";
import { type Sessione } from "@/lib/sessione";
import { rigeneraPagineDocumenti } from "@/lib/rigenera";
import { registra } from "@/lib/registro-store";

/**
 * Scritture sui documenti.
 *
 * A differenza degli album, la modulistica **non** è di un'unità: moduli di
 * iscrizione, quote e statuti valgono per tutto il gruppo. Quindi qui l'ambito
 * non è l'unità ma il ruolo: ci lavorano i gestori e lo sviluppatore, non i
 * referenti di unità. Il controllo sta in ogni azione, non solo nel menu.
 *
 * ## Chi decide, dalla fase 14
 *
 * Era `AMMESSI`, un elenco di due ruoli scritto qui dentro. Adesso è la riga
 * `documenti` della matrice, che nel seme dice le stesse due cose — gestore
 * e sviluppatore `completo`, referente di unità `nessuno` — quindi non cambia nulla di
 * quello che si può fare; cambia che a deciderlo è la riga che
 * l'amministratore vede a schermo.
 *
 * ## L'ambito, dalla fase 14.7
 *
 * `documenti` è passato a `limitato` per il referente di unità, e ogni azione passa
 * **l'unità del documento** al cancello. È il pezzo che rende sicuro il permesso
 * allargato, e va letto con attenzione perché il caso pericoloso è silenzioso:
 * con `limitato` e **nessuna risorsa**, `decidi()` concede — interpreta
 * l'assenza come «l'azione è per costruzione nel proprio ambito». Una chiamata
 * a `contesto("documenti")` senza il secondo argomento aprirebbe quindi la
 * modulistica del gruppo a chiunque abbia un'unità, senza nessun errore.
 *
 * Per questo l'ambito non è un argomento facoltativo di comodo ma il primo passo
 * di ogni azione: `ambitoDi(id)` legge il documento e restituisce la sua unità,
 * `gruppo` compreso — che è l'unità di nessuno, e che `copre()` nega a ogni referente
 * unità.
 *
 * ## Pubblicare
 *
 * Non c'è un cancello separato. Un referente di unità pubblica **la circolare della
 * propria unità** appena l'ha caricata, come deciso il 31 agosto 2026: una lista
 * materiale che aspetta un'approvazione arriva dopo l'uscita. E non può
 * pubblicare altro, perché non può *toccare* altro — l'ambito lo ferma prima
 * che lo stato conti, che è il modo di avere una regola sola invece di due.
 *
 * Resta la regola che c'era: **niente pubblicazione senza il file**, altrimenti
 * in pagina compare un pulsante che non scarica niente.
 *
 * ## Le cartelle, dalla migrazione 0012
 *
 * Le quattro azioni sulle cartelle — crearne una, rinominarla, spostarla,
 * eliminarla — passano dallo stesso cancello con l'ambito **`gruppo`**. Non è un
 * valore di comodo: le cartelle sono di tutto il sito, e `gruppo` è l'unità di
 * nessuno, che `copre()` nega a ogni referente di unità. Con `limitato` e senza ambito,
 * invece, il cancello avrebbe lasciato passare anche loro.
 */

const NEGATO: StatoAzione = {
  stato: "errore",
  messaggio: "I documenti del gruppo li gestiscono i gestori.",
};

/**
 * La sessione, se la matrice le concede i documenti **di quest'unità**; `null`
 * altrimenti.
 *
 * L'unità è obbligatoria, e non per gusto: vedi la nota in cima. Un valore
 * predefinito qui — anche `"gruppo"` — sarebbe stato la scorciatoia che prima o
 * poi qualcuno prende senza accorgersene.
 *
 * Restituisce `null` invece di far risalire `Negato` per non cambiare la forma
 * delle cinque azioni, che rispondono già con `NEGATO`. È lo stesso adattamento
 * di `identita/actions.ts`, e il rifiuto resta registrato dal cancello.
 */
async function autorizzato(
  unita: UnitaKey,
  descrizione: string,
): Promise<Sessione | null> {
  try {
    return (await contesto("documenti", { unita, descrizione })).sessione;
  } catch (errore) {
    if (errore instanceof Negato) return null;
    throw errore;
  }
}

/**
 * Sessione e ruolo, prima di leggere il documento per conoscerne l'unità.
 *
 * Senza, chi non è entrato distingueva un id vero («I documenti del gruppo li
 * gestiscono…») da uno inventato («non esiste più»): vedi `ingresso()`.
 */
async function entrato(): Promise<boolean> {
  try {
    await ingresso("documenti");
    return true;
  } catch (errore) {
    if (errore instanceof Negato) return false;
    throw errore;
  }
}

/**
 * L'unità di un documento esistente, per passarla al cancello.
 *
 * Si legge **prima** di autorizzare, perché l'ambito è una proprietà della
 * risorsa e senza di essa il cancello non ha niente da confrontare. Leggere non
 * è autorizzare: la decisione arriva subito dopo e nessuna scrittura è ancora
 * avvenuta. È la stessa sequenza di `approvazioni/actions.ts` per gli album, con
 * lo stesso commento perché è la stessa domanda che si fa chi la legge.
 */
async function ambitoDi(id: string): Promise<UnitaKey | null> {
  const d = await documentoPerId(id);
  return d?.unita ?? null;
}

const SPARITO: StatoAzione = {
  stato: "errore",
  messaggio: "Questo documento non esiste più.",
};

/**
 * Le pagine che mostrano i documenti.
 *
 * `/documenti/[cartella]` con il tipo `page`, come per le unità: chi salva non
 * deve sapere in quale cartella stava il documento prima, e una cartella
 * dimenticata è un salvataggio che sembra non aver funzionato. `/attivita` c'è
 * perché mostra il pulsante del calendario quando fra i documenti ce n'è uno.
 */
function aggiornaSito() {
  revalidatePath("/documenti");
  rigeneraPagineDocumenti();
  revalidatePath("/attivita");
  revalidatePath("/");
}

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

/**
 * L'anno dal modulo: la forma canonica, oppure `null` per «sempre valido».
 * `undefined` se non è né l'una né l'altro — chi chiama lo rifiuta.
 *
 * Qui si controlla solo la forma. Se l'anno esiste lo dice lo store, che guarda
 * `anni_sociali` e non `ANNI_DOC`: un anno aperto a settembre sta in tabella prima
 * che nel codice.
 */
function annoDalModulo(f: FormData): string | null | undefined {
  const v = testo(f, "anno");
  if (v === SEMPRE_VALIDO) return null;
  return /^\d{4}-\d{4}$/.test(v) ? v : undefined;
}

const ANNO_SBAGLIATO: StatoAzione = {
  stato: "errore",
  campo: "anno",
  messaggio: "L’anno si scrive «2026-2027», oppure si sceglie «sempre valido».",
};

/** Mese e anno correnti, come li scrive il sito: «set 2026». */
function meseCorrente(adesso: number): string {
  const mesi = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const d = new Date(adesso);
  return `${mesi[d.getMonth()]} ${d.getFullYear()}`;
}

export async function nuovoDocumento(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const titolo = testo(formData, "titolo");
  const anno = annoDalModulo(formData);
  const categoria = testo(formData, "categoria");
  const unita = testo(formData, "unita") as UnitaKey;

  /*
   * L'unità si valida **prima** di autorizzare, e arriva dal modulo.
   *
   * È il punto in cui una richiesta costruita a mano prova a passare: chiedendo
   * il cancello su `u4` mentre la sessione è dell'unità 1, o su `gruppo` per
   * arrivare alla modulistica. Il confronto lo fa `copre()`, con l'unità della
   * sessione e non con quella inviata — la stessa prova fatta dal vivo sugli
   * album nella fase 14.2 e sulla scheda nella 14.5.
   */
  if (unita !== "gruppo" && !TUTTE_LE_UNITA.includes(unita)) {
    return { stato: "errore", campo: "unita", messaggio: "Scegliete l’unità, o il gruppo." };
  }

  const sessione = await autorizzato(unita, `nuovo documento «${titolo}»`);
  if (!sessione) return NEGATO;

  if (titolo.length < 3 || titolo.length > 90) {
    return { stato: "errore", campo: "titolo", messaggio: "Il titolo deve stare fra 3 e 90 caratteri." };
  }
  if (anno === undefined) return ANNO_SBAGLIATO;
  // la cartella la controlla anche lo store, dentro la transazione; qui si
  // risponde prima a una richiesta costruita con un nome inventato
  if (!(await cartellaPerChiave(categoria))) {
    return { stato: "errore", campo: "categoria", messaggio: "Scegliete una cartella." };
  }

  const esito = await creaDocumento(
    { titolo, anno, unita, categoria, nota: testo(formData, "nota") },
    Date.now(),
    sessione.u,
  );
  if (!esito.ok) {
    return { stato: "errore", campo: esito.campo ?? "titolo", messaggio: esito.errore };
  }

  aggiornaSito();
  await registra(sessione, "contenuto", `Creata la voce «${titolo}»`, "documenti");
  return {
    stato: "fatto",
    messaggio: `«${titolo}» creato in bozza. Caricate il file e poi pubblicatelo.`,
  };
}

export async function modificaDocumento(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  if (!(await entrato())) return NEGATO;
  const unita = await ambitoDi(testo(formData, "id"));
  if (!unita) return SPARITO;

  const sessione = await autorizzato(unita, `documento «${testo(formData, "id")}»`);
  if (!sessione) return NEGATO;

  const id = testo(formData, "id");
  const titolo = testo(formData, "titolo");
  if (titolo.length < 3 || titolo.length > 90) {
    return { stato: "errore", campo: "titolo", messaggio: "Il titolo deve stare fra 3 e 90 caratteri." };
  }
  const anno = annoDalModulo(formData);
  if (anno === undefined) return ANNO_SBAGLIATO;

  /*
   * La cartella arriva solo se il modulo la offre.
   *
   * Una circolare non ha il menù delle cartelle — sta fra le circolari per
   * forza, lo dice il `CHECK` — e un campo assente qui voleva dire scrivere la
   * stringa vuota in `categoria`: era un vincolo violato a ogni salvataggio di
   * una circolare. Assente vuol dire «lasciala dov'è».
   */
  const categoria = testo(formData, "categoria") || undefined;

  // Assente vuol dire «lascialo com'è», come per la cartella: un editor aperto
  // da prima del rilascio non ha il campo, e salvarlo non deve cancellare
  // l'avviso. Gli a capo diventano spazi: il riquadro è un paragrafo solo.
  const avviso = formData.has("avviso")
    ? testo(formData, "avviso").replace(/\s+/g, " ")
    : undefined;
  if (avviso !== undefined && avviso.length > AVVISO_MAX) {
    return {
      stato: "errore",
      campo: "avviso",
      messaggio: `L’avviso sta in ${AVVISO_MAX} caratteri: è un riquadro sotto il documento, non una pagina.`,
    };
  }

  const esito = await aggiornaDocumento(
    id,
    { titolo, categoria, nota: testo(formData, "nota"), avviso, anno },
    Date.now(),
    sessione.u,
  );
  if (!esito.ok) return { stato: "errore", campo: esito.campo, messaggio: esito.errore };

  aggiornaSito();
  await registra(sessione, "contenuto", `Modificato «${titolo}»`, "documenti");
  return { stato: "fatto", messaggio: "Documento aggiornato." };
}

/**
 * Sposta un documento in un'altra cartella: è il gesto del trascinamento.
 *
 * Passa dalla stessa funzione di «Modifica» (`aggiornaDocumento`) con tutto il
 * resto com'è: titolo, validità, nota e avviso non si toccano. Non è un
 * secondo modo di modificare un documento ma lo stesso, ristretto a un campo, e
 * per questo chiede lo stesso cancello con l'unità **del documento**.
 *
 * Una circolare non si sposta, né si porta una voce del gruppo fra le
 * circolari: lo vieta `documenti_circolari_hanno_unita`, e qui si risponde
 * prima con una frase invece del messaggio del database.
 */
export async function spostaDocumento(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = testo(formData, "id");
  const categoria = testo(formData, "categoria");
  if (!(await entrato())) return NEGATO;
  const d = await documentoPerId(id);
  if (!d) return SPARITO;

  const sessione = await autorizzato(d.unita, `spostamento del documento «${id}»`);
  if (!sessione) return NEGATO;

  if (d.categoria === categoria) return { stato: "vuoto" };
  if (d.categoria === CARTELLA_CIRCOLARI || categoria === CARTELLA_CIRCOLARI) {
    return {
      stato: "errore",
      messaggio: "Le circolari restano fra le circolari: sono delle unità, e non si spostano.",
    };
  }
  const cartella = await cartellaPerChiave(categoria);
  if (!cartella) return { stato: "errore", messaggio: "Questo gruppo non esiste più." };

  const esito = await aggiornaDocumento(
    id,
    { titolo: d.titolo, categoria, nota: d.nota, avviso: d.avviso, anno: d.anno },
    Date.now(),
    sessione.u,
  );
  if (!esito.ok) return { stato: "errore", campo: esito.campo, messaggio: esito.errore };

  aggiornaSito();
  await registra(sessione, "contenuto", `«${d.titolo}» spostato in «${cartella.titolo}»`, "documenti");
  return { stato: "fatto", messaggio: `«${d.titolo}» è ora in «${cartella.titolo}».` };
}

/**
 * Più documenti in una cartella, in un invio solo: ogni file diventa un
 * documento, con il titolo ricavato dal nome del file.
 *
 * È la richiesta dei gestori del 25 settembre 2026 — aprire «Tesseramenti» e
 * trovarci tutti i moduli — messa dalla parte di chi carica: dieci PDF non
 * devono voler dire dieci voci da creare, dieci file da caricare e dieci
 * «Pubblica».
 *
 * L'ambito è quello del modulo, controllato come in `nuovoDocumento`: `gruppo`
 * per le cartelle del gruppo, l'unità della sessione per le circolari. I file
 * scartati — non PDF, troppo pesanti, già presenti — non fermano gli altri: si
 * elencano nel messaggio, come per le fotografie.
 */
export async function caricaDocumenti(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const categoria = testo(formData, "cartella");
  const unita = testo(formData, "unita") as UnitaKey;

  if (unita !== "gruppo" && !TUTTE_LE_UNITA.includes(unita)) {
    return { stato: "errore", messaggio: "Scegliete l’unità, o il gruppo." };
  }
  const cartella = await cartellaPerChiave(categoria);
  const sessione = await autorizzato(
    unita,
    `caricamento di documenti in «${cartella?.titolo ?? categoria}»`,
  );
  if (!sessione) return NEGATO;
  if (!cartella) return { stato: "errore", messaggio: "Questa cartella non esiste più." };

  const anno = annoDalModulo(formData);
  if (anno === undefined) return ANNO_SBAGLIATO;

  const files = formData
    .getAll("file")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { stato: "errore", campo: "file", messaggio: "Scegliete almeno un file." };
  }
  if (files.length > DOC_PER_INVIO) {
    return {
      stato: "errore",
      campo: "file",
      messaggio: `Al massimo ${DOC_PER_INVIO} file per volta: caricateli in più riprese.`,
    };
  }
  // il browser lo controlla prima di spedire; qui resta la rete per chi arriva
  // senza il suo JavaScript, e per il messaggio
  const totale = files.reduce((s, f) => s + f.size, 0);
  if (totale > CARICO_MAX) {
    return {
      stato: "errore",
      campo: "file",
      messaggio: `In tutto ${pesoLeggibile(totale)}: il massimo per invio è ${pesoLeggibile(CARICO_MAX)}.`,
    };
  }

  const pubblica = formData.get("pubblica") === "1";
  const adesso = Date.now();
  const mese = meseCorrente(adesso);
  const caricati: string[] = [];
  const scartati: string[] = [];

  for (const [i, file] of files.entries()) {
    if (file.size > DOC_PESO_MAX) {
      scartati.push(`${file.name} (${pesoLeggibile(file.size)}, troppo pesante)`);
      continue;
    }
    const titolo = titoloDaNomeFile(file.name);
    if (titolo.length < 3) {
      scartati.push(`${file.name} (il nome è troppo corto per farne un titolo: rinominatelo)`);
      continue;
    }

    const esito = await aggiungiDocumentoConFile(
      { titolo, anno, unita, categoria, nota: "" },
      Buffer.from(await file.arrayBuffer()),
      // la marca temporale si sposta di uno a ogni file: è nel nome del file
      // sul disco, e due file dello stesso invio non devono prendersi lo stesso
      { adesso: adesso + i, autore: sessione.u, mese, pubblica },
    );
    if (esito.ok) caricati.push(titolo);
    else scartati.push(`${file.name} (${esito.errore.replace(/\.$/, "")})`);
  }

  if (caricati.length === 0) {
    return {
      stato: "errore",
      campo: "file",
      messaggio: `Nessun documento caricato. ${scartati.join("; ")}.`,
    };
  }

  aggiornaSito();
  await registra(
    sessione,
    pubblica ? "pubblicazione" : "contenuto",
    `Caricati ${caricati.length} ${caricati.length === 1 ? "documento" : "documenti"} in «${cartella.titolo}»`,
    "documenti",
  );

  const uno = caricati.length === 1;
  return {
    stato: "fatto",
    messaggio:
      `${caricati.length} ${uno ? "documento caricato" : "documenti caricati"} in «${cartella.titolo}»` +
      (pubblica
        ? uno
          ? ": è già nella pagina pubblica."
          : ": sono già nella pagina pubblica."
        : uno
          ? ": è in bozza, pubblicatelo quando l’avete controllato."
          : ": sono in bozza, pubblicateli quando li avete controllati.") +
      (scartati.length ? ` Scartati: ${scartati.join("; ")}.` : ""),
  };
}

export async function caricaDocumento(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  if (!(await entrato())) return NEGATO;
  const unita = await ambitoDi(testo(formData, "id"));
  if (!unita) return SPARITO;

  const sessione = await autorizzato(unita, `file del documento «${testo(formData, "id")}»`);
  if (!sessione) return NEGATO;

  const id = testo(formData, "id");
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { stato: "errore", campo: "file", messaggio: "Scegliete un file." };
  }
  if (file.size > DOC_PESO_MAX) {
    return {
      stato: "errore",
      campo: "file",
      messaggio: `Il file pesa ${pesoLeggibile(file.size)}: il massimo è ${pesoLeggibile(DOC_PESO_MAX)}.`,
    };
  }

  const adesso = Date.now();
  const esito = await caricaFileDocumento(
    id,
    Buffer.from(await file.arrayBuffer()),
    adesso,
    sessione.u,
    meseCorrente(adesso),
  );
  if (!esito.ok) return { stato: "errore", campo: "file", messaggio: esito.errore };

  aggiornaSito();
  await registra(sessione, "contenuto", `Caricato il file di «${id}»`, "documenti");
  return {
    stato: "fatto",
    messaggio: "File caricato. Se il documento è pubblicato, è già scaricabile dal sito.",
  };
}

export async function statoDocumento(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  if (!(await entrato())) return NEGATO;
  const unita = await ambitoDi(testo(formData, "id"));
  if (!unita) return SPARITO;

  const sessione = await autorizzato(unita, `stato del documento «${testo(formData, "id")}»`);
  if (!sessione) return NEGATO;

  const id = testo(formData, "id");
  const nuovo = testo(formData, "stato") as Stato;
  if (!["bozza", "in-revisione", "pubblicato"].includes(nuovo)) {
    return { stato: "errore", messaggio: "Stato non riconosciuto." };
  }
  /*
   * Nessun cancello separato per la pubblicazione, e va detto perché.
   *
   * Era `if (nuovo === "pubblicato" && !puoPubblicare(sessione))`, cioè «solo
   * gestore e admin». Dalla fase 14.7 un referente di unità pubblica la circolare
   * della propria unità appena l'ha caricata — una lista materiale che aspetta
   * un'approvazione arriva dopo l'uscita — e non può pubblicare altro perché non
   * può *toccare* altro: l'ambito, verificato sopra, lo ferma prima che lo stato
   * conti.
   *
   * Una regola sola invece di due. Quella in più avrebbe dovuto dire «può
   * pubblicare se è una circolare della sua unità», che è la stessa cosa che
   * l'ambito già afferma, scritta una seconda volta in un posto dove può
   * divergere.
   */

  // Pubblicare una voce senza file rimetterebbe in pagina il pulsante che non
  // scarica niente: è esattamente il difetto che stiamo togliendo.
  const doc = await documentoPerId(id);
  if (nuovo === "pubblicato" && !doc?.file) {
    return {
      stato: "errore",
      messaggio:
        "Manca il file: caricatelo prima di pubblicare, altrimenti in pagina resta un " +
        "pulsante che non scarica niente.",
    };
  }

  await cambiaStatoDocumento(id, nuovo, Date.now(), sessione.u);
  aggiornaSito();
  await registra(
    sessione,
    nuovo === "pubblicato" ? "pubblicazione" : "contenuto",
    `Documento «${id}» → ${nuovo}`,
    "documenti",
  );

  const detto: Record<Stato, string> = {
    bozza: "Documento tolto dalla pagina pubblica.",
    "in-revisione": "Documento messo in revisione.",
    pubblicato: "Documento pubblicato: è scaricabile dalla pagina Documenti.",
  };
  return { stato: "fatto", messaggio: detto[nuovo] };
}

export async function rimuoviDocumento(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  if (!(await entrato())) return NEGATO;
  // l'ambito **prima** della cancellazione: dopo, il documento non c'è più e
  // non c'è nulla su cui autorizzare
  const unita = await ambitoDi(testo(formData, "id"));
  if (!unita) return SPARITO;

  const sessione = await autorizzato(unita, `documento «${testo(formData, "id")}»`);
  if (!sessione) return NEGATO;

  const fatto = await eliminaDocumento(testo(formData, "id"));
  aggiornaSito();
  if (fatto) {
    await registra(sessione, "eliminazione", `Eliminato «${testo(formData, "id")}»`, "documenti");
  }
  if (!fatto) return { stato: "errore", messaggio: "Questo documento non esiste più." };

  // come per gli album: si torna all'elenco, non si resta sull'editor di una
  // cosa appena cancellata
  const elenco = testo(formData, "da");
  if (elenco.startsWith("/area-riservata/") && !elenco.startsWith("//") && !elenco.includes(".."))
    redirect(elenco);

  return { stato: "fatto", messaggio: "Documento eliminato, insieme al file." };
}

// --------------------------------------------------------------------------
// Cartelle
// --------------------------------------------------------------------------

const NEGATO_CARTELLE: StatoAzione = {
  stato: "errore",
  messaggio: "Le cartelle dei documenti le gestiscono i gestori.",
};

/**
 * Le cartelle sono di tutto il sito: l'ambito è sempre `gruppo`, che `copre()`
 * nega a ogni referente di unità. Vedi la nota in cima al file.
 */
const cartelleAutorizzate = (descrizione: string) => autorizzato("gruppo", descrizione);

/** Un indirizzo dell'area a cui tornare, oppure `null` se non lo è. */
function dentroArea(indirizzo: string): string | null {
  return indirizzo.startsWith("/area-riservata/") &&
    !indirizzo.startsWith("//") &&
    !indirizzo.includes("..")
    ? indirizzo
    : null;
}

/** Nome e descrizione dal modulo, con le misure che la pagina regge. */
function nomeEDescrizione(
  formData: FormData,
): { titolo: string; descrizione: string } | StatoAzione {
  const titolo = testo(formData, "titolo");
  const descrizione = testo(formData, "descrizione");
  if (titolo.length < 2 || titolo.length > 60) {
    return { stato: "errore", campo: "titolo", messaggio: "Il nome deve stare fra 2 e 60 caratteri." };
  }
  if (descrizione.length > 200) {
    return {
      stato: "errore",
      campo: "descrizione",
      messaggio: "La descrizione sta in 200 caratteri: è la riga sotto il nome.",
    };
  }
  return { titolo, descrizione };
}

export async function nuovaCartella(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const sessione = await cartelleAutorizzate(`nuova cartella «${testo(formData, "titolo")}»`);
  if (!sessione) return NEGATO_CARTELLE;

  const dati = nomeEDescrizione(formData);
  if ("stato" in dati) return dati;

  const esito = await creaCartella(dati, sessione.u);
  if (!esito.ok) return { stato: "errore", campo: esito.campo, messaggio: esito.errore };

  aggiornaSito();
  await registra(sessione, "contenuto", `Creata la cartella «${dati.titolo}»`, "documenti");

  // si entra nella cartella appena creata: la cosa da fare subito dopo è
  // caricarci i file, e restare sull'elenco vorrebbe dire cercarla
  const elenco = dentroArea(testo(formData, "da"));
  if (elenco) redirect(`${elenco}?cartella=${esito.chiave}`);
  return { stato: "fatto", messaggio: `Cartella «${dati.titolo}» creata.` };
}

export async function salvaCartella(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const chiave = testo(formData, "chiave");
  const sessione = await cartelleAutorizzate(`cartella «${chiave}»`);
  if (!sessione) return NEGATO_CARTELLE;

  const dati = nomeEDescrizione(formData);
  if ("stato" in dati) return dati;

  if (!(await modificaCartella(chiave, dati, sessione.u))) {
    return { stato: "errore", messaggio: "Questa cartella non esiste più." };
  }

  aggiornaSito();
  await registra(sessione, "contenuto", `Modificata la cartella «${dati.titolo}»`, "documenti");
  return {
    stato: "fatto",
    messaggio: `Salvato. L’indirizzo resta /documenti/${chiave}: i collegamenti già mandati funzionano.`,
  };
}

export async function ordinaCartella(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const chiave = testo(formData, "chiave");
  const sessione = await cartelleAutorizzate(`ordine della cartella «${chiave}»`);
  if (!sessione) return NEGATO_CARTELLE;

  const verso = testo(formData, "verso");
  if (verso !== "su" && verso !== "giu") return { stato: "errore", messaggio: "Verso non riconosciuto." };

  if (!(await spostaCartella(chiave, verso))) {
    return { stato: "errore", messaggio: "Questa cartella non esiste più." };
  }
  aggiornaSito();
  // Niente riga di registro: spostare una cartella di un posto non cambia
  // niente di quello che la pagina contiene, e dieci clic per riordinare non
  // devono diventare dieci voci. E niente messaggio: l'esito è la tabella che
  // si ridisegna con la cartella al posto nuovo, e un «Spostata» sotto una
  // freccia in ogni riga cliccata sarebbe solo rumore.
  return { stato: "vuoto" };
}

export async function rimuoviCartella(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const chiave = testo(formData, "chiave");
  const sessione = await cartelleAutorizzate(`cartella «${chiave}»`);
  if (!sessione) return NEGATO_CARTELLE;

  const esito = await eliminaCartella(chiave);
  if (!esito.ok) return { stato: "errore", messaggio: esito.errore };

  aggiornaSito();
  await registra(sessione, "eliminazione", `Eliminata la cartella «${chiave}»`, "documenti");

  const elenco = dentroArea(testo(formData, "da"));
  if (elenco) redirect(elenco);
  return { stato: "fatto", messaggio: "Cartella eliminata." };
}
