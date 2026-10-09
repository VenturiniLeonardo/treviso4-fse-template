/**
 * Quello che lo sviluppatore guarda quando vuole sapere se il sistema sta bene.
 *
 * ## Perché un modulo e non tre query nella schermata
 *
 * La dashboard dello sviluppatore è la sola schermata dell'area che deve dire
 * *contemporaneamente* com'è il motore, com'è la sicurezza, com'è la coda e
 * quanto c'è dentro. Sono una ventina di misure che vengono da otto posti
 * diversi, e metterle in linea nel componente vorrebbe dire una schermata che
 * non si può provare senza un browser. Qui si possono: sono funzioni che
 * leggono e restituiscono numeri.
 *
 * ## Le due regole che questo modulo si dà
 *
 * **Non scrive niente.** Nemmeno `PRAGMA optimize`. Una schermata che si apre
 * per capire perché qualcosa non va non deve poter essere la cosa che non va.
 *
 * **Non inventa.** Dove una misura non si può prendere — il database non
 * risponde, la cartella non c'è — il campo torna `null` e la schermata scrive
 * «non misurabile», che è un'informazione. Uno zero al suo posto sarebbe una
 * bugia, e in questo progetto le schermate che mentono si sono già tolte una
 * volta (§ fase 14.10).
 *
 * Modulo di solo server: tocca il database e il disco.
 */

import { sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { dbSeEsiste, databaseRisponde, pragmiCorrenti } from "@/lib/db/db";
import { dimensioneDb } from "@/lib/db/manutenzione";
import { PERCORSO_DB } from "@/lib/db/percorso";
import { cifraturaAttiva } from "@/lib/auth/cifratura";
import { lavoriFalliti, statoCoda } from "@/lib/foto/coda";
import { postaConfigurata } from "@/lib/posta";
import { albumNonConformi } from "@/lib/iscritti-store";
import { elencoCopie } from "@/lib/db/copia";
import {
  album,
  attivita,
  documenti,
  faq,
  foto,
  immagini,
  inviti,
  iscrizioni,
  messaggi,
  pagineTesti,
  ragazzi,
  registro,
  sessioni,
  tentativiAccesso,
  unita,
  utenti,
} from "@/lib/db/schema";

/* ------------------------------------------------------------------------ *
 * I controlli
 * ------------------------------------------------------------------------ */

/**
 * Un controllo ha tre esiti e non due.
 *
 * `ok` e `guasto` sono ovvi. Il terzo, `aperto`, è per le cose che **non sono
 * ancora state fatte** e che il progetto sa di non aver fatto: il backup
 * automatico, il secondo fattore obbligatorio. Segnarle rosse le
 * confonderebbe con un guasto — non è rotto niente, manca una configurazione —
 * e segnarle verdi sarebbe la bugia peggiore di tutte. Sono giallo, come le
 * pastiglie «in attesa» del resto dell'area.
 */
export type EsitoControllo = "ok" | "aperto" | "guasto";

export interface Controllo {
  /** chiave stabile, per la `key` di React e per le prove */
  id: string;
  /** area di appartenenza: raggruppa i controlli nella schermata */
  gruppo: "motore" | "sicurezza" | "servizi" | "macchina" | "certificati" | "cloudflare" | "ovh";
  cosa: string;
  /** il valore misurato, già in forma leggibile */
  valore: string;
  esito: EsitoControllo;
  /** che cosa vuol dire, in una riga, per chi non l'ha scritto */
  nota: string;
  /**
   * Giorni a una scadenza, quando la riga ne misura una: certificati, rinnovo
   * della VPS, dominio. La dashboard ne fa il grafico delle scadenze; le altre
   * righe non lo hanno.
   */
  giorni?: number;
}

/** Byte in una misura che si legge: `320 KB`, `1,4 MB`. */
export function pesoDb(byte: number | null): string {
  if (byte === null) return "non misurabile";
  if (byte < 1024) return `${byte} B`;
  const kb = byte / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1).replace(".", ",")} MB`;
  return `${(mb / 1024).toFixed(1).replace(".", ",")} GB`;
}

/**
 * I controlli sul motore del database.
 *
 * Sono gli stessi quattro valori della sezione «Stato del sistema», e questa
 * non è una duplicazione da togliere: là si guardano uno per uno con la loro
 * spiegazione, qui contano come numero — «5 controlli su 5» — perché la
 * dashboard serve a sapere *se* guardare, non a leggere. Le due schermate
 * chiamano la stessa `pragmiCorrenti()`, quindi non possono divergere.
 *
 * Quali valori siano «a posto» non è un'opinione: sono quelli che §3 del piano
 * prescrive e che `lib/db/db.ts` applica a ogni connessione.
 */
export function controlliMotore(): Controllo[] {
  const risponde = databaseRisponde();
  const pragmi = risponde ? pragmiCorrenti() : null;
  const byte = risponde ? dimensioneDb() : null;

  return [
    {
      id: "db-risponde",
      gruppo: "motore",
      cosa: "Il database risponde",
      valore: risponde ? "sì" : "no",
      esito: risponde ? "ok" : "guasto",
      nota: risponde
        ? "il motore accetta letture e scritture"
        : "senza questo non funziona niente dell’area riservata",
    },
    {
      id: "journal-mode",
      gruppo: "motore",
      cosa: "journal_mode",
      valore: String(pragmi?.journal_mode ?? "—"),
      esito: pragmi?.journal_mode === "wal" ? "ok" : "guasto",
      nota: "con WAL le letture non si bloccano mentre qualcuno scrive",
    },
    {
      id: "foreign-keys",
      gruppo: "motore",
      cosa: "foreign_keys",
      valore: pragmi ? (pragmi.foreign_keys === 1 ? "on" : "off") : "—",
      esito: pragmi?.foreign_keys === 1 ? "ok" : "guasto",
      nota: "se spento, le cancellazioni a cascata non avvengono",
    },
    {
      id: "busy-timeout",
      gruppo: "motore",
      cosa: "busy_timeout",
      valore: pragmi ? `${pragmi.busy_timeout} ms` : "—",
      esito: Number(pragmi?.busy_timeout ?? 0) >= 5000 ? "ok" : "guasto",
      nota: "quanto una scrittura attende invece di fallire subito",
    },
    {
      id: "dimensione",
      gruppo: "motore",
      cosa: "Dimensione del database",
      valore: pesoDb(byte),
      // la dimensione non ha una soglia: è un numero da conoscere, non un esito
      esito: "ok",
      nota: "da salvare nel backup, insieme alla cartella dei file",
    },
  ];
}

/* ------------------------------------------------------------------------ *
 * I controlli di sicurezza e di servizio
 * ------------------------------------------------------------------------ */

/**
 * I controlli di sicurezza.
 *
 * Due di questi tornano **sempre** `aperto` quando la condizione non c'è, e non
 * `guasto`: il secondo fattore obbligatorio e la cifratura dei segreti TOTP
 * sono cose che il piano chiede (§07, §08) e che oggi non ci sono. Non è rotto
 * niente — è lavoro non fatto — e la differenza conta, perché chi apre questa
 * schermata alle due di notte deve poter distinguere «va riparato adesso» da
 * «va configurato prima di andare in esercizio».
 *
 * `contiAccount()` glielo passa chi chiama, invece di rileggerlo: la dashboard
 * lo usa anche per i suoi indicatori, e due letture della stessa tabella nella
 * stessa schermata possono dare due numeri diversi.
 */
export function controlliSicurezza(conti: ContiAccount | null): Controllo[] {
  const cifrati = cifraturaAttiva();
  const fuoriRegola = albumNonConformi().length;

  return [
    {
      id: "totp",
      gruppo: "sicurezza",
      cosa: "Secondo fattore sugli account attivi",
      valore: conti ? `${conti.conTotp} su ${conti.attivi}` : "non misurabile",
      esito: !conti ? "guasto" : conti.senzaTotp === 0 ? "ok" : "aperto",
      nota:
        "Va tenuto richiesto per admin e gestori, che vedono iscritti " +
        "e consensi; si sceglie account per account in «Utenti»" +
        (conti && conti.senzaPerScelta > 0
          ? `. ${conti.senzaPerScelta} ${conti.senzaPerScelta === 1 ? "account" : "account"} ` +
            "senza codice per scelta di chi amministra, e non contano come aperti"
          : ""),
    },
    {
      id: "cifratura-totp",
      gruppo: "sicurezza",
      cosa: "Segreti TOTP cifrati a riposo",
      valore: cifrati ? "sì" : "no",
      esito: cifrati ? "ok" : "aperto",
      nota: cifrati
        ? "SITO_TOTP_SEGRETO è impostata: i segreti nel database sono cifrati"
        : "senza SITO_TOTP_SEGRETO i segreti stanno in chiaro nel database",
    },
    {
      id: "conti-inutilizzabili",
      gruppo: "sicurezza",
      cosa: "Account attivi che non possono entrare",
      valore: conti ? String(conti.inutilizzabili) : "non misurabile",
      esito: !conti ? "guasto" : conti.inutilizzabili === 0 ? "ok" : "guasto",
      nota:
        "attivi senza password: non sono un buco, sono una bugia nella tabella — " +
        "in produzione vengono da un database di sviluppo copiato",
    },
    {
      id: "consensi",
      gruppo: "sicurezza",
      cosa: "Album pubblicati che violano i consensi",
      valore: String(fuoriRegola),
      esito: fuoriRegola === 0 ? "ok" : "guasto",
      nota:
        "non dovrebbero esistere: il trigger lo impedisce e la revoca li ritira, " +
        "quindi uno solo vuol dire una porta che non conosciamo",
    },
  ];
}

/** Una copia più vecchia di così ha saltato almeno una notte (parte alle 02:00). */
const COPIA_SCADUTA_MS = 30 * 60 * 60 * 1000;

/**
 * L'ultima copia locale, letta dal suo manifesto.
 *
 * Questa riga era scritta a mano come «non configurato», perché il backup non
 * esisteva. Adesso esiste (`sito-copia.timer`, alle 02:00) e ogni copia
 * lascia un `manifesto.json` con l'ora e l'esito di `integrity_check`: la riga
 * guarda quello, invece di fidarsi che il timer sia partito. Una copia che
 * c'è ma non ha passato il controllo d'integrità è un guasto quanto una copia
 * che manca — ripristinarla vorrebbe dire ripristinare un database rotto.
 *
 * Esportata con `adesso` per le prove.
 */
export function controlloCopia(
  copie: ReturnType<typeof elencoCopie>,
  adesso = Date.now(),
): Controllo {
  const base = { id: "backup", gruppo: "servizi" as const, cosa: "Copia notturna" };
  const ultima = copie[0];
  if (!ultima) {
    return {
      ...base,
      valore: "nessuna copia",
      esito: "aperto",
      nota:
        "un guasto del disco perde tutto: fotografie, consensi, registro. " +
        "Va installato sito-copia.timer (§ deploy/README.md)",
    };
  }
  const quando = ultima.manifesto ? new Date(ultima.manifesto.quando) : null;
  const sana = ultima.manifesto?.integrita === "ok";
  const recente = quando !== null && adesso - quando.getTime() < COPIA_SCADUTA_MS;
  const ore = quando ? Math.round((adesso - quando.getTime()) / 3_600_000) : null;
  return {
    ...base,
    valore: !sana ? "non integra" : ore === null ? "senza data" : ore < 1 ? "adesso" : `${ore} h fa`,
    esito: sana && recente ? "ok" : "guasto",
    nota: !ultima.manifesto
      ? `${ultima.nome}: manca il manifesto, la copia non si può verificare`
      : !sana
        ? `${ultima.nome}: integrity_check ha detto «${ultima.manifesto.integrita}»`
        : !recente
          ? `l'ultima è di ${ore} ore fa: il timer delle 02:00 ha saltato almeno una notte`
          : `${copie.length} ${copie.length === 1 ? "copia" : "copie"} in archivio, ` +
            `l'ultima di ${pesoDb(ultima.manifesto.byteDb + ultima.manifesto.byteFile)}`,
  };
}

