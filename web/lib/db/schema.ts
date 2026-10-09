import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Lo schema del database, in forma Drizzle.
 *
 * **Ventiquattro tabelle.** Venti sono quelle del piano — l'audit della fase 13
 * ha chiuso la questione «ventuno o venti»: il titolo di §2 conta male, il piano
 * ne descrive venti e ci sono tutte. Tre — `unita_persone`, `unita_proposte` e
 * `faq` — arrivano con `0007` e `0008`, con il CMS dei contenuti; l'ultima,
 * `cartelle`, con `0012`, quando le categorie dei documenti hanno smesso di
 * essere un elenco scritto nel codice.
 *
 * Due tabelle nuove sono **poche apposta**. §4 del mandato vieta di inventare
 * tabelle, e §10 di crearne di inutili: i testi delle unità e delle pagine
 * stanno in `pagine_testi`, che esiste dalla fase 2A proprio per i testi
 * editoriali; i campi scalari delle unità sono colonne su `unita`, che esiste
 * dall'inizio. Restano due cose che non avevano un posto — un elenco di persone
 * e una modifica che aspetta l'approvazione — e ognuna ha la sua, spiegata dove
 * è dichiarata. `Page`, `Content`, `Section`, `Media` e `AuditLog` del modello
 * generico non servono: sono già `pagine_testi`, `foto` e `registro`.
 *
 * La ventunesima del vecchio conteggio, `album_assenze`, era assente per una
 * ragione diversa e non è un precedente: la sua forma dipendeva da una decisione
 * di governance non presa — se un referente di unità possa dichiarare che un ragazzo non
 * compare in un album. Insieme a lei mancava il trigger dei consensi, perché la
 * clausola `NOT IN (SELECT … album_assenze)` esiste solo se la tabella esiste.
 * Arrivate con `0006`, quando la risposta c'è stata. Vedi
 * `docs/implementation/consensi.md`.
 *
 * Convenzioni, da §2 del piano e valide senza eccezioni:
 *
 *   chiavi primarie   INTEGER PRIMARY KEY — è il rowid
 *   indirizzi pubblici slug UNIQUE — gli id non finiscono mai in un URL
 *   date e orari      TEXT ISO-8601 UTC — ordinabili come stringhe
 *   vero/falso        INTEGER + CHECK (x IN (0,1))
 *   elenchi chiusi    TEXT + CHECK — vincolo nel database, tipo in TypeScript
 *   cancellazioni     reali, mai logiche
 *   nomi              italiano, minuscolo, plurale
 *
 * `STRICT` non è esprimibile in Drizzle: viene aggiunto alla migrazione, e un
 * test verifica su database vero che tutte e ventotto le tabelle ce l'abbiano.
 * Non ci si fida di un commento.
 *
 * Tre `CHECK` che sembrano giusti e non ci sono, ognuno perché rifiuterebbe dati
 * reali: `documenti` pubblicati senza file, `registro.ruolo` uguale a
 * «sconosciuto», e il vocabolario di `attivita.tipo`, su cui il repository ha
 * due elenchi in disaccordo. Le motivazioni sono in schema-review.md §5.
 */

/**
 * I ruoli. `social` — il social media manager — arriva con 0013: prepara
 * album, foto e testi di tutto il sito, e il gestore li approva. Allargare
 * questo `CHECK` ha voluto dire ricostruire `utenti`, che ventun tabelle
 * referenziano: vedi l'intestazione della migrazione e `scripts/applica.mjs`.
 */
const RUOLI = ["sviluppatore", "gestore", "referente", "social"] as const;
const STATI = ["bozza", "in_revisione", "pubblicato"] as const;
/**
 * Che cosa può aspettare in `proposte`. Vedi il commento sulla tabella.
 * `album` arriva con 0022: la richiesta di ritirare un album pubblicato.
 */
const TIPI_PROPOSTA = ["pagina", "faq", "immagine", "copertina", "attivita", "album"] as const;

/**
 * Che cosa **è** un'attività. Deciso in fase 8; vedi il commento su `attivita`.
 *
 * Sta qui e non in `lib/attivita.ts` perché questo file non importa niente —
 * lo legge anche `drizzle.config.ts`, fuori dal risolutore di alias di Next. La
 * copia leggibile, con le etichette, sta là; che le due restino uguali non è
 * affidato a un commento ma a una prova che legge il `CHECK` dal database vero
 * (`test/attivita.test.mjs`).
 */
const TIPI_ATTIVITA = [
  "riunione",
  "uscita",
  "uscita-squadra",
  "attivita-squadra",
  "campo",
  "escursione",
  "festa",
  "servizio",
  "distretto",
] as const;

/**
 * `TEXT` ISO-8601 UTC, con l'istante corrente come valore predefinito.
 *
 * Il nome della colonna va passato: senza, Drizzle lo ricava dalla chiave
 * dell'oggetto e produce `creatoIl` invece di `creato_il` — camelCase in mezzo a
 * uno schema che per convenzione è tutto minuscolo con l'underscore.
 */
const adesso = (nome: string) =>
  text(nome)
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ','now'))`);

const elencoSql = (valori: readonly string[]) => valori.map((v) => `'${v}'`).join(",");

// ==========================================================================
// Anagrafiche
// ==========================================================================

/**
 * L'anno sociale: il perno temporale del modello.
 *
 * Il gruppo non vive per anni solari. Con `anno_id` su iscrizioni,
 * attività, album e documenti, il cambio d'anno diventa una sola operazione.
 */
export const anniSociali = sqliteTable(
  "anni_sociali",
  {
    id: integer("id").primaryKey(),
    /** forma canonica `2026-2027`: è già `ANNI_DOC[].chiave` */
    etichetta: text("etichetta").notNull().unique(),
    /** ISO `2026-09-01` — da settembre a luglio, §3 del piano */
    inizio: text("inizio").notNull(),
    fine: text("fine").notNull(),
    corrente: integer("corrente").notNull().default(0),
  },
  (t) => [
    check("anni_corrente_booleano", sql`${t.corrente} IN (0,1)`),
    check("anni_etichetta_forma", sql`${t.etichetta} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'`),
    /**
     * Un solo anno corrente, garantito dall'indice: non serve ricordarselo, ed
     * è ciò che rende `archiviaAnno` sicura — lo spostamento del flag può solo
     * riuscire o fallire in blocco.
     */
    uniqueIndex("anni_uno_corrente").on(t.corrente).where(sql`${t.corrente} = 1`),
  ],
);

/**
 * Le sei unità. `gruppo` **non** è qui: nel modello è `unita_id IS NULL`.
 * Vedi il commento su `CHIAVE_GRUPPO` in `lib/db/mappa.ts`.
 *
 * ## Le colonne di contenuto, aggiunte in 0007
 *
 * Fino alla fase 14 questa tabella era un **bersaglio di chiavi esterne**: nove
 * colonne seminate una volta da `lib/data.ts`, che nessuna pagina leggeva. Il
 * contenuto vero delle pagine unità stava — e per i valori predefiniti sta
 * ancora — nell'interfaccia `Unita` di `lib/data.ts`, ventiquattro campi
 * scritti a mano.
 *
 * Le colonne nuove sono **tutte nullable, e il nullo significa qualcosa**:
 * «nessuno ha personalizzato questo campo, usa il predefinito del codice». È la
 * stessa proprietà che regge `lib/gruppo.ts` da tre fasi, e il motivo per cui è
 * quella giusta: se un domani si corregge un testo in `lib/data.ts`, chi non
 * l'aveva toccato se lo ritrova aggiornato invece di restare su una copia
 * scaduta. Vedi `lib/unita-store.ts`.
 *
 * ## `ramo` e `ramo_plurale` non ci sono, e non è una dimenticanza
 *
 * Il nome del ramo non è contenuto: è la tassonomia dell'organizzazione, la
 * stessa per ogni gruppo. Renderlo modificabile significherebbe permettere di
 * chiamare un'unità con il ramo di un'altra — e non c'è nessun referente che
 * lo voglia. Restano in `lib/data.ts`, come `FASCE`.
 *
 * ## `referente` e `responsabili[0]` dicono la stessa cosa in due modi, e restano due
 *
 * `referente` è la stringa che il sito mostra in Contatti — «Ref1 — Mario
 * Rossi» — e `unita_persone` porta la stessa persona scomposta. Sembra una
 * duplicazione da togliere, e ho provato: non è derivabile. In due unità su sei
 * il secondo campo è il **soprannome** («Ref1»), in tre è il **ruolo** («Referente
 * di unità»), e la composizione `ruolo — nome` produce «Referente di unità — Giulia»,
 * che non è quello che il sito dice oggi. È un'incoerenza dei dati consegnati:
 * unificarla è una decisione sui contenuti, e collassare le colonne per
 * eleganza avrebbe cambiato sei pagine pubbliche senza che nessuno lo chiedesse.
 */
