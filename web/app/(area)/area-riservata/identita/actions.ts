"use server";

import { revalidatePath } from "next/cache";
import {
  rimuoviMarchio,
  salvaMarchio,
  salvaRecapiti,
  salvaTesti,
} from "@/lib/gruppo";
import { misureImmagine } from "@/lib/immagini";
import { ErroreDatabase } from "@/lib/db/errori";
import { contesto, Negato } from "@/lib/auth/contesto";
import {
  CAMPI_RECAPITI,
  LATO_MAX,
  PESO_MAX,
  type Recapiti,
  type StatoIdentita,
  TIPI_AMMESSI,
} from "@/lib/identita";
import { registra } from "@/lib/registro-store";
import { emailValida } from "@/lib/email";


/**
 * Controllo di ambito, rifatto qui dentro.
 *
 * Il middleware protegge la **navigazione**, non le azioni: una Server Action è
 * un endpoint, e ci si arriva anche senza passare da una pagina. §05 del piano
 * lo chiede esplicitamente per tutto ciò che scrive, ed è la ragione per cui
 * questa riga non è ridondante.
 */
/**
 * Chi può toccare l'identità del gruppo.
 *
 * `identita` è la riga «Nomi, loghi, recapiti» della matrice di §8. Prima era un
 * elenco di ruoli ammessi scritto qui (`AMMESSI`); adesso è la matrice a
 * deciderlo, e quella che l'amministratore vede a schermo è la stessa riga.
 *
 * Restituisce `null` invece di sollevare, per non cambiare la forma di queste
 * quattro azioni: ognuna risponde già con `NEGATO` quando il controllo non
 * passa, e il rifiuto è comunque registrato dal cancello.
 */
async function autorizzato() {
  try {
    return (await contesto("identita")).sessione;
  } catch (errore) {
    if (errore instanceof Negato) return null;
    throw errore;
  }
}

/** Le pagine che mostrano nome o marchio: tutte, perché stanno in barra e piede. */
function aggiornaSito() {
  revalidatePath("/", "layout");
}

const NEGATO: StatoIdentita = {
  stato: "errore",
  messaggio: "Non avete i permessi per modificare l’identità del gruppo.",
};

/**
 * Esegue una scrittura sullo store traducendo un guasto del database in un
 * esito per il modulo.
 *
 * Serve da quando l'identità sta in `pagine_testi`: prima un errore di
 * scrittura risaliva come eccezione non gestita e Next mostrava una pagina
 * d'errore. Il messaggio dell'`ErroreDatabase` è già quello scritto per
 * l'utente — nessun SQL, §11 del piano — e il codice serve a chi amministra per
 * ritrovare la riga di registro.
 *
 * Rilancia tutto ciò che non è un `ErroreDatabase`: `redirect` e `notFound` di
 * Next funzionano lanciando, e intercettarli qui li romperebbe.
 */
async function prova(azione: () => Promise<void>): Promise<StatoIdentita | null> {
  try {
    await azione();
    return null;
  } catch (errore) {
    if (errore instanceof ErroreDatabase) {
      return { stato: "errore", messaggio: errore.message };
    }
    throw errore;
  }
}

export async function salvaIdentita(
  _precedente: StatoIdentita,
  formData: FormData,
): Promise<StatoIdentita> {
  const sessione = await autorizzato();
  if (!sessione) return NEGATO;

  const nome = String(formData.get("nome") ?? "").trim();
  const sottotitolo = String(formData.get("sottotitolo") ?? "").trim();

  if (nome.length < 2 || nome.length > 60) {
    return {
      stato: "errore",
      campo: "nome",
      messaggio: "Il nome del gruppo deve stare fra 2 e 60 caratteri.",
    };
  }
  if (sottotitolo.length > 80) {
    return {
      stato: "errore",
      campo: "sottotitolo",
      messaggio: "Il sottotitolo non può superare gli 80 caratteri.",
    };
  }

  const guasto = await prova(() => salvaTesti(nome, sottotitolo));
  if (guasto) return guasto;
  aggiornaSito();
  await registra(sessione, "configurazione", `Nome del gruppo → «${nome}»`, "identita");
  return { stato: "salvato", messaggio: "Nome e sottotitolo aggiornati in tutto il sito." };
}

