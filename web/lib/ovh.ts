/**
 * OVH, visto dalla dashboard dello sviluppatore: la VPS e le scadenze.
 *
 * ## Le chiavi, e perché possono solo leggere
 *
 * L'API di OVH vuole tre valori, tutti nell'ambiente del sito
 * (/etc/sito/ambiente):
 *
 *     SITO_OVH_APP_KEY        l'applicazione, creata una volta su
 *     SITO_OVH_APP_SECRET     https://eu.api.ovh.com/createApp/
 *     SITO_OVH_CONSUMER_KEY   il permesso vero, generato da
 *                                 `npm run ovh:chiave` e convalidato col login OVH
 *
 * La terza è quella che decide che cosa si può fare, e `ovh:chiave` la chiede
 * con **soltanto** GET su /vps e /domain: niente riavvii, niente reinstallazioni,
 * niente modifiche al dominio. Chi la trovasse potrebbe leggere quando scade la
 * VPS, e basta. Facoltative: `SITO_OVH_ENDPOINT` (predefinito `ovh-eu`) e
 * `SITO_OVH_VPS`, il nome del servizio, se sull'account ce n'è più d'una.
 *
 * ## Che cosa si guarda
 *
 * Le due date che fanno sparire un sito da un giorno all'altro senza che si
 * sia rotto niente: il **rinnovo della VPS** e la **scadenza del dominio**.
 * Accanto, lo stato della VPS come lo vede OVH — utile quando il sito non
 * risponde e la domanda è «è la macchina o è il programma?».
 *
 * Modulo di solo server. Non scrive niente.
 */

import { createHash } from "node:crypto";
import type { Controllo, EsitoControllo } from "@/lib/diagnostica";
import { indirizzoPubblico } from "@/lib/indirizzo-pubblico";
import { ricorda } from "@/lib/ricorda";

/** I punti d'ingresso dell'API, per regione dell'account. */
export const ENDPOINT_OVH: Record<string, string> = {
  "ovh-eu": "https://eu.api.ovh.com/1.0",
  "ovh-ca": "https://ca.api.ovh.com/1.0",
  "ovh-us": "https://api.us.ovhcloud.com/1.0",
};

/** I percorsi che la chiave può leggere. Li usa anche `npm run ovh:chiave`. */
export const DIRITTI_OVH = [
  { method: "GET", path: "/vps" },
  { method: "GET", path: "/vps/*" },
  { method: "GET", path: "/domain" },
  { method: "GET", path: "/domain/*" },
] as const;

export interface ConfigOvh {
  base: string;
  appKey: string;
  appSecret: string;
  consumerKey: string;
  vps: string | null;
}

/** La configurazione dall'ambiente, o l'elenco di quello che manca. */
export function configOvh(env = process.env): ConfigOvh | { mancano: string[] } {
  const nomi = ["SITO_OVH_APP_KEY", "SITO_OVH_APP_SECRET", "SITO_OVH_CONSUMER_KEY"] as const;
  const mancano = nomi.filter((n) => !env[n]?.trim());
  if (mancano.length > 0) return { mancano };
  const regione = env.SITO_OVH_ENDPOINT?.trim() || "ovh-eu";
  return {
    base: ENDPOINT_OVH[regione] ?? regione,
    appKey: env.SITO_OVH_APP_KEY!.trim(),
    appSecret: env.SITO_OVH_APP_SECRET!.trim(),
    consumerKey: env.SITO_OVH_CONSUMER_KEY!.trim(),
    vps: env.SITO_OVH_VPS?.trim() || null,
  };
}

/* ------------------------------------------------------------------------ *
 * La firma, pura e provabile
 * ------------------------------------------------------------------------ */

/**
 * La firma di una richiesta, come la documenta OVH:
 *
 *     "$1$" + sha1( segreto + "+" + consumer + "+" + metodo + "+" + URL
 *                   + "+" + corpo + "+" + ora )
 *
 * L'URL è quello intero, con la query; l'ora è quella **del server OVH**, in
 * secondi. Con l'orologio della VPS sfasato di qualche decina di secondi la
 * firma viene rifiutata, e per questo `ora` arriva da /auth/time (§ `adesso`).
 */
export function firmaOvh(
  appSecret: string,
  consumerKey: string,
  metodo: string,
  url: string,
  corpo: string,
  ora: number,
): string {
  const testo = [appSecret, consumerKey, metodo, url, corpo, String(ora)].join("+");
  return `$1$${createHash("sha1").update(testo).digest("hex")}`;
}

