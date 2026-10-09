/**
 * Matrice dei permessi: che cosa può fare ogni ruolo, funzione per funzione.
 *
 * Qui ci sono **solo tipi e costanti**: la matrice si disegna in un componente
 * client, e un client non può stare nella stessa catena di import di `node:fs`.
 * Lettura e scrittura stanno in `lib/permessi-store.ts`.
 *
 * Non è una tabella come le altre e non deve avere l'editor delle altre. Qui la
 * riga è una funzione, la colonna è un ruolo, e la cella è un livello: si
 * guarda a colpo d'occhio, e si modifica cliccando nella griglia — non aprendo
 * un modulo con cinque campi di testo.
 *
 * **Adesso decide.** Fino alla fase 5 questa matrice era documentazione: i
 * permessi veri stavano nel codice, e la schermata avvisava che cambiarla non
 * apriva né chiudeva nessuna porta. Ora la legge `contesto()` in
 * `lib/auth/contesto.ts`, dalla tabella `permessi`, prima di ogni operazione —
 * quindi matrice visibile e comportamento del server sono la stessa riga letta
 * due volte, che è il punto di §4 del piano.
 *
 * I valori qui sotto sono il **seme**: quello che il codice applicava prima, per
 * non aprire nessun permesso nel passaggio. Due righe divergono dalla matrice
 * di §8 del piano — `documenti` e `identita`, dove il piano darebbe al referente
 * unità un accesso limitato e il codice non gliene dava nessuno. Allinearle
 * **allargherebbe** dei permessi, e non è una cosa da fare di propria
 * iniziativa: vedi `docs/implementation/autorizzazione.md`.
 */

/** I tre livelli. Volutamente pochi: una matrice sfumata non si legge. */
export type Livello = "completo" | "limitato" | "nessuno";

export const LIVELLI: { valore: Livello; segno: string; label: string; nota: string }[] = [
  { valore: "completo", segno: "✓", label: "Sì", nota: "Può farlo da solo, per tutto il gruppo." },
  {
    valore: "limitato",
    segno: "~",
    label: "In parte",
    nota: "Può farlo con un limite, scritto nella casella: solo per la propria unità, oppure propone e un gestore approva.",
  },
  { valore: "nessuno", segno: "✗", label: "No", nota: "Non può, e nell’area riservata non vede nemmeno il comando." },
];

/**
 * L'ordine in cui il clic sulla griglia gira fra i tre livelli.
 *
 * Dal più stretto al più largo, che è **l'inverso** di `LIVELLI` — e la
 * differenza non è estetica. `LIVELLI` è l'ordine della legenda, dove si legge
 * bene dal più permissivo al meno; il ciclo dei clic seguiva quello, e da
 * `nessuno` il primo clic dava `completo`.
 *
 * Il problema si vede provando: per mettere una riga a `limitato` — che è il
 * livello con cui si concede l'ambito e non il mondo — bisognava passare da
 * `completo`, e la matrice **applica subito**. Fra i due clic quel ruolo aveva
 * il permesso pieno: pochi secondi, ma su una riga come `documenti` sono i
 * secondi in cui un referente di unità può toccare la modulistica del gruppo.
 *
 * Con quest'ordine, allargare di un passo dà il passo successivo e non l'ultimo.
 * Trovato nella fase 14.7, girando davvero quella riga dalla schermata.
 */
export const CICLO_LIVELLI: Livello[] = ["nessuno", "limitato", "completo"];

export const RUOLI_MATRICE = [
  { chiave: "sviluppatore", label: "Admin" },
  { chiave: "gestore", label: "Gestore" },
  { chiave: "referente", label: "Referente di unità" },
  /*
   * Il social media manager, dal 3 ottobre 2026. Carica album, cambia foto e
   * testi di tutte le unità e del sito, prepara il calendario — e **ogni**
   * modifica passa dall'approvazione del gestore o dello sviluppatore.
   *
   * Nella matrice questo si scrive `limitato`, nel secondo senso di `LIVELLI`:
   * «con l'approvazione di un altro ruolo». Per lui `limitato` non restringe
   * l'ambito — copre tutte le unità e il gruppo — e la scelta fra pubblicare e
   * proporre la fa `vaInCoda()` in `lib/auth/decisione.ts`, dove si spiega
   * perché dipende sia dal ruolo sia dal livello. Mettere una sua riga a
   * `completo` vuol dire lasciarlo pubblicare da solo su quella riga.
   */
  { chiave: "social", label: "Social media" },
] as const;

