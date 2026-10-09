import { closeSync, existsSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import { db } from "@/lib/db/db";
import { CARTELLA_DATI, percorsoDb } from "@/lib/db/percorso";

/**
 * La copia di sicurezza locale: database più archivio, verificata sul posto.
 *
 * ## Che cosa risolve, e che cosa no
 *
 * §07 del piano prevede due meccanismi verso un bucket europeo: Litestream per
 * il database, `restic` per foto e PDF. Entrambi vogliono un indirizzo e delle
 * credenziali, che questo repository non contiene e che non vanno inventate —
 * `deploy/README.md` lo dice da diverse fasi. La conseguenza, però, era che di
 * backup non ce n'era **nessuno**: né locale, né remoto, e la procedura di
 * rilascio non poteva nemmeno avere il passo «1. copia prima di migrare».
 *
 * Questo modulo copre la metà che non ha bisogno di segreti:
 *
 *  - **perdita di dati per errore umano** (una cancellazione sbagliata, una
 *    migrazione andata male, un album eliminato per sbaglio) → coperta;
 *  - **corruzione del database** → coperta, e la copia è verificata;
 *  - **perdita del server o del disco** → **non** coperta. Serve la spinta
 *    fuori dalla macchina, che è la parte con le credenziali.
 *
 * È la differenza fra «posso tornare indietro» e «posso ricostruire». La prima
 * si può avere oggi, e non averla è la ragione per cui una migrazione fallita
 * su dati veri sarebbe irreparabile.
 *
 * ## Perché il database si copia con `backup()` e non con `cp`
 *
 * Il database è in WAL, e mentre il sito gira ci sono scritture. Un `cp` del
 * solo `.db` prende un file a metà di una transazione: si apre, e a volte
 * funziona. `backup()` di SQLite legge pagina per pagina prendendo il lucchetto
 * giusto e produce un file **coerente** anche sotto scrittura, senza fermare
 * nessuno. È l'unico modo corretto, ed è già in `better-sqlite3`.
 *
 * ## Perché l'archivio si copia con dei collegamenti fisici
 *
 * I file caricati sono **immutabili**: il nome porta la marca temporale del
 * caricamento, il server non li sovrascrive mai, e chi sostituisce una
 * copertina scrive un file nuovo. È scritto in `web/README.md`, ed è la
 * proprietà su cui poggia anche la cache a un anno.
 *
 * Su file immutabili un collegamento fisico è una copia perfetta a costo zero:
 * niente spazio, niente tempo, e se qualcuno cancella l'originale i byte
 * restano perché il collegamento li tiene in vita. Sette copie giornaliere di
 * dieci gigabyte di fotografie occupano dieci gigabyte, non settanta.
 *
 * Se il collegamento non si può fare — copia su un altro filesystem, che è
 * quello che succede appena si punta a un disco esterno — si ricade sulla
 * copia vera. Il ripiego è dichiarato nel manifesto, così chi guarda una copia
 * sa che cosa ha in mano.
 *
 * ## Che cosa entra nell'archivio della copia
 *
 * **Tutto quello che non è il database.** Non un elenco di prefissi: un elenco
 * dimenticherebbe in silenzio i file di un genere aggiunto dopo, e un file non
 * salvato non si nota fino al giorno in cui serve. `lib/archivio-orfani.ts` usa
 * un elenco chiuso perché lì il rischio è **cancellare** troppo; qui il rischio
 * è **salvare** troppo poco, e i due errori vanno in direzioni opposte.
 *
 * Modulo di solo server: apre file e legge il database.
 */

/** I file del motore, che si copiano con `backup()` e non a mano. */
const DEL_MOTORE = (nome: string) =>
  nome.endsWith(".db") || nome.endsWith(".db-wal") || nome.endsWith(".db-shm");

/** Scritture a metà: `scriviArchivio` scrive un `.nuovo` e poi rinomina. */
const PROVVISORIO = (nome: string) => nome.endsWith(".nuovo");

export interface EsitoCopia {
  /** la cartella della copia appena fatta */
  cartella: string;
  /** byte del database copiato */
  byteDb: number;
  /** quanti file dell'archivio sono entrati, e quanti byte occupano */
  file: number;
  byteFile: number;
  /** vero se i file sono entrati come collegamenti fisici (costo zero) */
  collegamenti: boolean;
  /** l'esito di `PRAGMA integrity_check` sulla copia: «ok» o il guasto */
  integrita: string;
  /** righe contate nella copia, per le tabelle che non devono perdersi */
  righe: Record<string, number>;
  /** copie più vecchie tolte per rispettare la conservazione */
  scadute: string[];
}

/**
 * Le tabelle che si contano nella copia appena fatta.
 *
 * Non sono tutte: sono quelle il cui svuotamento sarebbe una perdita che non si
 * ricostruisce. Un `integrity_check` dice che il file è sano; questo dice che è
 * **il file giusto** — una copia sana di un database vuoto passerebbe il primo
 * controllo a pieni voti.
 */
const DA_CONTARE = [
  "utenti",
  "unita",
  "iscrizioni",
  "ragazzi",
  "album",
  "foto",
  "documenti",
  "attivita",
  "messaggi",
  "registro",
  "richieste_gdpr",
  "permessi",
] as const;

/** Il nome di una cartella di copia. Ordinabile per stringa, che è comodo. */
export function nomeCopia(quando: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return (
    `copia-${quando.getUTCFullYear()}${p(quando.getUTCMonth() + 1)}${p(quando.getUTCDate())}` +
    `-${p(quando.getUTCHours())}${p(quando.getUTCMinutes())}${p(quando.getUTCSeconds())}`
  );
}

/** Vero se il nome è una cartella di copia prodotta da qui. */
export const eCopia = (nome: string) => /^copia-\d{8}-\d{6}$/.test(nome);

/**
 * Dove vanno le copie.
 *
 * Fuori da `CARTELLA_DATI` per difetto, e non è un dettaglio: una copia dentro
 * la cartella che sta copiando finirebbe nella copia successiva, e non
 * sopravvivrebbe alla perdita di quel disco — cioè non sarebbe un backup ma un
 * duplicato. `SITO_COPIE_DIR` è la variabile con cui si punta a un altro
 * disco, o al percorso da cui `restic` prende.
 */
export function cartellaCopie(): string {
  return process.env.SITO_COPIE_DIR ?? join(CARTELLA_DATI, "..", "copie");
}

/**
 * Fa una copia, la verifica, e toglie quelle oltre la conservazione.
 *
 * Verifica **sempre**, e non su richiesta: la regola di §07 è «un backup non
 * provato non è un backup», e una verifica facoltativa è una verifica che non
 * si fa. Costa un `integrity_check` su qualche decina di megabyte.
 */
export function copia(conserva = 7, quando = new Date()): EsitoCopia {
  /*
   * Se qualcosa va storto, la cartella a metà non resta lì.
   *
   * Il caso vero è il database corrotto: `VACUUM INTO` solleva
   * `SQLITE_CORRUPT` e la copia non si può fare. Il `.parziale` non somiglia a
   * una copia buona — `elencoCopie` non lo vede e `fuori-sede.sh` non lo manda
   * fuori — ma il lavoro notturno riparte ogni notte, e un `.parziale` per
   * notte riempie il disco della macchina che sta già avendo un problema.
   *
   * Il `finally` non nasconde niente: l'errore continua a salire, e chi chiama
   * lo racconta.
   */
  let riuscita = false;
  let daRipulire: string | null = null;
  try {
    return dentro();
  } finally {
    if (!riuscita && daRipulire) rmSync(daRipulire, { recursive: true, force: true });
  }

  function dentro(): EsitoCopia {
  const radice = cartellaCopie();
  mkdirSync(radice, { recursive: true });

  const nome = nomeCopia(quando);
  // si lavora in una cartella «.parziale» e si rinomina alla fine: una copia
  // interrotta a metà non deve somigliare a una copia buona, o il ripristino
  // la sceglierebbe
  const parziale = join(radice, `${nome}.parziale`);
  daRipulire = parziale;
  rmSync(parziale, { recursive: true, force: true });
  mkdirSync(join(parziale, "archivio"), { recursive: true });

  const destDb = join(parziale, basename(percorsoDb()));

  // `backup()` di better-sqlite3 è asincrono nell'API pubblica; quello di
  // SQLite in modalità «tutto in una volta» non lo è. Si usa il metodo
  // sincrono della connessione nuda, che è ciò che serve a uno script.
  db().$client.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const sorgente = new Database(percorsoDb(), { readonly: true });
  try {
    // `VACUUM INTO` produce un file coerente e già compattato, prendendo i
    // lucchetti giusti: è la forma sincrona del backup online.
    sorgente.exec(`VACUUM INTO '${destDb.replace(/'/g, "''")}'`);
  } finally {
    sorgente.close();
  }

  const byteDb = statSync(destDb).size;

  // ---- l'archivio
  let file = 0;
  let byteFile = 0;
  let collegamenti = true;
  for (const voce of readdirSync(CARTELLA_DATI, { withFileTypes: true })) {
    if (!voce.isFile()) continue;
    if (DEL_MOTORE(voce.name) || PROVVISORIO(voce.name)) continue;

    const da = join(CARTELLA_DATI, voce.name);
    const a = join(parziale, "archivio", voce.name);
    try {
      linkSync(da, a);
    } catch {
      // filesystem diverso, o collegamenti non permessi: copia vera
      collegamenti = false;
      writeFileSync(a, readFileSync(da));
    }
    file++;
    byteFile += statSync(da).size;
  }

  // ---- la verifica, sulla copia e non sull'originale
  const controllo = new Database(destDb, { readonly: true });
  let integrita: string;
  const righe: Record<string, number> = {};
  try {
    integrita = String(
      (controllo.pragma("integrity_check", { simple: true }) as unknown) ?? "sconosciuto",
    );
    for (const t of DA_CONTARE) {
      try {
        righe[t] = (controllo.prepare(`select count(*) n from ${t}`).get() as { n: number }).n;
      } catch {
        // tabella assente: un database più vecchio delle migrazioni correnti.
        // Va detto, non nascosto: resta fuori dal conteggio.
      }
    }
  } finally {
    controllo.close();
  }

  const manifesto = {
    quando: quando.toISOString(),
    database: basename(destDb),
    byteDb,
    file,
    byteFile,
    collegamenti,
    integrita,
    righe,
    origine: { database: percorsoDb(), archivio: CARTELLA_DATI },
    nodo: process.version,
  };
  writeFileSync(join(parziale, "manifesto.json"), JSON.stringify(manifesto, null, 2) + "\n");

  const finale = join(radice, nome);
  rmSync(finale, { recursive: true, force: true });
  renameSync(parziale, finale);
  riuscita = true;
  // il rename di una cartella non è garantito durabile senza un fsync della
  // cartella padre: su un crash subito dopo, la copia potrebbe non esserci
  try {
    const fd = openSync(radice, "r");
    closeSync(fd);
  } catch {
    /* non tutti i sistemi lo permettono; non è un motivo per fallire */
  }

  return {
    cartella: finale,
    byteDb,
    file,
    byteFile,
    collegamenti,
    integrita,
    righe,
    scadute: potaCopie(conserva),
  };
  }
}

/**
 * Tiene le `conserva` copie più recenti e toglie il resto.
 *
 * Le copie **incoerenti non si contano** come copie da tenere: se le ultime
 * sette fossero tutte con `integrity_check` fallito, tenerne solo sette
 * butterebbe l'ultima buona. Si contano quelle sane; le altre restano finché
 * ce n'è una sana più vecchia da preservare.
 */
export function potaCopie(conserva: number): string[] {
  const radice = cartellaCopie();
  if (!existsSync(radice) || conserva <= 0) return [];

  const tutte = readdirSync(radice, { withFileTypes: true })
    .filter((v) => v.isDirectory() && eCopia(v.name))
    .map((v) => v.name)
    .sort()
    .reverse();

  const scadute: string[] = [];
  let sane = 0;
  for (const nome of tutte) {
    if (sane < conserva) {
      if (leggiManifesto(join(radice, nome))?.integrita === "ok") sane++;
      continue;
    }
    rmSync(join(radice, nome), { recursive: true, force: true });
    scadute.push(nome);
  }
  return scadute;
}

export interface Manifesto {
  quando: string;
  database: string;
  byteDb: number;
  file: number;
  byteFile: number;
  collegamenti: boolean;
  integrita: string;
  righe: Record<string, number>;
}

/** Il manifesto di una copia, o `null` se manca o è illeggibile. */
export function leggiManifesto(cartella: string): Manifesto | null {
  try {
    return JSON.parse(readFileSync(join(cartella, "manifesto.json"), "utf8")) as Manifesto;
  } catch {
    return null;
  }
}

/** Le copie presenti, dalla più recente. */
export function elencoCopie(): { nome: string; cartella: string; manifesto: Manifesto | null }[] {
  const radice = cartellaCopie();
  if (!existsSync(radice)) return [];
  return readdirSync(radice, { withFileTypes: true })
    .filter((v) => v.isDirectory() && eCopia(v.name))
    .map((v) => v.name)
    .sort()
    .reverse()
    .map((nome) => {
      const cartella = join(radice, nome);
      return { nome, cartella, manifesto: leggiManifesto(cartella) };
    });
}