/**
 * Una scadenza di servizio → esito.
 *
 * Con il rinnovo automatico acceso la data si sposta da sola: diventa un
 * problema solo a ridosso della scadenza, quando vuol dire che il pagamento
 * non è passato. Con il rinnovo manuale invece la data è una scadenza vera, e
 * trenta giorni sono il margine per accorgersene senza fretta. «Cancellazione
 * alla scadenza» è un guasto a qualunque distanza: qualcuno ha chiesto di
 * chiudere il servizio, e il sito ci sta sopra.
 */
export function esitoRinnovo(giorni: number, automatico: boolean, cancellazione: boolean): EsitoControllo {
  if (cancellazione) return "guasto";
  if (giorni <= 7) return automatico && giorni > 2 ? "aperto" : "guasto";
  if (!automatico && giorni < 30) return "aperto";
  return "ok";
}

/* ------------------------------------------------------------------------ *
 * Le chiamate
 * ------------------------------------------------------------------------ */

/* Il campo si dichiara a parte e non nel costruttore (`readonly stato`):
   script e prove girano con `--experimental-strip-types`, che quella forma
   non la accetta. */
class ErroreOvh extends Error {
  readonly stato: number;
  constructor(messaggio: string, stato: number) {
    super(messaggio);
    this.stato = stato;
  }
}

