/**
 * Contenuti dell'area riservata (referente di unità, gestore, sviluppatore, social
 * media manager).
 *
 * Portato da `src/data_area.py`. Le tre schermate condividono lo stesso guscio:
 * barra in alto, colonna delle sezioni a sinistra, contenuto a destra con
 * indicatori e avvisi.
 *
 * ## Che cosa è rimasto qui, dopo la fase 14.10
 *
 * **Il guscio, non i dati.** Fino a qui questo file conteneva anche le
 * diciassette tabelle del prototipo e i due moduli: righe, celle, stili di
 * cella, stati. Erano dati fissi, e l'editor generico che li scriveva li metteva
 * in un file JSON che nessuna pagina leggeva.
 *
 * Adesso ogni sezione ha la sua schermata, che legge dal database, e qui restano
 * le cose che descrivono la **navigazione**: quali sezioni ha un ruolo, come si
 * chiamano, che cosa dice la riga di spiegazione, quali pulsanti ci sono in
 * testa. Con loro sono andati via `StileCella`, `Cella`, `Riga`, `Tabella`,
 * `Modulo` e `CampoModulo`: nessuno li importava più, e un tipo che non si usa
 * è un invito a riusarlo.
 *
 * L'avvertenza che stava qui — «i contenuti sono dati fissi da prototipo» — non
 * serve più, ed è la cosa migliore di questa fase.
 */

import type { RuoloSessione } from "@/lib/sessione";

export interface Kpi {
  label: string;
  valore: string;
  tone?: "red";
}

/**
 * Una sezione dell'area riservata: intestazione, indicatori, avviso.
 *
 * ## `kpi` è vuoto quasi ovunque, dalla fase 14.11
 *
 * Sei sezioni avevano quattro indicatori con il valore `—`: erano i riquadri del
 * mockup, in attesa dei numeri veri. Quattro trattini non sono una bugia —
 * significano «non lo so» — ma sono una promessa di misura che nessuno mantiene,
 * e in quattro di quelle sezioni erano l'unica cosa sopra la tabella.
 *
 * Le sezioni che gli indicatori li **hanno** li calcolano nel proprio
 * componente, dove i dati sono già in mano: `IndicatoriCoda`,
 * `IndicatoriRegistro`, `Utenti`, `StatoSistema`. È l'architettura che è venuta
 * fuori da sola, e questo campo resta per le sezioni che un domani ne vorranno
 * di statici.
 *
 * Gli indicatori calcolati per le altre — iscritti, attività, messaggi, privacy
 * — restano fra le cose aperte: si fanno nel componente, come gli altri quattro.
 */
export interface Sezione {
  crumb: string;
  titolo: string;
  nota: string;
  azioni: { label: string; primary: boolean }[];
  kpi?: Kpi[];
  /**
   * Riquadro d'avviso. `href` è la sezione (o la pagina pubblica) a cui porta
   * il collegamento: nel mockup era un `#`, qui deve essere una destinazione
   * vera, altrimenti l'avviso segnala un problema e non dà modo di guardarlo.
   */
  avviso?: { tag: string; testo: string; link: string; href: string };
}

export interface GruppoNav {
  label: string;
  voci: { chiave: string; testo: string; tag: string }[];
}

export interface Ruolo {
  /** segmento di indirizzo: /area-riservata/<slug> */
  slug: string;
  titoloPagina: string;
  barraTema: "navy" | "dark";
  barraTitolo: string;
  /** La pastiglia accanto al titolo, in barra. Con testo vuoto non compare. */
  barraBadge:
    | { tipo: "unita"; logo: string; testo: string }
    | { tipo: "contorno"; testo: string }
    | { tipo: "testo"; testo: string };
  barraRicerca: string;
  barraRuolo: string;
  barraIniziali: string;
  ambitoColore: string;
  ambitoTitolo: string;
  ambitoNota: string;
  fuoriAmbito: string | null;
  /** viste degli altri ruoli; l'uscita non sta qui, è un'azione */
  altreViste: { href: string; label: string; ruolo: RuoloSessione }[];
  nav: GruppoNav[];
  sezioni: Record<string, Sezione>;
}

// --------------------------------------------------------------------------
// Referente di unità
// --------------------------------------------------------------------------

