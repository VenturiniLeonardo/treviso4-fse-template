"use client";

import { useActionState, useState } from "react";
import { salvaDomande } from "@/app/(area)/area-riservata/pagine/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";
import {
  FASCE_FAQ,
  COLORI_FAQ,
  DOMANDA_MAX,
  LINK_CODA_MAX,
  LINK_TESTO_MAX,
  PAGINE_COLLEGABILI,
  RISPOSTA_MAX,
  type VoceFaq,
} from "@/lib/faq-contenuti";

/**
 * Le domande frequenti della pagina Contatti.
 *
 * Il quarto editor di elenco dell'area, dopo persone d'unità, attività e utenti,
 * e l'ultimo contenuto editoriale del sito a diventare modificabile.
 *
 * ## Due righe vuote in fondo, come per le persone
 *
 * Aggiungere una riga è un gesto di JavaScript, e l'area riservata funziona anche
 * senza. Con due caselle vuote sempre presenti si aggiungono due domande per
 * salvataggio a JavaScript spento; con JavaScript «Aggiungi una domanda» ne mette
 * quante se ne vuole. Le voci senza domanda le scarta il server.
 *
 * ## Il collegamento è un menù, non una casella
 *
 * Una risposta può finire con un collegamento a una pagina del sito. L'indirizzo
 * si **scegli** fra le pagine esistenti: un campo libero in una pagina pubblica è
 * un posto dove mettere un indirizzo che porta altrove, e un link che parte dal
 * sito del gruppo si porta dietro la fiducia del gruppo. Il database lo
 * garantisce comunque con un `CHECK`; il menù fa in modo che nessuno debba
 * provarci.
 */

const VUOTA: VoceFaq = { domanda: "", risposta: "", fascia: "gruppo" };

const VUOTE_IN_FONDO = 2;