/** I controlli sui servizi che stanno attorno all'applicazione. */
export function controlliServizi(): Controllo[] {
  const coda = statoCoda();
  const falliti = lavoriFalliti();
  const posta = postaConfigurata();

  return [
    controlloCopia(elencoCopie()),
    {
      id: "posta",
      gruppo: "servizi",
      cosa: "Posta in uscita",
      valore: posta ? "configurata" : "non configurata",
      esito: posta ? "ok" : "aperto",
      nota: posta
        ? "gli avvisi al gruppo possono partire"
        : "senza POSTA_HOST e POSTA_A nessun avviso esce da qui",
    },
    {
      id: "coda",
      gruppo: "servizi",
      cosa: "Coda delle immagini",
      valore:
        coda.inAttesa + coda.inCorso + coda.errore === 0
          ? "vuota"
          : `${coda.inAttesa} in attesa · ${coda.inCorso} in corso · ${coda.errore} in errore`,
      esito: coda.errore === 0 && falliti.length === 0 ? "ok" : "guasto",
      nota:
        falliti.length > 0
          ? `${falliti.length} lavori hanno esaurito i tentativi: le loro versioni ridotte non ci sono`
          : "le fotografie caricate diventano le tre versioni ridotte che servono al sito",
    },
  ];
}