const REFERENTE: Ruolo = {
  slug: "referente",
  titoloPagina: "Area riservata — Referente di unità",
  barraTema: "navy",
  barraTitolo: "Label / gestione unità",
  barraBadge: { tipo: "unita", logo: "logo-u1.png", testo: "Label 1" },
  barraRicerca: "Cerca nella mia unità",
  barraRuolo: "referente di unità",
  barraIniziali: "AK",
  ambitoColore: "#ffcc00",
  ambitoTitolo: "Label 1",
  ambitoNota: "",
  fuoriAmbito:
    "Altre unità, pagine del sito, utenti e configurazione: gestiti dai gestori.",
  altreViste: [
    { href: "/area-riservata/gestore", label: "vista gestore", ruolo: "gestore" },
    { href: "/area-riservata/sviluppatore", label: "vista sviluppatore", ruolo: "sviluppatore" },
    { href: "/area-riservata/social", label: "vista social media", ruolo: "social" },
  ],
  nav: [
    /* La dashboard sta in un gruppo suo, «Panoramica», come nella vista del
       gestore. Prima era la prima voce di «Contenuti» e si chiamava
       «Riepilogo», mentre la schermata che apriva si intitolava «Dashboard
       dell'unità»: due nomi per la stessa cosa, e messa in mezzo agli album e
       alle circolari come se fosse un contenuto da compilare anche lei. Non lo
       è: è il quadro di tutte le altre. */
    {
      label: "Panoramica",
      voci: [{ chiave: "riepilogo", testo: "Panoramica", tag: "" }],
    },
    {
      label: "Contenuti",
      voci: [
        { chiave: "album", testo: "Album e foto", tag: "" },
        { chiave: "attivita", testo: "Attività", tag: "" },
        { chiave: "circolari", testo: "Circolari e liste", tag: "" },
        { chiave: "presentazione", testo: "Testo di presentazione", tag: "" },
        { chiave: "immagini", testo: "Foto dell’unità", tag: "" },
      ],
    },
    /*
     * «Dati riservati», con dentro l'elenco iscritti, è stato tolto dal menu il
     * 6 ottobre 2026, su richiesta dell'utente. La sezione `iscritti` resta
     * più sotto, raggiungibile dai collegamenti della dashboard: toglierla
     * davvero è una scelta a parte, perché la dashboard la nomina in tre punti.
     */
    {
      // I documenti che il gestore mette a disposizione dei referenti, dal 3
      // ottobre 2026. Un gruppo suo e non sotto «Contenuti»: quelle sono le
      // cose che il referente di unità scrive per il sito, questi sono cose che legge.
      label: "Comunità referenti",
      voci: [{ chiave: "documenti-referenti", testo: "Documenti per i referenti", tag: "" }],
    },
  ],
  sezioni: {
    riepilogo: {
      crumb: "Label 1 / Panoramica",
      titolo: "Panoramica dell’unità",
      nota: "Quadro generale dell’unità, attività in programma, iscritti e stato dei contenuti.",
      azioni: [{ label: "Anteprima pubblica", primary: false }],
      kpi: [],
    },
    album: {
      crumb: "Label 1 / Album e foto",
      titolo: "Album e foto",
      nota:
        "Ogni album va inviato in revisione: i gestori controllano i consensi " +
        "e pubblicano. Potete creare un album e caricare le foto da questa pagina.",
      azioni: [],
    },
    attivita: {
      crumb: "Label 1 / Attività",
      titolo: "Attività dell’unità",
      nota:
        "Potete inserire e modificare solo le attività della vostra unità. Le date " +
        "di gruppo le mettono i gestori.",
      azioni: [
        { label: "Esporta calendario", primary: false },
        { label: "Nuova attività", primary: true },
      ],
      kpi: [],
    },
    circolari: {
      crumb: "Label 1 / Circolari e liste",
      titolo: "Circolari e liste materiale",
      /*
       * Diceva «Vanno approvati dai gestori prima di comparire sul sito».
       * Dalla fase 14.7 non è più vero, ed è una decisione del 31 agosto 2026:
       * una lista materiale che aspetta un'approvazione arriva dopo l'uscita.
       */
      nota:
        "I file della vostra unità: circolari delle uscite, liste materiale, avvisi " +
        "alle famiglie. Li pubblicate voi, e compaiono nella pagina Documenti del " +
        "sito, nella cartella delle circolari, con il nome della vostra unità.",
      /*
       * «Nuova lista materiale» non compare — `mostraAzione` nasconde i comandi
       * che cominciano per «nuov…» nelle sezioni con schermata vera, perché il
       * modulo d'inserimento è sulla stessa pagina. «Carica PDF» portava alla
       * sezione documenti del gestore, che un referente di unità non può aprire:
       * qui il caricamento sta dentro l'editor di ogni voce.
       */
      azioni: [{ label: "Anteprima pubblica", primary: false }],
      kpi: [],
    },
    immagini: {
      crumb: "Label 1 / Foto dell’unità",
      titolo: "Foto dell’unità",
      nota:
        "La fotografia d’archivio accanto alla storia dell’unità e i ritratti dei referenti. " +
        "Finché un posto è vuoto la pagina mostra un rettangolo nel colore della fascia, " +
        "non un errore: si possono riempire uno per volta.",
      azioni: [],
      kpi: [],
    },
    presentazione: {
      crumb: "Label 1 / Testo di presentazione",
      titolo: "Testo di presentazione",
      /*
       * Diceva «Le modifiche vanno approvate dai gestori». Dalla fase 14 è
       * vero per metà, e una mezza verità in cima a una schermata è peggio di
       * un'imprecisione: chi legge crede che il suo testo stia aspettando
       * qualcuno, e non lo ricontrolla.
       */
      nota:
        "I testi vanno online appena salvati. Recapiti e nomi dei referenti passano " +
        "dall’approvazione dei gestori: il modulo lo dice campo per campo.",
      /*
       * «Salva bozza» è stato tolto. Portava alla schermata «questa funzione non
       * è ancora attiva», e adesso il salvataggio funziona — il pulsante vero è
       * dentro il modulo, poche righe più in basso. Un pulsante che dice il
       * falso su una cosa che funziona è il difetto che l'audit della fase 13
       * ha trovato quattro volte.
       */
      azioni: [{ label: "Anteprima pubblica", primary: false }],
      kpi: [],
      /*
       * Il `modulo` del prototipo non c'è più: la scheda vera è
       * `components/area/SchedaUnita.tsx`, con i campi del catalogo. Lasciarlo
       * qui non l'avrebbe disegnato — `SEZIONI_CON_SCHERMATA` lo nasconde — ma
       * sarebbe rimasto un elenco di campi plausibile e morto, che il prossimo
       * a passare avrebbe provato ad allineare.
       */
    },
    "documenti-referenti": {
      crumb: "Label 1 / Documenti per i referenti",
      titolo: "Documenti per i referenti",
      nota:
        "I documenti che i gestori mettono a disposizione dei referenti di unità. Non " +
        "compaiono sul sito pubblico: si aprono solo da qui, dopo l’accesso.",
      azioni: [],
      kpi: [],
    },
    iscritti: {
      crumb: "Label 1 / Elenco iscritti",
      titolo: "Elenco iscritti",
      nota:
        "Nomi, età e consensi. Le schede sanitarie restano cartacee e non passano " +
        "dal sito: ogni accesso a questo elenco è registrato nel log.",
      azioni: [
        { label: "Esporta per uscita", primary: false },
        { label: "Registra iscrizione", primary: true },
      ],
      kpi: [],
      avviso: {
        tag: "GDPR",
        testo:
          "L’elenco contiene dati personali di minori. Non esportatelo su dispositivi " +
          "personali e cancellate le copie dopo l’attività.",
        link: "Informativa",
        href: "/legale/immagini-e-minori",
      },
    },
  },
};

// --------------------------------------------------------------------------
// Contenuti del sito: gestore e sviluppatore
// --------------------------------------------------------------------------

