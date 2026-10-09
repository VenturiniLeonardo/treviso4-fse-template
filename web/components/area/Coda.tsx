"use client";

import clsx from "clsx";
import Link from "next/link";
import { useActionState } from "react";
import { decidi } from "@/app/(area)/area-riservata/approvazioni/actions";
import { decidiPropostaSito } from "@/app/(area)/area-riservata/proposte/actions";
import { decidiProposta } from "@/app/(area)/area-riservata/unita/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";
import { quantoFa } from "@/lib/registro";

/**
 * Il riquadro dei consensi, per un album in coda.
 *
 * Tre stati, e la differenza fra il primo e il terzo è tutto il punto della
 * fase 10.2:
 *
 *  - **nessuno senza consenso** — si può approvare;
 *  - **qualcuno senza consenso** — i nomi, e l'avviso;
 *  - **non lo sappiamo** — l'elenco iscritti di quell'unità e di quell'anno è
 *    vuoto. Non è la stessa cosa di «vanno tutti bene», e dirlo come se lo
 *    fosse sarebbe il modo di far pubblicare alla cieca credendo di aver
 *    controllato.
 *
 * I nomi si mostrano fino a otto, poi «e altri N»: un elenco lungo dentro una
 * scheda di coda si smette di leggere, e il numero resta visibile.
 */
function Consensi({ voce }: { voce: VoceCoda }) {
  const dati = voce.senzaConsenso;
  const mancanti = dati?.totale ?? 0;
  const nonSappiamo = dati === undefined;
  const allarme = mancanti > 0 || nonSappiamo;

  return (
    <div
      className={clsx("adm-coda__consensi", allarme && "adm-coda__consensi--attenzione")}
    >
      <span className="adm-coda__consensi-titolo">Prima di approvare</span>
      <span>
        {voce.foto ?? 0} {voce.foto === 1 ? "fotografia" : "fotografie"} ·{" "}
        {nonSappiamo
          ? "consensi non verificabili"
          : mancanti === 0
            ? "tutti i consensi risultano presenti"
            : `${mancanti} ${mancanti === 1 ? "iscritto" : "iscritti"} senza consenso`}
      </span>

      {mancanti > 0 ? (
        <span className="adm-coda__consensi-numero">
          {dati!.nomi.slice(0, 8).join(" · ")}
          {dati!.nomi.length > 8 ? ` · e altri ${dati!.nomi.length - 8}` : ""}
        </span>
      ) : null}

      <span className="adm-coda__consensi-nota">
        {nonSappiamo
          ? "Per quest’unità e quest’anno non c’è nessun iscritto registrato: il " +
            "sito non può dire se i consensi ci sono. Controllate sulla carta prima " +
            "di approvare."
          : mancanti > 0
            ? "Se una di queste persone compare nelle fotografie, l’album non va " +
              "online: una volta pubblicate, le immagini possono essere copiate da " +
              "chiunque."
            : "Resta da guardare le fotografie: il sito sa chi ha dato il consenso, " +
              "non chi è inquadrato."}
      </span>
    </div>
  );
}

/** Dove porta «Apri e controlla», per ciascun tipo di voce. */
function dovePorta(v: VoceCoda): string {
  const base = "/area-riservata/gestore";
  if (v.tipo === "pagina" || v.tipo === "faq") return `${base}/pagine`;
  if (v.tipo === "immagine") return `${base}/immagini`;
  if (v.tipo === "copertina") return `${base}/unita?u=${encodeURIComponent(v.chiave)}`;
  if (v.tipo === "album") return `${base}/album?album=${v.chiave}`;
  if (v.tipo === "attivita") return `${base}/calendario?att=${v.chiave}`;
  if (v.tipo === "campo") return `${base}/unita?u=${encodeURIComponent(unitaDi(v))}`;
  if (v.tipo === "persone") return `${base}/referenti?u=${encodeURIComponent(unitaDi(v))}`;
  return `${base}/documenti?doc=${encodeURIComponent(v.chiave)}`;
}

/** L'unità di una voce di contenuto: la prima metà della chiave composta. */
const unitaDi = (v: VoceCoda): string => v.chiave.split("|")[0] ?? "";

/**
 * La seconda metà: il tipo di elenco, o i nomi dei campi separati da virgole.
 * Per i campi sono **tutti** quelli della voce: vedi `decidiProposta`.
 */
const cosaDi = (v: VoceCoda): string[] => (v.chiave.split("|")[1] ?? "").split(",");

