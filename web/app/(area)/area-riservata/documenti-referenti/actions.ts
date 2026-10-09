"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  CARICO_MAX,
  DOC_PER_INVIO,
  DOC_PESO_MAX,
  pesoLeggibile,
  type StatoAzione,
  titoloDaNomeFile,
} from "@/lib/contenuti";
import {
  aggiungiDocumentoReferenti,
  cartellaReferentiPerId,
  creaCartellaReferenti,
  documentoReferentiPerId,
  eliminaCartellaReferenti,
  eliminaDocumentoReferenti,
  modificaCartellaReferenti,
  modificaDocumentoReferenti,
  sostituisciFileReferenti,
  spostaCartellaReferenti,
} from "@/lib/documenti-referenti-store";
import { contesto, type Contesto, Negato } from "@/lib/auth/contesto";

/**
 * Scritture sui documenti per i referenti: cartelle e file.
 *
 * Tutte passano da `contesto("documenti-referenti-carica")` con l'ambito **`gruppo`**,
 * che è l'unità di nessuno e che `copre()` nega a ogni referente di unità. Non è un
 * valore di comodo: con `limitato` e nessuna risorsa `decidi()` concede, quindi
 * senza l'ambito una riga di scrittura messa un giorno a `limitato` per il referente
 * unità gli aprirebbe il caricamento in silenzio. Con `gruppo` resta fuori.
 *
 * Leggere non passa di qui: la sezione e la rotta dei file chiedono `puo()`
 * sulla riga `documenti-referenti-leggi`, che non scrive nel registro — le letture
 * non si registrano, le scritture sì (vedi `app/documento/[file]/route.ts`).
 *
 * Il registro si scrive con l'origine `documenti-referenti`, e nomina cartelle e
 * documenti per titolo: chi legge il registro è chi li gestisce.
 */

const NEGATO: StatoAzione = {
  stato: "errore",
  messaggio: "I documenti per i referenti li caricano i gestori.",
};

const ORIGINE = "documenti-referenti";

/** Il contesto autorizzato, o `null` se la matrice non lo concede. Il rifiuto lo registra il cancello. */
async function autorizzato(descrizione: string): Promise<Contesto | null> {
  try {
    return await contesto("documenti-referenti-carica", { unita: "gruppo", descrizione });
  } catch (errore) {
    if (errore instanceof Negato) return null;
    throw errore;
  }
}

/**
 * La sezione in tutte e tre le viste. Le pagine dell'area sono dinamiche e non
 * hanno una cache sul server; quello che si svuota è la cache del router nel
 * browser, che altrimenti mostrerebbe l'elenco di prima tornando indietro. Il
 * layout copre le tre viste senza doverle nominare, come in `profilo/actions.ts`.
 */
function aggiornaSezione() {
  revalidatePath("/area-riservata", "layout");
}

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

/** Un identificativo numerico dal modulo, o `null`. */
function numero(f: FormData, nome: string): number | null {
  const v = testo(f, nome);
  return /^\d{1,12}$/.test(v) ? Number(v) : null;
}

/** Un indirizzo dell'area a cui tornare, oppure `null` se non lo è. */
function dentroArea(indirizzo: string): string | null {
  return indirizzo.startsWith("/area-riservata/") &&
    !indirizzo.startsWith("//") &&
    !indirizzo.includes("..") &&
    !indirizzo.includes("?")
    ? indirizzo
    : null;
}

const SPARITA: StatoAzione = { stato: "errore", messaggio: "Questa cartella non esiste più." };
const SPARITO: StatoAzione = { stato: "errore", messaggio: "Questo documento non esiste più." };

// --------------------------------------------------------------------------
// Cartelle
// --------------------------------------------------------------------------

/** Nome e descrizione dal modulo, con le misure che la schermata regge. */
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

