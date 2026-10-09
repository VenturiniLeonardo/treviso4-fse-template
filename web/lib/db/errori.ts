/**
 * Traduzione degli errori del database in errori applicativi.
 *
 * Esiste per una ragione dimostrata, non per prudenza generica. La fase 1 ha
 * verificato che Drizzle avvolge gli errori di SQLite così:
 *
 *   e.name          "DrizzleError"
 *   e.message       "Failed to run the query 'UPDATE t SET stato = 'pubblicato' WHERE id = 1'"
 *   e.cause.name    "SqliteError"
 *   e.cause.message "consensi immagini mancanti"
 *   e.cause.code    "SQLITE_CONSTRAINT_TRIGGER"
 *
 * `e.message` **contiene l'SQL completo con i valori**. §11 del piano vieta di
 * mandarlo al browser, e non è una formalità: quella stringa può contenere il
 * nome di un ragazzo, l'indirizzo di una famiglia, l'impronta di una sessione.
 * Quindi qui si legge `e.cause`, mai `e.message`, e verso l'esterno esce solo un
 * codice più una frase scritta a mano.
 *
 * Il dettaglio tecnico non si perde: finisce nel registro del server, dove chi
 * amministra lo vede, associato al codice che l'utente può riferire.
 *
 * Non importa `node:*` né lo schema: può stare in qualunque catena di import.
 */

/**
 * I generi di errore che l'applicazione distingue.
 *
 * Sono quelli di §19 del piano. Restano pochi di proposito: un elenco più fine
 * non cambierebbe né il messaggio all'utente né la decisione di chi legge il
 * registro.
 */
export type GenereErrore =
  | "vincolo"
  | "conflitto"
  | "chiave_esterna"
  | "trigger"
  | "non_trovato"
  | "database"
  | "filesystem"
  | "sconosciuto";

export interface ErroreMappato {
  genere: GenereErrore;
  /** codice che l'utente può riferire chiedendo aiuto */
  codice: string;
  /** frase per il browser: scritta qui, mai proveniente dal database */
  messaggio: string;
  /**
   * Dettaglio per il registro del server. Contiene il messaggio di SQLite —
   * **non** quello di Drizzle — e non va mai restituito al browser.
   */
  dettaglio: string;
}

/** La forma degli errori di better-sqlite3, senza fidarsi che sia quella. */
interface ErroreSqlite {
  name?: string;
  message?: string;
  code?: string;
}

function causaSqlite(errore: unknown): ErroreSqlite | null {
  if (typeof errore !== "object" || errore === null) return null;

  // Drizzle mette l'originale in `cause`; better-sqlite3 chiamato direttamente
  // è già lui l'originale
  const e = errore as { cause?: unknown; name?: string; code?: string; message?: string };
  const candidata = (e.cause ?? e) as ErroreSqlite;

  if (typeof candidata !== "object" || candidata === null) return null;
  if (typeof candidata.code === "string" && candidata.code.startsWith("SQLITE_")) {
    return candidata;
  }
  return null;
}

/**
 * Da un errore qualunque a un errore mappato.
 *
 * Non solleva mai: qualunque cosa le si dia produce un `ErroreMappato`. È il
 * punto in cui si smette di ragionare per casi e si comincia a ragionare per
 * codici, e deve valere anche per l'errore che non abbiamo previsto.
 */
