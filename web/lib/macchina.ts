/**
 * La macchina sotto il sito e i suoi certificati HTTPS.
 *
 * Il seguito di `lib/diagnostica.ts`, che guarda il database e l'applicazione:
 * qui si guarda **dove gira**. Le stesse due regole — non scrive niente, non
 * inventa — e lo stesso formato di `Controllo`, così la dashboard li mostra
 * con gli stessi riquadri.
 *
 * ## Da dove arriva ogni misura
 *
 * Niente credenziali e niente privilegi. Il servizio del sito gira come
 * utente `sito` con `ProtectSystem=strict` (§ deploy/sito.service), e
 * tutto quello che serve si legge lo stesso:
 *
 *   disco              statfs sulla cartella dei dati
 *   memoria            /proc/meminfo (MemAvailable, non MemFree)
 *   carico             os.loadavg()
 *   aggiornamenti      /var/lib/update-notifier/updates-available, il file
 *                      che Ubuntu scrive per il messaggio di benvenuto
 *   riavvio            /run/reboot-required
 *   servizi e lavori   `systemctl show`, che per leggere non chiede root
 *   certificati        una connessione TLS al proprio dominio
 *
 * Sul portatile di sviluppo metà di queste cose non c'è — niente /proc,
 * niente systemd, niente dominio — e le righe lo dicono («non misurabile
 * qui») invece di sparire: una riga che sparisce sul portatile sparisce anche
 * sul server il giorno che si rompe.
 *
 * Modulo di solo server.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { connect } from "node:tls";
import os from "node:os";
import { CARTELLA_DATI } from "@/lib/db/percorso";
import type { Controllo, EsitoControllo } from "@/lib/diagnostica";
import { pesoDb } from "@/lib/diagnostica";
import { indirizzoPubblico } from "@/lib/indirizzo-pubblico";
import { ricorda } from "@/lib/ricorda";

/* ------------------------------------------------------------------------ *
 * Le soglie, pure e provabili
 * ------------------------------------------------------------------------ */

/**
 * Giorni alla scadenza di un certificato → esito.
 *
 * Let's Encrypt rinnova a trenta giorni dalla scadenza, e Cloudflare fa lo
 * stesso con i suoi. Quindi un certificato che ne ha **meno di ventuno** non
 * è «quasi scaduto»: è un rinnovo che doveva già essere avvenuto e non è
 * avvenuto, e va guardato adesso, con tre settimane di margine. Sotto gli
 * otto è un guasto: il giorno che scade il sito si spegne per tutti.
 */
export function esitoScadenza(giorni: number): EsitoControllo {
  if (giorni <= 7) return "guasto";
  if (giorni < 21) return "aperto";
  return "ok";
}

/** Percentuale libera di disco o memoria → esito. */
export function esitoLibero(percentuale: number): EsitoControllo {
  if (percentuale < 10) return "guasto";
  if (percentuale < 20) return "aperto";
  return "ok";
}

/**
 * Il carico medio su quindici minuti, rispetto ai processori.
 *
 * Quello da un minuto sale e scende con ogni caricamento di fotografie, e
 * farne un allarme vorrebbe dire un allarme a ogni album. Quindici minuti
 * sopra il numero di CPU invece è una macchina in coda da un quarto d'ora.
 */
export function esitoCarico(carico15: number, cpu: number): EsitoControllo {
  if (carico15 > cpu * 1.5) return "guasto";
  if (carico15 > cpu) return "aperto";
  return "ok";
}

/** `MemTotal` e `MemAvailable` da /proc/meminfo, in byte. */
export function leggiMeminfo(testo: string): { totale: number; disponibile: number } | null {
  const kb = (chiave: string) => {
    const m = new RegExp(`^${chiave}:\\s+(\\d+)\\s*kB`, "m").exec(testo);
    return m ? Number(m[1]) * 1024 : null;
  };
  const totale = kb("MemTotal");
  const disponibile = kb("MemAvailable");
  return totale && disponibile !== null ? { totale, disponibile } : null;
}