/**
 * Le voci del gruppo «Contenuti del sito», uguali per i due ruoli che le hanno
 * tutte: il gestore e lo sviluppatore (che sulle righe di matrice ha
 * `completo` ovunque, quindi è la stessa schermata).
 *
 * Fino al 6 ottobre 2026 lo sviluppatore ne vedeva solo due — «Nome e marchio» e
 * «Testi delle pagine» — e per correggere una data o un nome doveva entrare come
 * gestore. Adesso il gruppo è uno solo, definito qui, e i due menu non
 * possono più divergere: stessa lista, stesse sezioni (`sezioniContenuti`).
 *
 * I nomi sono corti apposta, e dicono che cosa c'è dentro: «Unità» ha tutto
 * quello che riguarda una unità come pagina — nome, ritrovo, testi, foto,
 * storico —, «Referenti» le persone, «Foto del sito» i riquadri che non sono di
 * un'unità.
 */
const VOCI_CONTENUTI: GruppoNav["voci"] = [
  { chiave: "identita", testo: "Dati del gruppo", tag: "" },
  { chiave: "unita", testo: "Unità", tag: "" },
  { chiave: "referenti", testo: "Referenti", tag: "" },
  { chiave: "immagini", testo: "Foto del sito", tag: "" },
  { chiave: "calendario", testo: "Calendario attività", tag: "" },
  { chiave: "album", testo: "Album fotografici", tag: "" },
  { chiave: "documenti", testo: "Documenti e archivio", tag: "" },
  { chiave: "pagine", testo: "Testi delle pagine", tag: "" },
];

/** Le otto sezioni di `VOCI_CONTENUTI`, con la briciola che dice da dove si viene. */
function sezioniContenuti(radice: string): Record<string, Sezione> {
  return {
    identita: {
      crumb: `${radice} / Dati del gruppo`,
      titolo: "Dati del gruppo",
      nota:
        "Nome, sede, recapiti e marchio: quello che scrivete qui compare subito nella " +
        "barra e nel piede di tutte le pagine pubbliche. Solo l’email è obbligatoria.",
      azioni: [],
    },
    unita: {
      crumb: `${radice} / Unità`,
      titolo: "Unità",
      nota:
        "Una scheda per ogni unità: nome e fascia d’età, luogo di ritrovo, presentazione " +
        "e storia, fotografie e responsabili precedenti. Le modifiche vanno online appena " +
        "salvate. I referenti in carica e i loro recapiti stanno in «Referenti».",
      /*
       * Due pulsanti tolti, e vale la pena scrivere perché.
       *
       * «Nuova unità» non si fa, e non è un rinvio: le sei unità sono
       * l'anagrafica dell'organizzazione, hanno chiavi esterne da album, attività
       * e iscrizioni, e un `ordine` unico. Crearne una da un modulo vorrebbe
       * dire toccare il reticolo su cui si regge tutto il resto — e un gruppo
       * che apre una fascia nuova lo fa una volta in vent'anni, con qualcuno che
       * guarda il database.
       *
       * «Sostituisci logo» nemmeno: i sei loghi sono disegnati per
       * il sito, uno per unità, e stanno in `web/scripts/loghi.mjs` — la
       * geometria in un file, non sei immagini caricabili. Poterli sostituire
       * dal modulo vorrebbe dire poter mettere il logo dell'unità 1
       * su un'altra unità. Quello che si carica è la fotografia di copertina.
       */
      azioni: [{ label: "Anteprima pubblica", primary: false }],
      kpi: [],
    },
    referenti: {
      crumb: `${radice} / Referenti`,
      titolo: "Referenti",
      nota:
        "Tutti i referenti del gruppo, unità per unità: chi c’è, con che ruolo e da quando, a " +
        "quale unità appartiene e come si raggiunge. Un referente si sposta di unità dalla sua " +
        "scheda; per aggiungerne uno c’è il pulsante in cima. Le modifiche vanno online " +
        "appena salvate.",
      /*
       * «Esporta rubrica» è stato tolto, e il motivo va scritto perché sembra un
       * peggioramento. L'esportazione CSV legge le tabelle del prototipo
       * (`righeDi`), e questa sezione non ne ha più: il file sarebbe uscito con
       * le sole intestazioni. Per un registro è peggio di un pulsante assente.
       */
      azioni: [{ label: "Anteprima pubblica", primary: false }],
      kpi: [],
    },
    immagini: {
      crumb: `${radice} / Foto del sito`,
      titolo: "Foto del sito",
      nota:
        "Le fotografie dei riquadri fissi: le schede delle fasce in home, la fotografia " +
        "di gruppo e i ritratti dei referenti. Quelle di ogni unità — copertina e archivio — " +
        "stanno in «Unità». Finché un posto è vuoto la pagina mostra un rettangolo colorato, " +
        "non un errore.",
      azioni: [],
    },
    calendario: {
      crumb: `${radice} / Calendario attività`,
      titolo: "Calendario attività",
      nota:
        "Le attività del gruppo e di ogni unità, mese per mese. Scegliete una o più unità " +
        "per vedere solo le loro. Le date di gruppo le inserite voi; quelle di unità " +
        "arrivano dai referenti di unità e passano dalla revisione.",
      azioni: [
        // «Esporta PDF» diceva PDF e scaricava un CSV: `destinazione()` manda
        // qualunque «Esporta…» alla rotta di esportazione, che produce CSV. Il
        // nome adesso dice quello che il file è.
        { label: "Esporta CSV", primary: false },
      ],
      kpi: [],
    },
    album: {
      crumb: `${radice} / Album fotografici`,
      titolo: "Album fotografici",
      nota:
        "Tutti gli album del gruppo, di ogni unità. La pubblicazione passa da qui: " +
        "prima di mettere online, controllate i consensi delle unità coinvolte.",
      azioni: [],
    },
    documenti: {
      crumb: `${radice} / Documenti e archivio`,
      titolo: "Documenti e archivio",
      nota:
        "I gruppi di documenti della pagina Documenti e i file di ciascuno. Aprite un " +
        "gruppo per vedere i suoi file; trascinate i PDF su un gruppo per caricarli. I " +
        "moduli che non cambiano da un anno all’altro si caricano come «sempre validi».",
      azioni: [],
    },
    pagine: {
      crumb: `${radice} / Testi delle pagine`,
      titolo: "Testi delle pagine pubbliche",
      /*
       * I testi delle unità non sono qui: stanno in «Unità», e la pagina Contatti
       * non ha testi propri — mostra i recapiti del gruppo, che stanno in «Dati
       * del gruppo», e quelli delle unità. Elencarle qui mandava a cercare
       * caselle in una schermata che non le ha.
       */
      nota:
        "I testi di Home e Chi siamo e le domande frequenti di Contatti. Le modifiche " +
        "vanno online appena salvate. I testi delle unità stanno in «Unità», i recapiti " +
        "del gruppo in «Dati del gruppo».",
      // «Salva modifiche» era un pulsante d'intestazione che portava alla
      // schermata «non ancora attiva»: il salvataggio è dentro il modulo.
      azioni: [{ label: "Anteprima sito", primary: false }],
      kpi: [],
    },
  };
}

