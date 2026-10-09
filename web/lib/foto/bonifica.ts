import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Metadata } from "sharp";
import { CARTELLA_DATI } from "@/lib/db/percorso";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { foto as tabellaFoto, unita as tabellaUnita } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { contenitoreDi } from "@/lib/foto/formato";
import { eDerivata, ripulisciOriginale } from "@/lib/foto/derivate";

/**
 * La bonifica degli originali caricati **prima** che si ripulissero i metadati.
 *
 * Dall'audit di produzione `aggiungiFoto` scrive l'originale già ricodificato
 * senza EXIF. I file caricati prima no: sul disco hanno ancora il modello
 * dell'apparecchio e, se chi ha scattato non aveva spento la geolocalizzazione,
 * le coordinate del posto. `/foto-file/[file]` li serve come ripiego quando una
 * derivata manca, quindi non è una macchia dormiente: è una fuga che aspetta
 * una conversione fallita.
 *
 * Sono fotografie di minori. Questo modulo esiste perché su un archivio già
 * pieno la correzione da sola non basta: bisogna passare su quello che c'è.
 *
 * ## Le regole che rendono l'operazione sicura
 *
 * Sostituire dei file in blocco è la cosa più pericolosa che questo progetto
 * faccia dopo la cancellazione degli orfani. Quindi:
 *
 *  1. **si toccano solo i file che il database nomina.** Non si cammina
 *     nell'archivio cercando `.jpg`: si parte dalle righe. Un file che nessuno
 *     indicizza non è affare di questo strumento — è affare di `db:orfani`, che
 *     ha le sue cautele;
 *  2. **le derivate non si toccano.** Sono già pulite per costruzione, e
 *     riscriverle vorrebbe dire ricomprimere per niente;
 *  3. **il nome non cambia.** È ciò che tiene in piedi i riferimenti: la riga
 *     continua a nominare lo stesso file, e nessuna pagina si accorge di
 *     niente;
 *  4. **si valida prima e si verifica dopo.** Il file nuovo deve essere
 *     un'immagine leggibile, delle stesse misure, e senza metadati. Se una di
 *     queste tre cose non torna, l'originale resta dov'è;
 *  5. **la sostituzione è atomica.** Si scrive accanto e si rinomina sopra: o
 *     c'è il file vecchio o c'è quello nuovo, mai mezzo file;
 *  6. **il peso si aggiorna nella stessa transazione.** Ricodificare cambia i
 *     byte, e una riga che dichiara un peso sbagliato è un dato falso.
 *
 * Modulo di solo server.
 */

/** Che cosa si è trovato, o fatto, su un singolo file. */
export interface EsitoFile {
  file: string;
  genere: "foto" | "copertina" | "marchio";
  /** byte prima */
  byte: number;
  /** vero se il file portava metadati (EXIF, ICC o XMP) */
  conMetadati: boolean;
  /** byte dopo, se è stato riscritto */
  byteDopo?: number;
  stato: "pulito" | "da-pulire" | "riscritto" | "saltato" | "errore";
  motivo?: string;
}

export interface EsitoBonifica {
  /** vero se non è stato scritto niente */
  soloEsame: boolean;
  esaminati: number;
  conMetadati: number;
  riscritti: number;
  errori: number;
  file: EsitoFile[];
}

/**
 * Vero se il file porta metadati da togliere.
 *
 * Tre sorgenti, e vanno guardate tutte e tre: `exif` è dove stanno modello e
 * GPS, `icc` è il profilo colore che certi telefoni allegano, `xmp` è dove
 * finiscono i dati di chi ha modificato lo scatto. Nessuna delle tre serve a
 * mostrare una fotografia in una pagina.
 */
function haMetadati(m: Metadata): boolean {
  return Boolean(m.exif || m.icc || m.xmp);
}

/** I file che il database nomina come originali, con il loro genere. */
async function daiRiferimenti(): Promise<{ file: string; genere: EsitoFile["genere"] }[]> {
  const d = dbSeEsiste();
  if (!d) return [];

  const elenco: { file: string; genere: EsitoFile["genere"] }[] = [];

  for (const r of d.select({ file: tabellaFoto.file }).from(tabellaFoto).all()) {
    // per prudenza: una derivata in questa colonna sarebbe un guasto, ma se
    // c'è non la si riscrive comunque
    if (r.file && !eDerivata(r.file)) elenco.push({ file: r.file, genere: "foto" });
  }

  for (const r of d.select({ file: tabellaUnita.copertina }).from(tabellaUnita).all()) {
    if (r.file && !eDerivata(r.file)) elenco.push({ file: r.file, genere: "copertina" });
  }

  const { fileMarchioRegistrato } = await import("@/lib/gruppo");
  const marchio = await fileMarchioRegistrato();
  if (marchio) elenco.push({ file: marchio, genere: "marchio" });

  return elenco;
}

/**
 * Esamina, e — se `scrivi` — ripulisce.
 *
 * Senza `scrivi` non tocca **niente**: è la modalità che si guarda prima di
 * decidere, ed è quella predefinita perché su un archivio di fotografie di
 * ragazzi la modalità predefinita deve essere quella che non fa danni.
 */