/** Le voci che vengono da `proposte`: testi delle pagine, domande, fotografie. */
const dalSito = (v: VoceCoda): boolean =>
  v.proposta === true ||
  v.tipo === "pagina" ||
  v.tipo === "faq" ||
  v.tipo === "immagine" ||
  v.tipo === "copertina";

/**
 * Le due fotografie di una proposta, una accanto all'altra.
 *
 * Quella di adesso e quella proposta, alla stessa larghezza: chi approva deve
 * vedere la differenza senza cambiare schermata, per la stessa ragione per cui
 * i testi hanno il confronto. E deve **guardarla**: la regola sui volti — nessun
 * volto riconoscibile sul sito — la fa rispettare chi preme «Approva».
 */
function Fotografie({ voce }: { voce: VoceCoda }) {
  if (!voce.immagini) return null;
  const { prima, dopo } = voce.immagini;
  const riquadro = (src: string | null, etichetta: string, vuoto: string) => (
    <figure style={{ margin: 0, flex: "1 1 180px", minWidth: 0 }}>
      {src ? (
        <img
          src={src}
          alt=""
          style={{ width: "100%", height: "auto", display: "block", borderRadius: "4px" }}
        />
      ) : (
        <span className="adm-coda__consensi-nota">{vuoto}</span>
      )}
      <figcaption className="adm-coda__consensi-nota">{etichetta}</figcaption>
    </figure>
  );
  return (
    <div className="adm-coda__consensi adm-coda__consensi--attenzione">
      <span className="adm-coda__consensi-titolo">Prima di approvare</span>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        {riquadro(prima, "Adesso sul sito", "Adesso il riquadro è vuoto.")}
        {riquadro(dopo, "Proposta", "Proposta: togliere la fotografia.")}
      </div>
      <span className="adm-coda__consensi-nota">
        Guardatela a tutta grandezza prima di approvare: sul sito non vanno fotografie in cui
        si riconosca il volto di qualcuno. Approvando, la fotografia è online subito.
      </span>
    </div>
  );
}

/**
 * Il confronto prima/dopo di una proposta di contenuto.
 *
 * I valori si troncano a duecento caratteri: la storia di un'unità è lunga
 * migliaia, e una scheda di coda alta due schermi non si legge — «Apri e
 * controlla» porta al testo intero. Un valore vuoto si scrive «(vuoto)» e non
 * si lascia bianco, perché «da vuoto a qualcosa» e «non è cambiato niente»
 * devono distinguersi a occhio.
 */
function Confronto({ voce }: { voce: VoceCoda }) {
  if (!voce.confronto?.length) return null;
  const breve = (t: string) => (t.length > 200 ? `${t.slice(0, 200)}…` : t) || "(vuoto)";

  return (
    <div className="adm-coda__consensi">
      <span className="adm-coda__consensi-titolo">Che cosa cambia</span>
      {voce.confronto.map((c) => (
        <span key={c.etichetta} className="adm-coda__consensi-numero">
          <strong>{c.etichetta}</strong>
          <br />
          <s>{breve(c.prima)}</s>
          <br />
          {breve(c.dopo)}
        </span>
      ))}
      <span className="adm-coda__consensi-nota">
        Approvando, il sito pubblico cambia subito. Rimandando, resta come è adesso.
      </span>
    </div>
  );
}

/**
 * Coda di approvazione.
 *
 * Non è una tabella da modificare: è una lista di decisioni. Per ogni voce si
 * vede che cosa è stato preparato, da chi, quando, e — soprattutto — se i
 * consensi immagini sono a posto. Poi due soli pulsanti: approva o rimanda.
 *
 * Il riquadro dei consensi è la ragione per cui questa schermata esiste. Un
 * album va online solo se chi lo approva ha davvero potuto controllare, e
 * l'unico modo per farglielo controllare è metterglielo davanti prima dei
 * pulsanti, non in un'altra sezione.
 */