/* ------------------------------------------------------------------------ *
 * L'ambiente
 * ------------------------------------------------------------------------ */

export interface Ambiente {
  /** `produzione` o `sviluppo`, come lo dice Node */
  modo: "produzione" | "sviluppo";
  /** la versione di Node che sta servendo, non quella dichiarata altrove */
  node: string;
  /** il file di database aperto adesso: la risposta a «è quello giusto?» */
  database: string;
  /** da quanto è in piedi questo processo, in forma leggibile */
  inPiediDa: string;
}

/**
 * L'ambiente in cui il processo sta girando davvero.
 *
 * Serve a una domanda che si fa solo chi amministra e che nessun'altra
 * schermata risponde: **sto guardando la macchina che credo?** Il percorso del
 * database e il modo (`produzione`/`sviluppo`) sono i due valori che
 * distinguono una copia locale dal server, e averli scritti in testa alla
 * dashboard evita la categoria di errore peggiore — cancellare sul vero
 * credendo di essere sul finto.
 *
 * `process.uptime()` è del processo, non della macchina: dopo un riavvio
 * dell'unità systemd riparte da zero, ed è appunto quello che si vuole sapere.
 */
export function ambiente(): Ambiente {
  const s = Math.floor(process.uptime());
  const g = Math.floor(s / 86400);
  const o = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);

  const inPiediDa =
    g > 0 ? `${g} g ${o} h` : o > 0 ? `${o} h ${m} min` : m > 0 ? `${m} min` : `${s} s`;

  return {
    modo: process.env.NODE_ENV === "production" ? "produzione" : "sviluppo",
    node: process.version,
    database: PERCORSO_DB,
    inPiediDa,
  };
}

/* ------------------------------------------------------------------------ *
 * Gli account
 * ------------------------------------------------------------------------ */

export interface ContiAccount {
  totale: number;
  attivi: number;
  invitati: number;
  revocati: number;
  /** attivi con il secondo fattore confermato */
  conTotp: number;
  /** attivi che il secondo fattore lo devono avere e non l'hanno ancora: il numero di §08 */
  senzaTotp: number;
  /** attivi a cui chi amministra ha tolto il secondo fattore: è una scelta, non un buco */
  senzaPerScelta: number;
  /** attivi senza password: non possono entrare, e la tabella dice che sì */
  inutilizzabili: number;
  /** inviti creati, non ancora consumati e non ancora scaduti */
  invitiVivi: number;
  /** per ruolo, solo gli attivi */
  perRuolo: { ruolo: string; quanti: number }[];
}