export async function bonifica(scrivi = false): Promise<EsitoBonifica> {
  const riferimenti = await daiRiferimenti();
  const file: EsitoFile[] = [];

  for (const rif of riferimenti) {
    const percorso = join(CARTELLA_DATI, rif.file);
    let originale: Buffer;
    let meta: Metadata;
    let byte: number;

    try {
      originale = await readFile(percorso);
      byte = originale.length;
      meta = await sharp(originale).metadata();
    } catch (e) {
      // un file che la riga nomina e che non c'è è un guasto da segnalare, non
      // da riparare qui: `db:orfani` lo elenca come «riga senza file»
      file.push({
        file: rif.file,
        genere: rif.genere,
        byte: 0,
        conMetadati: false,
        stato: "errore",
        motivo: e instanceof Error ? e.message.split("\n")[0].slice(0, 80) : "non leggibile",
      });
      continue;
    }

    if (!haMetadati(meta)) {
      file.push({ file: rif.file, genere: rif.genere, byte, conMetadati: false, stato: "pulito" });
      continue;
    }

    if (!scrivi) {
      file.push({
        file: rif.file,
        genere: rif.genere,
        byte,
        conMetadati: true,
        stato: "da-pulire",
      });
      continue;
    }

    const esito = await riscrivi(percorso, originale, meta, rif);
    file.push(esito);
  }

  return {
    soloEsame: !scrivi,
    esaminati: file.length,
    conMetadati: file.filter((f) => f.conMetadati).length,
    riscritti: file.filter((f) => f.stato === "riscritto").length,
    errori: file.filter((f) => f.stato === "errore").length,
    file,
  };
}

/**
 * Riscrive un file ripulito, con la verifica prima e dopo.
 *
 * L'ordine è quello che rende l'operazione reversibile fino all'ultimo passo:
 * si produce il file nuovo, lo si controlla, e **solo se tutto torna** lo si
 * mette al posto del vecchio. Un guasto a metà lascia al massimo un `.bonifica`
 * accanto, che si cancella; l'originale non è mai in bilico.
 */
async function riscrivi(
  percorso: string,
  originale: Buffer,
  meta: Metadata,
  rif: { file: string; genere: EsitoFile["genere"] },
): Promise<EsitoFile> {
  const base: EsitoFile = {
    file: rif.file,
    genere: rif.genere,
    byte: originale.length,
    conMetadati: true,
    stato: "errore",
  };

  const contenitore = contenitoreDi(originale);
  if (!contenitore) {
    return { ...base, stato: "saltato", motivo: "non è un'immagine riconosciuta" };
  }

  const provvisorio = `${percorso}.bonifica`;
  try {
    const { dati: pulito } = await ripulisciOriginale(originale, contenitore);

    // ---- la verifica, PRIMA di sostituire
    const dopo = await sharp(pulito).metadata();
    if (haMetadati(dopo)) {
      return { ...base, stato: "errore", motivo: "la ricodifica non ha tolto i metadati" };
    }
    if (dopo.width !== meta.width || dopo.height !== meta.height) {
      /*
       * Le misure devono restare quelle. L'unico caso in cui cambiano è
       * l'orientamento EXIF applicato ai pixel — e allora le misure nuove sono
       * quelle **giuste**, perché le righe del database le hanno registrate
       * già ruotate (`misureVere` applica l'orientamento). Si accetta lo
       * scambio dei due lati, e nient'altro.
       */
      const scambiate = dopo.width === meta.height && dopo.height === meta.width;
      if (!scambiate) {
        return {
          ...base,
          stato: "errore",
          motivo: `misure cambiate: ${meta.width}×${meta.height} → ${dopo.width}×${dopo.height}`,
        };
      }
    }

    await writeFile(provvisorio, pulito);
    // rename sullo stesso filesystem è atomico: o il vecchio o il nuovo
    await rename(provvisorio, percorso);

    // ---- e la verifica DOPO, sul file che adesso c'è davvero
    const riletto = await sharp(await readFile(percorso)).metadata();
    if (haMetadati(riletto)) {
      return { ...base, stato: "errore", motivo: "dopo la scrittura i metadati ci sono ancora" };
    }

    const dimensione = (await stat(percorso)).size;
    aggiornaPeso(rif, dimensione);

    return { ...base, stato: "riscritto", byteDopo: dimensione };
  } catch (e) {
    await unlink(provvisorio).catch(() => {});
    return {
      ...base,
      stato: "errore",
      motivo: e instanceof Error ? e.message.split("\n")[0].slice(0, 80) : "guasto",
    };
  }
}

/**
 * Aggiorna il peso registrato, per i soli generi che lo registrano.
 *
 * Ricodificare cambia i byte; una riga che dichiara il peso vecchio dice una
 * cosa falsa, e quel numero si vede nella schermata degli album. Copertina e
 * marchio non hanno una colonna del peso, quindi non c'è niente da allineare.
 */
function aggiornaPeso(rif: { file: string; genere: EsitoFile["genere"] }, byte: number): void {
  if (rif.genere !== "foto") return;
  transazione((d) => {
    d.update(tabellaFoto).set({ peso: byte }).where(eq(tabellaFoto.file, rif.file)).run();
  });
}