/**
 * Le azioni che il contesto autorizzativo sa controllare.
 *
 * Sono le stesse chiavi di `FUNZIONI_INIZIALI`, dichiarate come tipo perché il
 * cancello le riceva come argomento e un nome sbagliato non compili. Le due
 * cose restano allineate per costruzione: `FUNZIONI_INIZIALI` è tipizzata su
 * questa unione, quindi aggiungere una riga senza aggiungere il valore — o
 * viceversa — è un errore di compilazione, non una svista da scoprire in
 * esercizio.
 */
export type Azione =
  | "album-carica"
  | "album-pubblica"
  | "documenti"
  | "documenti-referenti-leggi"
  | "documenti-referenti-carica"
  | "identita"
  | "unita-scheda"
  | "unita-anagrafica"
  | "referenti"
  | "iscritti"
  | "iscritti-elenco"
  | "consensi-verifica"
  | "attivita"
  | "messaggi"
  | "pagine"
  | "archivio-anno"
  | "esporta"
  | "utenti"
  | "permessi"
  | "permessi-leggi"
  | "gdpr"
  | "privacy"
  | "registro"
  | "backup"
  | "viste";

export interface Funzione {
  /** chiave stabile: non cambia se si riscrive l'etichetta */
  id: string;
  nome: string;
  /** livello per ruolo */
  livelli: Record<string, Livello>;
}

/** Come `Funzione`, ma con l'id vincolato: è la forma del seme. */
export interface FunzioneNota extends Funzione {
  id: Azione;
}

/**
 * Le funzioni di partenza, con i livelli che il codice applica **davvero**
 * oggi. Non è un elenco di intenzioni: è la fotografia di `lib/sessione.ts` e
 * dei controlli nelle azioni, così chi legge la matrice legge il comportamento
 * vero e non una promessa.
 */