export async function salvaContatti(
  _precedente: StatoIdentita,
  formData: FormData,
): Promise<StatoIdentita> {
  const sessione = await autorizzato();
  if (!sessione) return NEGATO;

  const recapiti = {} as Recapiti;

  for (const campo of CAMPI_RECAPITI) {
    const valore = String(formData.get(campo.chiave) ?? "").trim();

    // un campo facoltativo vuoto è una scelta, non un errore: si salva vuoto e
    // le pagine non lo scrivono
    if (valore === "" && campo.obbligatorio) {
      return {
        stato: "errore",
        campo: campo.chiave,
        messaggio: `«${campo.label}» non può restare vuoto: è l’indirizzo a cui arrivano i messaggi del sito.`,
      };
    }
    if (valore === "") {
      recapiti[campo.chiave] = "";
      continue;
    }
    if (valore.length > 120) {
      return {
        stato: "errore",
        campo: campo.chiave,
        messaggio: `«${campo.label}» è troppo lungo: al massimo 120 caratteri.`,
      };
    }
    if (campo.tipo === "email" && !emailValida(valore)) {
      return {
        stato: "errore",
        campo: campo.chiave,
        messaggio: `«${campo.label}» non sembra un indirizzo di posta valido.`,
      };
    }
    recapiti[campo.chiave] = valore;
  }

  const guasto = await prova(() => salvaRecapiti(recapiti));
  if (guasto) return guasto;
  aggiornaSito();
  await registra(sessione, "configurazione", "Aggiornati sede e recapiti", "identita");
  return {
    stato: "salvato",
    messaggio: "Recapiti aggiornati nel piede, in Contatti e nelle informative.",
  };
}

export async function caricaMarchio(
  _precedente: StatoIdentita,
  formData: FormData,
): Promise<StatoIdentita> {
  const sessione = await autorizzato();
  if (!sessione) return NEGATO;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { stato: "errore", campo: "file", messaggio: "Scegliete un file da caricare." };
  }
  if (file.size > PESO_MAX) {
    return {
      stato: "errore",
      campo: "file",
      messaggio: `Il file pesa ${Math.round(file.size / 1024)} KB: il massimo è ${PESO_MAX / 1024} KB.`,
    };
  }

  const dati = Buffer.from(await file.arrayBuffer());

  // Il tipo dichiarato dal browser non fa fede: conta quello che c'è dentro il
  // file. `misureImmagine` legge l'intestazione, e se non riconosce niente vuol
  // dire che l'immagine non è un'immagine.
  const misure = misureImmagine(dati);
  if (!misure || !TIPI_AMMESSI.includes(misure.tipo)) {
    return {
      stato: "errore",
      campo: "file",
      messaggio: "Il file non è un PNG o un JPEG valido. Convertitelo e riprovate.",
    };
  }
  if (misure.larghezza > LATO_MAX || misure.altezza > LATO_MAX) {
    return {
      stato: "errore",
      campo: "file",
      messaggio: `L’immagine è ${misure.larghezza}×${misure.altezza}: il lato massimo è ${LATO_MAX} px.`,
    };
  }

  const guasto = await prova(() =>
    salvaMarchio(
      dati,
      misure.tipo,
      { larghezza: misure.larghezza, altezza: misure.altezza },
      Date.now(),
    ),
  );
  if (guasto) return guasto;
  aggiornaSito();
  await registra(sessione, "configurazione", "Sostituito il marchio del gruppo", "identita");
  return {
    stato: "salvato",
    messaggio: `Marchio sostituito (${misure.larghezza}×${misure.altezza}). Compare subito in barra e nel piede.`,
  };
}

export async function ripristinaMarchio(
  _precedente: StatoIdentita,
  _formData: FormData,
): Promise<StatoIdentita> {
  const sessione = await autorizzato();
  if (!sessione) return NEGATO;
  const guasto = await prova(() => rimuoviMarchio());
  if (guasto) return guasto;
  aggiornaSito();
  await registra(sessione, "configurazione", "Rimesso il marchio predefinito", "identita");
  return { stato: "salvato", messaggio: "Rimesso il marchio consegnato con il sito." };
}