export function contiAccount(): ContiAccount | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    const righe = d
      .select({
        ruolo: utenti.ruolo,
        stato: utenti.stato,
        conPassword: sql<number>`(${utenti.passwordHash} is not null)`,
        conTotp: sql<number>`(${utenti.totpAttivatoIl} is not null)`,
        richiesto: sql<number>`(${utenti.mfaRichiesto} <> 0)`,
      })
      .from(utenti)
      .all();

    const attivi = righe.filter((r) => r.stato === "attivo");
    const perRuolo = new Map<string, number>();
    for (const r of attivi) perRuolo.set(r.ruolo, (perRuolo.get(r.ruolo) ?? 0) + 1);

    /* Un invito «vivo» è quello che qualcuno può ancora usare: creato, non
       consumato (`usato_il` nullo) e non scaduto. Contare solo i non consumati
       gonfierebbe il numero con quelli lasciati scadere mesi prima, che non
       sono un'azione in sospeso per nessuno. */
    const inv = d
      .select({ n: sql<number>`count(*)` })
      .from(inviti)
      .where(sql`${inviti.usatoIl} is null and ${inviti.scadeIl} > strftime('%Y-%m-%dT%H:%M:%SZ','now')`)
      .get();

    return {
      totale: righe.length,
      attivi: attivi.length,
      invitati: righe.filter((r) => r.stato === "invitato").length,
      revocati: righe.filter((r) => r.stato === "revocato").length,
      conTotp: attivi.filter((r) => r.conTotp === 1).length,
      senzaTotp: attivi.filter((r) => r.conTotp !== 1 && r.richiesto === 1).length,
      senzaPerScelta: attivi.filter((r) => r.richiesto !== 1).length,
      inutilizzabili: attivi.filter((r) => r.conPassword !== 1).length,
      invitiVivi: inv?.n ?? 0,
      perRuolo: [...perRuolo].map(([ruolo, quanti]) => ({ ruolo, quanti })),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ *
 * Sessioni e tentativi
 * ------------------------------------------------------------------------ */

export interface ContiAccesso {
  /** sessioni valide adesso, stato `attiva` e non scadute */
  sessioniAttive: number;
  /** ferme fra password e secondo fattore */
  sessioniInAttesa: number;
  /** quante persone diverse sono dentro */
  personeDentro: number;
  /** righe scadute ancora in tabella: le pulisce il lavoro notturno */
  sessioniScadute: number;
  /** tentativi falliti nell'ultimo quarto d'ora, che è la finestra di §7 */
  tentativiRecenti: number;
  /** su quanti nomi utente diversi */
  tentativiSuUtenti: number;
}

export function contiAccesso(): ContiAccesso | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    const adesso = sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')`;

    const vive = d
      .select({ stato: sessioni.stato, utenteId: sessioni.utenteId })
      .from(sessioni)
      .where(sql`${sessioni.scadeIl} > ${adesso}`)
      .all();

    const scadute = d
      .select({ n: sql<number>`count(*)` })
      .from(sessioni)
      .where(sql`${sessioni.scadeIl} <= ${adesso}`)
      .get();

    /* La finestra è quindici minuti perché è quella che `lib/auth/tentativi.ts`
       usa per bloccare: un numero calcolato su un'altra finestra sarebbe un
       numero che non corrisponde a nessuna decisione del sistema. */
    const recenti = d
      .select({ chiave: tentativiAccesso.chiave })
      .from(tentativiAccesso)
      .where(
        sql`${tentativiAccesso.tipo} = 'utente'
            and ${tentativiAccesso.quando} > strftime('%Y-%m-%dT%H:%M:%SZ','now','-15 minutes')`,
      )
      .all();

    const attive = vive.filter((s) => s.stato === "attiva");

    return {
      sessioniAttive: attive.length,
      sessioniInAttesa: vive.filter((s) => s.stato === "attesa_totp").length,
      personeDentro: new Set(attive.map((s) => s.utenteId)).size,
      sessioniScadute: scadute?.n ?? 0,
      tentativiRecenti: recenti.length,
      tentativiSuUtenti: new Set(recenti.map((r) => r.chiave)).size,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ *
 * Quanto c'è dentro
 * ------------------------------------------------------------------------ */

export interface VoceInventario {
  tabella: string;
  etichetta: string;
  righe: number;
  /** dove si gestisce, per il collegamento */
  href?: string;
}

/**
 * Il conto delle righe, tabella per tabella.
 *
 * Serve a una domanda che nessun'altra schermata risponde: «questo database è
 * quello giusto?». Un referente di unità guarda i propri contenuti; chi amministra, il
 * giorno di un ripristino o di un trasloco, ha bisogno di vedere in una volta
 * che i numeri sono quelli di prima. Quattordici numeri in una tabella lo
 * dicono meglio di quattordici schermate da aprire.
 */
export function inventario(fotoAccese: boolean): VoceInventario[] | null {
  const d = dbSeEsiste();
  if (!d) return null;

  const conta = (t: SQLiteTable) => {
    try {
      const r = d.select({ n: sql<number>`count(*)` }).from(t).get();
      return r?.n ?? 0;
    } catch {
      return 0;
    }
  };

  try {
    return [
      { tabella: "unita", etichetta: "Unità", righe: conta(unita), href: "/area-riservata/gestore/unita" },
      { tabella: "utenti", etichetta: "Account", righe: conta(utenti), href: "/area-riservata/sviluppatore/utenti" },
      { tabella: "ragazzi", etichetta: "Ragazzi in anagrafica", righe: conta(ragazzi) },
      { tabella: "iscrizioni", etichetta: "Iscrizioni", righe: conta(iscrizioni) },
      {
        tabella: "album",
        etichetta: "Album",
        righe: conta(album),
        // con gli album spenti la schermata non c'è, e il collegamento darebbe 404
        ...(fotoAccese ? { href: "/area-riservata/gestore/album" } : {}),
      },
      { tabella: "foto", etichetta: "Fotografie", righe: conta(foto) },
      { tabella: "immagini", etichetta: "Immagini delle pagine", righe: conta(immagini), href: "/area-riservata/sviluppatore/pagine" },
      { tabella: "documenti", etichetta: "Documenti", righe: conta(documenti), href: "/area-riservata/gestore/documenti" },
      { tabella: "attivita", etichetta: "Attività", righe: conta(attivita), href: "/area-riservata/gestore/calendario" },
      { tabella: "messaggi", etichetta: "Messaggi dal sito", righe: conta(messaggi), href: "/area-riservata/gestore/messaggi" },
      { tabella: "pagine_testi", etichetta: "Testi delle pagine", righe: conta(pagineTesti), href: "/area-riservata/sviluppatore/pagine" },
      { tabella: "faq", etichetta: "Domande frequenti", righe: conta(faq) },
      { tabella: "registro", etichetta: "Voci di registro", righe: conta(registro), href: "/area-riservata/sviluppatore/log" },
    ];
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ *
 * L'attività, giorno per giorno
 * ------------------------------------------------------------------------ */

export interface GiornoAttivita {
  /** `2026-09-23`, in UTC come le date del registro */
  giorno: string;
  /** entrate riuscite nell'area riservata */
  accessi: number;
  /** tutto quello che tocca dati: modifiche, pubblicazioni, consensi, elenchi */
  operazioni: number;
  /** tentativi respinti dal cancello dei permessi */
  rifiutate: number;
}

/** Come si divide una voce del registro fra le due serie del grafico. */
export function serieDiTipo(tipo: string): "accessi" | "operazioni" | null {
  if (tipo === "accesso") return "accessi";
  // l'uscita non è un'attività: è la fine di un accesso già contato
  if (tipo === "uscita") return null;
  return "operazioni";
}

/**
 * Riempie i giorni senza voci con zero, dal più vecchio a oggi.
 *
 * I conteggi arrivano dal database solo per i giorni in cui è successo
 * qualcosa; un grafico che saltasse gli altri avvicinerebbe il 3 al 20 del
 * mese come se fossero consecutivi. Qui lo zero è un'informazione vera — quel
 * giorno non è entrato nessuno — e non una misura mancata.
 */
export function riempiGiorni(
  righe: { giorno: string; tipo: string; esito: string; n: number }[],
  giorni: number,
  oggi = new Date(),
): GiornoAttivita[] {
  const perGiorno = new Map<string, GiornoAttivita>();
  for (let i = giorni - 1; i >= 0; i--) {
    const g = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth(), oggi.getUTCDate() - i));
    const chiave = g.toISOString().slice(0, 10);
    perGiorno.set(chiave, { giorno: chiave, accessi: 0, operazioni: 0, rifiutate: 0 });
  }
  for (const r of righe) {
    const g = perGiorno.get(r.giorno);
    if (!g) continue;
    if (r.esito === "rifiutato") {
      g.rifiutate += r.n;
      continue;
    }
    const serie = serieDiTipo(r.tipo);
    if (serie) g[serie] += r.n;
  }
  return [...perGiorno.values()];
}

/**
 * L'attività degli ultimi `giorni` giorni, contata dal database.
 *
 * Non da `leggiRegistro()`: quella tiene le ultime cinquecento voci, e in un
 * mese con un campo estivo e cento fotografie caricate cinquecento voci
 * possono non arrivare indietro di trenta giorni — il grafico mostrerebbe una
 * caduta a zero che non è mai successa. Qui si conta tutto quello che c'è.
 */
export function attivitaGiornaliera(giorni = 30): GiornoAttivita[] | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    const righe = d
      .select({
        giorno: sql<string>`substr(${registro.quando}, 1, 10)`,
        tipo: registro.tipo,
        esito: registro.esito,
        n: sql<number>`count(*)`,
      })
      .from(registro)
      .where(sql`${registro.quando} >= strftime('%Y-%m-%dT00:00:00Z', 'now', ${`-${giorni - 1} days`})`)
      .groupBy(sql`1, 2, 3`)
      .all();
    return riempiGiorni(righe, giorni);
  } catch {
    return null;
  }
}