// --------------------------------------------------------------------------
// Gestore
// --------------------------------------------------------------------------

const GESTORE: Ruolo = {
  slug: "gestore",
  titoloPagina: "Area riservata — Gestore",
  barraTema: "navy",
  barraTitolo: "Label / gestione gruppo",
  barraBadge: { tipo: "testo", testo: "" },
  barraRicerca: "Cerca in tutto il gruppo",
  barraRuolo: "gestore",
  barraIniziali: "CG",
  ambitoColore: "#003366",
  ambitoTitolo: "Tutto il gruppo",
  ambitoNota: "",
  fuoriAmbito:
    "Account di gestori e sviluppatore, modifica dei permessi, dominio, backup e " +
    "cancellazione dei dati di una persona: gestiti dallo sviluppatore.",
  altreViste: [
    { href: "/area-riservata/referente", label: "vista referente di unità", ruolo: "referente" },
    { href: "/area-riservata/sviluppatore", label: "vista sviluppatore", ruolo: "sviluppatore" },
    { href: "/area-riservata/social", label: "vista social media", ruolo: "social" },
  ],
  nav: [
    {
      label: "Panoramica",
      voci: [{ chiave: "riepilogo", testo: "Panoramica", tag: "" }],
    },
    {
      label: "Coda di lavoro",
      voci: [
        { chiave: "approvazioni", testo: "Approvazioni", tag: "" },
        { chiave: "messaggi", testo: "Messaggi dal sito", tag: "" },
        // «Utenti», dalla fase 14.9: il ricambio dei referenti di unità di settembre.
        // Sta nella coda di lavoro e non fra i contenuti perché non è
        // contenuto — è amministrazione, e capita due volte l'anno.
        { chiave: "utenti", testo: "Utenti", tag: "" },
      ],
    },
    { label: "Contenuti del sito", voci: VOCI_CONTENUTI },
    {
      // Non sta fra i «Contenuti del sito» perché non lo è: questi documenti
      // non finiscono in nessuna pagina pubblica. Il nome del gruppo è quello
      // del referente di unità, che li ritrova sotto la stessa voce.
      label: "Comunità referenti",
      voci: [{ chiave: "documenti-referenti", testo: "Documenti per i referenti", tag: "" }],
    },
    {
      /*
       * Dal 4 ottobre 2026 (audit degli accessi, §7): chi risponde di ciò che va
       * online vede chi ha fatto che cosa, le richieste delle famiglie e le
       * regole dei permessi. Tutto in lettura, tranne le richieste.
       *
       * «Iscritti e consensi» non c'è più, dal 6 ottobre: il gestore non
       * apre l'elenco dei ragazzi da qui. I consensi che gli servono li vede
       * nella coda di approvazione, album per album.
       */
      label: "Controllo",
      voci: [
        { chiave: "privacy", testo: "Privacy e richieste", tag: "" },
        { chiave: "log", testo: "Registro delle operazioni", tag: "" },
        { chiave: "permessi", testo: "Permessi per ruolo", tag: "" },
      ],
    },
  ],
  sezioni: {
    ...sezioniContenuti("Label"),
    "documenti-referenti": {
      crumb: "Comunità referenti / Documenti per i referenti",
      titolo: "Documenti per i referenti",
      nota:
        "Documenti riservati ai referenti di unità: verbali, programmi, regolamenti interni. " +
        "Non compaiono sul sito pubblico; i referenti li aprono dalla loro area riservata, " +
        "nelle cartelle che create qui. PDF e file di Office.",
      azioni: [],
      kpi: [],
    },
    privacy: {
      crumb: "Label / Privacy e richieste",
      titolo: "Richieste degli interessati",
      nota:
        "Le richieste delle famiglie — accesso, rettifica, cancellazione — si registrano " +
        "qui appena arrivano. La cancellazione dei dati la esegue lo sviluppatore, " +
        "partendo dalla richiesta aperta da voi: nessuno dei due la fa da solo.",
      azioni: [
        { label: "Esporta registro", primary: false },
        { label: "Nuova richiesta", primary: true },
      ],
      kpi: [],
    },
    log: {
      crumb: "Label / Registro delle operazioni",
      titolo: "Registro delle operazioni",
      nota:
        "Chi ha fatto che cosa, in sola lettura. Conservazione 12 mesi; consensi e " +
        "pubblicazioni restano più a lungo. L’esportazione finisce a sua volta nel registro.",
      azioni: [{ label: "Esporta il registro", primary: false }],
    },
    permessi: {
      crumb: "Label / Permessi per ruolo",
      titolo: "Permessi per ruolo",
      nota:
        "Che cosa può fare ogni ruolo nell’area riservata. È in sola lettura: i permessi li " +
        "cambia lo sviluppatore, e ogni modifica compare nella vostra panoramica.",
      azioni: [],
    },
    riepilogo: {
      crumb: "Label / Panoramica",
      titolo: "Panoramica del gruppo",
      nota: "Panoramica generale delle attività, unità, approvazioni e comunicazioni del Label.",
      azioni: [{ label: "Anteprima sito", primary: false }],
      kpi: [],
    },
    approvazioni: {
      crumb: "Label / Approvazioni",
      titolo: "Coda di approvazione",
      nota:
        "Quello che i referenti di unità inviano compare qui e va online solo dopo la " +
        "vostra conferma.",
      azioni: [
        { label: "Nuovo documento", primary: false },
        { label: "Nuova attività", primary: false },
        { label: "Archivia anno", primary: true },
      ],
    },
    /**
     * «Utenti», aggiunta alla vista del gestore nella fase 14.9.
     *
     * La sezione esisteva solo per lo sviluppatore. La decisione del 31 agosto
     * 2026 dà al gestore il ricambio dei **referenti di unità** — quello di
     * settembre, che con un comando da riga di server non si fa — e una funzione
     * che non ha una voce di menù è una funzione che non esiste.
     *
     * Si chiamava «Utenti e referenti», e dal 6 ottobre è solo «Utenti»: i referenti, come
     * persone da mostrare sul sito, sono in un'altra sezione («Referenti»), e due
     * schermate con «referenti» nel nome facevano cercare l'una nell'altra.
     */
    utenti: {
      crumb: "Label / Utenti",
      titolo: "Utenti",
      nota:
        "Invitare e revocare i referenti di unità e il social media manager. Il collegamento " +
        "d’invito viene inviato per email, se disponibile; altrimenti compare una sola volta, da consegnare. Gli account dei referenti " +
        "gruppo e dello sviluppatore li gestisce chi amministra.",
      azioni: [],
      kpi: [],
    },
    messaggi: {
      crumb: "Label / Messaggi dal sito",
      titolo: "Messaggi dal sito",
      nota:
        "Arrivano dal modulo della pagina Contatti. Conservati 24 mesi, poi cancellati " +
        "automaticamente.",
      /*
       * «Segna come letti» è stato tolto: portava alla schermata «funzione non
       * ancora attiva», mentre la schermata vera ha il comando su ogni riga —
       * ed è giusto che sia per riga, perché «letto» è una cosa che si dice di
       * un messaggio, non di venti insieme.
       */
      azioni: [{ label: "Esporta CSV", primary: false }],
      kpi: [],
    },
  },
};