export const FUNZIONI_INIZIALI: FunzioneNota[] = [
  {
    id: "album-carica",
    nome: "Caricare foto e creare album",
    // per il social media manager: tutte le unità, e l'album resta suo finché
    // un gestore non lo pubblica — `album-pubblica` per lui è `nessuno`, e
    // un album già online che lui modifica torna in revisione
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "limitato",
      social: "limitato",
    },
  },
  {
    id: "album-pubblica",
    nome: "Pubblicare un album",
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  {
    id: "documenti",
    nome: "Documenti e modulistica",
    /*
     * `limitato` per il referente di unità dalla fase 14.7, ed è una delle due
     * divergenze che `docs/implementation/autorizzazione.md` §3 teneva aperte
     * dal 23 agosto 2026. Confermata il 31: **le circolari si approvano
     * subito.**
     *
     * `limitato` qui significa «i documenti della propria unità», cioè le sole
     * circolari — il `CHECK` `documenti_circolari_hanno_unita` garantisce che
     * nessun'altra categoria abbia un'unità, e `copre()` nega `gruppo` a ogni
     * referente di unità. La modulistica del gruppo resta quindi fuori portata anche se
     * qualcuno ne indovina l'identificativo.
     *
     * Il livello si è potuto allargare **solo** dopo che ogni azione in
     * `documenti/actions.ts` è passata a chiedere l'ambito: con `limitato` e
     * nessuna risorsa `decidi()` concede, e il permesso allargato senza l'ambito
     * avrebbe aperto la modulistica a chiunque abbia un'unità, in silenzio. Le
     * due modifiche sono nella stessa fase e non si possono separare.
     *
     * **Su un'installazione già in esercizio questa riga non cambia da sé**:
     * `allineaSeme` non tocca i livelli esistenti, per non riaprire permessi che
     * un amministratore ha chiuso. Va messa a «limitato» dalla schermata
     * «Permessi», che è un clic — ed è anche la prova che la matrice decide.
     *
     * **Dal 6 ottobre 2026 torna `nessuno`**, su decisione dell'utente: i
     * documenti li caricano e li modificano solo sviluppatore e gestore.
     * Il controllo dell'ambito nelle azioni resta, e vale di nuovo se
     * qualcuno rimette `limitato` dalla schermata «Permessi».
     */
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  /*
   * I documenti per i referenti, dal 3 ottobre 2026: li caricano gestore e
   * sviluppatore, li leggono i referenti di unità. Due righe e non una, perché sono
   * due domande — chi legge, chi scrive — e una riga sola avrebbe dovuto dire
   * «limitato» per «legge soltanto», un terzo significato di quel livello dopo
   * «la propria unità» e «con l'approvazione».
   *
   * Per il referente di unità la lettura è `limitato`, come ogni sua riga: il tetto
   * dell'audit del 4 ottobre (M-5) non gli lascia mai `completo`. Qui `limitato`
   * non restringe niente — i documenti sono di tutto il gruppo, la rotta e la
   * sezione chiedono `puo()` senza risorsa e basta che non sia `nessuno` — e la
   * schermata «Permessi» lo scrive «Sola lettura». Caricare per lui ha tetto
   * `nessuno`. Chi non ha la riga di lettura — o la ha a `nessuno` — non vede
   * la sezione e riceve «non trovato» dalla rotta dei file. Le azioni di
   * caricamento passano comunque l'ambito `gruppo`, che `copre()` nega a ogni
   * referente di unità: due cancelli sulla stessa porta.
   *
   * Su un'installazione in esercizio le due righe le aggiunge `npm run
   * db:permessi`, che il runbook di rilascio esegue già.
   */
  {
    id: "documenti-referenti-leggi",
    nome: "Leggere i documenti per i referenti",
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "limitato",
      social: "nessuno",
    },
  },
  {
    id: "documenti-referenti-carica",
    nome: "Caricare i documenti per i referenti",
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  {
    id: "identita",
    nome: "Nome, marchio e recapiti del gruppo",
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  {
    id: "unita-scheda",
    nome: "Testi e recapiti della propria unità",
    // `limitato` per il referente di unità significa: la sua unità e nessun'altra.
    // È il perimetro deciso il 31 agosto 2026 — testi e recapiti sì,
    // anagrafica no — e la riga sotto è l'altra metà della stessa decisione.
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "limitato",
      social: "limitato",
    },
  },
  {
    id: "unita-anagrafica",
    nome: "Nome, logo e copertina di un’unità",
    // `limitato` per il social media manager vale per la sola fotografia di
    // copertina, che propone: nome, età e iscritti restano del gestore, e
    // `salvaAnagrafica` glielo dice invece di metterli in coda
    // Nome dell'unità, logo, fascia, età, indirizzo pubblico, numero
    // iscritti, fotografia di copertina. Non è contenuto editoriale: è
    // l'identità con cui l'unità compare nel gruppo, e la decide il referente
    // gruppo. Un referente di unità che potesse rinominare la propria unità potrebbe
    // anche cambiarne l'indirizzo pubblico, cioè rompere i collegamenti che
    // altri hanno condiviso.
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "limitato",
    },
  },
  {
    id: "referenti",
    nome: "Referenti, responsabili e staff pubblicati",
    /*
     * `limitato`, ma con l'approvazione: il referente di unità propone, il gestore
     * pubblica.
     *
     * Non è una sfumatura in più nella matrice — i livelli restano tre — ed è
     * la definizione di `limitato` scritta in `LIVELLI` qui sopra: «nel proprio
     * ambito, **o con l'approvazione di un altro ruolo**». Il secondo ramo non
     * era mai stato usato da nessuna riga, e questa è la prima.
     *
     * Il perché sta nella decisione del 31 agosto: sono nomi di persone
     * pubblicati sul sito, e chi risponde della privacy è chi ha l'elenco
     * completo — la stessa ragione per cui la pubblicazione degli album non è
     * del referente di unità. La coda che le riceve è `unita_proposte`.
     */
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "limitato",
      social: "nessuno",
    },
  },
  {
    id: "iscritti",
    nome: "Registrare iscrizioni e consensi",
    /*
     * Chi **scrive** l'elenco: iscrizioni, consensi, quote, squadre, e le
     * dichiarazioni «non compare in queste fotografie» sugli album.
     *
     * Il gestore qui è `nessuno` dal 4 ottobre 2026 (audit degli accessi,
     * SoD-1), e non per sfiducia: il consenso e l'assenza sono i due fatti che
     * sbloccano la pubblicazione di fotografie di minori, e la pubblicazione è
     * sua. Chi attesta il fatto e chi decide in base a quel fatto devono essere
     * due persone — e il referente di unità, che i ragazzi li conosce, è quella giusta
     * per attestarlo. Il gestore l'elenco lo **legge**: riga sotto.
     *
     * Non si riapre dalla schermata: è un tetto (`TETTI`), non un valore.
     */
    livelli: {
      sviluppatore: "completo",
      "gestore": "nessuno",
      "referente": "limitato",
      social: "nessuno",
    },
  },
  {
    id: "iscritti-elenco",
    nome: "Consultare iscritti e consensi",
    /*
     * La lettura dell'elenco, separata dalla scrittura il 4 ottobre 2026.
     *
     * Il gestore pubblica le fotografie dei minori, e fino a quel giorno
     * non aveva una schermata da cui controllare il registro dei consensi su
     * cui il trigger si basa: lo vedeva album per album, in approvazione. Ora
     * lo consulta per tutte le unità, in sola lettura. Il referente di unità vede la
     * propria unità, come prima; il social media manager niente.
     */
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "limitato",
      social: "nessuno",
    },
  },
  {
    id: "attivita",
    nome: "Attività del calendario",
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "limitato",
      social: "limitato",
    },
  },
  {
    id: "messaggi",
    nome: "Leggere i messaggi dal sito",
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  {
    id: "pagine",
    nome: "Testi delle pagine del sito",
    // §8 del piano: al referente di unità nessun accesso ai testi globali
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "limitato",
    },
  },
  {
    id: "archivio-anno",
    nome: "Archiviare l’anno sociale",
    // §8 del piano: il passaggio d'anno non è del referente di unità
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  {
    id: "esporta",
    nome: "Esportare le tabelle in CSV",
    // per il gestore era `limitato`, che per lui non restringeva niente:
    // `copre()` gli dà tutte le unità, e la rotta di esportazione filtra per
    // ruolo. Un segno che non decide è un segno che mente (audit B-3).
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "limitato",
      social: "nessuno",
    },
  },
  {
    id: "utenti",
    nome: "Gestire account e ruoli",
    /*
     * `limitato` per il gestore dalla fase 14.9, e questo `limitato`
     * significa una cosa che `copre()` **non** sa verificare. Va letto con
     * attenzione, perché è il punto più delicato della fase.
     *
     * Sulle altre righe `limitato` vuol dire «la propria unità», e la
     * decisione la prende `copre()` confrontando `risorsa.unita` con
     * `sessione.un`. Qui l'ambito non è un'unità: è **quali account si possono
     * toccare**, e la risposta è «solo quelli dei referenti di unità». Un gestore
     * invita e revoca i referenti delle proprie unità — è il ricambio di inizio
     * anno, e farlo passare da chi ha accesso al server significa che a
     * settembre non si fa — ma non crea un altro gestore né uno
     * sviluppatore, cioè non si dà da sé un pari grado.
     *
     * Il cancello generico non basta, e la conseguenza è concrea: `decidi()`
     * con `limitato` e nessuna risorsa **concede**. `contesto("utenti")` da solo
     * lascerebbe quindi passare un gestore su qualunque account, e la
     * matrice sembrerebbe stretta mentre non lo è. Per questo le azioni di
     * `utenti/actions.ts` non chiamano mai `contesto` direttamente: passano da
     * `autorizzaSuUtente(ruoloBersaglio)`, che è l'unico posto dove quella
     * regola vive. Se un domani si aggiunge un'azione su un account, quella
     * funzione è la porta — e non chiamarla si vede in revisione.
     *
     * `nessuno` resta per il referente di unità: un referente di unità non tocca account, e
     * nemmeno il proprio ruolo. La propria password la cambia dal profilo, che
     * non è una voce di questa matrice — è servizio all'utente.
     */
    livelli: {
      sviluppatore: "completo",
      "gestore": "limitato",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  {
    id: "permessi-leggi",
    nome: "Consultare la matrice dei permessi",
    livelli: { sviluppatore: "completo", "gestore": "completo", "referente": "nessuno", social: "nessuno" },
  },
  {
    id: "permessi",
    nome: "Modificare la matrice dei permessi",
    livelli: { sviluppatore: "completo", "gestore": "nessuno", "referente": "nessuno", social: "nessuno" },
  },
  {
    id: "gdpr",
    nome: "Cancellare i dati di una persona",
    /*
     * Irreversibile, e su minori: dal 4 ottobre 2026 si esegue solo su una
     * richiesta di cancellazione **aperta da un'altra persona** nella sezione
     * «Privacy» (riga `privacy`) — di solito il gestore. È la doppia firma:
     * chi riceve la richiesta della famiglia la registra, chi ha le mani sul
     * database la esegue, e nessuno dei due la fa da solo.
     */
    livelli: {
      sviluppatore: "completo",
      "gestore": "nessuno",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  {
    id: "consensi-verifica",
    nome: "Verificare a campione i consensi",
    /*
     * Il controllo a campione dei consensi, dal 7 ottobre 2026 (audit degli
     * accessi, I-1). Il consenso è un fatto che attesta il referente di unità e su cui
     * il gestore pubblica: questa riga è il modo di controllarlo senza
     * rifarlo. Il sistema estrae qualche iscrizione con il consenso, chi
     * verifica guarda il modulo di carta in sede e scrive l'esito. Non registra
     * consensi e non apre l'elenco degli iscritti: vede solo il campione.
     *
     * Chi ha registrato un consenso non lo verifica (`verificaConsenso`). Il
     * referente di unità qui è `nessuno` per un tetto: attesterebbe e controllerebbe lo
     * stesso fatto.
     */
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  {
    id: "privacy",
    nome: "Richieste degli interessati (privacy)",
    /*
     * Aprire, seguire e chiudere le richieste delle famiglie (accesso,
     * rettifica, cancellazione…). Del gestore dal 4 ottobre 2026: le
     * richieste arrivano al gruppo, e prima le poteva registrare solo lo
     * sviluppatore. Cancellare i dati resta `gdpr`.
     */
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  {
    id: "registro",
    nome: "Leggere il registro delle operazioni",
    /*
     * Sola lettura (ed esportazione, che a sua volta finisce nel registro).
     * Del gestore dal 4 ottobre 2026: chi risponde di ciò che va online
     * deve poter vedere chi ha fatto che cosa, e prima il registro intero lo
     * leggeva solo lo sviluppatore — cioè l'unico che nessuno controllava.
     * Nessuna riga permette di cancellarlo.
     */
    livelli: {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  {
    id: "backup",
    nome: "Backup e ripristino",
    livelli: {
      sviluppatore: "completo",
      "gestore": "nessuno",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
  {
    id: "viste",
    nome: "Aprire la vista di un altro ruolo",
    livelli: {
      sviluppatore: "completo",
      "gestore": "nessuno",
      "referente": "nessuno",
      social: "nessuno",
    },
  },
];

// ==========================================================================
// Tetti: quello che la matrice non può concedere
// ==========================================================================

/**
 * L'ordine dei livelli, dal più stretto: serve a prendere il minimo fra il
 * valore scritto in tabella e il tetto.
 */
const RANGO: Record<Livello, number> = { nessuno: 0, limitato: 1, completo: 2 };

/**
 * Le righe che per un referente di unità non hanno un ambito.
 *
 * Su queste `limitato` non vorrebbe dire «la propria unità»: le azioni non
 * passano un'unità al cancello, `copre()` senza risorsa concede, e `limitato`
 * diventerebbe «tutto». Per questo il loro tetto, per lui, è `nessuno`.
 */
const SENZA_AMBITO: readonly string[] = [
  "identita",
  "messaggi",
  "pagine",
  "archivio-anno",
  "utenti",
  "permessi",
  "permessi-leggi",
  "gdpr",
  "privacy",
  "registro",
  "backup",
  "viste",
];

/**
 * Le righe che il social media manager non deve mai avere: persone, minori,
 * posta, configurazione, pubblicazione. È il perimetro deciso il 3 ottobre 2026
 * — «fuori: recapiti e nomi dei referenti, iscritti, documenti, identità, utenti» —
 * scritto in un posto dove un clic sbagliato non lo può disfare.
 */
const MAI_AL_SOCIAL: readonly string[] = [
  "album-pubblica",
  "documenti",
  "documenti-referenti-leggi",
  "documenti-referenti-carica",
  "identita",
  "referenti",
  "iscritti",
  "iscritti-elenco",
  "consensi-verifica",
  "messaggi",
  "archivio-anno",
  "esporta",
  "utenti",
  "permessi",
  "permessi-leggi",
  "gdpr",
  "privacy",
  "registro",
  "backup",
  "viste",
];

/**
 * Righe che **non decidono**: il comportamento è scritto nel codice, e la
 * matrice lo mostra soltanto (audit B-3). Una cella cliccabile che non apre né
 * chiude niente è la peggiore delle bugie che una schermata di permessi possa
 * dire, quindi qui il valore è fisso e la schermata dice perché.
 */
export const RIGHE_FISSE: Record<string, { livelli: Record<string, Livello>; perche: string }> = {
  "permessi-leggi": {
    livelli: { sviluppatore: "completo", "gestore": "completo", "referente": "nessuno", social: "nessuno" },
    perche: "Questa pagina la vedono lo sviluppatore e il gestore. Cambiarla è la riga sotto.",
  },
  permessi: {
    livelli: { sviluppatore: "completo", "gestore": "nessuno", "referente": "nessuno", social: "nessuno" },
    perche: "Solo lo sviluppatore cambia i permessi, e non può toglierseli: nessuno resterebbe chiuso fuori.",
  },
  viste: {
    livelli: { sviluppatore: "completo", "gestore": "nessuno", "referente": "nessuno", social: "nessuno" },
    perche: "Solo lo sviluppatore apre le viste degli altri ruoli, e solo per guardare.",
  },
  "archivio-anno": {
    livelli: { sviluppatore: "completo", "gestore": "completo", "referente": "nessuno", social: "nessuno" },
    perche: "Funzione non ancora attiva: la riga dice a chi spetterà.",
  },
};

/**
 * Il livello più alto che un ruolo può avere su una riga, qualunque cosa dica
 * la tabella — con il motivo, che la schermata «Permessi» mostra sulla cella.
 *
 * Audit degli accessi del 4 ottobre 2026, M-5: prima di questo la matrice
 * accettava qualunque combinazione, e un clic su «completo» per il social alla
 * riga `iscritti` gli avrebbe dato i minori di tutte le unità — per lui
 * `copre()` è sempre vero. I tetti sono le regole che non dipendono da una
 * preferenza dell'amministratore ma dalla natura del ruolo.
 *
 * Valgono in **lettura**: `livelloEffettivo` li applica sia alla decisione sia
 * alla matrice mostrata, quindi un valore vecchio rimasto in tabella non apre
 * niente. E in scrittura: `cambiaLivello` rifiuta un valore sopra il tetto.
 */
export function tetto(azione: string, ruolo: string): { livello: Livello; perche: string | null } {
  const fissa = RIGHE_FISSE[azione];
  if (fissa) return { livello: fissa.livelli[ruolo] ?? "nessuno", perche: fissa.perche };

  if (ruolo === "sviluppatore") return { livello: "completo", perche: null };

  if (ruolo === "gestore") {
    if (azione === "gdpr" || azione === "backup" || azione === "permessi") {
      return {
        livello: "nessuno",
        perche: "Cancellare dati, rimettere copie e cambiare i permessi è dello sviluppatore, su richiesta del gestore.",
      };
    }
    if (azione === "iscritti") {
      return {
        livello: "nessuno",
        perche:
          "Chi pubblica le foto non registra anche i consensi che le permettono: li inserisce " +
          "il referente di unità, il gestore li consulta (riga «Consultare iscritti e consensi»).",
      };
    }
    if (azione === "utenti") {
      return {
        livello: "limitato",
        perche: "Il gestore gestisce referenti di unità e social media manager, non i propri pari grado.",
      };
    }
    return { livello: "completo", perche: null };
  }

  if (ruolo === "referente") {
    // i documenti per i referenti li carica chi guida il gruppo, qualunque cosa dica
    // la tabella: il referente di unità li legge (e la lettura è la riga qui accanto)
    if (azione === "documenti-referenti-carica") {
      return {
        livello: "nessuno",
        perche: "I documenti per i referenti li caricano i gestori: il referente di unità li legge.",
      };
    }
    if (azione === "consensi-verifica") {
      return {
        livello: "nessuno",
        perche: "I consensi li registra il referente di unità: a controllarli è un’altra persona.",
      };
    }
    if (SENZA_AMBITO.includes(azione)) {
      return {
        livello: "nessuno",
        perche: "Riguarda tutto il gruppo, non una singola unità: a un referente di unità non si apre.",
      };
    }
    if (azione === "album-pubblica") {
      return {
        livello: "nessuno",
        perche: "Pubblica le fotografie di minori chi controlla i consensi: il gestore.",
      };
    }
    return {
      livello: "limitato",
      perche: "Un referente di unità lavora solo sulla propria unità: «Sì» vorrebbe dire tutte le unità.",
    };
  }

  if (ruolo === "social") {
    if (MAI_AL_SOCIAL.includes(azione)) {
      return {
        livello: "nessuno",
        perche: "Il social media manager non tocca dati di persone, ragazzi, posta e configurazione.",
      };
    }
    return {
      livello: "limitato",
      perche: "Il social media manager propone: ogni sua modifica la approva un gestore.",
    };
  }

  // un ruolo che il codice non conosce non ha niente
  return { livello: "nessuno", perche: "Ruolo sconosciuto." };
}

/** Il livello che vale davvero: quello in tabella, sotto il tetto. */
export function livelloEffettivo(azione: string, ruolo: string, scritto: Livello): Livello {
  const t = tetto(azione, ruolo);
  if (RIGHE_FISSE[azione]) return t.livello;
  return RANGO[scritto] <= RANGO[t.livello] ? scritto : t.livello;
}

/** Vero se `livello` sta sotto il tetto: è quello che `cambiaLivello` controlla. */
export function ammesso(azione: string, ruolo: string, livello: Livello): boolean {
  if (RIGHE_FISSE[azione]) return false;
  return RANGO[livello] <= RANGO[tetto(azione, ruolo).livello];
}

/**
 * Che cosa vuol dire «limitato» per ciascun ruolo.
 *
 * Tre significati in una parola sola erano il rilievo B-3 dell'audit: la
 * schermata li scrive tutti, accanto alla legenda, invece di lasciarli nei
 * commenti del codice.
 */
export const SIGNIFICATO_LIMITATO: Record<string, string> = {
  "referente": "solo la propria unità.",
  social: "propone: la modifica va in coda e la approva il gestore; tocca solo i contenuti che ha creato lui.",
  "gestore": "solo su una parte degli oggetti — alla riga «Utenti», gli account di referenti di unità e social.",
};

/**
 * Le funzioni raggruppate per argomento, con una frase che dice in parole
 * semplici che cosa apre la riga.
 *
 * La matrice era un elenco piatto di ventiquattro righe con nomi da codice, e
 * chi la apriva non capiva né che cosa fosse una riga né perché ce ne fossero
 * due quasi uguali. Il gruppo dà il contesto, la frase dà il significato. Una
 * riga che il seme non conosce — aggiunta a mano in tabella — finisce in
 * «Altro» con il solo nome.
 */
export const GRUPPI_FUNZIONI: { titolo: string; righe: { id: Azione; spiegazione: string }[] }[] = [
  {
    titolo: "Foto e album",
    righe: [
      { id: "album-carica", spiegazione: "Creare un album e caricarci le foto. Finché non è pubblicato, sul sito non si vede." },
      { id: "album-pubblica", spiegazione: "Mettere online un album. Chi pubblica controlla i consensi alle foto dei ragazzi." },
    ],
  },
  {
    titolo: "Sito pubblico",
    righe: [
      { id: "pagine", spiegazione: "I testi di Home e Chi siamo e le domande frequenti." },
      { id: "identita", spiegazione: "Nome del gruppo, marchio, indirizzo e recapiti che compaiono sul sito." },
      { id: "attivita", spiegazione: "Uscite, campi ed eventi del calendario." },
      { id: "messaggi", spiegazione: "I messaggi arrivati dal modulo contatti del sito." },
    ],
  },
  {
    titolo: "Unità e referenti",
    righe: [
      { id: "unita-scheda", spiegazione: "Motto, presentazione, ritrovo e recapiti nella pagina dell’unità." },
      { id: "unita-anagrafica", spiegazione: "Nome, età, logo, indirizzo web e foto di copertina di un’unità." },
      { id: "referenti", spiegazione: "I nomi dei referenti e dello staff mostrati sul sito." },
    ],
  },
  {
    titolo: "Documenti",
    righe: [
      { id: "documenti", spiegazione: "Moduli e circolari che le famiglie scaricano dal sito." },
      { id: "documenti-referenti-leggi", spiegazione: "Aprire i documenti riservati ai referenti." },
      { id: "documenti-referenti-carica", spiegazione: "Aggiungere, cambiare o togliere i documenti riservati ai referenti." },
    ],
  },
  {
    titolo: "Iscritti e privacy",
    righe: [
      { id: "iscritti", spiegazione: "Inserire iscrizioni, quote e consensi alle foto dei ragazzi." },
      { id: "iscritti-elenco", spiegazione: "Vedere l’elenco degli iscritti e dei consensi, senza cambiarlo." },
      { id: "consensi-verifica", spiegazione: "Controllare in sede, su qualche iscrizione estratta a caso, che il modulo del consenso ci sia." },
      { id: "esporta", spiegazione: "Scaricare le tabelle in un file da aprire con Excel." },
      { id: "privacy", spiegazione: "Registrare e seguire le richieste delle famiglie sui propri dati." },
      { id: "gdpr", spiegazione: "Cancellare per sempre i dati di una persona, su una richiesta registrata da un altro." },
    ],
  },
  {
    titolo: "Account e sicurezza",
    righe: [
      { id: "utenti", spiegazione: "Invitare, sospendere e togliere gli account dell’area riservata." },
      { id: "permessi-leggi", spiegazione: "Vedere questa pagina." },
      { id: "permessi", spiegazione: "Cambiare le caselle di questa pagina." },
      { id: "registro", spiegazione: "Vedere chi ha fatto che cosa nell’area riservata, e quando." },
      { id: "backup", spiegazione: "Fare copie di sicurezza del sito e rimetterle." },
      { id: "viste", spiegazione: "Guardare l’area riservata come la vede un altro ruolo, senza poter cambiare niente." },
      { id: "archivio-anno", spiegazione: "Chiudere l’anno sociale e passare al successivo. Non ancora attiva." },
    ],
  },
];

/** Una riga in parole semplici sotto il nome di ciascun ruolo. */
export const RUOLI_DESCRIZIONE: Record<string, string> = {
  sviluppatore: "gestisce il sito",
  "gestore": "guida il gruppo",
  "referente": "la propria unità",
  social: "propone, non pubblica",
};

/**
 * Che cosa c'è scritto nella cella: due o tre parole, non una frase.
 *
 * Prima ogni cella ripeteva «Accesso completo» o «Nessun accesso» sotto il
 * segno, e una griglia di cento caselle tutte uguali nascondeva le poche che
 * dicono qualcosa. Sì e No bastano al segno; le parole servono solo dove il
 * permesso ha un limite, ed è lì che vanno lette.
 */
export function descriviPermesso(azione: string, ruolo: string, livello: Livello): string {
  if (livello === "nessuno") return "No";
  if (livello === "completo") return "Sì";
  if (azione === "documenti-referenti-leggi" || azione === "permessi-leggi") return "Solo lettura";
  if (azione === "utenti") return "Solo referenti di unità e social";
  if (ruolo === "social") {
    if (azione === "album-carica") return "Propone i suoi album";
    if (azione === "attivita") return "Propone le sue attività";
    if (azione === "unita-anagrafica") return "Propone la copertina";
    return "Propone";
  }
  if (ruolo === "referente") {
    if (["album-carica", "attivita", "referenti"].includes(azione)) return "Sua unità, con approvazione";
    if (azione === "unita-scheda") return "Sua unità (foto con approvazione)";
    if (azione === "iscritti-elenco" || azione === "esporta") return "Sua unità, solo lettura";
    return "Sua unità";
  }
  return "In parte";
}