/**
 * Il file del messaggio di benvenuto di Ubuntu, in due numeri.
 *
 * È scritto da `update-notifier` in inglese (la lingua del sistema su una VPS
 * appena installata), e in due forme a seconda di Ubuntu Pro:
 *
 *     5 updates can be applied immediately.
 *     3 of these updates are standard security updates.
 *
 * Se il file dice solo la prima riga, gli aggiornamenti di sicurezza sono
 * zero; se non dice nemmeno quella, il formato è cambiato e il risultato è
 * `null` — «non misurabile», non «nessun aggiornamento».
 */
export function leggiAggiornamenti(
  testo: string,
): { totali: number; sicurezza: number } | null {
  if (/no updates? can be applied|0 updates can be applied/i.test(testo)) {
    return { totali: 0, sicurezza: 0 };
  }
  const tot = /(\d+) updates? can be applied immediately/i.exec(testo);
  if (!tot) return null;
  const sic =
    /(\d+) of these updates? (?:is a|are) (?:standard )?security updates?/i.exec(testo) ??
    /(\d+) (?:standard )?security updates?/i.exec(testo);
  return { totali: Number(tot[1]), sicurezza: sic ? Number(sic[1]) : 0 };
}

export interface StatoUnita {
  /** `loaded`, oppure `not-found` quando l'unità non è installata */
  caricata: string;
  /** `active`, `inactive`, `failed`… */
  attiva: string;
  /** esito dell'ultima esecuzione: `success`, `exit-code`… */
  risultato: string;
  /** quando è finita l'ultima esecuzione, se è mai finita */
  finitaIl: Date | null;
}

/**
 * L'uscita di `systemctl show -p … a b c`: un blocco per unità, separati da
 * una riga vuota, nello stesso ordine in cui le unità sono state chieste.
 */
export function leggiSystemctl(testo: string): StatoUnita[] {
  return testo
    .trim()
    .split(/\n\s*\n/)
    .map((blocco) => {
      const v = new Map<string, string>();
      for (const riga of blocco.split("\n")) {
        const i = riga.indexOf("=");
        if (i > 0) v.set(riga.slice(0, i), riga.slice(i + 1).trim());
      }
      /* Con `--timestamp=unix` la data arriva come `@1790000000`: senza, sarebbe
         «Tue 2026-09-23 02:10:04 CEST», e il fuso scritto a sigla non lo
         riconosce nessun parser di date di JavaScript. */
      const ts = /^@(\d+)$/.exec(v.get("ExecMainExitTimestamp") ?? "");
      const data = ts ? new Date(Number(ts[1]) * 1000) : null;
      return {
        caricata: v.get("LoadState") ?? "",
        attiva: v.get("ActiveState") ?? "",
        risultato: v.get("Result") ?? "",
        finitaIl: data && !Number.isNaN(data.getTime()) ? data : null,
      };
    });
}

/* ------------------------------------------------------------------------ *
 * Misure di forma
 * ------------------------------------------------------------------------ */

const percento = (n: number) => `${Math.round(n)}%`;

function durata(secondi: number): string {
  const g = Math.floor(secondi / 86400);
  const o = Math.floor((secondi % 86400) / 3600);
  const m = Math.floor((secondi % 3600) / 60);
  if (g > 0) return `${g} ${g === 1 ? "giorno" : "giorni"}${o > 0 ? ` ${o} h` : ""}`;
  if (o > 0) return `${o} h ${m} min`;
  return `${m} min`;
}

function fa(data: Date, adesso = Date.now()): string {
  const s = Math.max(0, Math.round((adesso - data.getTime()) / 1000));
  return s < 60 ? "adesso" : `${durata(s)} fa`;
}

const decimale = (n: number) => n.toFixed(2).replace(".", ",");

const NON_QUI = "non misurabile qui";

/* ------------------------------------------------------------------------ *
 * La macchina
 * ------------------------------------------------------------------------ */

function leggiFile(percorso: string): string | null {
  try {
    return readFileSync(percorso, "utf8");
  } catch {
    return null;
  }
}

/** Il nome del sistema operativo, come lo scrive lui. */
function nomeSistema(): string {
  const rilascio = leggiFile("/etc/os-release");
  const m = rilascio ? /^PRETTY_NAME="?([^"\n]+)"?/m.exec(rilascio) : null;
  if (m) return m[1];
  return `${os.type()} ${os.release()}`;
}