// --------------------------------------------------------------------------
// Sviluppatore
// --------------------------------------------------------------------------

const SVILUPPATORE: Ruolo = {
  slug: "sviluppatore",
  titoloPagina: "Area riservata — Sviluppatore",
  barraTema: "dark",
  barraTitolo: "Label / amministrazione",
  barraBadge: { tipo: "testo", testo: "" },
  barraRicerca: "Cerca utenti, log, pagine",
  barraRuolo: "admin · 2FA attiva",
  barraIniziali: "SV",
  ambitoColore: "#12161c",
  ambitoTitolo: "",
  ambitoNota: "",
  fuoriAmbito: null,
  altreViste: [
    { href: "/area-riservata/gestore", label: "vista gestore", ruolo: "gestore" },
    { href: "/area-riservata/referente", label: "vista referente di unità", ruolo: "referente" },
    { href: "/area-riservata/social", label: "vista social media", ruolo: "social" },
  ],
  nav: [
    {
      label: "Panoramica",
      voci: [{ chiave: "riepilogo", testo: "Panoramica", tag: "" }],
    },
    {
      label: "Amministrazione",
      voci: [
        { chiave: "sistema", testo: "Stato del sistema", tag: "" },
        { chiave: "utenti", testo: "Utenti", tag: "" },
        { chiave: "permessi", testo: "Permessi per ruolo", tag: "" },
      ],
    },
    // Lo stesso gruppo del gestore, dal 6 ottobre 2026: lo sviluppatore ha
    // `completo` su tutte queste righe, e prima doveva passare dalla vista di un
    // altro ruolo per toccarle.
    { label: "Contenuti del sito", voci: VOCI_CONTENUTI },
    {
      // Lo sviluppatore carica i documenti per i referenti come il gestore: è
      // la stessa schermata, e la stessa riga della matrice.
      label: "Comunità referenti",
      voci: [{ chiave: "documenti-referenti", testo: "Documenti per i referenti", tag: "" }],
    },
    {
      label: "Sicurezza e dati",
      voci: [
        { chiave: "log", testo: "Registro delle operazioni", tag: "" },
        { chiave: "backup", testo: "Backup e ripristino", tag: "" },
        { chiave: "privacy", testo: "Privacy e consensi", tag: "GDPR" },
      ],
    },
  ],
  sezioni: {
    ...sezioniContenuti("Contenuti del sito"),
    "documenti-referenti": {
      crumb: "Comunità referenti / Documenti per i referenti",
      titolo: "Documenti per i referenti",
      nota:
        "Documenti riservati ai referenti di unità, gli stessi che gestiscono i gestori. " +
        "Non compaiono sul sito pubblico: si servono solo a chi è entrato e ha la riga " +
        "«Leggere i documenti per i referenti» nella matrice.",
      azioni: [],
      kpi: [],
    },
    /*
     * La dashboard di sistema.
     *
     * `azioni` è vuoto di proposito, e non per dimenticanza: le altre due
     * dashboard hanno «Anteprima pubblica» perché quello che curano finisce in
     * una pagina del sito, e questa non cura contenuti. I collegamenti che
     * servono — stato del sistema, registro, utenti — stanno nella schermata,
     * accanto al numero che li motiva, che è dove si vanno a cercare.
     */
    riepilogo: {
      crumb: "Amministrazione / Panoramica",
      titolo: "Panoramica del sistema",
      nota:
        "Se c'è qualcosa da fare, e come sta andando. I dettagli, riga per " +
        "riga, sono in «Stato del sistema».",
      azioni: [],
      kpi: [],
    },
    sistema: {
      crumb: "Amministrazione / Stato del sistema",
      titolo: "Stato del sistema",
      nota:
        "Tutti i controlli, riga per riga: database, sicurezza, macchina, " +
        "certificati, Cloudflare e OVH. Nessuno di questi valori si scrive a mano.",
      /*
       * Tre pulsanti tolti.
       *
       * «Esporta backup»: `destinazione()` tratta qualunque «Esporta…» come uno
       * scarico CSV della sezione, quindi scaricava un file con la sola
       * intestazione — e il suo nome promette una copia di sicurezza. Il backup
       * non c'è, e lo dice la sezione «Backup e ripristino».
       *
       * «Nuovo utente»: c'è la sezione «Utenti e ruoli», con il modulo vero.
       *
       * «Rilascia versione»: un rilascio è `npm run build` e una copia sul
       * server (§06 del piano). Un pulsante che lo promette da una schermata web
       * è la cosa più pericolosa che si possa mettere in un'area riservata.
       */
      azioni: [],
      // gli indicatori li calcola la schermata: quattro trattini erano quattro
      // promesse di numeri che nessuno leggeva
      kpi: [],
      avviso: {
        tag: "Sicurezza",
        testo:
          "Il secondo fattore si sceglie account per account, in «Utenti». Chi lo " +
          "ha richiesto non entra senza codice: va tenuto attivo per admin e referenti " +
          "gruppo, che accedono a elenchi iscritti e consensi.",
        link: "Apri utenti",
        href: "/area-riservata/sviluppatore/utenti",
      },
    },
    utenti: {
      crumb: "Amministrazione / Utenti",
      titolo: "Utenti",
      /*
       * Diceva «È l'unico ruolo che può modificare questa tabella». Dalla fase
       * 14.9 non è più vero: un gestore invita e revoca i **referenti di unità**, e
       * lasciare quella frase avrebbe fatto cercare a un gestore il motivo
       * per cui vede una schermata che gli dice di non essere sua.
       */
      nota:
        "Creazione, ambito e revoca degli account. Il collegamento d’invito compare " +
        "una volta sola: nel database c’è solo la sua impronta.",
      /*
       * «Invita utente» non compare: `mostraAzione` nasconde i comandi che
       * cominciano per «invita» nelle sezioni con schermata vera, e il modulo è
       * sulla stessa pagina. «Forza 2FA» è stato tolto: portava alla schermata
       * «non ancora attiva», e §08 vuole il secondo fattore **obbligatorio** per
       * gestore e admin — cioè una regola nell'accesso, non un pulsante che
       * qualcuno preme una volta. L'elenco mostra chi non ce l'ha, che è
       * l'informazione utile finché quella regola non c'è.
       */
      azioni: [],
      kpi: [],
    },
    permessi: {
      crumb: "Amministrazione / Permessi per ruolo",
      titolo: "Permessi per ruolo",
      nota:
        "Che cosa può fare ogni ruolo nell’area riservata. Le righe sono raggruppate per " +
        "argomento; «Tutti i ruoli» le mostra a confronto, gli altri pulsanti un ruolo alla volta.",
      azioni: [{ label: "Esporta i permessi per ruolo", primary: false }],
    },
    log: {
      crumb: "Amministrazione / Log",
      titolo: "Registro delle operazioni",
      nota:
        "Conservazione 12 mesi; consensi e pubblicazioni restano più a lungo. Ogni " +
        "operazione registra chi, con quale ruolo, che cosa e dove.",
      azioni: [{ label: "Esporta il registro", primary: true }],
    },
    /**
     * Backup e ripristino: la sezione resta, la tabella «Copie recenti» no.
     *
     * Era vuota, e sotto c'era il modulo per aggiungere una riga a mano — cioè
     * per **dichiarare** un backup che non è stato fatto. Fra tutte le tabelle
     * del prototipo era la più pericolosa: un elenco di copie inventate è
     * esattamente ciò che si guarda il giorno in cui il disco si rompe.
     *
     * Il backup non è codice: sono `restic` e Litestream verso un bucket, cioè
     * credenziali che questo repository non deve contenere — l'audit della fase
     * 13 lo mette come prima delle cose aperte. Finché non ci sono, la schermata
     * dice che non ci sono.
     */
    backup: {
      crumb: "Amministrazione / Backup",
      titolo: "Backup e ripristino",
      nota:
        "Non c’è nessun backup automatico configurato. Sotto c’è che cosa serve, e " +
        "che cosa si perde nel frattempo.",
      azioni: [],
      kpi: [],
    },
    privacy: {
      crumb: "Amministrazione / Privacy e consensi",
      titolo: "Richieste sui dati e controllo consensi",
      nota:
        "Richieste sui dati personali, controllo dei consensi degli album e tempi " +
        "di conservazione.",
      azioni: [
        { label: "Esporta registro", primary: false },
        { label: "Nuova richiesta", primary: true },
      ],
      kpi: [],
      avviso: {
        tag: "Scadenze",
        // «La cancellazione automatica arriva con il database» era vero fino
        // alla fase 8.1 e non lo è più: `npm run db:pulizia` cancella i
        // messaggi oltre i 24 mesi, le sessioni e gli inviti scaduti. Lasciare
        // scritto che una cosa non c'è, quando c'è, manda a cercare un lavoro
        // già fatto — ed è lo stesso difetto dell'avviso di `Matrice.tsx`,
        // corretto in fase 5.
        testo:
          "I messaggi del modulo contatti si conservano 24 mesi, come dichiarato " +
          "nell’informativa privacy, e oltre quel termine li cancella il lavoro " +
          "notturno insieme a sessioni e inviti scaduti. Questo registro delle " +
          "richieste invece non scade: le righe restano finché non le si cancella.",
        link: "Apri il registro delle operazioni",
        href: "/area-riservata/sviluppatore/log",
      },
    },
  },
};

