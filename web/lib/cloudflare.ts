/**
 * Cloudflare, visto dalla dashboard dello sviluppatore.
 *
 * ## Il token, e perché è di sola lettura
 *
 * `SITO_CLOUDFLARE_TOKEN` nell'ambiente del sito (/etc/sito/ambiente).
 * Si crea in Cloudflare → My Profile → API Tokens → Create Custom Token, con
 * **soltanto** questi permessi, e soltanto sulla zona del sito:
 *
 *     Zone · Zone · Read            lo stato della zona e il suo identificativo
 *     Zone · Zone Settings · Read   modalità SSL, HTTPS obbligatorio, sicurezza
 *     Zone · DNS · Read             i record, e se passano dal proxy
 *     Zone · Analytics · Read       il traffico delle ultime 24 ore
 *
 * Nessun «Edit». È un token diverso da quello di Caddy, che invece deve poter
 * scrivere il DNS per il certificato (§ deploy/caddy-cloudflare.sh): il
 * processo del sito è quello che parla con internet, e non deve poter spostare
 * il dominio altrove se un giorno qualcuno gli fa fare una cosa che non
 * dovrebbe. Un permesso che manca non rompe la schermata: la riga
 * corrispondente dice quale permesso aggiungere.
 *
 * ## Una riga che non ha bisogno del token
 *
 * «Indirizzi di Cloudflare in Caddy» confronta l'elenco scritto nel Caddyfile
 * con quello che Cloudflare pubblica, e l'elenco pubblico si legge senza
 * credenziali. È la riga che si accorge quando Cloudflare aggiunge una rete e
 * il Caddyfile no: i visitatori che passano da lì tornerebbero a comparire con
 * un IP di Cloudflare, cioè il guasto che quell'elenco esiste per evitare.
 *
 * Modulo di solo server. Non scrive niente, da nessuna parte.
 */

import { readFileSync } from "node:fs";
import type { Controllo, EsitoControllo } from "@/lib/diagnostica";
import { pesoDb } from "@/lib/diagnostica";
import { indirizzoPubblico } from "@/lib/indirizzo-pubblico";
import { ricorda } from "@/lib/ricorda";

const API = "https://api.cloudflare.com/client/v4";

/* ------------------------------------------------------------------------ *
 * Le interpretazioni, pure e provabili
 * ------------------------------------------------------------------------ */

/**
 * La modalità SSL della zona → esito.
 *
 * Solo «Full (strict)» è giusta: Cloudflare cifra verso questa macchina **e
 * controlla** che il certificato sia valido. «Full» cifra ma accetta qualunque
 * certificato, anche scaduto — chi si mette in mezzo fra Cloudflare e la VPS
 * non viene scoperto. «Flexible» è la peggiore, e la più insidiosa: il
 * visitatore vede il lucchetto, ma da Cloudflare a qui la password viaggia in
 * chiaro.
 */
export function esitoModalitaSsl(valore: string): { esito: EsitoControllo; etichetta: string; nota: string } {
  switch (valore) {
    case "strict":
      return { esito: "ok", etichetta: "Full (strict)", nota: "cifrato fino a questa macchina, e il certificato di Caddy è controllato" };
    case "full":
      return {
        esito: "aperto",
        etichetta: "Full",
        nota: "cifrato, ma Cloudflare accetta anche un certificato scaduto: va messo su «Full (strict)»",
      };
    case "flexible":
      return {
        esito: "guasto",
        etichetta: "Flexible",
        nota: "da Cloudflare a questa macchina il traffico viaggia IN CHIARO, password comprese: va messo su «Full (strict)»",
      };
    case "off":
      return { esito: "guasto", etichetta: "Off", nota: "HTTPS spento verso i visitatori" };
    default:
      return { esito: "aperto", etichetta: valore || "sconosciuta", nota: "modalità non riconosciuta" };
  }
}

/**
 * Le reti di Cloudflare che il Caddyfile non ha fra i proxy fidati.
 *
 * Il confronto è per testo, non per aritmetica di rete: il Caddyfile le
 * scrive una per una come le pubblica Cloudflare, e un confronto esatto è
 * quello che dice «manca questa» senza bisogno di spiegare perché.
 */
export function retiMancanti(caddyfile: string, reti: string[]): string[] {
  const riga = caddyfile
    .split("\n")
    .map((r) => r.trim())
    .find((r) => r.startsWith("trusted_proxies"));
  if (!riga) return reti;
  const scritte = new Set(riga.split(/\s+/));
  return reti.filter((r) => !scritte.has(r));
}

interface GruppoOrario {
  dimensions?: { datetime: string };
  sum: { requests: number; cachedRequests: number; bytes: number; threats: number };
}

