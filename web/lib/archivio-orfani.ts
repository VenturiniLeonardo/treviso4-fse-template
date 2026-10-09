import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { dbSeEsiste } from "@/lib/db/db";
import { CARTELLA_DATI } from "@/lib/db/percorso";
import { documenti, documentiReferenti, foto, immagini, pagineTesti, unita } from "@/lib/db/schema";
import { LATI, nomeDerivata } from "@/lib/foto/derivate";
import { fileDelleProposte } from "@/lib/proposte-store";

/**
 * Che cosa c'è in archivio che nessuno indicizza, e viceversa.
 *
 * Modulo di solo server, e di sola **lettura**: qui non si cancella niente. Chi
 * cancella è lo script, e solo dopo che una persona ha guardato l'elenco.
 *
 * ## Perché è l'operazione più pericolosa del progetto
 *
 * Cancellare file guardando il database vuol dire fidarsi che il database sia
 * quello giusto, completo e leggibile. Se una sola di quelle tre cose non è
 * vera — un `SITO_DB` sbagliato nell'ambiente, un ripristino a metà, una
 * tabella vuota perché una migrazione non è passata — l'elenco degli «orfani»
 * diventa l'elenco di tutte le fotografie del gruppo.
 *
 * Da qui le tre regole che questo modulo applica e che lo script non può
 * aggirare:
 *
 *  1. **si guardano solo i nomi che genera l'applicazione** — `foto-`, `doc-`,
 *     `marchio-`. Il database, il WAL, i JSON e qualunque cosa una persona
 *     abbia messo lì non entrano nell'elenco nemmeno per sbaglio;
 *  2. **un archivio pieno con un database vuoto è un errore, non un elenco di
 *     orfani** — `sospetto()` lo riconosce e lo dice;
 *  3. **c'è un periodo di grazia**: un file scritto pochi minuti fa può essere
 *     il caricamento di qualcuno la cui riga sta per essere scritta.
 *
 * ## L'asimmetria che nessuno guardava
 *
 * Un file senza riga occupa spazio e basta. Una **riga senza file** è una
 * fotografia che il sito mostra come riquadro rotto, o un documento che si
 * scarica in un errore. È il guasto più visibile dei due, e fino a qui non lo
 * cercava nessuno: `righeSenzaFile()` lo cerca, e non propone di cancellare
 * niente — quelle righe si sistemano ricaricando il file, non buttando la riga.
 */

/**
 * I prefissi che l'applicazione genera. Tutto il resto non si tocca.
 *
 * **Aggiungere un prefisso qui senza aggiungere i suoi nomi a `nomiAttesi` è
 * il modo di cancellare dei file veri.** Il primo elenco dice «questi file li
 * conosco», il secondo «questi mi servono»: un file nel primo e non nel secondo
 * è, per definizione, un orfano da buttare. `copertina-` è entrato in entrambi
 * nella fase 14, nella stessa modifica, e la prova che le copertine non
 * risultano orfane sta in `test/orfani.test.mjs`. `immagine-` è entrato allo
 * stesso modo con i diciotto posti fotografici delle pagine, e ha la sua prova
 * lì accanto: senza, tutte le fotografie della home e dei ritratti sarebbero
 * risultate orfane alla prima esecuzione — cioè da cancellare.
 * `referenti-`, i documenti per i referenti, è entrato con la migrazione 0019, allo stesso
 * modo e con la sua prova.
 */
const PREFISSI = ["foto-", "doc-", "marchio-", "copertina-", "immagine-", "referenti-"] as const;

export interface Orfano {
  nome: string;
  byte: number;
  /** giorni da quando è stato scritto */
  giorni: number;
}

export interface RigaSenzaFile {
  genere: "foto" | "documento" | "marchio" | "copertina" | "immagine" | "documento per i referenti";
  /** l'indirizzo o l'identificativo con cui ritrovarlo nell'area riservata */
  dove: string;
  file: string;
}

export interface Esito {
  orfani: Orfano[];
  righeSenzaFile: RigaSenzaFile[];
  /** quanti file dell'applicazione ci sono in tutto */
  esaminati: number;
  /** quanti nomi il database si aspetta */
  attesi: number;
  /** valorizzato quando i numeri non hanno senso: allora non si cancella niente */
  sospetto?: string;
}