export interface MisureMacchina {
  /** byte della partizione dei dati, o `null` se non si legge */
  disco: { libero: number; totale: number } | null;
  /** da /proc/meminfo; `null` fuori da Linux (§ la riga «Memoria») */
  memoria: { disponibile: number; totale: number } | null;
  carico: { uno: number; cinque: number; quindici: number; cpu: number };
}

/** I numeri della macchina, senza giudizio: servono ai grafici della dashboard. */
export function misureMacchina(): MisureMacchina {
  let disco: MisureMacchina["disco"] = null;
  try {
    const fs = statfsSync(CARTELLA_DATI);
    disco = { libero: fs.bavail * fs.bsize, totale: fs.blocks * fs.bsize };
  } catch {
    disco = null;
  }
  const [uno, cinque, quindici] = os.loadavg();
  return {
    disco,
    memoria: leggiMeminfo(leggiFile("/proc/meminfo") ?? ""),
    carico: { uno, cinque, quindici, cpu: os.cpus().length || 1 },
  };
}

/**
 * Le misure della macchina che si prendono leggendo, senza chiedere niente a
 * nessuno. Sincrone: sono file locali e una chiamata al kernel.
 */
export function controlliMacchina(): Controllo[] {
  const cpu = os.cpus().length || 1;
  const controlli: Controllo[] = [];

  controlli.push({
    id: "sistema",
    gruppo: "macchina",
    cosa: "Sistema",
    valore: `acceso da ${durata(os.uptime())}`,
    esito: "ok",
    nota: `${nomeSistema()} · ${os.hostname()} · ${cpu} ${cpu === 1 ? "processore" : "processori"}`,
  });

  /* Il disco si misura sulla cartella dei dati e non su «/»: è lì che crescono
     le fotografie, il database e le copie, e su una VPS con un volume
     aggiuntivo per i dati le due partizioni non sono la stessa. */
  try {
    const fs = statfsSync(CARTELLA_DATI);
    const totale = fs.blocks * fs.bsize;
    const libero = fs.bavail * fs.bsize;
    const quota = (libero / totale) * 100;
    controlli.push({
      id: "disco",
      gruppo: "macchina",
      cosa: "Spazio su disco",
      valore: `${percento(quota)} libero`,
      esito: esitoLibero(quota),
      nota: `${pesoDb(libero)} liberi su ${pesoDb(totale)}, sulla partizione di fotografie, database e copie`,
    });
  } catch {
    controlli.push({
      id: "disco",
      gruppo: "macchina",
      cosa: "Spazio su disco",
      valore: "non misurabile",
      esito: "guasto",
      nota: `la cartella dei dati (${CARTELLA_DATI}) non si legge`,
    });
  }

  /* `MemAvailable` e non `os.freemem()`: su Linux la memoria «libera» esclude
     la cache dei file, che il kernel restituisce appena serve. Una VPS sana
     con qualche giorno di vita ha quasi zero memoria libera e molta
     disponibile — con freemem questa riga sarebbe sempre rossa. */
  const mem = leggiMeminfo(leggiFile("/proc/meminfo") ?? "");
  if (mem) {
    const quotaMem = (mem.disponibile / mem.totale) * 100;
    controlli.push({
      id: "memoria",
      gruppo: "macchina",
      cosa: "Memoria",
      valore: `${percento(quotaMem)} disponibile`,
      esito: esitoLibero(quotaMem),
      nota: `${pesoDb(mem.disponibile)} disponibili su ${pesoDb(mem.totale)}`,
    });
  } else {
    /* Fuori da Linux non c'è /proc/meminfo, e il ripiego `os.freemem()` ha lo
       stesso difetto di MemFree: sul Mac di sviluppo dava «4% disponibile» in
       rosso su una macchina scarica. Meglio nessun numero che uno sbagliato. */
    controlli.push({
      id: "memoria",
      gruppo: "macchina",
      cosa: "Memoria",
      valore: NON_QUI,
      esito: "aperto",
      nota: `${pesoDb(os.totalmem())} in tutto; quella disponibile si legge da /proc/meminfo, sul server`,
    });
  }

  const [c1, c5, c15] = os.loadavg();
  controlli.push({
    id: "carico",
    gruppo: "macchina",
    cosa: "Carico",
    valore: `${decimale(c1)} · ${decimale(c5)} · ${decimale(c15)}`,
    esito: os.platform() === "win32" ? "ok" : esitoCarico(c15, cpu),
    nota: `media su 1, 5 e 15 minuti: sopra ${cpu} la macchina ha lavoro in coda`,
  });

  const linux = os.platform() === "linux";
  const agg = leggiAggiornamenti(leggiFile("/var/lib/update-notifier/updates-available") ?? "");
  controlli.push({
    id: "aggiornamenti",
    gruppo: "macchina",
    cosa: "Aggiornamenti di sicurezza",
    valore: agg ? String(agg.sicurezza) : linux ? "non misurabile" : NON_QUI,
    esito: agg ? (agg.sicurezza === 0 ? "ok" : "aperto") : "aperto",
    nota: agg
      ? agg.sicurezza === 0
        ? agg.totali === 0
          ? "il sistema è aggiornato"
          : `${agg.totali} aggiornamenti normali in attesa, nessuno di sicurezza`
        : `su ${agg.totali} in attesa: sudo apt upgrade`
      : linux
        ? "manca il file di update-notifier: sudo apt install update-notifier-common"
        : "si legge sul server Ubuntu, non su questo computer",
  });

  /* Il file c'è solo quando serve: la sua assenza su Linux è la risposta
     «no», non una misura mancata. Fuori da Linux invece non vuol dire niente. */
  const riavvio = existsSync("/run/reboot-required");
  const pacchetti = (leggiFile("/run/reboot-required.pkgs") ?? "").split("\n").filter(Boolean);
  controlli.push({
    id: "riavvio",
    gruppo: "macchina",
    cosa: "Riavvio richiesto",
    valore: linux ? (riavvio ? "sì" : "no") : NON_QUI,
    esito: linux ? (riavvio ? "aperto" : "ok") : "aperto",
    nota: riavvio
      ? `un aggiornamento${pacchetti.length ? ` (${pacchetti.slice(0, 3).join(", ")})` : ""} ha effetto solo dopo il riavvio`
      : linux
        ? "nessun aggiornamento aspetta un riavvio"
        : "si legge sul server Ubuntu, non su questo computer",
  });

  return controlli;
}