// --------------------------------------------------------------------------
// Social media manager
// --------------------------------------------------------------------------

/**
 * Il social media manager, dal 3 ottobre 2026.
 *
 * Prepara i contenuti di tutte le unità e del sito — album, fotografie, testi,
 * domande frequenti, calendario — e niente di quello che fa va online da sé:
 * ogni salvataggio diventa una voce nella coda dei gestori. Le sezioni sono
 * quelle del gestore che riguardano i contenuti, con due differenze:
 *
 *  - «Testi delle unità» invece di «Referenti e recapiti»: i testi sì, i recapiti e i
 *    nomi dei referenti no — sono dati personali, e la riga `referenti` per lui è
 *    `nessuno`. La copertina dell'unità sta qui, perché è la sua fotografia;
 *  - «In attesa», la stessa coda del gestore **senza i pulsanti**: chi
 *    propone deve poter vedere che cosa sta aspettando, e una coda che non si
 *    vede insegna a rimandare la stessa modifica tre volte.
 *
 * Utenti, permessi, iscritti, messaggi, documenti e identità del gruppo non ci
 * sono: non sono contenuto, e la matrice glieli nega comunque.
 *
 * Dal 4 ottobre 2026 il menu segue le tre cose che fa — contenuti, fotografie,
 * calendario — e la dashboard è sua (`DashboardSocial`), non una versione
 * ridotta di quella del gestore. Nella stessa occasione sono usciti dal suo
 * perimetro il ritrovo delle unità, che è un indirizzo, e i telefoni della
 * locandina: «nessun accesso a documenti, informative, contatti, numeri di
 * telefono, indirizzi».
 *
 * Dal 6 ottobre 2026 è lui che tiene aggiornato il sito, perché i referenti di unità non
 * ne hanno il tempo: lavora anche sugli album e sulle attività creati dagli
 * altri — sempre con l'approvazione dei gestori — e le fotografie le
 * nasconde invece di eliminarle. Il perimetro dei dati resta quello del 4.
 */
