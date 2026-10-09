"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { Chips } from "@/components/site/Chips";
import type { Cartella, DocumentoSalvato } from "@/lib/contenuti";
import { ANNI_DOC, labelDiUnita } from "@/lib/data";

/**
 * La pagina Documenti, cartella per cartella.
 *
 * Era un componente client con due filtri, anno e tipo, sopra un elenco unico.
 * Dalla migrazione 0012 i documenti stanno in cartelle che decidono i referenti
 * gruppo — «Tesseramenti», «Campi estivi» — e la pagina diventa quello che la
 * richiesta del 25 settembre 2026 descriveva: si apre una cartella e si trovano
 * tutti i suoi moduli, e la pagina di una cartella ha un indirizzo suo da
 * mandare alle famiglie. Dentro la cartella, dal 6 ottobre 2026 su richiesta
 * dell'utente, torna il filtro per anno, nel browser (quello per unità è
 * stato provato e tolto lo stesso giorno).
 *
 * Dal 6 ottobre 2026, sempre su richiesta dell'utente, le cartelle non hanno
 * più una pagina ciascuna da aprire: `/documenti` è subito l'elenco, ogni
 * cartella è una tendina che si apre sul posto, e le note sotto i documenti non
 * si mostrano più (l'avviso sì). `/documenti/<chiave>` resta valido: rimanda a
 * `/documenti#<chiave>`, che apre quella tendina.
 *
 * ## Dove portano i pulsanti di un documento, e perché non sono sempre due
 *
 * Con il file caricato sono due e fanno quello che dicono: `/documento/<nome>`
 * lo apre, `?scarica=1` lo fa scendere.
 *
 * Senza file **il pulsante è uno solo, e non dice «Scarica»**. Prima ce n'erano
 * due — uno dei quali primario, giallo, in mezzo alla riga — che portavano
 * tutti e due alla pagina di manutenzione: un invito a scaricare una cosa che
 * non c'è. La riga dichiara «in preparazione», e l'unica azione offerta è
 * chiedere il documento ai referenti finché non è online.
 */

const apri = (d: DocumentoSalvato) => `/documento/${d.file}`;

const scarica = (d: DocumentoSalvato) => `/documento/${d.file}?scarica=1`;

/** La pagina che spiega che cosa manca, per il documento che si stava cercando. */
const richiedi = (d: DocumentoSalvato, da: string) =>
  `/manutenzione?cosa=${encodeURIComponent(d.titolo)}&da=${encodeURIComponent(da)}`;

const conta = (n: number) => `${n} ${n === 1 ? "documento" : "documenti"}`;

/** Il valore del filtro che non è un anno. */
const TUTTI = "tutti";

/** L'anno sociale in corso: i suoi documenti stanno con i sempre validi, in testa. */
const ANNO_CORRENTE = ANNI_DOC.find((a) => a.corrente) ?? ANNI_DOC[0];

const etichettaAnno = (chiave: string) =>
  ANNI_DOC.find((a) => a.chiave === chiave)?.label ??
  chiave.replace("-", " – ");

/** Vero per i documenti che valgono adesso: sempre validi, o dell'anno in corso. */
export const inVigore = (d: DocumentoSalvato) =>
  d.anno === null || d.anno === ANNO_CORRENTE.chiave;

// --------------------------------------------------------------------------
// L'elenco: le cartelle come tendine
// --------------------------------------------------------------------------

/** Una riga di documento: icona del formato, titolo e nota, peso, pulsanti. */
function RigaDocumento({
  d,
  conUnita,
  da,
}: {
  d: DocumentoSalvato;
  /** nella cartella delle circolari: di quale unità è */
  conUnita: boolean;
  da: string;
}) {
  return (
    <div className="doc">
      <span
        className={clsx(
          "doc__icon",
          d.formato !== "PDF" && "doc__icon--docx",
          !d.file && "doc__icon--assente",
        )}
      >
        {d.file ? d.formato : "—"}
      </span>
      <span className="doc__main">
        {/* Le circolari sono di un'unità, e il titolo non lo dice sempre: «Lista
            materiale uscita invernale» c'è in ogni unità. */}
        {conUnita && d.unita !== "gruppo" ? (
          <span className="doc__ambito">{labelDiUnita(d.unita)}</span>
        ) : null}
        <span className="doc__title">{d.titolo}</span>
        {/* L'avviso sta qui, sotto il titolo, e non in una riga a parte: viene
            prima di «Scarica» sia a occhio sia per chi legge con lo screen
            reader, ed è letto insieme al documento a cui si riferisce. */}
        {d.avviso ? (
          <span className="doc__avviso" role="note">
            <strong>Attenzione.</strong> {d.avviso}
          </span>
        ) : null}
      </span>
      <span className="doc__meta">
        <span className="doc__updated">
          {d.file ? `agg. ${d.aggiornamento}` : "in preparazione"}
        </span>
        <span className="doc__size">
          {d.file ? d.peso : "file non ancora caricato"}
        </span>
      </span>
      <span className="doc__actions">
        {d.file ? (
          <>
            <a
              className="btn btn--sm"
              href={apri(d)}
              target="_blank"
              rel="noopener"
              aria-label={`Visualizza «${d.titolo}»`}
            >
              Visualizza
            </a>
            <a className="btn btn--sm btn--primary" href={scarica(d)} aria-label={`Scarica «${d.titolo}»`}>
              Scarica
            </a>
          </>
        ) : (
          <a className="btn btn--sm btn--ghost" href={richiedi(d, da)} aria-label={`Come richiedere «${d.titolo}»`}>
            Come richiederlo
          </a>
        )}
      </span>
    </div>
  );
}