/* ------------------------------------------------------------------------ *
 * I servizi di sistema
 * ------------------------------------------------------------------------ */

/**
 * Le unità systemd attorno al sito. Il sito stesso non c'è: se questa
 * schermata si apre, è acceso.
 */
const UNITA = [
  {
    unita: "caddy.service",
    id: "caddy",
    cosa: "Proxy HTTPS (Caddy)",
    lavoro: false,
    nota: "davanti al sito: certificato, compressione, cache",
  },
  {
    unita: "sito-notturno.service",
    id: "notturno",
    cosa: "Lavori notturni",
    lavoro: true,
    nota: "conservazione, pulizia e manutenzione del database, alle 02:10",
  },
  {
    unita: "sito-fuorisede.service",
    id: "fuorisede",
    cosa: "Copia fuori sede",
    lavoro: true,
    nota: "l'ultima copia portata fuori dalla macchina con restic, alle 02:30",
  },
] as const;

/** Un lavoro notturno più vecchio di così ha saltato almeno una notte. */
const LAVORO_SCADUTO_MS = 30 * 60 * 60 * 1000;

function systemctl(unita: readonly string[]): Promise<string | null> {
  return new Promise((risolvi) => {
    execFile(
      "systemctl",
      [
        "show",
        "--timestamp=unix",
        "--property=LoadState,ActiveState,Result,ExecMainExitTimestamp",
        ...unita,
      ],
      { timeout: 3000 },
      (errore, uscita) => risolvi(errore ? null : uscita),
    );
  });
}