/**
 * I documenti per i referenti, se la migrazione 0019 c'è.
 *
 * Senza la tabella non ci sono nemmeno file `referenti-` da aspettarsi, e chiederli
 * al database fermerebbe con «no such table» un controllo che fino al giorno
 * prima funzionava — lo script degli orfani può girare con il codice nuovo su
 * un database non ancora migrato, nella finestra del rilascio.
 */
function righeDocumentiReferenti(d: NonNullable<ReturnType<typeof dbSeEsiste>>) {
  const presente = d.$client
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'documenti_referenti'")
    .get();
  if (!presente) return [];
  return d.select({ id: documentiReferenti.id, file: documentiReferenti.file }).from(documentiReferenti).all();
}

/** Tutti i nomi di file che il database si aspetta di trovare in archivio. */
function nomiAttesi(d: NonNullable<ReturnType<typeof dbSeEsiste>>): Set<string> {
  const attesi = new Set<string>();

  for (const r of d.select({ file: foto.file }).from(foto).all()) {
    attesi.add(r.file);
    // le derivate non stanno in nessuna colonna: si ricavano, come le ricava
    // chi le serve. Dimenticarlo qui vorrebbe dire cancellare le tre versioni
    // ridotte di ogni fotografia del sito
    for (const lato of LATI) attesi.add(nomeDerivata(r.file, lato));
  }

  for (const r of d.select({ file: documenti.file }).from(documenti).all()) {
    if (r.file) attesi.add(r.file);
  }

  // il marchio sta in `pagine_testi` come valore di una chiave, non in una
  // colonna `file`: si legge di lì
  for (const r of d.select({ chiave: pagineTesti.chiave, valore: pagineTesti.valore }).from(pagineTesti).all()) {
    if (r.chiave.endsWith("marchioFile") && r.valore) attesi.add(r.valore);
  }

  // Le copertine delle unità, con le loro derivate. Come per le fotografie, le
  // derivate non stanno in nessuna colonna: si ricavano, come le ricava chi le
  // serve. Dimenticare questo ciclo vorrebbe dire proporre di cancellare
  // l'immagine in cima a tutte e sei le pagine d'unità.
  for (const r of d.select({ file: unita.copertina }).from(unita).all()) {
    if (!r.file) continue;
    attesi.add(r.file);
    for (const lato of LATI) attesi.add(nomeDerivata(r.file, lato));
  }

  /*
   * Le immagini dei posti fissi del disegno, con le loro derivate.
   *
   * Stessa forma delle copertine, e stessa trappola: le derivate non stanno in
   * nessuna colonna e si ricavano. Senza questo ciclo, le tre derivate di ogni
   * fotografia della home e di ogni ritratto sarebbero risultate orfane —
   * settantadue file da cancellare, a posti tutti pieni.
   */
  for (const r of d.select({ file: immagini.file }).from(immagini).all()) {
    attesi.add(r.file);
    for (const lato of LATI) attesi.add(nomeDerivata(r.file, lato));
  }

  /*
   * Le fotografie in attesa di approvazione (0013), con le loro derivate.
   *
   * Hanno già il nome che avranno una volta approvate — `immagine-…` e
   * `copertina-…` — quindi i prefissi le riconoscono, e senza questo ciclo
   * sarebbero orfane: nessuna riga di `immagini` né di `unita` le nomina
   * finché un gestore non le guarda. La grazia di sette giorni non basta,
   * perché una proposta può aspettare più di una settimana.
   */
  for (const file of fileDelleProposte(d)) {
    attesi.add(file);
    for (const lato of LATI) attesi.add(nomeDerivata(file, lato));
  }

  // I documenti per i referenti: un file ciascuno, niente derivate. Dimenticarli
  // qui vorrebbe dire proporre di cancellare ogni verbale caricato.
  for (const r of righeDocumentiReferenti(d)) attesi.add(r.file);

  return attesi;
}

/**
 * Confronta l'archivio con il database. Non tocca niente.
 *
 * `graziaGiorni` è il periodo sotto il quale un file non si considera orfano
 * comunque: sette giorni per difetto. Un caricamento appena fatto, o una riga
 * scritta da una transazione che deve ancora concludersi, non devono finire in
 * un elenco di cose da buttare.
 */