export interface VoceCoda {
  tipo:
    | "album"
    | "documento"
    | "attivita"
    | "campo"
    | "persone"
    // le quattro di `proposte`, dal social media manager (3 ottobre 2026)
    | "pagina"
    | "faq"
    | "immagine"
    | "copertina";
  /**
   * `slug` dell'album, `id` del documento, identificativo dell'attività —
   * oppure, per i due tipi della fase 14, `<unità>|<campo>` e `<unità>|<tipo>`.
   */
  chiave: string;
  /**
   * L'impronta di ciò che la scheda mostra (`lib/impronta-revisione.ts`), per
   * album, documenti e attività: `decidi()` pubblica solo se il contenuto è
   * ancora quello. Le proposte sui campi portano il valore nel confronto.
   */
  versione?: string;
  titolo: string;
  /** unità di competenza, o «tutto il gruppo» */
  ambito: string;
  quando: number;
  autore: string;
  /** quante fotografie contiene, per gli album */
  foto?: number;
  /** quante ne sono state escluse per mancanza di consenso */
  escluse?: number;
  /**
   * Chi, in quest'unità e in quest'anno, non ha il consenso alla pubblicazione
   * delle immagini. Presente solo per gli album.
   *
   * I **nomi**, non il numero. §5 del piano: «senza i nomi, chi legge non sa a
   * chi telefonare». Fino alla fase 10.2 questo riquadro diceva «controllate
   * l'elenco dei consensi dell'unità» — un compito, non un'informazione, e un
   * compito da svolgere in un'altra schermata mentre si ha il pulsante
   * «Approva» sotto il dito.
   */
  senzaConsenso?: { nomi: string[]; totale: number };
  /** per i documenti: se il file c'è */
  conFile?: boolean;
  /**
   * Il confronto, per le proposte di contenuto: che cosa dice il sito adesso e
   * che cosa direbbe dopo.
   *
   * Non è un vezzo di presentazione. Una voce che dicesse soltanto «Ref1
   * propone di cambiare l'email dell'unità» costringerebbe chi approva ad
   * aprire un'altra schermata per sapere che cosa c'è scritto ora — e chi deve
   * cambiare pagina per decidere, dopo la seconda volta, approva senza
   * guardare. È la stessa ragione per cui i nomi dei consensi stanno nella
   * scheda e non in un collegamento.
   */
  confronto?: { etichetta: string; prima: string; dopo: string }[];
  /**
   * Viene da `proposte`, e si decide con `decidiPropostaSito`. Serve perché
   * `attivita` è anche il tipo delle attività in revisione, che si decidono con
   * `decidi`: dal 6 ottobre 2026 un'attività può avere anche una modifica o una
   * cancellazione proposta dal social media manager, e il tipo da solo non
   * basta più a dire quale delle due azioni chiamare.
   */
  proposta?: true;
  /** il testo del pulsante che approva, se non «Approva e pubblica» */
  approva?: string;
  /**
   * Perché chi propone chiede di ritirare un album o un'attività online: è
   * l'unica cosa che chi decide deve leggere, e la scrive chi lo chiede.
   */
  motivo?: string;
  /**
   * Per le fotografie proposte: quella di adesso e quella nuova, come indirizzi.
   * `null` è «il riquadro è vuoto» a sinistra e «togliere» a destra.
   */
  immagini?: { prima: string | null; dopo: string | null };
  anteprima: string;
  /**
   * L'indirizzo dell'anteprima, per le voci che ne hanno una.
   *
   * Si chiama `anteprimaHref` e non `anteprima` perché quel nome era già preso
   * dalla riga di testo sotto il titolo, e rinominarlo avrebbe toccato tutte e
   * cinque le sorgenti di voci per un guadagno estetico.
   */
  anteprimaHref?: string;
}

function Decisione({
  voce,
  verso,
  primary,
  conferma,
  children,
}: {
  voce: VoceCoda;
  verso: "pubblicato" | "bozza";
  primary?: boolean;
  conferma?: string;
  children: React.ReactNode;
}) {
  const [stato, invia, inCorso] = useActionState(decidi, AZIONE_INIZIALE);
  return (
    <form action={invia} className="adm-comando">
      <input type="hidden" name="tipo" value={voce.tipo} />
      <input type="hidden" name="chiave" value={voce.chiave} />
      <input type="hidden" name="versione" value={voce.versione ?? ""} />
      <input type="hidden" name="verso" value={verso} />
      <button
        className={clsx("adm-btn", primary && "adm-btn--primary")}
        type="submit"
        disabled={inCorso}
        onClick={(e) => {
          if (conferma && !window.confirm(conferma)) e.preventDefault();
        }}
      >
        {inCorso ? "…" : children}
      </button>
      <Esito stato={stato} />
    </form>
  );
}

/**
 * I due pulsanti per una proposta di contenuto.
 *
 * Gemello di `Decisione`, e non lo stesso componente: l'azione è un'altra —
 * `decidiProposta` invece di `decidi` — perché sono due cose diverse. Là si
 * cambia lo **stato** di un contenuto che esiste già; qui si travasa un valore
 * proposto sopra quello in linea, o si butta la proposta. Fonderle avrebbe
 * significato un'azione con due rami che non condividono niente tranne il nome
 * dei pulsanti.
 *
 * Niente `slug` fra i campi nascosti: l'azione rigenera le pagine unità per
 * rotta, non per indirizzo. Vedi `aggiornaSito` in `unita/actions.ts`.
 */