export function DomandeFrequenti({
  voci,
  dalCodice,
  inCoda = false,
  inAttesa = false,
}: {
  voci: VoceFaq[];
  /** vero se l'elenco è ancora quello del progetto: la nota lo dichiara */
  dalCodice: boolean;
  /** chi salva propone soltanto: il social media manager (`vaInCoda`) */
  inCoda?: boolean;
  /** se c'è già un elenco proposto che aspetta un gestore */
  inAttesa?: boolean;
}) {
  const [stato, invia, inCorso] = useActionState(salvaDomande, AZIONE_INIZIALE);
  const [righe, setRighe] = useState<VoceFaq[]>([
    ...voci,
    ...Array.from({ length: VUOTE_IN_FONDO }, () => ({ ...VUOTA })),
  ]);

  const cambia = (i: number, patch: Partial<VoceFaq>) =>
    setRighe((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const cambiaLink = (i: number, patch: Partial<NonNullable<VoceFaq["link"]>>) =>
    setRighe((r) =>
      r.map((x, j) => {
        if (j !== i) return x;
        const link = { testo: "", href: "", coda: "", ...x.link, ...patch };
        // togliendo l'indirizzo si toglie tutto il collegamento: le tre parti
        // stanno o cadono insieme, e un testo senza indirizzo sarebbe una parola
        // che sembra un link
        return link.href === "" ? { ...x, link: undefined } : { ...x, link };
      }),
    );

  return (
    <form className="adm-form" action={invia}>
      <h2>Domande frequenti</h2>
      <span className="adm-note">
        Compaiono nella pagina <strong>Contatti</strong>, come riquadri che si aprono.{" "}
        {inCoda
          ? "L’elenco intero va ai gestori: nella pagina restano le domande di adesso " +
            "finché non lo approvano."
          : "Le modifiche vanno online appena salvate."}
        {inAttesa ? (
          <>
            {" "}
            <strong>
              {inCoda
                ? "Qui sotto c’è il vostro elenco, in attesa di approvazione: nella pagina ci " +
                  "sono ancora le domande di prima. Salvando, prende il posto di quello in attesa."
                : "C’è un elenco in attesa di approvazione, nella coda: salvando da qui, le " +
                  "domande vanno online subito e quello in attesa resta in coda."}
            </strong>
          </>
        ) : null}
        {dalCodice ? (
          <>
            {" "}
            <strong>Adesso sono quelle del progetto.</strong> Al primo salvataggio l’elenco
            diventa vostro: da quel momento le domande stanno nel database, e correggerle
            nel codice non cambia più il sito. Svuotando l’elenco ci si torna.
          </>
        ) : null}
      </span>

      {righe.map((v, i) => (
        /*
          Una scheda per domanda, con la striscia del suo colore: in fila, le
          caselle di dieci domande si confondevano, e non si capiva dove finisse
          una e cominciasse l'altra.
        */
        <fieldset
          key={i}
          className="adm-faq"
          style={{ "--colore": COLORI_FAQ[v.fascia] } as React.CSSProperties}
        >
          <legend className="visually-hidden">Domanda {i + 1}</legend>
          <div className="adm-faq__testa">
            <span className="adm-faq__numero" aria-hidden="true">
              {i + 1}
            </span>
            <span className="adm-faq__anteprima">{v.domanda || "Nuova domanda"}</span>
            <button
              className="adm-faq__togli"
              type="button"
              onClick={() => setRighe((x) => x.filter((_, j) => j !== i))}
            >
              Togli
              <span className="visually-hidden"> la domanda {i + 1}</span>
            </button>
          </div>
          <div className="adm-form__grid">
          <label className="adm-field adm-field--larga">
            <span className="adm-field__label">Domanda</span>
            <input
              type="text"
              name={`domanda-${i}`}
              value={v.domanda}
              maxLength={DOMANDA_MAX}
              onChange={(e) => cambia(i, { domanda: e.target.value })}
              aria-invalid={stato.campo === `domanda-${i}` || undefined}
            />
          </label>

          <label className="adm-field adm-field--larga">
            <span className="adm-field__label">Risposta</span>
            <textarea
              name={`risposta-${i}`}
              rows={4}
              value={v.risposta}
              maxLength={RISPOSTA_MAX}
              onChange={(e) => cambia(i, { risposta: e.target.value })}
              aria-invalid={stato.campo === `risposta-${i}` || undefined}
            />
          </label>

          <label className="adm-field">
            <span className="adm-field__label">Colore della striscia</span>
            <select
              name={`fascia-${i}`}
              value={v.fascia}
              onChange={(e) => cambia(i, { fascia: e.target.value as VoceFaq["fascia"] })}
            >
              {FASCE_FAQ.map((b) => (
                <option value={b.chiave} key={b.chiave}>
                  {b.label}
                </option>
              ))}
            </select>
            <span className="adm-field__hint">
              È solo la riga colorata a sinistra del riquadro, come qui.
            </span>
          </label>

          <label className="adm-field">
            <span className="adm-field__label">Rimanda a una pagina</span>
            <select
              name={`link-${i}`}
              value={v.link?.href ?? ""}
              onChange={(e) => cambiaLink(i, { href: e.target.value })}
              aria-invalid={stato.campo === `link-${i}` || undefined}
            >
              <option value="">nessun collegamento</option>
              {PAGINE_COLLEGABILI.map((p) => (
                <option value={p.href} key={p.href}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="adm-field__hint">
              Solo pagine di questo sito: è un menù e non una casella di proposito.
            </span>
          </label>

          {v.link ? (
            <>
              <label className="adm-field">
                <span className="adm-field__label">Testo del collegamento</span>
                <input
                  type="text"
                  name={`linkTesto-${i}`}
                  value={v.link.testo}
                  maxLength={LINK_TESTO_MAX}
                  onChange={(e) => cambiaLink(i, { testo: e.target.value })}
                  aria-invalid={stato.campo === `linkTesto-${i}` || undefined}
                />
                <span className="adm-field__hint">Le parole su cui si clicca.</span>
              </label>
              <label className="adm-field">
                <span className="adm-field__label">Come finisce la frase</span>
                <input
                  type="text"
                  name={`linkCoda-${i}`}
                  value={v.link.coda}
                  maxLength={LINK_CODA_MAX}
                  onChange={(e) => cambiaLink(i, { coda: e.target.value })}
                />
                <span className="adm-field__hint">
                  Di solito un punto: viene stampato subito dopo il collegamento.
                </span>
              </label>
            </>
          ) : (
            <>
              {/* il server legge i tre campi per ogni indice: mandarli vuoti è
                  meglio che far dipendere il server dalla presenza del link */}
              <input type="hidden" name={`linkTesto-${i}`} value="" />
              <input type="hidden" name={`linkCoda-${i}`} value="" />
            </>
          )}

          </div>
        </fieldset>
      ))}

      <button
        className="adm-faq__aggiungi"
        type="button"
        onClick={() => setRighe((r) => [...r, { ...VUOTA }])}
      >
        + Aggiungi una domanda
      </button>

      <Esito stato={stato} />

      <div className="adm-form__actions adm-testi__salva">
        <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
          {inCorso ? "Salvataggio…" : inCoda ? "Invia ai gestori" : "Salva le domande"}
        </button>
      </div>
    </form>
  );
}