/** Lo scarto fra l'orologio di OVH e il nostro, letto una volta per lettura. */
async function scartoOrologio(base: string): Promise<number> {
  const r = await fetch(`${base}/auth/time`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
  const loro = Number(await r.text());
  return Number.isFinite(loro) ? loro - Math.floor(Date.now() / 1000) : 0;
}

/**
 * Un client che firma. Esportato per `npm run ovh:chiave -- --prova`, che
 * controlla le chiavi con le stesse chiamate della dashboard.
 */
export async function clientOvh(c: ConfigOvh) {
  const scarto = await scartoOrologio(c.base).catch(() => 0);
  return async function chiedi<T>(percorso: string): Promise<T> {
    const url = `${c.base}${percorso}`;
    const ora = Math.floor(Date.now() / 1000) + scarto;
    let r: Response;
    try {
      r = await fetch(url, {
        headers: {
          "X-Ovh-Application": c.appKey,
          "X-Ovh-Consumer": c.consumerKey,
          "X-Ovh-Timestamp": String(ora),
          "X-Ovh-Signature": firmaOvh(c.appSecret, c.consumerKey, "GET", url, "", ora),
        },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
    } catch {
      throw new ErroreOvh("l'API di OVH non risponde", 0);
    }
    if (!r.ok) {
      const corpo = (await r.json().catch(() => null)) as { message?: string } | null;
      throw new ErroreOvh(corpo?.message ?? `risposta ${r.status}`, r.status);
    }
    return (await r.json()) as T;
  };
}

interface Vps {
  name: string;
  displayName?: string;
  state: string;
  zone?: string;
  model?: { name?: string; vcore?: number; memory?: number; disk?: number };
}

interface InfoServizio {
  expiration: string;
  status: string;
  renew?: { automatic?: boolean; deleteAtExpiration?: boolean };
}

/* ------------------------------------------------------------------------ *
 * Le righe
 * ------------------------------------------------------------------------ */

const riga = (id: string, cosa: string, valore: string, esito: EsitoControllo, nota: string): Controllo => ({
  id,
  gruppo: "ovh",
  cosa,
  valore,
  esito,
  nota,
});

function rigaErrore(id: string, cosa: string, e: unknown): Controllo {
  if (e instanceof ErroreOvh && e.stato === 403) {
    return riga(id, cosa, "senza permesso", "aperto", `la chiave non può leggerlo: ${e.message} · rigeneratela con npm run ovh:chiave`);
  }
  if (e instanceof ErroreOvh && (e.stato === 401 || /invalid/i.test(e.message))) {
    return riga(id, cosa, "chiave rifiutata", "guasto", `${e.message} · rigeneratela con npm run ovh:chiave`);
  }
  return riga(id, cosa, "non leggibile", "guasto", e instanceof Error ? e.message : String(e));
}

/** Una scadenza in riga. Esportata per le prove. */
export function rigaScadenza(
  id: string,
  cosa: string,
  info: InfoServizio,
  adesso = Date.now(),
): Controllo {
  const scade = new Date(`${info.expiration}T00:00:00`);
  const giorni = Math.floor((scade.getTime() - adesso) / 86_400_000);
  const automatico = info.renew?.automatic === true;
  const cancellazione = info.renew?.deleteAtExpiration === true;
  const data = scade.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  const r = riga(
    id,
    cosa,
    giorni < 0 ? "scaduto" : `tra ${giorni} ${giorni === 1 ? "giorno" : "giorni"}`,
    giorni < 0 ? "guasto" : esitoRinnovo(giorni, automatico, cancellazione),
    cancellazione
      ? `il ${data} il servizio verrà CANCELLATO: qualcuno ne ha chiesto la chiusura dal pannello OVH`
      : automatico
        ? `il ${data}, rinnovo automatico: se questa data si avvicina, il pagamento non è passato`
        : `il ${data}, rinnovo MANUALE: va pagato dal pannello OVH prima di allora`,
  );
  return { ...r, giorni };
}

async function leggiOvh(): Promise<Controllo[]> {
  const c = configOvh();
  if ("mancano" in c) {
    return [
      riga(
        "ovh-chiavi",
        "Account OVH",
        "non configurato",
        "aperto",
        `mancano ${c.mancano.join(", ")}: le crea npm run ovh:chiave (istruzioni in web/.env.esempio)`,
      ),
    ];
  }

  let chiedi: Awaited<ReturnType<typeof clientOvh>>;
  try {
    chiedi = await clientOvh(c);
  } catch (e) {
    return [rigaErrore("ovh-vps", "VPS", e)];
  }

  const righe: Controllo[] = [];

  /* La VPS: quella indicata, o l'unica dell'account. */
  let nome = c.vps;
  let avvisoNome = "";
  if (!nome) {
    try {
      const elenco = await chiedi<string[]>("/vps");
      nome = elenco[0] ?? null;
      if (elenco.length > 1) avvisoNome = ` · sull'account ce ne sono ${elenco.length}: indicate SITO_OVH_VPS`;
    } catch (e) {
      return [rigaErrore("ovh-vps", "VPS", e)];
    }
  }

  if (!nome) {
    righe.push(riga("ovh-vps", "VPS", "nessuna", "aperto", "l'account non ha VPS: la chiave è dell'account giusto?"));
  } else {
    const percorso = `/vps/${encodeURIComponent(nome)}`;
    const [vps, info, ip] = await Promise.allSettled([
      chiedi<Vps>(percorso),
      chiedi<InfoServizio>(`${percorso}/serviceInfos`),
      chiedi<string[]>(`${percorso}/ips`),
    ]);

    if (vps.status === "fulfilled") {
      const v = vps.value;
      const accesa = v.state === "running";
      const m = v.model;
      const misure = [
        m?.vcore ? `${m.vcore} vCore` : null,
        m?.memory ? `${Math.round(m.memory / 1024)} GB di RAM` : null,
        m?.disk ? `${m.disk} GB di disco` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const indirizzi = ip.status === "fulfilled" ? ip.value.filter((x) => !x.includes(":")).join(", ") : "";
      righe.push(
        riga(
          "ovh-vps",
          "VPS",
          accesa ? "accesa" : v.state,
          accesa ? "ok" : "guasto",
          [v.displayName || v.name, m?.name, v.zone, misure, indirizzi].filter(Boolean).join(" · ") + avvisoNome,
        ),
      );
    } else righe.push(rigaErrore("ovh-vps", "VPS", vps.reason));

    righe.push(
      info.status === "fulfilled"
        ? rigaScadenza("ovh-rinnovo", "Rinnovo della VPS", info.value)
        : rigaErrore("ovh-rinnovo", "Rinnovo della VPS", info.reason),
    );
  }

  /* Il dominio: quello del sito, se è registrato su questo account. Si prova
     dal nome intero verso l'alto, come per la zona di Cloudflare. */
  const indirizzo = indirizzoPubblico();
  const host = indirizzo ? new URL(indirizzo).hostname : null;
  if (host && host !== "localhost") {
    try {
      const domini = await chiedi<string[]>("/domain");
      const parti = host.split(".");
      const dominio = parti
        .map((_, i) => parti.slice(i).join("."))
        .find((n) => domini.includes(n));
      if (dominio) {
        const info = await chiedi<InfoServizio>(`/domain/${encodeURIComponent(dominio)}/serviceInfos`);
        righe.push(rigaScadenza("ovh-dominio", `Dominio ${dominio}`, info));
      } else {
        righe.push(
          riga(
            "ovh-dominio",
            "Dominio",
            "altrove",
            "ok",
            `${host} non è registrato su questo account OVH: la sua scadenza si guarda dal registrar`,
          ),
        );
      }
    } catch (e) {
      righe.push(rigaErrore("ovh-dominio", "Dominio", e));
    }
  }

  return righe;
}

/**
 * Mezz'ora di memoria (§ lib/ricorda.ts): sono date di scadenza e lo stato di
 * una macchina, e l'API di OVH conta le richieste.
 */
export const controlliOvh = ricorda(30 * 60 * 1000, leggiOvh);