const SOCIAL: Ruolo = {
  slug: "social",
  titoloPagina: "Area riservata — Social media",
  barraTema: "navy",
  barraTitolo: "Label / contenuti e social",
  barraBadge: { tipo: "testo", testo: "" },
  barraRicerca: "Cerca nei contenuti",
  barraRuolo: "social media",
  barraIniziali: "SM",
  ambitoColore: "#003366",
  ambitoTitolo: "Tutte le unità",
  ambitoNota: "ogni modifica passa dai gestori",
  fuoriAmbito:
    "Documenti e informative, recapiti, telefoni e indirizzi, nomi dei referenti, " +
    "iscritti, utenti e configurazione: li gestiscono i gestori.",
  altreViste: [],
  nav: [
    {
      label: "Panoramica",
      voci: [
        { chiave: "riepilogo", testo: "Panoramica", tag: "" },
        { chiave: "in-attesa", testo: "In attesa di approvazione", tag: "" },
      ],
    },
    {
      label: "Contenuti",
      voci: [
        { chiave: "pagine", testo: "Testi delle pagine", tag: "" },
        { chiave: "testi-unita", testo: "Testi e foto delle unità", tag: "" },
      ],
    },
    {
      label: "Foto",
      voci: [
        { chiave: "album", testo: "Album e foto", tag: "" },
        { chiave: "immagini", testo: "Foto del sito", tag: "" },
      ],
    },
    {
      // La locandina delle giornate di prova, che stava qui, è stata tolta il 6
      // ottobre 2026 su richiesta dell'utente, come prima dagli altri ruoli.
      label: "Calendario",
      voci: [{ chiave: "calendario", testo: "Calendario attività", tag: "" }],
    },
  ],
  sezioni: {
    riepilogo: {
      crumb: "Contenuti e social / Panoramica",
      titolo: "Panoramica dei contenuti",
      nota:
        "Quello che avete preparato e che aspetta i gestori, e dove si fa il resto. " +
        "Niente di quello che salvate va online da solo.",
      azioni: [{ label: "Anteprima sito", primary: false }],
      kpi: [],
    },
    "in-attesa": {
      crumb: "Contenuti e social / In attesa di approvazione",
      titolo: "In attesa di approvazione",
      nota:
        "La parte della coda dei gestori che riguarda contenuti, fotografie e " +
        "calendario. Quando approvano, la voce sparisce da qui e la modifica è " +
        "online; quando la rimandano, sparisce lo stesso e sul sito resta quello " +
        "che c’era.",
      azioni: [],
      kpi: [],
    },
    album: {
      crumb: "Contenuti e social / Album e foto",
      titolo: "Album e foto",
      nota:
        "Gli album di tutte le unità, anche quelli creati dai referenti. Caricate e mandate in " +
        "revisione: la pubblicazione spetta ai gestori, che controllano i consensi, e " +
        "un album già online che modificate torna da loro. Le fotografie si nascondono, " +
        "non si eliminano; le password le custodiscono i gestori.",
      azioni: [],
    },
    immagini: {
      crumb: "Contenuti e social / Foto del sito",
      titolo: "Foto del sito",
      nota:
        "I riquadri fissi del disegno: le schede delle fasce in home e la fotografia " +
        "di gruppo. Quelle d’archivio delle unità stanno in «Testi e foto delle unità». Ogni " +
        "fotografia che caricate va ai gestori, e sul sito resta quella di adesso " +
        "finché non la approvano. «Nascondi» toglie subito una fotografia dal sito, senza " +
        "eliminarla.",
      azioni: [],
      kpi: [],
    },
    "testi-unita": {
      crumb: "Contenuti e social / Testi e foto delle unità",
      titolo: "Testi e foto delle unità",
      nota:
        "Motto, storia e fotografie (copertina e archivio) di ogni unità. Le modifiche " +
        "vanno ai gestori: il pallino segna le unità che hanno qualcosa in attesa.",
      azioni: [{ label: "Anteprima pubblica", primary: false }],
      kpi: [],
    },
    pagine: {
      crumb: "Contenuti e social / Testi delle pagine",
      titolo: "Testi delle pagine pubbliche",
      nota:
        "I testi di Home e Chi siamo, e le domande frequenti della pagina Contatti. " +
        "Le modifiche vanno ai gestori, campo per campo.",
      azioni: [{ label: "Anteprima sito", primary: false }],
      kpi: [],
    },
    calendario: {
      crumb: "Contenuti e social / Calendario attività",
      titolo: "Calendario attività",
      nota:
        "Le attività di tutte le unità e del gruppo, anche quelle inserite dai referenti. Le " +
        "modifiche e le cancellazioni di quelle già pubblicate vanno ai gestori, e " +
        "fino alla loro approvazione nel calendario resta la versione di adesso.",
      azioni: [],
      kpi: [],
    },
  },
};

/**
 * Un ruolo senza la sezione «album», quando gli album sono spenti (vedi
 * `lib/funzioni.ts`). Si toglie da `nav` **e** da `sezioni`: la pagina della
 * sezione cerca in `sezioni`, e togliere la sola voce di menu lascerebbe
 * l'indirizzo aperto a chi lo scrive a mano.
 */
function senzaAlbum(r: Ruolo, album: boolean): Ruolo {
  if (album) return r;
  return {
    ...r,
    nav: r.nav.map((g) => ({ ...g, voci: g.voci.filter((v) => v.chiave !== "album") })),
    sezioni: Object.fromEntries(Object.entries(r.sezioni).filter(([chiave]) => chiave !== "album")),
  };
}

export const RUOLI: Ruolo[] = [REFERENTE, GESTORE, SVILUPPATORE, SOCIAL];

export const ruoloPerSlug = (slug: string): Ruolo | undefined =>
  RUOLI.find((r) => r.slug === slug);

/**
 * Il ruolo come lo vede chi entra adesso: senza «album» se gli album sono
 * spenti (`lib/funzioni.ts`). È quello che usano le schermate e le
 * esportazioni; `ruoloPerSlug` resta per i rimandi alla prima sezione, che
 * non è mai «album».
 */