export function mappaErroreDatabase(errore: unknown): ErroreMappato {
  const causa = causaSqlite(errore);

  if (!causa) {
    // non è un errore di SQLite: può essere il nostro «database non disponibile»,
    // un errore di filesystem, o un difetto di programmazione
    const codiceNode =
      typeof errore === "object" && errore !== null
        ? (errore as { code?: string }).code
        : undefined;

    if (typeof codiceNode === "string" && ["ENOENT", "EACCES", "ENOSPC", "EROFS"].includes(codiceNode)) {
      return {
        genere: "filesystem",
        codice: `FS_${codiceNode}`,
        messaggio:
          "Non riesco a leggere o scrivere un file sul server. Riprovate; " +
          "se continua, segnalatelo a chi amministra il sito.",
        dettaglio: `errore di filesystem ${codiceNode}`,
      };
    }

    return {
      genere: "sconosciuto",
      codice: "DB_SCONOSCIUTO",
      messaggio:
        "Qualcosa non ha funzionato sul server. Riprovate; se continua, " +
        "segnalate il codice DB_SCONOSCIUTO a chi amministra il sito.",
      // il messaggio del nostro Error è scritto da noi, non dal database:
      // qui non c'è SQL. Di un errore ignoto si tiene solo il nome.
      dettaglio: errore instanceof Error ? `${errore.name}: ${errore.message}` : String(errore),
    };
  }

  const codice = causa.code ?? "SQLITE_ERROR";
  // il messaggio di SQLite: descrive il vincolo, non contiene i valori
  const dettaglio = `${codice}${causa.message ? `: ${causa.message}` : ""}`;

  // Il trigger va per primo: è il cancello dei consensi, ed è l'unico caso in
  // cui il messaggio dal database è stato scritto da noi (nel RAISE) e quindi è
  // sicuro da usare come discriminante — mai da inoltrare così com'è.
  if (codice === "SQLITE_CONSTRAINT_TRIGGER") {
    return {
      genere: "trigger",
      codice: "REGOLA_DB",
      messaggio:
        "L’operazione è stata bloccata da una regola del sistema. " +
        "Controllate i requisiti e riprovate.",
      dettaglio,
    };
  }

  if (codice === "SQLITE_CONSTRAINT_UNIQUE" || codice === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return {
      genere: "conflitto",
      codice: "GIA_ESISTE",
      messaggio: "Esiste già una voce con questi dati.",
      dettaglio,
    };
  }

  if (codice === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    return {
      genere: "chiave_esterna",
      codice: "RIFERIMENTO_MANCANTE",
      messaggio:
        "Questa operazione fa riferimento a qualcosa che non esiste più. " +
        "Ricaricate la pagina e riprovate.",
      dettaglio,
    };
  }

  if (codice.startsWith("SQLITE_CONSTRAINT")) {
    // CHECK, NOT NULL, e gli altri vincoli
    return {
      genere: "vincolo",
      codice: "DATI_NON_VALIDI",
      messaggio: "Alcuni dati non sono validi. Controllate i campi e riprovate.",
      dettaglio,
    };
  }

  if (codice === "SQLITE_BUSY" || codice === "SQLITE_LOCKED") {
    return {
      genere: "database",
      codice: "OCCUPATO",
      messaggio:
        "Il sistema era occupato da un’altra operazione. Riprovate fra qualche istante.",
      dettaglio,
    };
  }

  if (codice === "SQLITE_READONLY" || codice === "SQLITE_CANTOPEN" || codice === "SQLITE_FULL") {
    return {
      genere: "database",
      codice: "DB_NON_SCRIVIBILE",
      messaggio:
        "Non riesco a salvare sul server. Segnalate il codice DB_NON_SCRIVIBILE " +
        "a chi amministra il sito.",
      dettaglio,
    };
  }

  return {
    genere: "database",
    codice: "DB_ERRORE",
    messaggio:
      "Qualcosa non ha funzionato salvando i dati. Riprovate; se continua, " +
      "segnalate il codice DB_ERRORE a chi amministra il sito.",
    dettaglio,
  };
}

/**
 * Registra il dettaglio sulla console del server e restituisce l'errore mappato.
 *
 * Due cose in una perché non vanno separate: il dettaglio serve *adesso*, nel
 * momento in cui l'errore accade, e un `catch` che mappa senza registrare butta
 * via l'unica informazione utile a capire cos'è successo.
 */
export function registraEMappa(dove: string, errore: unknown): ErroreMappato {
  const mappato = mappaErroreDatabase(errore);
  console.error(`[${dove}] ${mappato.codice} — ${mappato.dettaglio}`);
  return mappato;
}

/**
 * Trasforma un errore mappato nella forma che le azioni già restituiscono ai
 * form (`StatoAzione` di `lib/contenuti.ts`).
 *
 * Il tipo di ritorno è strutturale e non importato: `lib/contenuti.ts` importa
 * `lib/data.ts`, e questo modulo deve restare importabile da qualunque parte.
 */
export function comeStatoAzione(e: ErroreMappato): {
  stato: "errore";
  messaggio: string;
  codice: string;
} {
  return { stato: "errore", messaggio: e.messaggio, codice: e.codice };
}

/**
 * Un errore del database già ripulito, pronto a uscire da uno store.
 *
 * `message` è la frase scritta da noi, non quella del database: se qualcuno la
 * restituisce così com'è — ed è quello che farà chi legge questo codice fra due
 * anni — non fa danni. È il motivo per cui questa classe porta il messaggio
 * sicuro e non l'originale.
 */
export class ErroreDatabase extends Error {
  readonly codice: string;
  readonly genere: GenereErrore;

  constructor(mappato: ErroreMappato) {
    super(mappato.messaggio);
    this.name = "ErroreDatabase";
    this.codice = mappato.codice;
    this.genere = mappato.genere;
  }
}

/**
 * Registra il dettaglio e solleva un `ErroreDatabase`.
 *
 * Da usare nei `catch` degli store: una riga invece di tre, e nessun modo di
 * dimenticare la registrazione.
 */
export function solleva(dove: string, errore: unknown): never {
  throw new ErroreDatabase(registraEMappa(dove, errore));
}
