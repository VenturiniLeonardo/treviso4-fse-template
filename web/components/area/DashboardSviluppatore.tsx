/**
 * La dashboard dello sviluppatore.
 *
 * ## Com'è fatta, dall'alto in basso
 *
 *  1. **Il periodo** — 7, 30 o 90 giorni — in una riga sola sopra tutto: vale
 *     per i numeri e per il grafico dell'attività, che così dicono sempre la
 *     stessa cosa.
 *  2. **Quattro numeri**, ciascuno con il confronto sul periodo prima.
 *  3. **L'attività** in colonne, e accanto **lo stato del sistema** in un
 *     anello: quanti controlli sono a posto, da configurare, guasti, e i
 *     guasti per nome. È la risposta a «c'è qualcosa da fare?».
 *  4. In fondo, tre riquadri: **le ultime operazioni**, **le risorse della
 *     macchina** e **le scadenze**. Il traffico di Cloudflare si aggiunge a
 *     tutta larghezza quando c'è.
 *
 * Un riquadro senza dati non si mostra: niente spazi vuoti che spiegano che
 * cosa ci sarebbe. Quello che manca da configurare lo dice l'anello, e il
 * dettaglio di ogni controllo è in «Stato del sistema».
 *
 * ## Che cosa questa schermata NON fa
 *
 * **Non ha un pulsante che agisce.** Nessun «ottimizza», nessun «pulisci»,
 * nessun «rilascia»: sono script, da lanciare guardando l'esito. Un cruscotto
 * che scrive può essere lui la causa del guasto che si sta cercando.
 */

import Link from "next/link";
import { ICONA_ESITO, TITOLO_GRUPPO } from "@/components/area/Controlli";
import { Anello, Colonne, Misuratore, type PuntoColonne } from "@/components/area/Grafici";
import { Icona, type NomeIcona } from "@/components/area/Icone";
import {
  attivitaGiornaliera,
  contiAccesso,
  type EsitoControllo,
  type GiornoAttivita,
  perSettimana,
  variazione,
} from "@/lib/diagnostica";
import { conteggi as conteggiGdpr } from "@/lib/gdpr-store";
import { esitoCarico, esitoLibero, misureMacchina } from "@/lib/macchina";
import { livelloPer } from "@/lib/auth/contesto";
import { leggiRegistro } from "@/lib/registro-store";
import { quandoLeggibile, quantoFa } from "@/lib/registro";
import type { Sessione } from "@/lib/sessione";
import { statoSistema } from "@/lib/stato-sistema";

const PERIODI = [7, 30, 90] as const;
type Periodo = (typeof PERIODI)[number];

const numero = (n: number) => n.toLocaleString("it-IT");

const giorno = (iso: string, lungo = true) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(
    "it-IT",
    lungo ? { weekday: "long", day: "numeric", month: "long" } : { day: "numeric", month: "short" },
  );

/** Le colonne del grafico: giorni fino a 30, settimane oltre. */
function puntiDi(giorni: GiornoAttivita[], periodo: Periodo): PuntoColonne[] {
  if (periodo <= 30) {
    return giorni.map((g) => ({
      breve: String(Number(g.giorno.slice(8, 10))),
      lungo: giorno(g.giorno),
      valori: { operazioni: g.operazioni, accessi: g.accessi },
    }));
  }
  return perSettimana(giorni).map((s) => ({
    breve: giorno(s.da, false),
    lungo: `dal ${giorno(s.da, false)} al ${giorno(s.giorno, false)}`,
    valori: { operazioni: s.operazioni, accessi: s.accessi },
  }));
}