export function confronta(graziaGiorni = 7): Esito {
  const d = dbSeEsiste();
  if (!d) {
    return {
      orfani: [],
      righeSenzaFile: [],
      esaminati: 0,
      attesi: 0,
      sospetto: "il database non è raggiungibile: non si può dire che cosa sia orfano",
    };
  }

  const attesi = nomiAttesi(d);

  let file: string[];
  try {
    file = readdirSync(CARTELLA_DATI, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => PREFISSI.some((p) => n.startsWith(p)));
  } catch {
    return {
      orfani: [],
      righeSenzaFile: [],
      esaminati: 0,
      attesi: attesi.size,
      sospetto: `non riesco a leggere ${CARTELLA_DATI}`,
    };
  }

  const adesso = Date.now();
  const orfani: Orfano[] = [];
  for (const nome of file) {
    if (attesi.has(nome)) continue;
    let s;
    try {
      s = statSync(join(CARTELLA_DATI, nome));
    } catch {
      continue; // sparito mentre guardavamo: non è un problema nostro
    }
    const giorni = Math.floor((adesso - s.mtimeMs) / 86_400_000);
    if (giorni < graziaGiorni) continue;
    orfani.push({ nome, byte: s.size, giorni });
  }

  const presenti = new Set(file);
  const righeSenzaFile: RigaSenzaFile[] = [];

  for (const r of d.select({ file: foto.file }).from(foto).all()) {
    if (!presenti.has(r.file)) {
      righeSenzaFile.push({ genere: "foto", dove: r.file, file: r.file });
    }
  }
  for (const r of d.select({ id: documenti.id, file: documenti.file }).from(documenti).all()) {
    if (r.file && !presenti.has(r.file)) {
      righeSenzaFile.push({ genere: "documento", dove: `documento #${r.id}`, file: r.file });
    }
  }
  /*
   * Una copertina registrata il cui file non c'è.
   *
   * È il guasto più visibile dell'intero elenco: non una fotografia che manca in
   * fondo a un album, ma l'immagine in cima alla pagina di un'unità. La rotta
   * `/copertina/[file]` prova prima la derivata e poi l'originale, quindi qui si
   * segnala solo quando **manca l'originale** — se ci sono le derivate la pagina
   * si vede comunque, e nominarla sarebbe un allarme per un guasto che nessuno
   * nota.
   */
  for (const r of d.select({ chiave: unita.chiave, file: unita.copertina }).from(unita).all()) {
    if (r.file && !presenti.has(r.file)) {
      righeSenzaFile.push({
        genere: "copertina",
        dove: `copertina di ${r.chiave}`,
        file: r.file,
      });
    }
  }

  // Un posto del disegno la cui immagine non è più in archivio. Come per le
  // copertine, si segnala solo quando manca l'originale: con le derivate la
  // pagina si vede comunque.
  for (const r of d.select({ chiave: immagini.chiave, file: immagini.file }).from(immagini).all()) {
    if (!presenti.has(r.file)) {
      righeSenzaFile.push({
        genere: "immagine",
        dove: `immagine «${r.chiave}»`,
        file: r.file,
      });
    }
  }

  for (const r of righeDocumentiReferenti(d)) {
    if (!presenti.has(r.file)) {
      righeSenzaFile.push({
        genere: "documento per i referenti",
        dove: `documento per i referenti #${r.id}`,
        file: r.file,
      });
    }
  }

  return {
    orfani: orfani.sort((a, b) => b.byte - a.byte),
    righeSenzaFile,
    esaminati: file.length,
    attesi: attesi.size,
    sospetto: sospetto(file.length, attesi.size, orfani.length),
  };
}

/**
 * Riconosce la situazione in cui l'elenco degli orfani **non va creduto**.
 *
 * Il caso che fa danno: l'archivio è pieno e il database non sa niente di
 * quei file. Da fuori è indistinguibile da «ci sono molti orfani», e le due
 * cose portano a decisioni opposte — nella seconda si cancella, nella prima si
 * cerca perché si sta guardando il database sbagliato.
 *
 * La soglia è grossolana apposta: metà dei file orfani è già un numero che in
 * un archivio sano non si vede, e sbagliare per eccesso di prudenza qui costa
 * una lettura in più a una persona.
 */
function sospetto(esaminati: number, attesi: number, orfani: number): string | undefined {
  if (esaminati === 0) return undefined;
  if (attesi === 0) {
    return (
      `ci sono ${esaminati} file in archivio e il database non ne indicizza nessuno. ` +
      "Quasi certamente state guardando il database sbagliato, o una migrazione " +
      "non è passata: NON cancellate niente prima di aver capito perché."
    );
  }
  if (orfani > esaminati / 2) {
    return (
      `${orfani} file su ${esaminati} risultano orfani: è troppo per un archivio sano. ` +
      "Controllate SITO_DB prima di procedere."
    );
  }
  return undefined;
}