/** Esito di un'unità già letta. Esportata per le prove. */
export function controlloUnita(
  u: (typeof UNITA)[number],
  s: StatoUnita,
  adesso = Date.now(),
): Controllo {
  const base = { id: u.id, gruppo: "macchina" as const, cosa: u.cosa };

  if (s.caricata === "not-found") {
    return { ...base, valore: "non installato", esito: "aperto", nota: `${u.unita} non c'è: ${u.nota}` };
  }

  if (!u.lavoro) {
    const va = s.attiva === "active";
    return {
      ...base,
      valore: va ? "attivo" : s.attiva || "sconosciuto",
      esito: va ? "ok" : "guasto",
      nota: va ? u.nota : `fermo: il sito non è raggiungibile da fuori · sudo systemctl status ${u.unita}`,
    };
  }

  if (!s.finitaIl) {
    return { ...base, valore: "mai eseguito", esito: "aperto", nota: `${u.nota}: il timer non è ancora partito` };
  }
  const riuscito = s.risultato === "success";
  const recente = adesso - s.finitaIl.getTime() < LAVORO_SCADUTO_MS;
  return {
    ...base,
    valore: riuscito ? fa(s.finitaIl, adesso) : "fallito",
    esito: riuscito && recente ? "ok" : "guasto",
    nota: !riuscito
      ? `l'ultima esecuzione è finita con «${s.risultato}» · journalctl -u ${u.unita}`
      : !recente
        ? `riuscito, ma l'ultima volta ${fa(s.finitaIl, adesso)}: il timer ha saltato almeno una notte`
        : u.nota,
  };
}

/** Lo stato delle unità systemd, o una riga sola che dice perché non si legge. */
export async function controlliServiziSistema(): Promise<Controllo[]> {
  const uscita = os.platform() === "linux" ? await systemctl(UNITA.map((u) => u.unita)) : null;
  const stati = uscita ? leggiSystemctl(uscita) : [];

  if (stati.length !== UNITA.length) {
    return [
      {
        id: "systemd",
        gruppo: "macchina",
        cosa: "Servizi di sistema",
        valore: NON_QUI,
        esito: "aperto",
        nota:
          os.platform() === "linux"
            ? "systemctl non risponde: Caddy e i lavori notturni non si possono controllare"
            : "Caddy e i lavori notturni si leggono da systemd, sul server",
      },
    ];
  }
  return UNITA.map((u, i) => controlloUnita(u, stati[i]));
}

/* ------------------------------------------------------------------------ *
 * I certificati
 * ------------------------------------------------------------------------ */

export interface Certificato {
  scade: Date;
  emittente: string;
  /** il certificato è valido per quel nome ed è firmato da chi il sistema conosce */
  valido: boolean;
  errore: string | null;
  impronta: string;
}

/**
 * Apre una connessione TLS e legge il certificato che viene presentato.
 *
 * `rejectUnauthorized: false` di proposito: un certificato scaduto o sbagliato
 * è proprio quello che si vuole **vedere**, e con la verifica accesa la
 * connessione cadrebbe prima di poterlo leggere. Se è valido lo dice
 * `authorized`, che il socket calcola comunque.
 */
function leggiCertificato(host: string, servername: string): Promise<Certificato | null> {
  return new Promise((risolvi) => {
    const socket = connect({ host, port: 443, servername, rejectUnauthorized: false, timeout: 3000 });
    const fine = (c: Certificato | null) => {
      socket.destroy();
      risolvi(c);
    };
    socket.once("secureConnect", () => {
      const c = socket.getPeerCertificate();
      if (!c || !c.valid_to) return fine(null);
      const emittente = [c.issuer?.O, c.issuer?.CN].filter(Boolean).join(" · ") || "sconosciuto";
      fine({
        scade: new Date(c.valid_to),
        emittente,
        valido: socket.authorized,
        errore: socket.authorizationError ? String(socket.authorizationError) : null,
        impronta: c.fingerprint256,
      });
    });
    socket.once("timeout", () => fine(null));
    socket.once("error", () => fine(null));
  });
}