function DecisioneContenuto({
  voce,
  verso,
  primary,
  children,
}: {
  voce: VoceCoda;
  verso: "approva" | "rimanda";
  primary?: boolean;
  children: React.ReactNode;
}) {
  const [stato, invia, inCorso] = useActionState(decidiProposta, AZIONE_INIZIALE);
  return (
    <form action={invia} className="adm-comando">
      <input type="hidden" name="unita" value={unitaDi(voce)} />
      {cosaDi(voce).map((cosa) => (
        <input
          key={cosa}
          type="hidden"
          name={voce.tipo === "persone" ? "tipo" : "campo"}
          value={cosa}
        />
      ))}
      <input type="hidden" name="verso" value={verso} />
      <button
        className={clsx("adm-btn", primary && "adm-btn--primary")}
        type="submit"
        disabled={inCorso}
      >
        {inCorso ? "…" : children}
      </button>
      <Esito stato={stato} />
    </form>
  );
}

/**
 * I pulsanti per una proposta di `proposte`.
 *
 * Terzo gemello, con la terza azione (`decidiPropostaSito`), per la stessa
 * ragione per cui `DecisioneContenuto` non è `Decisione`. Porta l'impronta come
 * `Decisione`: si approva quello che è stato guardato.
 *
 * Il social media manager, che guarda la stessa coda senza poter decidere, ha
 * qui il solo «Ritira»: è il modo di togliere una fotografia caricata per
 * sbaglio prima che qualcuno debba rimandarla.
 */
function DecisioneProposta({
  voce,
  verso,
  primary,
  children,
}: {
  voce: VoceCoda;
  verso: "approva" | "rimanda";
  primary?: boolean;
  children: React.ReactNode;
}) {
  const [stato, invia, inCorso] = useActionState(decidiPropostaSito, AZIONE_INIZIALE);
  return (
    <form action={invia} className="adm-comando">
      <input type="hidden" name="tipo" value={voce.tipo} />
      <input type="hidden" name="chiave" value={voce.chiave} />
      <input type="hidden" name="versione" value={voce.versione ?? ""} />
      <input type="hidden" name="verso" value={verso} />
      <button
        className={clsx("adm-btn", primary && "adm-btn--primary")}
        type="submit"
        disabled={inCorso}
      >
        {inCorso ? "…" : children}
      </button>
      <Esito stato={stato} />
    </form>
  );
}