export const unita = sqliteTable(
  "unita",
  {
    id: integer("id").primaryKey(),
    /** `UnitaKey` meno `gruppo`: u1, u2, u3, u4, u5, u6 */
    chiave: text("chiave").notNull().unique(),
    /** indirizzo pubblico: /unita/<slug> */
    slug: text("slug").notNull().unique(),
    nome: text("nome").notNull(),
    fascia: text("fascia").notNull(),
    eta: text("eta"),
    logo: text("logo"),
    email: text("email"),
    telefono: text("telefono"),
    /** ordine di presentazione, quello di `FILTRI_UNITA` */
    ordine: integer("ordine").notNull().unique(),

    // ------------------------------------------------------------ contenuto
    // Nullable per progetto: nullo = «usa il predefinito di lib/data.ts».

    /** una riga, sopra il titolo della pagina */
    occhiello: text("occhiello"),
    /** il motto dell'unità: quaranta caratteri, non un testo */
    motto: text("motto"),
    /** dove e quando ci si trova, in una riga */
    ritrovo: text("ritrovo"),
    /** l'anno di fondazione, come testo: a volte è «2002», a volte «anni Ottanta» */
    fondazione: text("fondazione"),
    /** «Ref1 — Mario Rossi»: la forma che il sito mostra. Vedi sopra. */
    referente: text("referente"),
    /** «Referente di unità», «Responsabile», «Coordinatrice» */
    ruoloReferente: text("ruolo_referente"),
    /** sigla del tesseramento: «U1» per l'unità 1, «U2» per l'unità 2 */
    sigla: text("sigla"),
    /** quanti iscritti dichiara la pagina. L'etichetta la compone il codice. */
    iscritti: integer("iscritti"),
    /** titolo della sezione «La storia dell'unità», se non quello segnaposto */
    storiaTitolo: text("storia_titolo"),
    /** la riga sotto la tabella dei responsabili passati */
    notaStorico: text("nota_storico"),

    /**
     * La fotografia di copertina della pagina.
     *
     * Quattro colonne che stanno o cadono insieme, e un `CHECK` lo garantisce:
     * un record a metà produrrebbe un'immagine senza misure, cioè esattamente
     * il salto di layout che le misure servono a evitare (soglia CLS di §04).
     * Il nome del file lo genera il server e porta la marca temporale, come per
     * il marchio del gruppo: non arriva mai da chi carica.
     */
    copertina: text("copertina"),
    copertinaTipo: text("copertina_tipo"),
    copertinaLarghezza: integer("copertina_larghezza"),
    copertinaAltezza: integer("copertina_altezza"),
    /**
     * 1 se la copertina è nascosta: resta in archivio e nell'area, ma il sito
     * non la mostra. Il social media manager le fotografie le nasconde e non le
     * elimina (decisione del 6 ottobre 2026). Aggiunta in 0021.
     */
    copertinaNascosta: integer("copertina_nascosta").notNull().default(0),

    aggiornatoIl: text("aggiornato_il"),
    /**
     * Il tipo di ritorno è annotato, e serve.
     *
     * `unita` referenzia `utenti` (chi ha modificato) e `utenti` referenzia
     * `unita` (di quale unità è referente): un ciclo, che TypeScript non riesce a
     * srotolare da solo — `TS7022: 'unita' implicitly has type 'any'`. È il caso
     * che Drizzle documenta per le chiavi esterne circolari, e `AnySQLiteColumn`
     * è la sua risposta: spezza l'inferenza senza spegnere il controllo.
     *
     * L'alternativa era togliere `autore_id` da qui, visto che il registro sa
     * già chi ha fatto che cosa. Ma tutte le altre tabelle di contenuto —
     * album, documenti, attivita, pagine_testi — hanno la coppia
     * `aggiornato_il` + `autore_id`, e una sola che ne ha metà si nota.
     */
    autoreId: integer("autore_id").references((): AnySQLiteColumn => utenti.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    check("unita_fascia", sql`${t.fascia} IN ('gialla','verde','rossa')`),
    check("unita_iscritti", sql`${t.iscritti} IS NULL OR ${t.iscritti} >= 0`),
    /**
     * La copertina è tutta o niente.
     *
     * Scritto contando i nulli invece di enumerare le sedici combinazioni: se
     * ce n'è uno, devono essere quattro. `lib/gruppo.ts` fa lo stesso controllo
     * in TypeScript per il marchio (`marchioValido`), e lì è una precauzione in
     * lettura; qui è il database a rifiutare la riga, che è il posto giusto.
     */
    check(
      "unita_copertina_completa",
      sql`(${t.copertina} IS NULL) + (${t.copertinaTipo} IS NULL) + (${t.copertinaLarghezza} IS NULL) + (${t.copertinaAltezza} IS NULL) IN (0, 4)`,
    ),
    check(
      "unita_copertina_misure",
      sql`(${t.copertinaLarghezza} IS NULL OR ${t.copertinaLarghezza} > 0) AND (${t.copertinaAltezza} IS NULL OR ${t.copertinaAltezza} > 0)`,
    ),
  ],
);

/**
 * Le persone di un'unità: responsabili in carica, staff, e lo storico.
 *
 * Tre elenchi in una tabella sola, distinti da `tipo`. Nel codice consegnato
 * sono tre array di tuple — `responsabili`, `staff`, `storico` in `Unita` — con
 * la stessa forma e tre significati: chi guida l'unità oggi, chi aiuta, chi
 * l'ha guidata prima. Tre tabelle avrebbero moltiplicato per tre lo store,
 * l'editor e il controllo di ambito, per distinguere un dato che una colonna
 * distingue già.
 *
 * ## Perché ha uno `stato` come album, documenti e attività
 *
 * Sono **nomi di persone pubblicati sul sito**. La decisione del 31 agosto 2026
 * mette i nomi e i recapiti fra le cose che il gestore approva, e i testi
 * liberi fra quelle che vanno online subito: chi risponde della privacy è chi
 * ha l'elenco completo, come per i consensi degli album. Con `stato` la
 * revisione non ha bisogno di nessun meccanismo nuovo — la coda di approvazione
 * legge lo stato, che è già ciò che fa per gli altri tre tipi di contenuto.
 *
 * `periodo` è una colonna sola per due usi, perché è la stessa informazione con
 * due precisioni: «dal 2022» per chi c'è adesso, «2018 – 2022» per chi c'è
 * stato. Nell'archivio delle unità spesso è un trattino, e resta un trattino:
 * un anno plausibile ma non documentato vale meno di niente.
 *
 * Aggiunta in 0007.
 */
export const unitaPersone = sqliteTable(
  "unita_persone",
  {
    id: integer("id").primaryKey(),
    unitaId: integer("unita_id")
      .notNull()
      .references(() => unita.id, { onDelete: "cascade" }),
    tipo: text("tipo").notNull(),
    nome: text("nome").notNull(),
    /** il soprannome, o il ruolo: dipende dall'unità. Vedi il commento su `unita.referente`. */
    ruolo: text("ruolo").notNull().default(""),
    /** «dal 2022» per chi è in carica, «2018 – 2022» per lo storico, «—» se ignoto */
    periodo: text("periodo").notNull().default(""),
    /** la terza colonna dello storico: «Primo referente dell'unità.» */
    nota: text("nota").notNull().default(""),
    ordine: integer("ordine").notNull().default(0),
    stato: text("stato").notNull().default("bozza"),
    aggiornatoIl: text("aggiornato_il"),
    autoreId: integer("autore_id").references(() => utenti.id, { onDelete: "set null" }),
  },
  (t) => [
    check("unita_persone_tipo", sql`${t.tipo} IN ('responsabile','staff','storico')`),
    check("unita_persone_stato", sql`${t.stato} IN (${sql.raw(elencoSql(STATI))})`),
    index("unita_persone_unita_tipo").on(t.unitaId, t.tipo, t.ordine),
  ],
);

/**
 * Le modifiche in attesa di approvazione, per i campi che non hanno una riga
 * propria in cui aspettare.
 *
 * ## Perché esiste, invece di uno `stato` come per le persone
 *
 * `unita_persone` stagia da sé: una persona in attesa è una riga in più con
 * `stato = 'in_revisione'`, e quella pubblicata resta al suo posto. Un
 * **recapito** no: `unita.email` è una colonna, e scriverci il valore proposto
 * cancellerebbe quello in linea — cioè pubblicherebbe la modifica proprio nel
 * momento in cui la si manda in revisione. Serviva un posto dove il valore
 * nuovo aspetta senza spingere fuori il vecchio.
 *
 * L'alternativa era raddoppiare le colonne delicate con una variante
 * `_proposto`. Quattro colonne in più oggi, e una in più per ogni campo che un
 * domani entra nella revisione — pagato in migrazioni. Una tabella verticale
 * costa una `SELECT` e non cresce mai.
 *
 * ## Una sola proposta pendente per campo
 *
 * L'indice unico su `(unita_id, campo)`: la seconda proposta **sostituisce** la
 * prima. Senza, un referente che si corregge tre volte lascerebbe tre righe in coda,
 * e chi approva dovrebbe indovinare quale conta — o approvarle in ordine
 * sbagliato e pubblicare il valore vecchio per ultimo.
 *
 * `campo` non ha un `CHECK` con l'elenco dei campi ammessi, e per una volta è
 * deliberato: l'elenco vive in `lib/unita-contenuti.ts`, dove lo legge sia
 * l'azione che decide se stagiare sia l'interfaccia che disegna il modulo. Un
 * `CHECK` sarebbe una terza copia da tenere allineata a colpi di migrazione, e
 * una riga con un campo sconosciuto non è pericolosa: nessuno la applica, e
 * `npm run db:orfani` la trova.
 *
 * Aggiunta in 0007.
 */
export const unitaProposte = sqliteTable(
  "unita_proposte",
  {
    id: integer("id").primaryKey(),
    unitaId: integer("unita_id")
      .notNull()
      .references(() => unita.id, { onDelete: "cascade" }),
    /** il nome del campo di `unita`: `email`, `telefono`, `referente`, `ruoloReferente` */
    campo: text("campo").notNull(),
    valore: text("valore").notNull(),
    autoreId: integer("autore_id").references(() => utenti.id, { onDelete: "set null" }),
    creatoIl: adesso("creato_il"),
  },
  (t) => [uniqueIndex("unita_proposte_campo").on(t.unitaId, t.campo)],
);

/**
 * Le modifiche che aspettano un'approvazione e non hanno un posto loro.
 *
 * Arriva con 0013, insieme al social media manager: tutto quello che prepara
 * passa dal gestore, e tre delle cose che tocca non avevano dove aspettare.
 * `unita_proposte` serve i campi delle unità, gli album e le attività hanno uno
 * `stato`; i testi di Home e Chi siamo, le domande frequenti e le fotografie
 * dei riquadri no — si scrivevano direttamente, perché fino a qui li scriveva
 * solo chi li avrebbe approvati.
 *
 *     tipo        chiave                    valore
 *     pagina      il campo: `home.titolo`   il testo proposto
 *     faq         `faq`                     l'elenco intero, in JSON
 *     immagine    il posto: `home.fascia-…` misure e descrizione, in JSON
 *     copertina   l'unità: `u1`        misure, in JSON
 *     attivita    l'id: `42`                i campi nuovi, o la cancellazione, in JSON
 *
 * Le attività hanno già uno `stato`, ma quello serve a chi le crea. Da 0021 il
 * social media manager modifica e cancella anche le attività **già pubblicate**
 * degli altri, e lì la modifica deve aspettare accanto alla versione online,
 * che le famiglie continuano a leggere finché un gestore non decide.
 *
 * Una riga per `(tipo, chiave)`, come in `unita_proposte` e per la stessa
 * ragione: la seconda proposta sostituisce la prima, e chi approva non deve
 * indovinare quale conta. Le domande frequenti si propongono intere, come gli
 * elenchi di persone: togliere la terza domanda di cinque non ha una riga in
 * cui aspettare.
 *
 * ## Le fotografie aspettano già in archivio
 *
 * `file` è il nome del file **già scritto**, ripulito e con le derivate: si
 * lavora al caricamento, come per una pubblicazione diretta, così chi approva
 * guarda l'immagine vera e approvare è solo spostare un nome in una riga.
 * Vuoto con `tipo` immagine o copertina vuol dire «togliere quella che c'è».
 * Il lavoro notturno legge questa colonna fra i file attesi: senza, una
 * proposta che aspetta più di una settimana perderebbe la sua fotografia.
 */
export const proposte = sqliteTable(
  "proposte",
  {
    id: integer("id").primaryKey(),
    tipo: text("tipo").notNull(),
    chiave: text("chiave").notNull(),
    valore: text("valore").notNull(),
    /** il file in archivio, per immagini e copertine. Vedi il commento qui sopra */
    file: text("file"),
    autoreId: integer("autore_id").references(() => utenti.id, { onDelete: "set null" }),
    creatoIl: adesso("creato_il"),
  },
  (t) => [
    check("proposte_tipo", sql`${t.tipo} IN (${sql.raw(elencoSql(TIPI_PROPOSTA))})`),
    check("proposte_chiave", sql`length(${t.chiave}) > 0`),
    check(
      "proposte_file_solo_immagini",
      sql`${t.file} IS NULL OR ${t.tipo} IN ('immagine','copertina')`,
    ),
    uniqueIndex("proposte_tipo_chiave").on(t.tipo, t.chiave),
  ],
);

/**
 * Gli account. Nessuna registrazione pubblica: si entra solo su invito.
 *
 * `utente` e `email` convivono per un motivo concreto: l'applicazione fa
 * accedere con un nome utente (`verificaCredenziali(nomeUtente, …)`) e i tre
 * account reali in `utenti.json` non hanno un indirizzo. Il piano usa l'email
 * come chiave, e serve per gli inviti e per il conteggio dei tentativi. Quindi
 * `utente` è obbligatorio e presente, `email` è unica e nullabile finché non
 * arriva. Inventare tre indirizzi per far quadrare lo schema sarebbe stato peggio.
 */
export const utenti = sqliteTable(
  "utenti",
  {
    id: integer("id").primaryKey(),
    /** nome con cui si accede, come in `utenti.json` */
    utente: text("utente").notNull(),
    email: text("email"),
    nome: text("nome").notNull(),
    iniziali: text("iniziali").notNull(),
    ruolo: text("ruolo").notNull(),
    unitaId: integer("unita_id").references((): AnySQLiteColumn => unita.id),
    /** argon2id, o scrypt per gli account travasati: il formato si riconosce dal prefisso */
    passwordHash: text("password_hash"),
    totpSecret: text("totp_secret"),
    /** Nuovo autenticatore, cifrato e legato alla sessione che lo configura. */
    totpInAttesa: text("totp_in_attesa"),
    totpInAttesaScadeIl: text("totp_in_attesa_scade_il"),
    /** Solo impronte SHA-256 di codici casuali monouso. */
    codiciRecupero: text("codici_recupero"),
    /**
     * Quando il secondo fattore è stato confermato la prima volta.
     *
     * Serve a distinguere «segreto generato, QR mostrato, attivazione lasciata
     * a metà» da «attivo»: senza, un segreto abbandonato sembrerebbe un secondo
     * fattore funzionante, e l'accesso chiederebbe un codice che nessun telefono
     * sa produrre. Aggiunta in 0002.
     */
    totpAttivatoIl: text("totp_attivato_il"),
    /**
     * L'ultimo passo di trenta secondi consumato, per non riaccettarlo.
     *
     * RFC 6238 §5.2: un codice già usato non deve valere una seconda volta.
     * Senza questa colonna, chi lo vede — sopra una spalla, in una schermata
     * condivisa — ha mezzo minuto buono per rigiocarlo. Aggiunta in 0002.
     */
    totpUltimoPasso: integer("totp_ultimo_passo"),
    /**
     * 1 se la password è provvisoria, data da chi ha preparato l'account: al
     * primo accesso, dopo il secondo fattore, non si entra finché non la si
     * cambia (`proxy.ts`, `sessioneCorrente`). Aggiunta in 0015.
     */
    passwordDaCambiare: integer("password_da_cambiare").notNull().default(0),
    /**
     * 0 se all'accesso basta la password: chi amministra ha tolto il secondo
     * fattore a questo account. Il predefinito 1 lascia com'è chi esiste già e
     * ogni account nuovo (§7: obbligatorio), e si cambia solo dalla schermata
     * degli utenti, da uno sviluppatore. Il segreto TOTP resta dov'è: rimettendo
     * il segno si riparte dal codice che l'account aveva. Aggiunta in 0018.
     */
    mfaRichiesto: integer("mfa_richiesto").notNull().default(1),
    stato: text("stato").notNull().default("invitato"),
    creatoIl: adesso("creato_il"),
    ultimoAccesso: text("ultimo_accesso"),
  },
  (t) => [
    check("utenti_ruolo", sql`${t.ruolo} IN (${sql.raw(elencoSql(RUOLI))})`),
    check("utenti_stato", sql`${t.stato} IN ('invitato','attivo','revocato')`),
    /**
     * Solo il referente di unità ha un'unità, e ce l'ha sempre.
     *
     * Questo vincolo rifiuterà l'account `ref1` di `utenti.json`, che è
     * `referente` senza unità. È deliberato: un referente di unità senza unità non può
     * modificare nessun album, quindi è un account che non può fare il proprio
     * lavoro. L'importazione lo segnalerà per nome invece di accomodarlo.
     * Vedi `docs/implementation/import-audit.md` §A3.1.
     */
    check(
      "utenti_unita_solo_referente",
      sql`(${t.ruolo} = 'referente') = (${t.unitaId} IS NOT NULL)`,
    ),
    /**
     * Unicità **senza distinzione di maiuscole**, su un'espressione.
     *
     * Serve perché l'accesso confronta il nome utente in minuscolo
     * (`verificaCredenziali` fa `.trim().toLowerCase()`): con un indice
     * sensibile alle maiuscole, un account salvato come «Ref1» sarebbe unico
     * rispetto ad «ref1» e nessuno dei due riuscirebbe più a entrare in modo
     * prevedibile. Il piano chiede `COLLATE NOCASE` sull'email; Drizzle non
     * esprime le collazioni, ma un indice su `lower()` dà la stessa garanzia.
     */
    uniqueIndex("utenti_utente").on(sql`lower(${t.utente})`),
    uniqueIndex("utenti_email").on(sql`lower(${t.email})`),
  ],
);

/**
 * I ragazzi, che restano gli stessi attraverso gli anni.
 *
 * È ciò che permette di dire «questo ragazzo è con noi dal 2019» e, quando
 * serve, di cancellarlo del tutto con una riga sola grazie al `CASCADE` su
 * `iscrizioni`. Nessun dato sanitario: quelli restano su carta, fuori dal
 * sistema.
 */
export const ragazzi = sqliteTable(
  "ragazzi",
  {
    id: integer("id").primaryKey(),
    nome: text("nome").notNull(),
    cognome: text("cognome").notNull(),
    natoIl: text("nato_il"),
    creatoIl: adesso("creato_il"),
  },
  (t) => [index("ragazzi_cognome_nome").on(t.cognome, t.nome)],
);

/**
 * Un ragazzo, in un'unità, in un anno. È la tabella che porta il consenso.
 *
 * Il consenso riparte da zero a ogni anno: quello dell'anno scorso non vale per
 * quest'anno, ed è l'unico comportamento corretto.
 */
export const iscrizioni = sqliteTable(
  "iscrizioni",
  {
    id: integer("id").primaryKey(),
    ragazzoId: integer("ragazzo_id")
      .notNull()
      .references(() => ragazzi.id, { onDelete: "cascade" }),
    unitaId: integer("unita_id")
      .notNull()
      .references(() => unita.id),
    annoId: integer("anno_id")
      .notNull()
      .references(() => anniSociali.id),
    /** la squadra dentro l'unità, se c'è */
    gruppoInterno: text("gruppo_interno"),
    quota: text("quota").notNull().default("da_saldare"),
    consensoImmagini: integer("consenso_immagini").notNull().default(0),
    consensoData: text("consenso_data"),
    /**
     * Le colonne della verifica a campione, aggiunte in 0022 (audit degli
     * accessi, I-1). Il modulo firmato resta di carta, in sede: qui non entra
     * nessuna scansione — decisione del 7 ottobre 2026.
     *
     * - `consenso_modulo`: dove il referente di unità ha archiviato il modulo
     *   («raccoglitore in sede, 2026-27»). Facoltativo, testo breve;
     * - `consenso_da`: chi ha registrato il consenso. Chi lo registra non lo
     *   verifica (separazione dei compiti);
     * - `consenso_verifica`: l'esito del controllo — `conforme` (il modulo c'è
     *   ed è firmato) o `mancante` —, con chi e quando. Nullo = mai verificato.
     *
     * Un consenso registrato di nuovo, o revocato, perde la verifica: era la
     * verifica di un altro modulo. Nessun `CHECK` su `consenso_verifica`:
     * aggiungerlo vorrebbe dire ricostruire `iscrizioni`, a cui puntano le
     * dichiarazioni di assenza; il valore lo scrive solo `verificaConsenso`.
     */
    consensoModulo: text("consenso_modulo"),
    consensoDa: integer("consenso_da").references(() => utenti.id, { onDelete: "set null" }),
    consensoVerifica: text("consenso_verifica"),
    consensoVerificatoIl: text("consenso_verificato_il"),
    consensoVerificatoDa: integer("consenso_verificato_da").references(() => utenti.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    check("iscrizioni_quota", sql`${t.quota} IN ('da_saldare','saldata','ridotta')`),
    check("iscrizioni_consenso_booleano", sql`${t.consensoImmagini} IN (0,1)`),
    /**
     * Un consenso senza data non è un consenso: se è concesso si sa quando, ed è
     * il dato che serve per dimostrarlo.
     */
    check(
      "iscrizioni_consenso_datato",
      sql`${t.consensoImmagini} = 0 OR ${t.consensoData} IS NOT NULL`,
    ),
    uniqueIndex("iscrizioni_ragazzo_anno").on(t.ragazzoId, t.annoId),
    index("iscrizioni_unita_anno").on(t.unitaId, t.annoId),
  ],
);

/**
 * Le sessioni aperte. Nel database sta solo l'impronta del token, mai il token.
 *
 * `ultimo_uso` e `scade_il` sono due colonne e non una perché il piano §7 chiede
 * due limiti diversi: otto ore di inattività e dodici ore in totale. Con una
 * sola non si può distinguere una sessione ferma da una lunga.
 */
export const sessioni = sqliteTable(
  "sessioni",
  {
    id: integer("id").primaryKey(),
    utenteId: integer("utente_id")
      .notNull()
      .references(() => utenti.id, { onDelete: "cascade" }),
    /** SHA-256 del token in esadecimale: 64 caratteri */
    impronta: text("impronta").notNull().unique(),
    creataIl: adesso("creata_il"),
    ultimoUso: adesso("ultimo_uso"),
    /** limite assoluto: 12 h dalla creazione */
    scadeIl: text("scade_il").notNull(),
    ip: text("ip"),
    /**
     * `attesa_totp` finché il secondo fattore non è stato dato.
     *
     * §7 del piano vuole che un account senza TOTP non prosegua oltre la
     * schermata di attivazione. Fra «ha dato la password» e «è dentro» c'è
     * quindi uno stato, e sta qui invece che in un cookie a parte per due
     * motivi: si revoca come tutte le altre sessioni, e scade con la riga. Un
     * secondo formato di credenziale, con una sua verifica, sarebbe un secondo
     * modo di essere autenticati — cioè la cosa che le sessioni opache servono
     * a togliere di mezzo.
     *
     * Aggiunta in 0002: la tabella era stata scritta prima che il secondo
     * fattore avesse un'implementazione. Vedi docs/implementation/accessi.md.
     */
    stato: text("stato").notNull().default("attiva"),
  },
  (t) => [
    check("sessioni_stato", sql`${t.stato} IN ('attesa_totp','attiva')`),
    index("sessioni_scade").on(t.scadeIl),
  ],
);

/** Inviti monouso, 72 ore. `usato_il` non nullo significa consumato. */
export const inviti = sqliteTable(
  "inviti",
  {
    id: integer("id").primaryKey(),
    utenteId: integer("utente_id")
      .notNull()
      .references(() => utenti.id, { onDelete: "cascade" }),
    impronta: text("impronta").notNull().unique(),
    creatoIl: adesso("creato_il"),
    scadeIl: text("scade_il").notNull(),
    usatoIl: text("usato_il"),
  },
  (t) => [index("inviti_scade").on(t.scadeIl)],
);

/**
 * La matrice dei permessi, in forma di dati.
 *
 * Una riga per coppia (funzione, ruolo): è la forma che serve al cancello
 * autorizzativo, che interroga `WHERE funzione = ? AND ruolo = ?`. Con tre
 * colonne di livello quella diventerebbe una scelta dinamica di colonna.
 *
 * `nome` si ripete per i tre ruoli della stessa funzione: dieci stringhe
 * duplicate su trenta righe. La forma normale vorrebbe una tabella `funzioni`,
 * che però sarebbe la ventiduesima tabella — e il mandato vieta di inventarne.
 *
 * Il valore della scelta è che matrice visibile e comportamento del server non
 * possono divergere: sono la stessa riga letta due volte.
 */
export const permessi = sqliteTable(
  "permessi",
  {
    id: integer("id").primaryKey(),
    /** chiave stabile: non cambia se si riscrive l'etichetta */
    funzione: text("funzione").notNull(),
    nome: text("nome").notNull(),
    ruolo: text("ruolo").notNull(),
    livello: text("livello").notNull(),
    /**
     * Ordine di presentazione della funzione nella matrice.
     *
     * Non è decorazione. Finché la matrice stava in un JSON, l'ordine era
     * quello dell'array — cioè quello di `FUNZIONI_INIZIALI`, che segue una
     * logica di lettura (prima gli album, poi i documenti, poi
     * l'amministrazione) e non l'alfabeto. Con SQLite senza `ORDER BY` l'ordine
     * non è garantito fra due letture, e una griglia di permessi che si
     * rimescola è una griglia che nessuno si fida di leggere.
     *
     * `ORDER BY funzione` avrebbe dato un ordine stabile ma alfabetico, cioè
     * diverso da quello che i referenti vedono oggi. Questa colonna conserva
     * l'ordine vero.
     */
    ordine: integer("ordine").notNull().default(0),
  },
  (t) => [
    check("permessi_ruolo", sql`${t.ruolo} IN (${sql.raw(elencoSql(RUOLI))})`),
    check("permessi_livello", sql`${t.livello} IN ('completo','limitato','nessuno')`),
    check("permessi_ordine", sql`${t.ordine} >= 0`),
    uniqueIndex("permessi_funzione_ruolo").on(t.funzione, t.ruolo),
    index("permessi_ordine_idx").on(t.ordine, t.funzione),
  ],
);

/**
 * I tentativi di accesso falliti: cinque in quindici minuti, per email **e**
 * per IP.
 *
 * Una riga per tentativo, non un contatore: contare le righe nella finestra è
 * esatto anche con richieste concorrenti, mentre un contatore condiviso va
 * incrementato sotto transazione per non perdere colpi. Il job notturno le
 * cancella.
 */
export const tentativiAccesso = sqliteTable(
  "tentativi_accesso",
  {
    id: integer("id").primaryKey(),
    /**
     * `utente` oppure `ip`: sono due conteggi indipendenti, come chiede §7.
     *
     * Il piano dice «per email e per IP». Qui è `utente` perché si accede con
     * un nome utente e non con un indirizzo — la stessa decisione già presa per
     * `utenti.utente`, e documentata in schema-decisions.md. Lasciare scritto
     * `email` e metterci dentro un nome utente sarebbe stato uno schema che
     * dice il falso a chi lo legge. Corretta in 0002, a tabella vuota.
     */
    tipo: text("tipo").notNull(),
    chiave: text("chiave").notNull(),
    quando: adesso("quando"),
  },
  (t) => [
    check("tentativi_tipo", sql`${t.tipo} IN ('utente','ip')`),
    index("tentativi_tipo_chiave_quando").on(t.tipo, t.chiave, t.quando),
  ],
);

// ==========================================================================
// Contenuti
// ==========================================================================

export const album = sqliteTable(
  "album",
  {
    id: integer("id").primaryKey(),
    /** indirizzo pubblico: /foto/<slug> */
    slug: text("slug").notNull().unique(),
    annoId: integer("anno_id")
      .notNull()
      .references(() => anniSociali.id),
    /** nullo se di gruppo — ed è ciò su cui si regge il trigger dei consensi */
    unitaId: integer("unita_id").references(() => unita.id),
    titolo: text("titolo").notNull(),
    /** il mese come lo scrive il sito: «Settembre 2026». Testo, non una data */
    dataTesto: text("data_testo").notNull(),
    sottotitolo: text("sottotitolo").notNull().default(""),
    tag: text("tag").notNull().default(""),
    stato: text("stato").notNull().default("bozza"),
    /**
     * Contatore delle foto escluse per mancanza di consenso: è la versione
     * grezza del problema che `album_assenze` risolve nominativamente. Resta
     * perché la firma di `aggiornaAlbum({escluse})` e il campo del form
     * esistono; nei dati reali vale 0 su tutti e 13 gli album, quindi nessun
     * dato ne dipende. Quando la decisione arriva, diventa derivato o se ne va.
     */
    escluse: integer("escluse").notNull().default(0),
    aggiornatoIl: text("aggiornato_il"),
    autoreId: integer("autore_id").references(() => utenti.id, { onDelete: "set null" }),
    /**
     * La password con cui le famiglie aprono l'album. Aggiunta in 0010.
     *
     * **Cifrata e non ridotta a un'impronta**, a differenza di quelle degli
     * account: non è la credenziale di una persona ma un segreto condiviso che
     * i referenti consegnano a decine di famiglie, e devono poterla rileggere per
     * rimandarla. Si cifra con `lib/auth/cifratura.ts`, la stessa chiave dei
     * secondi fattori (`SITO_TOTP_SEGRETO`).
     *
     * Nulla sugli album nati prima della password: per il pubblico quegli album
     * restano chiusi finché un referente non ne imposta una. Vedi `lib/album-accesso.ts`.
     */
    passwordAccesso: text("password_accesso"),
    /**
     * Un valore casuale, nuovo a ogni cambio di password: il cookie di chi ha
     * già aperto l'album ne è l'impronta, quindi cambiarla fa decadere tutti i
     * cookie emessi con la password vecchia senza tenere un elenco di sessioni.
     */
    accessoVersione: text("accesso_versione"),
    /**
     * Chi l'ha **creato**, e non cambia più. Aggiunta in 0014.
     *
     * `autore_id` qui sopra è chi l'ha toccato per ultimo, quindi non dice di
     * chi è l'album. Serve al social media manager, che prepara album per tutte
     * le unità ma agisce soltanto sui propri (audit accessi del 4 ottobre 2026).
     * Nullo per gli album di cui la migrazione non ha trovato la creazione nel
     * registro: sono di nessuno, e quindi non suoi.
     */
    creatoDa: integer("creato_da").references(() => utenti.id, { onDelete: "set null" }),
  },
  (t) => [
    check("album_stato", sql`${t.stato} IN (${sql.raw(elencoSql(STATI))})`),
    check("album_escluse_non_negative", sql`${t.escluse} >= 0`),
    index("album_unita_anno").on(t.unitaId, t.annoId),
    index("album_stato_idx").on(t.stato),
  ],
);

export const foto = sqliteTable(
  "foto",
  {
    id: integer("id").primaryKey(),
    albumId: integer("album_id")
      .notNull()
      .references(() => album.id, { onDelete: "cascade" }),
    /** nome del file generato dall'applicazione, mai quello scelto da chi carica */
    file: text("file").notNull().unique(),
    tipo: text("tipo").notNull(),
    larghezza: integer("larghezza").notNull(),
    altezza: integer("altezza").notNull(),
    /** byte dell'originale; nullo finché la coda non l'ha misurato */
    peso: integer("peso"),
    /** mai nomi di ragazzi, come dice l'informativa */
    didascalia: text("didascalia").notNull().default(""),
    ordine: integer("ordine").notNull().default(0),
    creataIl: adesso("creata_il"),
    /**
     * Quando le tre derivate sono state generate. Nullo = non ancora.
     *
     * È la colonna che dice se il file da servire è la derivata senza metadati
     * o l'originale che li porta ancora. Sta qui e non si deduce dalla tabella
     * `lavori` perché quelle righe si possono ripulire, mentre questo è un
     * fatto sul file che deve restare vero per sempre. Aggiunta in 0003.
     */
    derivateIl: text("derivate_il"),
    /**
     * 1 se la fotografia è nascosta: il file resta, l'album non la mostra e la
     * rotta non la serve a chi non gestisce l'album. È il «togliere» del social
     * media manager, che le fotografie non le elimina (6 ottobre 2026). 0021.
     */
    nascosta: integer("nascosta").notNull().default(0),
    /**
     * Quando è stata eliminata. Nullo = c'è. Aggiunta in 0022.
     *
     * Eliminare una fotografia non cancella più il file subito (audit degli
     * accessi, A-1): la riga e il file restano trenta giorni nel cestino
     * dell'album, da cui un gestore la rimette o la cancella per sempre, e
     * poi li porta via il lavoro notturno. Per tutto il resto del sito — album,
     * area, rotte dei file, conteggi — una fotografia eliminata non c'è: la
     * filtra `fotoPerAlbum`, e `perFile` non la serve.
     */
    eliminataIl: text("eliminata_il"),
    /** chi l'ha eliminata, per il cestino e per «Da sapere» */
    eliminataDa: integer("eliminata_da").references(() => utenti.id, { onDelete: "set null" }),
  },
  (t) => [
    check("foto_larghezza", sql`${t.larghezza} > 0`),
    check("foto_altezza", sql`${t.altezza} > 0`),
    check("foto_peso", sql`${t.peso} IS NULL OR ${t.peso} > 0`),
    index("foto_album_ordine").on(t.albumId, t.ordine),
  ],
);

/**
 * Le dichiarazioni di assenza: la ventunesima tabella, e l'ultima.
 *
 * Non c'era, e non era un'omissione. §5 del piano la propone e chiude con «da
 * confermare: è una decisione del gruppo, non tecnica». Confermata il 31 agosto
 * 2026: **dichiarazione di assenza**. Vedi `docs/implementation/consensi.md`.
 *
 * ## Che cosa afferma una riga
 *
 * «Questo iscritto **non compare** nelle fotografie di questo album.» Non
 * «pubblica comunque»: è un'affermazione puntuale, nominativa, su un album
 * preciso, con chi l'ha fatta e quando. La differenza non è formale — un
 * pulsante che scavalca il controllo si preme senza pensarci, una frase che si
 * firma no.
 *
 * §5 mette a confronto le tre strade e spiega perché il blocco secco del mockup
 * è «inapplicabile»: due consensi mancanti bloccherebbero tutti gli album di
 * quell'unità per l'anno, e la conseguenza prevedibile è che i referenti smettano di
 * usare il sito e mandino le foto su WhatsApp. Peggio del problema di partenza.
 *
 * ## Perché la chiave primaria è composta
 *
 * La convenzione di §2 è `INTEGER PRIMARY KEY`, e qui non si applica: la coppia
 * (album, iscrizione) **è** il vincolo. Con una chiave surrogata servirebbe
 * comunque un indice unico su quelle due colonne, e si potrebbe dichiarare due
 * volte la stessa assenza — due righe che dicono la stessa cosa con due autori
 * e due orari diversi, e nessun modo di sapere quale conta.
 *
 * ## Che cosa succede alla cancellazione
 *
 * `CASCADE` su entrambi i lati. Cancellato l'album, le sue dichiarazioni non
 * vogliono dire più niente; cancellata l'iscrizione — o il ragazzo, che porta
 * via le sue iscrizioni — la dichiarazione perde il soggetto. In nessuno dei
 * due casi resta una riga che afferma qualcosa su qualcuno che non c'è.
 *
 * Aggiunta in 0006, insieme al trigger che la usa.
 */
export const albumAssenze = sqliteTable(
  "album_assenze",
  {
    albumId: integer("album_id")
      .notNull()
      .references(() => album.id, { onDelete: "cascade" }),
    iscrizioneId: integer("iscrizione_id")
      .notNull()
      .references(() => iscrizioni.id, { onDelete: "cascade" }),
    /**
     * Chi l'ha dichiarata. `NOT NULL` e **senza** `ON DELETE SET NULL`, al
     * contrario di `album.autore_id`.
     *
     * È la differenza fra un'informazione di comodo e una responsabilità: una
     * dichiarazione senza autore non è una dichiarazione. Se un account va
     * cancellato e ha dichiarato delle assenze, la cancellazione si fermerà — ed
     * è giusto che qualcuno debba decidere cosa farne, invece che la riga si
     * svuoti da sola.
     */
    dichiarataDa: integer("dichiarata_da")
      .notNull()
      .references(() => utenti.id),
    dichiarataIl: adesso("dichiarata_il"),
  },
  (t) => [
    primaryKey({ columns: [t.albumId, t.iscrizioneId] }),
    index("assenze_album").on(t.albumId),
  ],
);

/**
 * Il calendario.
 *
 * ## Il vocabolario di `tipo`, deciso in fase 8
 *
 * Nel repository c'erano **due** elenchi in disaccordo: quello di `EVENTI` in
 * `lib/data.ts`, che governa il calendario pubblico (`gruppo`, `unità`, `campo`,
 * `escursione`, `distretto`, `servizio`), e quello di `lib/colonne.ts`, l'editor del
 * prototipo (`riunione`, `uscita di unità`, `uscita di squadra`, `campo`,
 * `festa`, `servizio`). Si sovrapponevano su due valori e divergevano su otto.
 *
 * La risposta non è stata scegliere uno dei due: erano **due assi diversi
 * schiacciati in una colonna sola**. `gruppo` e `unità` dicono *chi* organizza;
 * `riunione` e `campo` dicono *che cosa è*. Adesso il primo asse lo porta
 * l'ambito — `unita_id` e `unita_chiavi` qui sotto, che c'erano già — e `tipo`
 * porta solo il secondo. `distretto` resta fra i tipi perché è l'unico valore
 * del vecchio elenco che non è né l'uno né l'altro: descrive un'attività a cui
 * il gruppo partecipa senza organizzarla.
 *
 * ## L'ambito, e perché sono due colonne
 *
 * Un'attività può riguardare una sola unità, tutto il gruppo, oppure **alcune**
 * unità: nel seme, «Uscita invernale» è delle unità 1 e 2,
 * «Gita in montagna» delle unità 5 e 6. Una chiave esterna sola non lo esprime, e una
 * tabella di collegamento sarebbe la ventiduesima — che il mandato vieta.
 *
 * Quindi due colonne, con un `CHECK` che garantisce che **una sola** delle due
 * parli:
 *
 * | `unita_id` | `unita_chiavi` | significa |
 * | --- | --- | --- |
 * | valorizzata | `''` | una sola unità: è il caso dei referenti di unità |
 * | `NULL` | `''` | tutto il gruppo |
 * | `NULL` | `u1,u2` | quelle elencate, e nessun'altra |
 *
 * Non è forma normale, ed è la stessa denormalizzazione accettata per
 * `permessi.nome`: il costo è una colonna di testo da leggere con attenzione, il
 * ricavo è non inventare una tabella. Aggiunta in 0004.
 */
export const attivita = sqliteTable(
  "attivita",
  {
    id: integer("id").primaryKey(),
    annoId: integer("anno_id")
      .notNull()
      .references(() => anniSociali.id),
    unitaId: integer("unita_id").references(() => unita.id),
    /**
     * Le unità coinvolte, separate da virgola, quando sono più d'una e non
     * tutte. Vuota negli altri due casi. Vedi la tabella nel commento sopra.
     */
    unitaChiavi: text("unita_chiavi").notNull().default(""),
    titolo: text("titolo").notNull(),
    /** la data come la scrive il sito: «11 ott 2026» */
    dataTesto: text("data_testo").notNull(),
    /** la stessa data in ISO, per ordinare e filtrare */
    dataIso: text("data_iso"),
    tipo: text("tipo").notNull(),
    nota: text("nota").notNull().default(""),
    luogo: text("luogo").notNull().default(""),
    durata: text("durata").notNull().default(""),
    stato: text("stato").notNull().default("bozza"),
    aggiornatoIl: text("aggiornato_il"),
    autoreId: integer("autore_id").references(() => utenti.id, { onDelete: "set null" }),
    /** chi l'ha creata, e non cambia più: vedi la colonna omonima di `album` (0014) */
    creatoDa: integer("creato_da").references(() => utenti.id, { onDelete: "set null" }),
  },
  (t) => [
    check("attivita_stato", sql`${t.stato} IN (${sql.raw(elencoSql(STATI))})`),
    check("attivita_tipo", sql`${t.tipo} IN (${sql.raw(elencoSql(TIPI_ATTIVITA))})`),
    /**
     * L'ambito lo dice **una** colonna sola.
     *
     * Senza questo vincolo si potrebbe scrivere una riga con `unita_id` dei
     * u1 e `unita_chiavi` che dice «u3, u4», e nessuna delle
     * due sarebbe sbagliata abbastanza da farsi notare: la schermata mostrerebbe
     * una cosa e il filtro pubblico un'altra.
     */
    check(
      "attivita_ambito_uno_solo",
      sql`${t.unitaId} IS NULL OR ${t.unitaChiavi} = ''`,
    ),
    index("attivita_anno_data").on(t.annoId, t.dataIso),
  ],
);

/**
 * Le cartelle della pagina Documenti, arrivate con 0012.
 *
 * Erano le sei categorie scritte in `CATEGORIE_DOC` e ripetute in un `CHECK` su
 * `documenti`: un elenco chiuso che solo un rilascio poteva allargare. La
 * richiesta dei gestori del 25 settembre 2026 è stata di poter aprire
 * «Tesseramenti» o «Campi estivi» e trovarci tutti i moduli — cartelle che
 * decidono loro, non noi.
 *
 * `documenti.categoria` resta una colonna di testo, ma adesso è una **chiave
 * esterna su `chiave`**, non un id. Non è una scorciatoia: è ciò che tiene in
 * piedi `documenti_circolari_hanno_unita`, che confronta la categoria con la
 * stringa `'circolari'` e che un `CHECK` non potrebbe più fare se la categoria
 * fosse un numero che rimanda a un'altra tabella.
 *
 * Le sei di partenza le scrive la migrazione, perché i documenti esistenti le
 * referenziano: **cambiarle in `lib/data.ts` non cambia un database esistente**.
 * Da lì in avanti si rinominano e si riordinano dall'area riservata.
 */
export const cartelle = sqliteTable(
  "cartelle",
  {
    id: integer("id").primaryKey(),
    /**
     * L'indirizzo pubblico, `/documenti/<chiave>`. Si ricava dal nome alla
     * creazione e **non cambia più**: rinominare «Campi e uscite» in «Campi
     * estivi» non deve rompere il collegamento mandato alle famiglie.
     */
    chiave: text("chiave").notNull().unique(),
    titolo: text("titolo").notNull(),
    /** la riga sotto il nome, nella pagina Documenti. Vuota se non serve. */
    descrizione: text("descrizione").notNull().default(""),
    ordine: integer("ordine").notNull(),
    aggiornatoIl: text("aggiornato_il"),
    autoreId: integer("autore_id").references(() => utenti.id, { onDelete: "set null" }),
  },
  (t) => [
    /**
     * Minuscole, cifre e trattini, cominciando con una lettera o una cifra.
     * È un pezzo di indirizzo: uno spazio o una barra qui diventerebbero una
     * pagina che non si apre.
     */
    check(
      "cartelle_chiave_forma",
      sql`${t.chiave} GLOB '[a-z0-9]*' AND ${t.chiave} NOT GLOB '*[^a-z0-9-]*'`,
    ),
    check("cartelle_ordine", sql`${t.ordine} >= 0`),
  ],
);

/**
 * Documenti e modulistica.
 *
 * **Nessun `CHECK` che leghi `pubblicato` alla presenza del file.** Sembra il
 * vincolo giusto e rifiuterebbe 25 dei 26 documenti reali: il seme pubblica
 * l'elenco dei moduli che il sito già annuncia, senza i file, e la pagina
 * pubblica lo dichiara. La regola esiste, ma in `approvazioni/actions.ts`, dove
 * riguarda il *passaggio* a pubblicato e non lo stato. Vedi import-audit.md §A3.2.
 *
 * ## L'ambito, aggiunto in 0007
 *
 * Fino alla fase 14 la modulistica era per costruzione roba di gruppo: moduli
 * d'iscrizione, quote e statuti valgono per tutti, e infatti la sezione stava
 * nel menù dei soli gestori. Le **circolari** no: la lista materiale di un
 * campo estivo la scrive il referente dell'unità, e la decisione del 31 agosto 2026
 * dice che va online subito, senza coda.
 *
 * Perciò `unita_id`, con la stessa convenzione di `attivita` e `album`:
 * **`NULL` = documento di gruppo**. Non è una comodità di scrittura, è il
 * controllo che conta — un referente di unità non tocca mai una riga con `unita_id`
 * nullo, e il modulo d'iscrizione del gruppo resta fuori dalla sua portata
 * anche se ne indovina l'identificativo.
 *
 * ## Le cartelle e i documenti «sempre validi», da 0012
 *
 * Due cambiamenti, che vanno insieme:
 *
 *   `categoria`  non più un elenco chiuso in un `CHECK`, ma la chiave di una
 *                riga di `cartelle`;
 *   `anno_id`    facoltativo. **`NULL` = sempre valido**: il modulo di
 *                tesseramento o la scheda sanitaria del campo non cambiano da un
 *                anno all'altro, e legati a un anno sarebbero finiti in archivio
 *                a ogni settembre, da ricaricare identici.
 *
 * Tutti e due chiedevano di ricostruire la tabella — togliere un `NOT NULL` e
 * aggiungere una chiave esterna non si fa con `ALTER TABLE` — ed è sicuro per
 * lo stesso motivo di 0007: **nessuna tabella referenzia `documenti`**.
 */
export const documenti = sqliteTable(
  "documenti",
  {
    id: integer("id").primaryKey(),
    /**
     * chiave stabile `<anno>/<titolo normalizzato>`, o `sempre/<titolo>`: non
     * cambia se si corregge il titolo, né se il documento cambia cartella
     */
    chiave: text("chiave").notNull().unique(),
    /** l'anno sociale del documento. `NULL` = sempre valido. */
    annoId: integer("anno_id").references(() => anniSociali.id),
    /** l'unità di cui è la circolare. `NULL` = documento di gruppo. */
    unitaId: integer("unita_id").references(() => unita.id),
    /** la cartella: `cartelle.chiave`, che non cambia quando la si rinomina */
    categoria: text("categoria")
      .notNull()
      .references(() => cartelle.chiave),
    titolo: text("titolo").notNull(),
    nota: text("nota").notNull().default(""),
    /**
     * l'avviso che la pagina mostra in un riquadro sotto il documento: «chi è
     * già tesserato in un altro gruppo non lo compila». Vuoto = nessun riquadro.
     * Dalla migrazione 0016.
     */
    avviso: text("avviso").notNull().default(""),
    formato: text("formato").notNull().default("PDF"),
    /** dimensione leggibile, come la mostrava il mockup: «240 KB» */
    peso: text("peso").notNull().default("—"),
    aggiornamento: text("aggiornamento").notNull().default(""),
    stato: text("stato").notNull().default("bozza"),
    file: text("file"),
    aggiornatoIl: text("aggiornato_il"),
    autoreId: integer("autore_id").references(() => utenti.id, { onDelete: "set null" }),
  },
  (t) => [
    check("documenti_formato", sql`${t.formato} IN ('PDF','DOCX')`),
    check("documenti_stato", sql`${t.stato} IN (${sql.raw(elencoSql(STATI))})`),
    /**
     * Solo le circolari hanno un'unità, e viceversa.
     *
     * Senza questo vincolo si potrebbe caricare un modulo d'iscrizione
     * intestato all'unità 1 — che il suo referente potrebbe poi modificare,
     * perché è nel suo ambito — oppure una circolare senza unità, che
     * nessun referente di unità riuscirebbe più a toccare. Sono i due modi in cui
     * l'ambito si sfila, e li chiude una riga.
     */
    check(
      "documenti_circolari_hanno_unita",
      sql`(${t.categoria} = 'circolari') = (${t.unitaId} IS NOT NULL)`,
    ),
    uniqueIndex("documenti_file").on(t.file),
    index("documenti_anno_categoria").on(t.annoId, t.categoria),
    index("documenti_unita").on(t.unitaId),
  ],
);

/**
 * I formati dei documenti per i referenti. Gli stessi di `FORMATI_REFERENTI` in
 * `lib/documenti-referenti.ts`, che qui non si può importare (lo schema lo legge
 * anche drizzle-kit, fuori dagli alias di Next): una prova controlla che i due
 * elenchi coincidano.
 */
const FORMATI_REFERENTI = ["PDF", "DOCX", "XLSX", "PPTX", "ODT", "ODS", "ODP", "DOC", "XLS", "PPT"] as const;

/**
 * Le cartelle dei documenti per i referenti: «Comunità referenti», «Formazione»,
 * «Regolamenti».
 *
 * Arrivano con 0019, su richiesta del 3 ottobre 2026: una sezione dell'area
 * riservata dove gestore e sviluppatore caricano documenti che vedono
 * **soltanto i referenti**, dopo l'accesso.
 *
 * ## Perché non sono righe di `cartelle`
 *
 * Perché `cartelle` è la pagina pubblica `/documenti`: ogni sua riga è un
 * indirizzo del sito, e ogni suo documento pubblicato si scarica da chiunque.
 * Mettere qui una cartella «riservata» avrebbe voluto dire un filtro in più in
 * ogni lettura pubblica — la pagina, l'indice, la ricerca, la mappa del sito —
 * e la riservatezza sarebbe dipesa dal non averne dimenticato nessuno. Due
 * tabelle separate la danno per costruzione: nessuna pagina pubblica le legge.
 *
 * Senza `chiave`: una cartella per i referenti non ha un indirizzo pubblico da
 * conservare, e nell'area la si apre per `id`. Il nome è unico senza badare
 * alle maiuscole, perché due «Verbali» nello stesso elenco non si distinguono.
 */
export const cartelleReferenti = sqliteTable(
  "cartelle_referenti",
  {
    id: integer("id").primaryKey(),
    titolo: text("titolo").notNull(),
    /** la riga sotto il nome. Vuota se non serve. */
    descrizione: text("descrizione").notNull().default(""),
    ordine: integer("ordine").notNull(),
    aggiornatoIl: text("aggiornato_il"),
    autoreId: integer("autore_id").references(() => utenti.id, { onDelete: "set null" }),
  },
  (t) => [
    check("cartelle_referenti_titolo", sql`length(trim(${t.titolo})) > 0`),
    check("cartelle_referenti_ordine", sql`${t.ordine} >= 0`),
    uniqueIndex("cartelle_referenti_titolo_unico").on(sql`lower(${t.titolo})`),
  ],
);

/**
 * I documenti per i referenti: un file ciascuno, sempre.
 *
 * Diversi dai `documenti` pubblici in tre punti, tutti voluti:
 *
 *  - **niente stato.** Caricato vuol dire visibile ai referenti: non c'è una pagina
 *    pubblica da cui toglierlo, e una bozza che solo chi l'ha caricata vede è
 *    un file sul proprio computer;
 *  - **niente voce senza file.** Là serviva ad annunciare i moduli che il sito
 *    di prima elencava; qui non c'è niente da annunciare;
 *  - **niente anno sociale.** Un verbale porta la sua data nel titolo, e la data
 *    di caricamento è in `caricato_il`.
 *
 * `cartella_id` senza `ON DELETE`: una cartella con dentro dei documenti non si
 * elimina, e non deve portarsi via i file in silenzio. `file` comincia sempre
 * con `referenti-`: è il prefisso che `lib/archivio-orfani.ts` riconosce, e nessuna
 * rotta pubblica serve un file che non trova nella propria tabella.
 */
export const documentiReferenti = sqliteTable(
  "documenti_referenti",
  {
    id: integer("id").primaryKey(),
    cartellaId: integer("cartella_id")
      .notNull()
      .references(() => cartelleReferenti.id),
    titolo: text("titolo").notNull(),
    nota: text("nota").notNull().default(""),
    formato: text("formato").notNull(),
    /** il peso in byte: si mostra leggibile, ma si somma e si confronta */
    byte: integer("byte").notNull(),
    file: text("file").notNull().unique(),
    caricatoIl: adesso("caricato_il"),
    aggiornatoIl: text("aggiornato_il"),
    autoreId: integer("autore_id").references(() => utenti.id, { onDelete: "set null" }),
  },
  (t) => [
    check("documenti_referenti_titolo", sql`length(trim(${t.titolo})) > 0`),
    check("documenti_referenti_formato", sql`${t.formato} IN (${sql.raw(elencoSql(FORMATI_REFERENTI))})`),
    check("documenti_referenti_byte", sql`${t.byte} > 0`),
    check("documenti_referenti_file", sql`${t.file} GLOB 'referenti-*'`),
    index("documenti_referenti_cartella").on(t.cartellaId),
  ],
);

/**
 * Testi editoriali, e l'identità del gruppo.
 *
 * Chiave/valore perché assorbe due cose di forma diversa: i testi delle pagine e
 * i campi di `dati/gruppo.json` (nome, sottotitolo, sette recapiti, marchio),
 * che nel piano non hanno una tabella propria. Nove righe invece di una tabella
 * in più, come chiede §4 del mandato.
 */
export const pagineTesti = sqliteTable(
  "pagine_testi",
  {
    id: integer("id").primaryKey(),
    /** `gruppo.nome`, `gruppo.email`, `chi-siamo.storia`, … */
    chiave: text("chiave").notNull().unique(),
    valore: text("valore").notNull(),
    stato: text("stato").notNull().default("pubblicato"),
    aggiornatoIl: text("aggiornato_il"),
    autoreId: integer("autore_id").references(() => utenti.id, { onDelete: "set null" }),
  },
  (t) => [check("pagine_stato", sql`${t.stato} IN (${sql.raw(elencoSql(STATI))})`)],
);

/**
 * Le domande frequenti della pagina Contatti.
 *
 * ## Perché una tabella e non `pagine_testi`
 *
 * È l'unica cosa di questo CMS che non si è potuta mettere in chiave/valore, e
 * la ragione è l'**ordine**. Una FAQ è una riga di un elenco ordinato con due
 * campi di testo: in chiave/valore diventa `faq.2.domanda`, `faq.2.risposta`, e
 * cancellare la terza di cinque vuol dire rinumerare le due successive con due
 * scritture e una cancellazione che non possono essere una transazione senza
 * inventarsi una chiave d'ordine a parte. Con una colonna `ordine` è un
 * `DELETE` e un `INSERT`.
 *
 * È la stessa forma di `unita_persone`, e per la stessa ragione: un elenco che
 * si modifica **come elenco** vuole una tabella.
 *
 * ## Il colore è una fascia, non un esadecimale
 *
 * La striscia a sinistra di ogni domanda ha uno dei quattro colori del gruppo.
 * In tabella sta la **fascia** — `gialla`, `verde`, `rossa`, `gruppo` — e non il
 * valore: un `CHECK` su quattro esadecimali avrebbe legato lo schema alla
 * tavolozza, e cambiare una tinta sarebbe diventata una migrazione. La
 * traduzione sta in `lib/faq-contenuti.ts`.
 *
 * ## Il collegamento, e perché `href` non è testo libero
 *
 * Una risposta può finire con un collegamento — «vedi Documenti e modulistica».
 * `link_href` accetta **solo un percorso interno**, garantito da un `CHECK`: un
 * campo libero in una pagina pubblica è un posto dove mettere un indirizzo che
 * porta altrove, e un collegamento che parte dal sito del gruppo se lo porta
 * dietro la fiducia del gruppo. L'interfaccia offre un menù delle pagine del
 * sito, non una casella.
 *
 * Le tre colonne del collegamento stanno o cadono insieme, come le quattro della
 * copertina: un `testo` senza `href` sarebbe una parola che sembra un link.
 *
 * Aggiunta in 0008.
 */
export const faq = sqliteTable(
  "faq",
  {
    id: integer("id").primaryKey(),
    domanda: text("domanda").notNull(),
    risposta: text("risposta").notNull(),
    /** una delle quattro fasce: decide il colore della striscia */
    fascia: text("fascia").notNull().default("gruppo"),
    linkTesto: text("link_testo"),
    /** solo percorsi interni: il `CHECK` lo garantisce */
    linkHref: text("link_href"),
    /** quello che resta della frase dopo il collegamento, di solito un punto */
    linkCoda: text("link_coda"),
    ordine: integer("ordine").notNull().default(0),
    aggiornatoIl: text("aggiornato_il"),
    autoreId: integer("autore_id").references((): AnySQLiteColumn => utenti.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    check("faq_fascia", sql`${t.fascia} IN ('gialla','verde','rossa','gruppo')`),
    /**
     * Il collegamento è tutto o niente. Scritto contando i nulli, come per la
     * copertina delle unità: se ce n'è uno, devono essere tre.
     */
    check(
      "faq_link_completo",
      sql`(${t.linkTesto} IS NULL) + (${t.linkHref} IS NULL) + (${t.linkCoda} IS NULL) IN (0, 3)`,
    ),
    /**
     * Solo percorsi interni.
     *
     * `GLOB '/*'` vuole la barra iniziale; `NOT GLOB '//*'` esclude
     * `//evil.example`, che un browser interpreta come un indirizzo assoluto
     * con lo stesso schema — è la forma con cui un controllo scritto solo su
     * «comincia con /» si aggira. Nessuno schema, nessun `..`.
     */
    check(
      "faq_link_interno",
      sql`${t.linkHref} IS NULL OR (${t.linkHref} GLOB '/*' AND ${t.linkHref} NOT GLOB '//*' AND ${t.linkHref} NOT LIKE '%..%')`,
    ),
    index("faq_ordine").on(t.ordine),
  ],
);

/** I messaggi dal modulo contatti. Il job notturno cancella oltre 24 mesi. */
export const messaggi = sqliteTable(
  "messaggi",
  {
    id: integer("id").primaryKey(),
    quando: adesso("quando"),
    nome: text("nome").notNull(),
    email: text("email").notNull(),
    telefono: text("telefono").notNull().default(""),
    /** una delle chiavi di `MOTIVI_CONTATTO` */
    motivo: text("motivo").notNull(),
    messaggio: text("messaggio").notNull(),
    stato: text("stato").notNull().default("da_leggere"),
    ip: text("ip"),
  },
  (t) => [
    check(
      "messaggi_motivo",
      sql`${t.motivo} IN ('iscrizione','informazioni','quote','referenti','privacy','altro')`,
    ),
    check("messaggi_stato", sql`${t.stato} IN ('da_leggere','letto','risposto')`),
    index("messaggi_quando").on(t.quando),
  ],
);

/**
 * La coda delle derivate. Vive in una tabella, non in un servizio esterno:
 * nessun Redis, nessun broker.
 *
 * Se il processo si riavvia a metà, i lavori non completati sono ancora qui e
 * riprendono da soli. Tre tentativi, poi la riga resta in errore con il motivo,
 * visibile nell'amministrazione — ed è il `CHECK` a garantire che «tre» sia tre.
 */
export const lavori = sqliteTable(
  "lavori",
  {
    id: integer("id").primaryKey(),
    tipo: text("tipo").notNull().default("foto"),
    fotoId: integer("foto_id").references(() => foto.id, { onDelete: "cascade" }),
    stato: text("stato").notNull().default("in_attesa"),
    tentativi: integer("tentativi").notNull().default(0),
    /** perché è fallito, quando è fallito */
    motivo: text("motivo"),
    creatoIl: adesso("creato_il"),
    iniziatoIl: text("iniziato_il"),
    finitoIl: text("finito_il"),
  },
  (t) => [
    check("lavori_tipo", sql`${t.tipo} IN ('foto')`),
    check("lavori_stato", sql`${t.stato} IN ('in_attesa','in_corso','fatto','errore')`),
    check("lavori_tentativi", sql`${t.tentativi} BETWEEN 0 AND 3`),
    index("lavori_stato_creato").on(t.stato, t.creatoIl),
  ],
);

// ==========================================================================
// Conformità
// ==========================================================================

/**
 * Chi ha fatto cosa, e quando. Anche i rifiuti: sono il segnale che qualcosa non
 * torna.
 *
 * `utente`, `nome` e `ruolo` sono **testo** e non solo una chiave esterna, e
 * `utente_id` è `ON DELETE SET NULL`. È la scelta più importante della tabella:
 * quando un account viene cancellato — e la cancellazione GDPR cancella davvero
 * — la riga deve continuare a dire chi ha pubblicato quell'album. Un registro
 * che si svuota cancellando un utente non dimostra niente, che è esattamente
 * ciò che deve dimostrare.
 *
 * **Nessun `CHECK` su `ruolo`:** `accedi/actions.ts` scrive `'sconosciuto'`
 * quando l'accesso fallisce, perché il ruolo di chi ha sbagliato le credenziali
 * non si sa. Il registro conserva ciò che è avvenuto, non ciò che è ammesso.
 */
export const registro = sqliteTable(
  "registro",
  {
    id: integer("id").primaryKey(),
    quando: adesso("quando"),
    utenteId: integer("utente_id").references(() => utenti.id, { onDelete: "set null" }),
    utente: text("utente").notNull(),
    nome: text("nome").notNull(),
    ruolo: text("ruolo").notNull(),
    tipo: text("tipo").notNull(),
    operazione: text("operazione").notNull(),
    origine: text("origine").notNull(),
    esito: text("esito").notNull().default("ok"),
    /**
     * L'IP da cui è partita l'operazione (0020). Lo legge solo lo
     * sviluppatore. Nullo per le voci di prima e per quelle senza richiesta.
     */
    indirizzo: text("indirizzo"),
  },
  (t) => [
    check(
      "registro_tipo",
      /*
       * `consenso` e `iscritti` sono aggiunti in 0005.
       *
       * Non è una comodità di etichette. Il consenso alla pubblicazione delle
       * immagini è ciò su cui poggia tutto il capitolo dei minori: se una
       * famiglia contesta una fotografia, la domanda è «quando è stato
       * registrato quel consenso, e da chi» — e con i consensi mescolati fra i
       * `contenuto` quella domanda non ha una risposta interrogabile.
       */
      sql`${t.tipo} IN ('accesso','uscita','contenuto','pubblicazione','eliminazione','configurazione','permessi','consenso','iscritti')`,
    ),
    check("registro_esito", sql`${t.esito} IN ('ok','rifiutato')`),
    index("registro_quando").on(t.quando),
    index("registro_utente_quando").on(t.utente, t.quando),
  ],
);

/** Il registro degli artt. 15–22. Nessun nome di minore nella descrizione. */
export const richiesteGdpr = sqliteTable(
  "richieste_gdpr",
  {
    id: integer("id").primaryKey(),
    arrivataIl: text("arrivata_il").notNull(),
    diritto: text("diritto").notNull(),
    descrizione: text("descrizione").notNull(),
    stato: text("stato").notNull().default("ricevuta"),
    chiusaIl: text("chiusa_il"),
    apertaDa: integer("aperta_da").references(() => utenti.id, { onDelete: "set null" }),
  },
  (t) => [
    check(
      "gdpr_diritto",
      sql`${t.diritto} IN ('accesso','rettifica','cancellazione','limitazione','portabilita','opposizione','rimozione_foto','revoca_consenso')`,
    ),
    check("gdpr_stato", sql`${t.stato} IN ('ricevuta','in_corso','eseguita','respinta')`),
    index("gdpr_arrivata").on(t.arrivataIl),
  ],
);

/**
 * Contatori di frequenza generici, per quello che non è l'accesso: il modulo
 * contatti per indirizzo IP, e quello che servirà dopo.
 *
 * Distinta da `tentativi_accesso` perché il piano le elenca entrambe, e perché
 * le due cose hanno forma diversa: là una riga per tentativo, qui un secchiello
 * per finestra temporale.
 */
export const limiti = sqliteTable(
  "limiti",
  {
    id: integer("id").primaryKey(),
    /** che cosa si sta limitando: `contatti`, … */
    ambito: text("ambito").notNull(),
    chiave: text("chiave").notNull(),
    /** inizio della finestra, ISO */
    finestraDa: text("finestra_da").notNull(),
    conteggio: integer("conteggio").notNull().default(0),
  },
  (t) => [
    check("limiti_conteggio", sql`${t.conteggio} >= 0`),
    uniqueIndex("limiti_ambito_chiave_finestra").on(t.ambito, t.chiave, t.finestraDa),
  ],
);

/**
 * Le immagini dei posti fissi del disegno: un riquadro, una riga.
 *
 * ## Perché una tabella e non altre colonne
 *
 * Il progetto grafico ha diciotto riquadri rigati che nessun caricamento poteva
 * riempire: le tre fotografie di fascia e la copertina della galleria in home,
 * la foto di gruppo di «Chi siamo», la foto d'archivio accanto alla storia di
 * ogni unità, e il ritratto sopra il nome di ogni referente. Erano `<Photo>` scritti
 * nel codice, con dentro l'etichetta del designer — «foto fascia gialla»,
 * «ritratto» — e nessun ramo `<img>` accanto: restavano rettangoli colorati per
 * sempre, qualunque cosa il gruppo caricasse.
 *
 * La copertina di un'unità e il marchio del gruppo si caricano già, e ognuna ha
 * il suo gruppo di quattro colonne (`unita.copertina*`, il marchio in
 * `dati/gruppo.json`). Ripetere quel disegno cinque volte avrebbe voluto dire
 * cinque migrazioni, cinque azioni, cinque schermate e cinque posti dove
 * sbagliare — e il sesto riquadro che qualcuno aggiungerà al disegno sarebbe
 * ricominciato da capo.
 *
 * Qui la chiave è il **posto**, non la cosa: `home.fascia-gialla`,
 * `chi-siamo.gruppo`, `unita.u1.archivio`, `referente.mario-rossi`. Il
 * catalogo dei posti sta in `lib/slot-immagini.ts`, in TypeScript, perché è una
 * proprietà del disegno e non un dato: un posto che non c'è più va tolto dal
 * codice, e la riga rimasta senza posto la si vede e la si cancella.
 *
 * ## Le quattro colonne che stanno o cadono insieme
 *
 * Come per `unita.copertina`, e per la stessa ragione: un record a metà
 * produrrebbe un'immagine senza misure, cioè il salto di impaginazione che le
 * misure servono a evitare. Qui però sono `NOT NULL` tutte e quattro — non
 * esiste una riga «senza immagine», perché il posto vuoto è semplicemente una
 * riga che non c'è.
 */
export const immagini = sqliteTable(
  "immagini",
  {
    id: integer("id").primaryKey(),
    /** il posto nel disegno: vedi `SLOT` in `lib/slot-immagini.ts` */
    chiave: text("chiave").notNull().unique(),
    /** nome del file in archivio. Lo genera il server, con la marca temporale */
    file: text("file").notNull(),
    tipo: text("tipo").notNull(),
    larghezza: integer("larghezza").notNull(),
    altezza: integer("altezza").notNull(),
    /**
     * Il testo alternativo, scritto da chi carica.
     *
     * Facoltativo, e il perché conta. Questi riquadri sono **decorativi** nella
     * quasi totalità dei casi: la fotografia di fascia sta sopra un titolo che
     * dice già «Unità 1, 8–11 anni», e il ritratto sta sopra il nome. In quei
     * casi `alt=""` è la cosa giusta, e obbligare a scrivere qualcosa
     * produrrebbe «foto» o «immagine» letti a voce da uno screen reader.
     *
     * Chi ha qualcosa da dire lo scrive; chi non ce l'ha lascia vuoto e
     * l'immagine esce con `alt=""`, che è come deve uscire.
     */
    descrizione: text("descrizione"),
    caricataIl: text("caricata_il"),
    autoreId: integer("autore_id").references(() => utenti.id, { onDelete: "set null" }),
    /**
     * 1 se l'immagine è nascosta: il posto torna vuoto sul sito, ma il file e la
     * riga restano e la si può rimettere. Come `foto.nascosta`. Aggiunta in 0021.
     */
    nascosta: integer("nascosta").notNull().default(0),
  },
  (t) => [
    check("immagini_misure", sql`${t.larghezza} > 0 AND ${t.altezza} > 0`),
    check("immagini_chiave", sql`length(${t.chiave}) > 0`),
    check("immagini_file", sql`length(${t.file}) > 0`),
    check("immagini_tipo", sql`${t.tipo} IN ('image/jpeg','image/png')`),
  ],
);