/** Se il dominio risponde attraverso Cloudflare: lo dicono le sue intestazioni. */
async function passaDaCloudflare(indirizzo: string): Promise<boolean | null> {
  try {
    const r = await fetch(indirizzo, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    return r.headers.get("server")?.toLowerCase() === "cloudflare" || r.headers.has("cf-ray");
  } catch {
    return null;
  }
}

/** Un certificato già letto, in riga. Esportata per le prove. */
export function controlloCertificato(
  id: string,
  cosa: string,
  c: Certificato | null,
  contesto: string,
  adesso = Date.now(),
): Controllo {
  if (!c) {
    return {
      id,
      gruppo: "certificati",
      cosa,
      valore: "non raggiungibile",
      esito: "guasto",
      nota: `nessuna risposta TLS sulla 443: ${contesto}`,
    };
  }
  const giorni = Math.floor((c.scade.getTime() - adesso) / 86_400_000);
  const scaduto = giorni < 0;
  return {
    id,
    gruppo: "certificati",
    cosa,
    valore: scaduto ? "scaduto" : `${giorni} ${giorni === 1 ? "giorno" : "giorni"}`,
    esito: !c.valido && !scaduto ? "guasto" : esitoScadenza(giorni),
    giorni,
    nota: [
      `scade il ${c.scade.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}`,
      c.emittente,
      !c.valido && c.errore ? `non valido: ${c.errore}` : null,
      contesto,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * Dieci minuti di memoria (§ lib/ricorda.ts): un certificato non cambia da un
 * minuto all'altro, e senza memoria ogni apertura della dashboard farebbe due
 * connessioni TLS e una richiesta al proprio dominio.
 */
export const controlliCertificati = ricorda(10 * 60 * 1000, leggiCertificati);

async function leggiCertificati(): Promise<Controllo[]> {
  const indirizzo = indirizzoPubblico();
  const dominio = indirizzo ? new URL(indirizzo).hostname : null;

  if (!dominio || dominio === "localhost" || dominio.endsWith(".localhost")) {
    return [
      {
        id: "cert-pubblico",
        gruppo: "certificati",
        cosa: "Certificato del dominio",
        valore: "nessun dominio",
        esito: "aperto",
        nota: "SITO_BASE_URL non indica un dominio pubblico: in sviluppo non c'è un certificato da controllare",
      },
    ];
  }

  /* Due letture, perché con Cloudflare davanti i certificati sono due:
     quello che Cloudflare presenta ai visitatori, e quello di Caddy che
     Cloudflare vede quando chiede la pagina a questa macchina. Il secondo si
     legge chiedendo a 127.0.0.1 con il nome del dominio, cioè esattamente
     come lo chiede Cloudflare. */
  const [pubblico, origine, cloudflare] = await Promise.all([
    leggiCertificato(dominio, dominio),
    leggiCertificato("127.0.0.1", dominio),
    passaDaCloudflare(indirizzo!),
  ]);

  const stesso = pubblico && origine && pubblico.impronta === origine.impronta;

  const righe: Controllo[] = [
    controlloCertificato(
      "cert-pubblico",
      "Certificato pubblico",
      pubblico,
      cloudflare
        ? "presentato da Cloudflare ai visitatori, che lo rinnova da sé"
        : "quello che vedono i visitatori",
    ),
  ];

  /* Senza Cloudflare in mezzo le due letture trovano lo stesso certificato,
     e ripeterlo in una seconda riga sarebbe rumore. */
  if (!stesso) {
    righe.push(
      controlloCertificato(
        "cert-origine",
        "Certificato di questo server",
        origine,
        "quello di Caddy, che Cloudflare controlla: se scade, i visitatori vedono l'errore 526",
      ),
    );
  }

  righe.push({
    id: "cloudflare",
    gruppo: "certificati",
    cosa: "Passa da Cloudflare",
    valore: cloudflare === null ? "non raggiungibile" : cloudflare ? "sì" : "no",
    // non è un esito: dietro Cloudflare o no sono due configurazioni legittime
    esito: cloudflare === null ? "guasto" : "ok",
    nota:
      cloudflare === null
        ? `${indirizzo} non risponde da questa macchina`
        : cloudflare
          ? "il dominio risponde con le intestazioni di Cloudflare (cf-ray)"
          : "il dominio risponde direttamente da questa macchina",
  });

  return righe;
}