/** Indicatori della coda: calcolati da album e documenti, non scritti a mano. */
export function IndicatoriCoda({
  daApprovare,
  bozze,
  senzaFile,
  escluse,
}: {
  daApprovare: number;
  bozze: number;
  senzaFile: number;
  escluse: number;
}) {
  const celle = [
    { label: "Da approvare", valore: daApprovare, allarme: false },
    { label: "In bozza nelle unità", valore: bozze, allarme: false },
    { label: "Documenti senza file", valore: senzaFile, allarme: true },
    { label: "Foto escluse per consenso", valore: escluse, allarme: false },
  ];

  return (
    <div className="adm-kpi">
      {celle.map((c) => (
        <div className="adm-kpi__cell" key={c.label}>
          <span className="adm-kpi__label">{c.label}</span>
          <span
            className={
              c.allarme && c.valore > 0 ? "adm-kpi__value adm-kpi__value--red" : "adm-kpi__value"
            }
          >
            {c.valore}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Coda({
  voci,
  adesso,
  soloLettura = false,
}: {
  voci: VoceCoda[];
  adesso: number;
  /**
   * La coda vista da chi propone: niente «Approva», niente «Apri e controlla»
   * (porta alle schermate del gestore), niente consensi. Resta «Ritira»
   * sulle proposte di `proposte`.
   */
  soloLettura?: boolean;
}) {
  if (voci.length === 0) {
    return (
      <div className="adm-coda__vuota">
        <strong>{soloLettura ? "Niente in attesa." : "Niente da approvare."}</strong>
        <span>
          {soloLettura
            ? "Quello che salvate compare qui finché un gestore non lo approva o lo " +
              "rimanda. Adesso non c’è niente che aspetta."
            : "Quando un referente di unità o il social media manager manda in revisione un album, " +
              "un documento, un’attività, un testo, una fotografia o l’elenco dei referenti, " +
              "compare qui con l’anteprima e i due pulsanti. Non c’è un elenco separato da " +
              "tenere allineato: la coda è lo stato di quei contenuti."}
        </span>
      </div>
    );
  }

  return (
    <div className="adm-coda">
      {voci.map((v) => {
        // non sulle richieste di ritiro: ritirare non mette online nessuno
        const consensiDaVedere = v.tipo === "album" && !v.proposta && !soloLettura;
        // i due tipi della fase 14 hanno un'altra azione e non hanno consensi:
        // sono testi e nomi di referenti, non fotografie di minori
        const eContenuto = v.tipo === "campo" || v.tipo === "persone";
        const eDelSito = dalSito(v);
        return (
          <article
            className="adm-coda__voce"
            key={`${v.tipo}-${v.chiave}${v.proposta ? "-proposta" : ""}`}
          >
            <div className="adm-coda__testa">
              <span className="adm-coda__tipo">{v.tipo}</span>
              <h3>{v.titolo}</h3>
              <span className="adm-coda__meta">
                {/*
                  Una data che non c'è non diventa il 1970.

                  `quando` è 0 quando la riga non porta un istante — succede se
                  è stata scritta fuori dall'applicazione, o da una versione che
                  quella colonna non riempiva. `quantoFa(0, adesso)` risponde
                  «20696 giorni fa», che non è un'informazione: è una schermata
                  che sembra rotta, e chi la legge smette di fidarsi anche del
                  resto della scheda.
                */}
                {v.ambito} ·{" "}
                {v.quando > 0 ? `inviato ${quantoFa(v.quando, adesso)}` : "data non registrata"}
                {v.autore ? ` da ${v.autore}` : ""}
              </span>
            </div>

            <p className="adm-coda__anteprima">{v.anteprima}</p>

            {v.motivo ? (
              <div className="adm-coda__consensi">
                <span className="adm-coda__consensi-titolo">Il motivo</span>
                <span>{v.motivo}</span>
              </div>
            ) : null}

            {consensiDaVedere ? <Consensi voce={v} /> : null}
            {eContenuto || (eDelSito && v.confronto) ? <Confronto voce={v} /> : null}
            {eDelSito ? <Fotografie voce={v} /> : null}

            {v.tipo === "documento" && !v.conFile ? (
              <div className="adm-coda__consensi adm-coda__consensi--attenzione">
                <span className="adm-coda__consensi-titolo">Manca il file</span>
                <span>Questa voce non ha un allegato: approvarla lascerebbe un pulsante vuoto.</span>
              </div>
            ) : null}

            <div className="adm-coda__azioni">
              {soloLettura ? (
                eDelSito ? (
                  <DecisioneProposta voce={v} verso="rimanda">
                    Ritira la proposta
                  </DecisioneProposta>
                ) : null
              ) : eDelSito ? (
                <>
                  <DecisioneProposta voce={v} verso="approva" primary>
                    {v.approva ?? "Approva e pubblica"}
                  </DecisioneProposta>
                  <DecisioneProposta voce={v} verso="rimanda">
                    Rimanda indietro
                  </DecisioneProposta>
                </>
              ) : eContenuto ? (
                <>
                  <DecisioneContenuto voce={v} verso="approva" primary>
                    Approva e pubblica
                  </DecisioneContenuto>
                  <DecisioneContenuto voce={v} verso="rimanda">
                    Rimanda indietro
                  </DecisioneContenuto>
                </>
              ) : (
                <>
                  <Decisione
                    voce={v}
                    verso="pubblicato"
                    primary
                    conferma={
                      v.tipo === "album"
                        ? "Pubblicare l’album? Le fotografie diventano visibili a chi ha la password dell’album."
                        : undefined
                    }
                  >
                    Approva e pubblica
                  </Decisione>
                  <Decisione voce={v} verso="bozza">
                    Rimanda ai referenti di unità
                  </Decisione>
                </>
              )}
              {soloLettura ? null : (
                <Link className="adm-btn" href={dovePorta(v)}>
                  Apri e controlla
                </Link>
              )}
              {/*
                L'anteprima apre in una scheda nuova: chi approva non deve
                perdere la coda per andare a guardare, e tornare col tasto
                indietro su una lista di decisioni è il modo di premere il
                pulsante sbagliato.
              */}
              {v.anteprimaHref ? (
                <a
                  className="adm-btn"
                  href={v.anteprimaHref}
                  target="_blank"
                  rel="noopener"
                >
                  Anteprima ↗
                </a>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