export async function nuovaCartellaReferenti(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const ctx = await autorizzato(`nuova cartella per i referenti «${testo(formData, "titolo")}»`);
  if (!ctx) return NEGATO;

  const dati = nomeEDescrizione(formData);
  if ("stato" in dati) return dati;

  const esito = await creaCartellaReferenti(dati, ctx.utente);
  if (!esito.ok) return { stato: "errore", campo: esito.campo, messaggio: esito.errore };

  aggiornaSezione();
  await ctx.registra("contenuto", `Creata la cartella per i referenti «${dati.titolo}»`, ORIGINE);

  // si entra nella cartella appena creata: la cosa da fare subito dopo è
  // caricarci i file
  const elenco = dentroArea(testo(formData, "da"));
  if (elenco) redirect(`${elenco}?cartella=${esito.id}`);
  return { stato: "fatto", messaggio: `Cartella «${dati.titolo}» creata.` };
}

export async function salvaCartellaReferenti(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = numero(formData, "id");
  const ctx = await autorizzato(`cartella per i referenti #${id ?? "?"}`);
  if (!ctx) return NEGATO;
  if (id === null) return SPARITA;

  const dati = nomeEDescrizione(formData);
  if ("stato" in dati) return dati;

  const esito = await modificaCartellaReferenti(id, dati, ctx.utente);
  if (!esito.ok) return { stato: "errore", campo: esito.campo, messaggio: esito.errore };

  aggiornaSezione();
  await ctx.registra("contenuto", `Modificata la cartella per i referenti «${dati.titolo}»`, ORIGINE);
  return { stato: "fatto", messaggio: "Cartella salvata." };
}

export async function ordinaCartellaReferenti(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = numero(formData, "id");
  const ctx = await autorizzato(`ordine della cartella per i referenti #${id ?? "?"}`);
  if (!ctx) return NEGATO;
  if (id === null) return SPARITA;

  const verso = testo(formData, "verso");
  if (verso !== "su" && verso !== "giu") return { stato: "errore", messaggio: "Verso non riconosciuto." };

  if (!(await spostaCartellaReferenti(id, verso))) return SPARITA;
  aggiornaSezione();
  // niente registro e niente messaggio, come per le cartelle pubbliche: l'esito
  // è l'elenco che si ridisegna, e dieci clic non devono diventare dieci voci
  return { stato: "vuoto" };
}

export async function rimuoviCartellaReferenti(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = numero(formData, "id");
  const ctx = await autorizzato(`cartella per i referenti #${id ?? "?"}`);
  if (!ctx) return NEGATO;
  if (id === null) return SPARITA;

  const cartella = await cartellaReferentiPerId(id);
  const esito = await eliminaCartellaReferenti(id);
  if (!esito.ok) return { stato: "errore", messaggio: esito.errore };

  aggiornaSezione();
  await ctx.registra(
    "eliminazione",
    `Eliminata la cartella per i referenti «${cartella?.titolo ?? `#${id}`}»`,
    ORIGINE,
  );

  const elenco = dentroArea(testo(formData, "da"));
  if (elenco) redirect(elenco);
  return { stato: "fatto", messaggio: "Cartella eliminata." };
}

// --------------------------------------------------------------------------
// Documenti
// --------------------------------------------------------------------------

/**
 * Più file in una cartella, in un invio solo: ogni file diventa un documento,
 * con il titolo ricavato dal nome. Come per i documenti pubblici, i file
 * scartati — formato sbagliato, troppo pesanti — non fermano gli altri: si
 * elencano nel messaggio.
 */