export const ruoloVisibile = (slug: string, album: boolean): Ruolo | undefined => {
  const r = ruoloPerSlug(slug);
  return r && senzaAlbum(r, album);
};

/**
 * Da sezione a riga della matrice, per le sezioni che ne hanno una.
 *
 * Serve al menu: §8 del mandato dice che il frontend deve **nascondere** le
 * sezioni non disponibili, e fino alla fase 14.9 la colonna mostrava tutte le
 * voci del ruolo — comprese quelle che poi rispondevano «la matrice non concede
 * questa funzione». Una voce che porta a un rifiuto è peggio di una voce
 * assente: fa cercare un guasto, e insegna che il menu non dice la verità.
 *
 * L'elenco è **parziale di proposito**. Una sezione che non è qui si mostra
 * sempre, e va bene: `riepilogo`, `log`, `sistema`, `profilo` non hanno una riga
 * di matrice, e la loro protezione sta altrove — nel middleware, che decide
 * quali viste un ruolo può aprire. Se questa mappa fosse esaustiva per
 * costruzione, aggiungere una sezione senza aggiungerla qui la farebbe sparire
 * dal menu di tutti; così, dimenticarla la lascia visibile, che è il modo
 * sbagliato meno dannoso.
 */
export const AZIONE_DI_SEZIONE: Record<string, string> = {
  identita: "identita",
  unita: "unita-anagrafica",
  referenti: "referenti",
  presentazione: "unita-scheda",
  "testi-unita": "unita-scheda",
  // `unita-scheda` e non `identita`: è il cancello che un referente di unità ha
  // `limitato` sulla propria pagina, quindi la voce si vede anche a lui. Le
  // singole immagini poi passano ognuna dal proprio, dentro l'azione.
  immagini: "unita-scheda",
  circolari: "documenti",
  documenti: "documenti",
  // la voce la vede chi può leggere; caricare lo decide l'altra riga, dentro
  // la schermata
  "documenti-referenti": "documenti-referenti-leggi",
  album: "album-carica",
  attivita: "attivita",
  calendario: "attivita",
  // la LETTURA dell'elenco: registrarlo è la riga `iscritti`, che la sezione
  // interroga da sé per decidere se mostrare i comandi
  iscritti: "iscritti-elenco",
  messaggi: "messaggi",
  pagine: "pagine",
  utenti: "utenti",
  permessi: "permessi-leggi",
  privacy: "privacy",
  log: "registro",
  approvazioni: "album-pubblica",
  backup: "backup",
};

/**
 * Le sezioni che **non** hanno una riga di matrice, dette una per una.
 *
 * Dal 4 ottobre 2026 la riga di `AZIONE_DI_SEZIONE` non nasconde più soltanto
 * la voce di menu: chiude la sezione (audit degli accessi, M-2). Prima una
 * riga messa a «nessuno» toglieva la voce, ma la pagina restava leggibile a
 * chi ne scriveva l'indirizzo — l'elenco dei minori compreso. Una sezione che
 * non sta in nessuna delle due liste fa fallire `test/sezioni-matrice.test.mjs`:
 * va decisa, non dimenticata.
 *
 * - `riepilogo`: la dashboard di ciascuno, costruita sul suo perimetro;
 * - `sistema`: solo nella vista dello sviluppatore, che il middleware protegge;
 * - `in-attesa`: le proposte di chi la guarda.
 */
export const SEZIONI_SENZA_RIGA: readonly string[] = [
  "riepilogo",
  "sistema",
  "in-attesa",
];

/** Chiavi delle sezioni nell'ordine del menu; la prima è quella predefinita. */
export const chiaviSezioni = (ruolo: Ruolo): string[] =>
  ruolo.nav.flatMap((g) => g.voci.map((v) => v.chiave));

/**
 * Indirizzo della prima sezione di un ruolo.
 *
 * Serve a mandarci la gente in un colpo solo: passare da
 * /area-riservata/<ruolo>, che a sua volta rimanda alla prima sezione, è un
 * salto in più — e una catena di due redirect dentro una Server Action manda in
 * errore il router lato client.
 */
export function primaSezioneDi(slug: string): string {
  const ruolo = ruoloPerSlug(slug);
  if (!ruolo) return "/area-riservata";
  return `/area-riservata/${ruolo.slug}/${chiaviSezioni(ruolo)[0]}`;
}
/**
 * Le sezioni che hanno una schermata vera, collegata al database.
 *
 * Serve a **non** disegnare accanto a quella schermata la tabella del
 * prototipo, che scrive in `lib/tabelle.ts` — un file JSON che nessuna di
 * queste sezioni legge.
 *
 * Non è una questione di ordine. Nella sezione «Elenco iscritti» comparivano
 * due tabelle: quella vera e quella del prototipo, con lo stesso titolo e gli
 * stessi campi. Un referente di unità che scriveva un nome e spuntava il consenso in
 * quella sbagliata lo scriveva in un file che il cancello dei consensi non
 * legge: nessuna riga in `iscrizioni`, nessun consenso, e il trigger che non
 * ha niente da bloccare. La schermata diceva di aver registrato, e non era
 * vero — che è il difetto peggiore di tutti quelli trovati in questo progetto.
 *
 * Il pulsante d'azione della sezione («Registra iscrizione», «Nuova attività»)
 * usa la stessa lista: senza, porta al modulo del prototipo.
 *
 * Aggiunta nella fase 13, l'audit finale. Quando una sezione passa al
 * database, il suo nome va qui — e la tabella del prototipo sparisce da sola.
 */
export const SEZIONI_CON_SCHERMATA = new Set([
  "identita",
  "immagini",
  // fase 14: la scheda dell'unità, gli elenchi di persone, l'anagrafica
  "presentazione",
  "referenti",
  "unita",
  "circolari",
  "utenti",
  "pagine",
  "sistema",
  "backup",
  "album",
  "documenti",
  "documenti-referenti",
  "permessi",
  "approvazioni",
  "riepilogo",
  "log",
  "messaggi",
  "attivita",
  "calendario",
  "privacy",
  "iscritti",
  // le due del social media manager
  "testi-unita",
  "in-attesa",
]);