/** Un sottogruppo dentro la tendina: «Anno sociale 2026 – 2027 · 3 documenti». */
function Fascia({
  titolo,
  docs,
  conUnita,
  da,
}: {
  titolo: string;
  docs: DocumentoSalvato[];
  conUnita: boolean;
  da: string;
}) {
  return (
    <section className="stack gap-10" aria-label={titolo}>
      <div className="section-rule">
        <span className="eyebrow" style={{ whiteSpace: "nowrap" }}>
          {titolo}
        </span>
        <span className="section-rule__line" aria-hidden="true"></span>
        <span className="section-rule__count">{conta(docs.length)}</span>
      </div>
      <div className="doclist">
        {docs.map((d) => (
          <RigaDocumento d={d} conUnita={conUnita} da={da} key={d.id} />
        ))}
      </div>
    </section>
  );
}

/** Le fasce di una cartella: sempre validi, anno in corso, poi gli anni passati. */
function fasce(docs: DocumentoSalvato[]) {
  const out: { titolo: string; docs: DocumentoSalvato[] }[] = [];
  const sempre = docs.filter((d) => d.anno === null);
  if (sempre.length) out.push({ titolo: "Sempre validi", docs: sempre });
  const anni = [
    ...new Set(docs.map((d) => d.anno).filter((a): a is string => a !== null)),
  ]
    .sort()
    .reverse();
  for (const a of anni) {
    const titolo =
      a === ANNO_CORRENTE.chiave
        ? `Anno ${ANNO_CORRENTE.label}`
        : `Archivio · anno ${etichettaAnno(a)}`;
    out.push({ titolo, docs: docs.filter((d) => d.anno === a) });
  }
  // l'anno in corso subito dopo i sempre validi, l'archivio in fondo
  return out.sort(
    (x, y) =>
      Number(x.titolo.startsWith("Archivio")) -
      Number(y.titolo.startsWith("Archivio")),
  );
}

/**
 * Tutte le cartelle con dei documenti, ciascuna una tendina chiusa con titolo e
 * conteggio; sopra, il filtro per anno, che vale per tutte.
 * Una cartella che con i filtri resta vuota sparisce dall'elenco.
 */
export function ElencoDocumenti({
  cartelle,
  documenti: tutti,
}: {
  cartelle: Cartella[];
  documenti: DocumentoSalvato[];
}) {
  const [anno, setAnno] = useState(TUTTI);

  // `/documenti#tesseramenti` (anche dal vecchio indirizzo della cartella) la apre
  useEffect(() => {
    const apriDaHash = () => {
      const chiave = decodeURIComponent(window.location.hash.slice(1));
      const el = chiave ? document.getElementById(chiave) : null;
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    apriDaHash();
    window.addEventListener("hashchange", apriDaHash);
    return () => window.removeEventListener("hashchange", apriDaHash);
  }, []);

  /*
   * Il filtro per anno: un anno mostra i suoi documenti più i sempre validi.
   * Con il filtro attivo le tendine che hanno qualcosa si aprono da sole.
   */
  const anniPresenti = [
    ...new Set(tutti.map((d) => d.anno).filter((a): a is string => a !== null)),
  ].sort((a, b) => b.localeCompare(a));
  const documenti = tutti.filter(
    (d) => anno === TUTTI || d.anno === null || d.anno === anno,
  );
  const filtrato = anno !== TUTTI;

  const voci = cartelle
    .map((c) => ({
      c,
      docs: documenti.filter((d) => d.categoria === c.chiave),
    }))
    .filter((v) => v.docs.length > 0);

  if (tutti.length === 0) {
    return (
      <div className="empty">
        <strong>Label</strong>
        <span>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
          incididunt ut labore et dolore magna aliqua. Ut.
        </span>
      </div>
    );
  }

  return (
    <div className="stack gap-34">
      <div className="stack gap-14">
        {anniPresenti.length > 0 ? (
          <div className="stack gap-10">
            <span className="eyebrow" id="filtro-anno">
              Anno
            </span>
            <Chips
              chips={[
                { chiave: TUTTI, label: "Tutti" },
                ...anniPresenti.map((a) => ({
                  chiave: a,
                  label: etichettaAnno(a),
                  tone: a === ANNO_CORRENTE.chiave ? "corrente" : undefined,
                })),
              ]}
              attivo={anno}
              onSelect={setAnno}
              labelledBy="filtro-anno"
            />
          </div>
        ) : null}
        {filtrato ? (
          <p className="note">
            Con l’anno scelto restano anche i documenti sempre validi.
          </p>
        ) : null}
      </div>

      {voci.length === 0 && filtrato ? (
        <div className="empty">
          <strong>Nessun documento con questi filtri</strong>
          <span>
            <button
              className="btn btn--sm btn--ghost"
              type="button"
              onClick={() => {
                setAnno(TUTTI);
              }}
            >
              Togli i filtri
            </button>
          </span>
        </div>
      ) : null}

      <div className="tendine">
        {voci.map(({ c, docs }) => {
          const conUnita = docs.some((d) => d.unita !== "gruppo");
          const da = `/documenti#${c.chiave}`;
          return (
            <details
              className="tendina"
              id={c.chiave}
              // al cambio dei filtri la tendina rinasce: aperta se filtrata
              key={`${c.chiave}-${anno}`}
              open={filtrato || undefined}
            >
              <summary className="tendina__testa">
                <span className="h3 tendina__titolo">{c.titolo}</span>
                <span className="tendina__conta">{conta(docs.length)}</span>
                <span className="tendina__freccia" aria-hidden="true">
                  ▾
                </span>
              </summary>
              <div className="tendina__corpo stack gap-22">
                {fasce(docs).map((f) => (
                  <Fascia
                    titolo={f.titolo}
                    docs={f.docs}
                    conUnita={conUnita}
                    da={da}
                    key={f.titolo}
                  />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