export async function caricaDocumentiReferenti(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const cartellaId = numero(formData, "cartella");
  const cartella = cartellaId === null ? undefined : await cartellaReferentiPerId(cartellaId);
  const ctx = await autorizzato(
    `caricamento di documenti per i referenti in «${cartella?.titolo ?? cartellaId ?? "?"}»`,
  );
  if (!ctx) return NEGATO;
  if (!cartella) return SPARITA;

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

  const adesso = Date.now();
  const caricati: string[] = [];
  const scartati: string[] = [];

  for (const [i, file] of files.entries()) {
    if (file.size > DOC_PESO_MAX) {
      scartati.push(`${file.name} (${pesoLeggibile(file.size)}, troppo pesante)`);
      continue;
    }
    const titolo = titoloDaNomeFile(file.name);
    if (titolo.length < 2) {
      scartati.push(`${file.name} (il nome è troppo corto per farne un titolo: rinominatelo)`);
      continue;
    }

    const esito = await aggiungiDocumentoReferenti(
      { cartellaId: cartella.id, titolo, nota: "" },
      Buffer.from(await file.arrayBuffer()),
      file.name,
      // la marca temporale si sposta di uno a ogni file: è nel nome sul disco
      { adesso: adesso + i, autore: ctx.utente },
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

  aggiornaSezione();
  const uno = caricati.length === 1;
  await ctx.registra(
    "contenuto",
    `Caricati ${caricati.length} ${uno ? "documento" : "documenti"} per i referenti in «${cartella.titolo}»`,
    ORIGINE,
  );

  return {
    stato: "fatto",
    messaggio:
      `${caricati.length} ${uno ? "documento caricato" : "documenti caricati"} in «${cartella.titolo}»: ` +
      `${uno ? "i referenti lo vedono" : "i referenti li vedono"} già dalla loro area riservata.` +
      (scartati.length ? ` Scartati: ${scartati.join("; ")}.` : ""),
  };
}

export async function modificaDocumentoReferentiAzione(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = numero(formData, "id");
  const ctx = await autorizzato(`documento per i referenti #${id ?? "?"}`);
  if (!ctx) return NEGATO;
  if (id === null) return SPARITO;

  const titolo = testo(formData, "titolo");
  const nota = testo(formData, "nota");
  const cartellaId = numero(formData, "cartella");
  if (titolo.length < 2 || titolo.length > 90) {
    return { stato: "errore", campo: "titolo", messaggio: "Il titolo deve stare fra 2 e 90 caratteri." };
  }
  if (nota.length > 500) {
    return { stato: "errore", campo: "nota", messaggio: "La nota sta in 500 caratteri." };
  }
  if (cartellaId === null) {
    return { stato: "errore", campo: "cartella", messaggio: "Scegliete una cartella." };
  }

  const esito = await modificaDocumentoReferenti(id, { titolo, nota, cartellaId }, ctx.utente);
  if (!esito.ok) return { stato: "errore", campo: esito.campo, messaggio: esito.errore };

  aggiornaSezione();
  await ctx.registra("contenuto", `Modificato il documento per i referenti «${titolo}»`, ORIGINE);
  return { stato: "fatto", messaggio: "Documento aggiornato." };
}

export async function nuovaVersioneReferenti(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = numero(formData, "id");
  const ctx = await autorizzato(`file del documento per i referenti #${id ?? "?"}`);
  if (!ctx) return NEGATO;
  if (id === null) return SPARITO;

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

  const esito = await sostituisciFileReferenti(id, Buffer.from(await file.arrayBuffer()), file.name, {
    adesso: Date.now(),
    autore: ctx.utente,
  });
  if (!esito.ok) {
    return {
      stato: "errore",
      campo: "file",
      // la frase di `riconosciFormato` comincia in minuscolo: sta bene fra
      // parentesi nell'elenco degli scartati, qui è la frase intera
      messaggio: `${esito.errore.charAt(0).toUpperCase()}${esito.errore.slice(1).replace(/\.?$/, ".")}`,
    };
  }

  const doc = await documentoReferentiPerId(id);
  aggiornaSezione();
  await ctx.registra(
    "contenuto",
    `Nuova versione del documento per i referenti «${doc?.titolo ?? `#${id}`}»`,
    ORIGINE,
  );
  return { stato: "fatto", messaggio: "File sostituito: chi lo scarica da ora riceve la versione nuova." };
}

export async function rimuoviDocumentoReferenti(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const id = numero(formData, "id");
  const ctx = await autorizzato(`documento per i referenti #${id ?? "?"}`);
  if (!ctx) return NEGATO;
  if (id === null) return SPARITO;

  const titolo = await eliminaDocumentoReferenti(id);
  if (titolo === null) return SPARITO;

  aggiornaSezione();
  await ctx.registra("eliminazione", `Eliminato il documento per i referenti «${titolo}»`, ORIGINE);

  // si torna alla cartella, non si resta sull'editor di una cosa cancellata
  const elenco = dentroArea(testo(formData, "da"));
  const cartella = numero(formData, "cartella");
  if (elenco) redirect(cartella === null ? elenco : `${elenco}?cartella=${cartella}`);
  return { stato: "fatto", messaggio: "Documento eliminato, insieme al file." };
}