/** Un'ora di traffico, per il grafico della dashboard. */
export interface OraTraffico {
  /** inizio dell'ora, ISO */
  ora: string;
  richieste: number;
  inCache: number;
}

/** Le ore dell'API di analisi, in ordine e nella forma del grafico. */
export function serieOraria(gruppi: GruppoOrario[]): OraTraffico[] {
  return gruppi
    .filter((g) => g.dimensions?.datetime)
    .map((g) => ({ ora: g.dimensions!.datetime, richieste: g.sum.requests ?? 0, inCache: g.sum.cachedRequests ?? 0 }))
    .sort((a, b) => a.ora.localeCompare(b.ora));
}

/** Le ore di traffico dell'API di analisi, sommate. */
export function sommaTraffico(
  gruppi: GruppoOrario[],
): { richieste: number; inCache: number; byte: number; minacce: number } {
  return gruppi.reduce(
    (t, g) => ({
      richieste: t.richieste + (g.sum.requests ?? 0),
      inCache: t.inCache + (g.sum.cachedRequests ?? 0),
      byte: t.byte + (g.sum.bytes ?? 0),
      minacce: t.minacce + (g.sum.threats ?? 0),
    }),
    { richieste: 0, inCache: 0, byte: 0, minacce: 0 },
  );
}

/** Mille separati alla maniera italiana: 12.408. */
const intero = (n: number) => n.toLocaleString("it-IT");

/* ------------------------------------------------------------------------ *
 * Le chiamate
 * ------------------------------------------------------------------------ */

/** Un rifiuto dell'API: `permesso` quando al token manca un diritto. */
/* Il campo si dichiara a parte e non nel costruttore (`readonly permesso`):
   script e prove girano con `--experimental-strip-types`, che quella forma
   non la accetta. */
class ErroreCloudflare extends Error {
  readonly permesso: boolean;
  constructor(messaggio: string, permesso: boolean) {
    super(messaggio);
    this.permesso = permesso;
  }
}

async function chiedi<T>(token: string, percorso: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API}${percorso}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
  } catch {
    throw new ErroreCloudflare("api.cloudflare.com non risponde", false);
  }
  const corpo = (await r.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
    errors?: { code: number; message: string }[];
    data?: T;
  } | null;
  if (r.status === 401 || r.status === 403) {
    throw new ErroreCloudflare(corpo?.errors?.[0]?.message ?? "permesso negato", true);
  }
  /* L'API di analisi è GraphQL e risponde 200 anche quando rifiuta: l'errore
     sta nel corpo, accanto a `data` vuoto. Senza questo controllo un token
     senza «Analytics · Read» darebbe una riga di traffico a zero. */
  const primo = corpo?.errors?.[0]?.message;
  if (primo && corpo?.result == null && corpo?.data == null) {
    throw new ErroreCloudflare(primo, /authori[sz]|permission|access/i.test(primo));
  }
  if (!r.ok || !corpo || corpo.success === false) {
    throw new ErroreCloudflare(corpo?.errors?.[0]?.message ?? `risposta ${r.status}`, false);
  }
  return (corpo.result ?? corpo.data) as T;
}

interface Zona {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  plan?: { name?: string };
  name_servers?: string[];
}

/**
 * La zona che contiene il dominio del sito. Si prova dal nome intero verso
 * l'alto (`www.example.org`, poi `example.org`): così funziona sia con il
 * sito sul dominio nudo sia su un sottodominio, senza chiedere l'identificativo
 * della zona a chi configura.
 */
async function trovaZona(token: string, nome: string): Promise<Zona | null> {
  const parti = nome.split(".");
  for (let i = 0; i < parti.length - 1; i++) {
    const candidato = parti.slice(i).join(".");
    const zone = await chiedi<Zona[]>(token, `/zones?name=${encodeURIComponent(candidato)}`);
    if (zone.length > 0) return zone[0];
  }
  return null;
}

/* ------------------------------------------------------------------------ *
 * Le righe
 * ------------------------------------------------------------------------ */

const riga = (id: string, cosa: string, valore: string, esito: EsitoControllo, nota: string): Controllo => ({
  id,
  gruppo: "cloudflare",
  cosa,
  valore,
  esito,
  nota,
});

/** Una riga che non si è potuta leggere, con il permesso che manca. */
function rigaNegata(id: string, cosa: string, e: unknown, permesso: string): Controllo {
  if (e instanceof ErroreCloudflare && e.permesso) {
    return riga(id, cosa, "senza permesso", "aperto", `al token manca «${permesso}»`);
  }
  return riga(id, cosa, "non leggibile", "guasto", e instanceof Error ? e.message : String(e));
}