export async function DashboardSviluppatore({
  sessione,
  periodo: periodoChiesto,
}: {
  sessione: Sessione;
  periodo?: string;
}) {
  const periodo: Periodo = PERIODI.find((p) => String(p) === periodoChiesto) ?? 30;

  const [stato, registro] = await Promise.all([statoSistema(), (await livelloPer("registro")) === "nessuno" ? [] : leggiRegistro()]);
  const accessi = contiAccesso();
  const gdpr = conteggiGdpr();
  const misure = misureMacchina();
  const adesso = Date.now();

  /* Il doppio del periodo: la seconda metà è il periodo, la prima è quello
     prima, per il confronto nei numeri. */
  const doppio = attivitaGiornaliera(periodo * 2);
  const corrente = doppio?.slice(periodo) ?? null;
  const precedente = doppio?.slice(0, periodo) ?? null;
  const somma = (g: GiornoAttivita[] | null, k: "accessi" | "operazioni" | "rifiutate") =>
    (g ?? []).reduce((t, x) => t + x[k], 0);

  /* ------------------------------------------------------------ controlli */
  const guasti = stato.tutti.filter((c) => c.esito === "guasto");
  const aperti = stato.tutti.filter((c) => c.esito === "aperto");
  const aPosto = stato.tutti.length - guasti.length - aperti.length;
  const verdetto: EsitoControllo = guasti.length > 0 ? "guasto" : aperti.length > 0 ? "aperto" : "ok";

  /* ------------------------------------------------------------ risorse */
  const discoLibero = misure.disco ? (misure.disco.libero / misure.disco.totale) * 100 : null;
  const memLibera = misure.memoria ? (misure.memoria.disponibile / misure.memoria.totale) * 100 : null;
  const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;

  /* ------------------------------------------------------------ scadenze */
  const scadenze = stato.tutti
    .filter((c) => typeof c.giorni === "number")
    .sort((a, b) => a.giorni! - b.giorni!);

  /* ------------------------------------------------------------ traffico */
  const traffico = stato.traffico && stato.traffico.length > 0 ? stato.traffico : null;
  const totTraffico = (traffico ?? []).reduce((t, o) => t + o.richieste, 0);
  const totCache = (traffico ?? []).reduce((t, o) => t + o.inCache, 0);

  return (
    <div className="adm-dash">
      {/* ------------------------------------------------------- il periodo */}
      <div className="dash-filtri">
        <nav className="dash-periodi" aria-label="Periodo dei grafici">
          {PERIODI.map((p) => (
            <Link
              key={p}
              href={`/area-riservata/sviluppatore/riepilogo?periodo=${p}`}
              className="dash-periodo"
              aria-current={p === periodo ? "true" : undefined}
              scroll={false}
            >
              {p} giorni
            </Link>
          ))}
        </nav>
        {sessione.r !== "sviluppatore" ? (
          <span className="dash-filtri__nota">vista in prestito ({sessione.r})</span>
        ) : null}
        <Link href="/area-riservata/sviluppatore/sistema" className="adm-btn adm-btn--primary">
          Stato del sistema
        </Link>
      </div>

      {/* ------------------------------------------------------- i numeri */}
      <div className="dash-kpi">
        <Numero
          icona="persone"
          valore={accessi ? numero(accessi.personeDentro) : "—"}
          etichetta="Persone collegate"
          nota={accessi ? `${accessi.sessioniAttive} ${accessi.sessioniAttive === 1 ? "sessione" : "sessioni"} aperte adesso` : undefined}
          href="/area-riservata/sviluppatore/log"
        />
        <Numero
          icona="chiave"
          valore={numero(somma(corrente, "accessi"))}
          etichetta={`Accessi in ${periodo} giorni`}
          nota={
            accessi && accessi.tentativiRecenti > 0
              ? `${accessi.tentativiRecenti} tentativi falliti negli ultimi 15 minuti`
              : undefined
          }
          allarme={(accessi?.tentativiRecenti ?? 0) >= 5}
          variazione={variazione(somma(corrente, "accessi"), somma(precedente, "accessi"))}
          periodo={periodo}
          href="/area-riservata/sviluppatore/log?che=accesso"
        />
        <Numero
          icona="matita"
          valore={numero(somma(corrente, "operazioni"))}
          etichetta={`Operazioni in ${periodo} giorni`}
          nota={
            somma(corrente, "rifiutate") > 0
              ? `${somma(corrente, "rifiutate")} respinte dal cancello dei permessi`
              : undefined
          }
          allarme={somma(corrente, "rifiutate") > 0}
          variazione={variazione(somma(corrente, "operazioni"), somma(precedente, "operazioni"))}
          periodo={periodo}
          href="/area-riservata/sviluppatore/log"
        />
        <Numero
          icona="lucchetto"
          valore={numero(gdpr.aperte)}
          etichetta="Richieste GDPR aperte"
          nota={gdpr.inRitardo > 0 ? `${gdpr.inRitardo} oltre i trenta giorni di legge` : undefined}
          allarme={gdpr.inRitardo > 0}
          href="/area-riservata/sviluppatore/privacy"
        />
      </div>

      {/* ---------------------------------------------- attività e controlli */}
      <div className="dash-riga dash-riga--grande">
        <section className="dash-scheda" aria-labelledby="t-attivita">
          <h3 id="t-attivita" className="dash-scheda__titolo">
            Attività
          </h3>
          {corrente ? (
            <Colonne
              titolo={`Accessi e operazioni, ultimi ${periodo} giorni`}
              serie={[
                { chiave: "operazioni", etichetta: "Operazioni", tono: "accento" },
                { chiave: "accessi", etichetta: "Accessi", tono: "tenue" },
              ]}
              punti={puntiDi(corrente, periodo)}
              ogni={periodo === 7 ? 1 : periodo === 30 ? 5 : 2}
            />
          ) : (
            <p className="dash-vuoto">Il database non risponde: i dati sulle attività non sono disponibili.</p>
          )}
        </section>

        <section className="dash-scheda" aria-labelledby="t-stato">
          <h3 id="t-stato" className="dash-scheda__titolo">
            Stato del sistema
          </h3>
          <Anello
            titolo="Controlli di sistema"
            totale={`${aPosto}/${stato.tutti.length}`}
            sotto="a posto"
            spicchi={[
              { chiave: "ok", etichetta: "A posto", valore: aPosto, esito: "ok" },
              { chiave: "aperto", etichetta: "Da configurare", valore: aperti.length, esito: "aperto" },
              { chiave: "guasto", etichetta: "Guasti", valore: guasti.length, esito: "guasto" },
            ]}
          />
          {/* I guasti per nome, perché sono quelli da riparare adesso. Le cose
              da configurare sono lavoro noto: le conta l'anello, e il
              dettaglio è a un clic. */}
          {verdetto === "guasto" ? (
            <ul className="dash-guasti">
              {guasti.map((c) => (
                <li key={`${c.gruppo}-${c.id}`}>
                  <span className="graf-stato graf-stato--guasto">
                    <Icona nome={ICONA_ESITO.guasto} misura={12} />
                  </span>
                  <span>
                    <strong>{c.cosa}</strong>
                    <small>{TITOLO_GRUPPO[c.gruppo]}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <Link href="/area-riservata/sviluppatore/sistema" className="dash-scheda__piede">
            {verdetto === "ok" ? "Tutti i controlli →" : "Vedi che cosa manca →"}
          </Link>
        </section>
      </div>

      {/* ------------------------------------------------------- in fondo */}
      <div className={`dash-riga dash-riga--tre${scadenze.length === 0 ? " dash-riga--due" : ""}`}>
        <section className="dash-scheda" aria-labelledby="t-operazioni">
          <h3 id="t-operazioni" className="dash-scheda__titolo">
            Ultime operazioni
          </h3>
          {registro.length === 0 ? (
            <p className="dash-vuoto">Nessuna operazione registrata.</p>
          ) : (
            <table className="dash-tabella">
              <thead>
                <tr>
                  <th scope="col">Chi</th>
                  <th scope="col">Operazione</th>
                  <th scope="col">Quando</th>
                </tr>
              </thead>
              <tbody>
                {registro.slice(0, 6).map((r, i) => (
                  <tr key={i} className={r.esito === "rifiutato" ? "dash-tabella__rifiutata" : undefined}>
                    <td>
                      <span className="dash-persona">
                        <span className="dash-iniziale" aria-hidden="true">
                          {r.nome.replace(/^.*— /, "").trim().charAt(0).toUpperCase()}
                        </span>
                        {r.nome}
                      </span>
                    </td>
                    <td>
                      {r.operazione}
                      {r.esito === "rifiutato" ? <span className="visually-hidden"> (rifiutata)</span> : null}
                    </td>
                    <td title={quandoLeggibile(r.quando)}>{quantoFa(r.quando, adesso)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Link href="/area-riservata/sviluppatore/log" className="dash-scheda__piede">
            Registro completo →
          </Link>
        </section>

        <section className="dash-scheda" aria-labelledby="t-risorse">
          <h3 id="t-risorse" className="dash-scheda__titolo">
            Risorse della macchina
          </h3>
          <div className="dash-misure">
            <Misuratore
              etichetta="Disco"
              percentuale={discoLibero === null ? null : 100 - discoLibero}
              esito={discoLibero === null ? "guasto" : esitoLibero(discoLibero)}
              dettaglio={misure.disco ? `${gb(misure.disco.libero)} liberi su ${gb(misure.disco.totale)}` : "non misurabile"}
            />
            <Misuratore
              etichetta="Memoria"
              percentuale={memLibera === null ? null : 100 - memLibera}
              esito={memLibera === null ? "aperto" : esitoLibero(memLibera)}
              dettaglio={
                misure.memoria
                  ? `${gb(misure.memoria.disponibile)} disponibili su ${gb(misure.memoria.totale)}`
                  : "si misura sul server Linux"
              }
            />
            <Misuratore
              etichetta="Carico"
              percentuale={(misure.carico.quindici / misure.carico.cpu) * 100}
              esito={esitoCarico(misure.carico.quindici, misure.carico.cpu)}
              dettaglio={`media a 15 minuti, ${misure.carico.cpu} ${misure.carico.cpu === 1 ? "processore" : "processori"}`}
            />
          </div>
        </section>

        {scadenze.length > 0 ? (
          <section className="dash-scheda" aria-labelledby="t-scadenze">
            <h3 id="t-scadenze" className="dash-scheda__titolo">
              Scadenze
            </h3>
            <ul className="dash-elenco">
              {scadenze.map((c) => (
                <li key={`${c.gruppo}-${c.id}`} className={`dash-elenco__voce dash-elenco__voce--${c.esito}`}>
                  <span className={`dash-elenco__segno graf-stato--${c.esito}`}>
                    <Icona nome={c.gruppo === "certificati" ? "lucchetto" : "calendario"} misura={16} />
                  </span>
                  <span className="dash-elenco__testo">
                    <strong>{c.cosa}</strong>
                    <small>{c.nota.split(" · ")[0].split(":")[0]}</small>
                  </span>
                  <span className="dash-elenco__valore">
                    {c.giorni! < 0 ? "scaduto" : `${c.giorni} g`}
                    <span className="visually-hidden"> · {c.esito === "ok" ? "a posto" : c.esito === "aperto" ? "da guardare" : "guasto"}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {/* ------------------------------------------------ il traffico, se c'è */}
      {traffico ? (
        <section className="dash-scheda" aria-labelledby="t-traffico">
          <div className="dash-scheda__testa">
            <h3 id="t-traffico" className="dash-scheda__titolo">
              Traffico, ultime 24 ore
            </h3>
            <span className="dash-scheda__meta">
              {numero(totTraffico)} richieste · {totTraffico > 0 ? Math.round((totCache / totTraffico) * 100) : 0}% dalla cache
            </span>
          </div>
          <Colonne
            titolo="Richieste per ora, ultime 24 ore"
            serie={[
              { chiave: "server", etichetta: "Arrivate al server", tono: "accento" },
              { chiave: "cache", etichetta: "Dalla cache di Cloudflare", tono: "tenue" },
            ]}
            punti={traffico.map((o) => {
              const hh = new Date(o.ora).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
              return {
                breve: hh.slice(0, 2),
                lungo: `ore ${hh}`,
                valori: { server: Math.max(0, o.richieste - o.inCache), cache: o.inCache },
              };
            })}
            ogni={3}
          />
        </section>
      ) : null}
    </div>
  );
}

/**
 * Un numero: il valore grande, l'etichetta sotto, l'icona in un cerchio a
 * destra. Il confronto col periodo prima è in inchiostro neutro: più accessi
 * non sono né un bene né un male, e colorarli di verde direbbe il contrario.
 */
function Numero({
  icona,
  valore,
  etichetta,
  nota,
  href,
  allarme = false,
  variazione: delta,
  periodo,
}: {
  icona: NomeIcona;
  valore: string;
  etichetta: string;
  nota?: string;
  href: string;
  allarme?: boolean;
  variazione?: number | null;
  periodo?: number;
}) {
  return (
    <Link href={href} className={`dash-numero${allarme ? " dash-numero--allarme" : ""}`}>
      <span className="dash-numero__testo">
        <span className="dash-numero__valore">{valore}</span>
        <span className="dash-numero__etichetta">{etichetta}</span>
        {nota ? (
          <span className="dash-numero__nota">{nota}</span>
        ) : delta !== undefined && delta !== null && periodo ? (
          <span className="dash-numero__nota">
            {delta > 0 ? "+" : ""}
            {delta}% rispetto ai {periodo} giorni prima
          </span>
        ) : null}
      </span>
      <span className="dash-numero__icona" aria-hidden="true">
        <Icona nome={icona} misura={22} />
      </span>
    </Link>
  );
}