/**
 * I giorni raggruppati a sette a sette, dal più recente all'indietro: novanta
 * colonne giornaliere in un riquadro sarebbero feritoie da tre pixel. L'ultimo
 * gruppo finisce oggi; il primo può essere più corto, e lo dice il suo `da`.
 */
export function perSettimana(giorni: GiornoAttivita[]): (GiornoAttivita & { da: string })[] {
  const gruppi: (GiornoAttivita & { da: string })[] = [];
  for (let fine = giorni.length; fine > 0; fine -= 7) {
    const pezzo = giorni.slice(Math.max(0, fine - 7), fine);
    gruppi.unshift({
      da: pezzo[0].giorno,
      giorno: pezzo[pezzo.length - 1].giorno,
      accessi: pezzo.reduce((t, g) => t + g.accessi, 0),
      operazioni: pezzo.reduce((t, g) => t + g.operazioni, 0),
      rifiutate: pezzo.reduce((t, g) => t + g.rifiutate, 0),
    });
  }
  return gruppi;
}

/**
 * La variazione rispetto al periodo prima, in percentuale intera. `null`
 * quando prima non c'era niente: da zero a dodici non è «+∞%», è un inizio.
 */
export function variazione(adesso: number, prima: number): number | null {
  if (prima === 0) return null;
  return Math.round(((adesso - prima) / prima) * 100);
}