/** L'elenco di reti del Caddyfile contro quello pubblicato. Senza token. */
async function controlloRetiCaddy(): Promise<Controllo> {
  const percorso = process.env.SITO_CADDYFILE ?? "/etc/caddy/Caddyfile";
  const cosa = "Indirizzi di Cloudflare in Caddy";
  let caddyfile: string;
  try {
    caddyfile = readFileSync(percorso, "utf8");
  } catch {
    return riga("cf-reti", cosa, "non misurabile qui", "aperto", `${percorso} non si legge: il confronto si fa sul server`);
  }
  let reti: string[];
  try {
    const r = await fetch(`${API}/ips`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    const corpo = (await r.json()) as { result: { ipv4_cidrs: string[]; ipv6_cidrs: string[] } };
    reti = [...corpo.result.ipv4_cidrs, ...corpo.result.ipv6_cidrs];
  } catch {
    return riga("cf-reti", cosa, "non raggiungibile", "aperto", "l'elenco pubblico di Cloudflare non risponde: si riprova tra poco");
  }
  const mancanti = retiMancanti(caddyfile, reti);
  if (mancanti.length === 0) {
    return riga("cf-reti", cosa, "aggiornati", "ok", `le ${reti.length} reti pubblicate da Cloudflare sono tutte fra i proxy fidati`);
  }
  return riga(
    "cf-reti",
    cosa,
    `ne mancano ${mancanti.length}`,
    "guasto",
    `chi passa da ${mancanti.slice(0, 2).join(", ")}${mancanti.length > 2 ? "…" : ""} compare con l'IP di Cloudflare: ` +
      "aggiungetele a trusted_proxies nel Caddyfile",
  );
}

export interface StatoCloudflare {
  controlli: Controllo[];
  /** le ultime 24 ore, se il token può leggere le analisi */
  orario: OraTraffico[] | null;
}

async function leggiCloudflare(): Promise<StatoCloudflare> {
  const soloRighe = (controlli: Controllo[]): StatoCloudflare => ({ controlli, orario: null });
  const reti = controlloRetiCaddy();
  const token = process.env.SITO_CLOUDFLARE_TOKEN?.trim();
  const indirizzo = indirizzoPubblico();
  const dominio = indirizzo ? new URL(indirizzo).hostname : null;

  if (!token) {
    return soloRighe([
      riga(
        "cf-token",
        "Pannello di Cloudflare",
        "non configurato",
        "aperto",
        "manca SITO_CLOUDFLARE_TOKEN: un token di sola lettura sulla zona (istruzioni in web/.env.esempio)",
      ),
      await reti,
    ]);
  }
  if (!dominio || dominio === "localhost") {
    return soloRighe([riga("cf-token", "Pannello di Cloudflare", "nessun dominio", "aperto", "serve SITO_BASE_URL per sapere quale zona leggere"), await reti]);
  }

  let zona: Zona | null;
  try {
    zona = await trovaZona(token, dominio);
  } catch (e) {
    return soloRighe([rigaNegata("cf-zona", "Zona", e, "Zone · Zone · Read"), await reti]);
  }
  if (!zona) {
    return soloRighe([
      riga("cf-zona", "Zona", "non trovata", "guasto", `il token non vede nessuna zona che contenga ${dominio}`),
      await reti,
    ]);
  }

  const impostazione = (nome: string) =>
    chiedi<{ value: string }>(token, `/zones/${zona.id}/settings/${nome}`).then((r) => r.value);

  const [ssl, https, sicurezza, record, traffico] = await Promise.allSettled([
    impostazione("ssl"),
    impostazione("always_use_https"),
    impostazione("security_level"),
    Promise.all(
      [...new Set([dominio, dominio.replace(/^www\./, ""), `www.${dominio.replace(/^www\./, "")}`])].map((n) =>
        chiedi<{ name: string; type: string; proxied: boolean }[]>(
          token,
          `/zones/${zona.id}/dns_records?name=${encodeURIComponent(n)}`,
        ),
      ),
    ).then((l) => l.flat().filter((r) => ["A", "AAAA", "CNAME"].includes(r.type))),
    trafficoUltimeOre(token, zona.id),
  ]);

  const righe: Controllo[] = [];

  righe.push(
    zona.status === "active" && !zona.paused
      ? riga("cf-zona", "Zona", "attiva", "ok", `${zona.name} · piano ${zona.plan?.name ?? "sconosciuto"}`)
      : zona.paused
        ? riga("cf-zona", "Zona", "in pausa", "guasto", "Cloudflare è in pausa: il traffico va diretto alla VPS, senza protezione")
        : riga(
            "cf-zona",
            "Zona",
            zona.status,
            "aperto",
            `i nameserver del dominio non puntano ancora a Cloudflare: ${(zona.name_servers ?? []).join(", ")}`,
          ),
  );

  if (ssl.status === "fulfilled") {
    const m = esitoModalitaSsl(ssl.value);
    righe.push(riga("cf-ssl", "Modalità SSL", m.etichetta, m.esito, m.nota));
  } else righe.push(rigaNegata("cf-ssl", "Modalità SSL", ssl.reason, "Zone · Zone Settings · Read"));

  if (https.status === "fulfilled") {
    const on = https.value === "on";
    righe.push(
      riga(
        "cf-https",
        "HTTPS obbligatorio",
        on ? "sì" : "no",
        on ? "ok" : "aperto",
        on ? "chi scrive http:// viene portato su https:// da Cloudflare" : "da accendere: «Always Use HTTPS», in SSL/TLS → Edge Certificates",
      ),
    );
  } else righe.push(rigaNegata("cf-https", "HTTPS obbligatorio", https.reason, "Zone · Zone Settings · Read"));

  if (record.status === "fulfilled") {
    const scoperti = record.value.filter((r) => !r.proxied);
    righe.push(
      record.value.length === 0
        ? riga("cf-dns", "Record DNS", "nessuno", "guasto", `nessun record A, AAAA o CNAME per ${dominio}`)
        : scoperti.length === 0
          ? riga("cf-dns", "Record DNS", "dietro il proxy", "ok", `${record.value.length} record, tutti con la nuvola arancione`)
          : riga(
              "cf-dns",
              "Record DNS",
              `${scoperti.length} scoperti`,
              "aperto",
              `${[...new Set(scoperti.map((r) => r.name))].join(", ")} senza proxy: rispondono con l'IP della VPS, e lo rendono pubblico`,
            ),
    );
  } else righe.push(rigaNegata("cf-dns", "Record DNS", record.reason, "Zone · DNS · Read"));

  if (sicurezza.status === "fulfilled") {
    const attacco = sicurezza.value === "under_attack";
    righe.push(
      riga(
        "cf-sicurezza",
        "Livello di sicurezza",
        attacco ? "Under Attack" : sicurezza.value,
        attacco ? "aperto" : "ok",
        attacco
          ? "ogni visitatore aspetta cinque secondi su una pagina di controllo: da spegnere quando l'attacco è finito"
          : "i visitatori sospetti ricevono una verifica, gli altri passano",
      ),
    );
  } else righe.push(rigaNegata("cf-sicurezza", "Livello di sicurezza", sicurezza.reason, "Zone · Zone Settings · Read"));

  if (traffico.status === "fulfilled") {
    const t = sommaTraffico(traffico.value);
    const quota = t.richieste > 0 ? Math.round((t.inCache / t.richieste) * 100) : 0;
    righe.push(
      riga(
        "cf-traffico",
        "Traffico, ultime 24 ore",
        `${intero(t.richieste)} richieste`,
        "ok",
        `${quota}% servite dalla cache · ${pesoDb(t.byte)} · ${intero(t.minacce)} ${t.minacce === 1 ? "minaccia bloccata" : "minacce bloccate"}`,
      ),
    );
  } else righe.push(rigaNegata("cf-traffico", "Traffico, ultime 24 ore", traffico.reason, "Zone · Analytics · Read"));

  righe.push(await reti);
  return { controlli: righe, orario: traffico.status === "fulfilled" ? serieOraria(traffico.value) : null };
}

/**
 * Le ultime 24 ore dall'API di analisi (GraphQL), a gruppi di un'ora: è la
 * granularità che il piano gratuito concede per l'ultimo giorno.
 */
async function trafficoUltimeOre(token: string, zona: string) {
  const da = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const dati = await chiedi<{
    viewer: {
      zones: { httpRequests1hGroups: GruppoOrario[] }[];
    };
  }>(token, "/graphql", {
    method: "POST",
    body: JSON.stringify({
      query:
        "query($zona:String!,$da:Time!){viewer{zones(filter:{zoneTag:$zona}){" +
        "httpRequests1hGroups(limit:25,filter:{datetime_geq:$da},orderBy:[datetime_ASC])" +
        "{dimensions{datetime} sum{requests cachedRequests bytes threats}}}}}",
      variables: { zona, da },
    }),
  });
  return dati.viewer.zones[0]?.httpRequests1hGroups ?? [];
}

/** Dieci minuti di memoria (§ lib/ricorda.ts). */
export const statoCloudflare = ricorda(10 * 60 * 1000, leggiCloudflare);
