"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { salvaPagine } from "@/app/(area)/area-riservata/pagine/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";
import {
  CAMPI_PAGINE,
  type CampoPagina,
  type DefinizionePagina,
  GRUPPI_PAGINE,
} from "@/lib/pagine-contenuti";

/**
 * I testi di Home e Chi siamo.
 *
 * Un modulo solo, diviso in due gruppi con l'indirizzo della pagina accanto al
 * titolo: chi scrive deve poter aprire quello che sta cambiando, e un modulo di
 * dieci caselle senza un riferimento visivo è un modulo in cui si sbaglia
 * casella.
 *
 * ## Che cosa non c'è, e perché si vede
 *
 * Le tre fasce, i quattro pilastri, i quattro riquadri «cosa facciamo», i
 * contatori, le schede e la storia non sono qui: sono griglie di disegno, e un
 * modulo che permette di averne cinque produce una pagina rotta, non un
 * contenuto diverso. La nota in cima lo dice, invece di lasciar cercare le
 * caselle che mancano.
 */

function Campo({
  campo,
  valore,
  personalizzato,
  inAttesa,
  propone,
  erroreSu,
}: {
  campo: DefinizionePagina;
  valore: string;
  personalizzato: boolean;
  /** il testo proposto che aspetta un gestore, se c'è */
  inAttesa?: string;
  /**
   * Chi guarda propone: nella casella va la sua proposta, non il testo online.
   * Il perché è quello del `Campo` della scheda d'unità: il modulo rimanda
   * tutti i campi, e rimandare il testo online ritira la proposta.
   */
  propone?: boolean;
  erroreSu?: string;
}) {
  const proprio = propone && inAttesa !== undefined;
  const nellaCasella = proprio ? inAttesa : valore;
  const grande = campo.tipo !== "riga";
  const righe = campo.tipo === "righe" ? 3 : campo.max > 1000 ? 12 : 5;
  const abbrevia = (t: string) => (t.length > 120 ? `${t.slice(0, 120)}…` : t);

  /*
   * Etichetta e spiegazione a sinistra, casella a destra: chi scrive vede su
   * quale campo sta lavorando e che cosa fa, senza che la frase di aiuto si
   * intrometta fra due caselle. Lo stato — «originale» o «modificato» — è una
   * pastiglia accanto al nome, non una frase in fondo.
   *
   * La casella porta anche `adm-field`: senza, textarea e input uscivano con
   * il vestito del browser — carattere a spaziatura fissa e fondo chiaro anche
   * nel tema scuro — in mezzo a una schermata disegnata.
   */
  const [lunghezza, setLunghezza] = useState(nellaCasella.length);
  const quasiPieno = lunghezza > campo.max * 0.9;
  // «Annulla» rimette i testi senza passare da `onInput`: il conto va rifatto
  const casella = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    const modulo = casella.current?.form;
    if (!modulo) return;
    const rifai = () => setTimeout(() => setLunghezza(casella.current?.value.length ?? 0));
    modulo.addEventListener("reset", rifai);
    return () => modulo.removeEventListener("reset", rifai);
  }, []);

  return (
    <div className={proprio || inAttesa !== undefined ? "adm-testo adm-testo--attesa" : "adm-testo"}>
      <div className="adm-testo__etichetta">
        <span className="adm-testo__titolo">
          <label htmlFor={`testo-${campo.chiave}`} className="adm-field__label">
            {campo.label}
          </label>
          <span className={personalizzato ? "adm-pill adm-pill--ok" : "adm-pill adm-pill--draft"}>
            {personalizzato ? "modificato" : "originale"}
          </span>
        </span>
        <span className="adm-testo__aiuto">{campo.hint}</span>
      </div>
      <div className="adm-testo__campo adm-field">
        {grande ? (
          <textarea
            ref={casella}
            id={`testo-${campo.chiave}`}
            name={campo.chiave}
            rows={righe}
            defaultValue={nellaCasella}
            maxLength={campo.max}
            onInput={(e) => setLunghezza(e.currentTarget.value.length)}
            aria-invalid={erroreSu === campo.chiave || undefined}
          />
        ) : (
          <input
            ref={casella}
            id={`testo-${campo.chiave}`}
            type="text"
            name={campo.chiave}
            defaultValue={nellaCasella}
            maxLength={campo.max}
            onInput={(e) => setLunghezza(e.currentTarget.value.length)}
            aria-invalid={erroreSu === campo.chiave || undefined}
          />
        )}
        <span className={quasiPieno ? "adm-testo__conto is-pieno" : "adm-testo__conto"} aria-live="polite">
          {lunghezza} / {campo.max}
        </span>
        {/*
          Come nella scheda dell'unità: la casella mostra quello che è online, e
          la proposta si dichiara accanto. Mettere il proposto nella casella
          farebbe credere che sia già sul sito.
        */}
        {proprio ? (
          <p className="adm-testo__attesa">
            <span className="adm-pill adm-pill--wait">in attesa</span>
            Nella casella c’è la vostra proposta. Sul sito adesso: «{abbrevia(valore)}»
          </p>
        ) : inAttesa !== undefined ? (
          <p className="adm-testo__attesa">
            <span className="adm-pill adm-pill--wait">in attesa</span>
            Proposta da approvare: «{abbrevia(inAttesa) || "testo originale"}»
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function TestiPagine({
  valori,
  personalizzati,
  inCoda = false,
  inAttesa = {},
  domande,
}: {
  valori: Record<CampoPagina, string>;
  personalizzati: string[];
  /** chi salva propone soltanto: il social media manager (`vaInCoda`) */
  inCoda?: boolean;
  /** i testi proposti che aspettano, per campo */
  inAttesa?: Partial<Record<CampoPagina, string>>;
  /** la scheda delle domande frequenti: ha il suo modulo e il suo salvataggio */
  domande?: React.ReactNode;
}) {
  const modificato = new Set(personalizzati);
  const [scheda, setScheda] = useState<string>(GRUPPI_PAGINE[0].chiave);

  return (
    <>
      <ul className="adm-testi__guida">
        <li>Una scheda per pagina: ogni scheda ha il suo pulsante per salvare.</li>
        <li>
          Svuotando una casella si torna al <strong>testo originale</strong> del sito.
        </li>
        {inCoda ? (
          <li>
            Le modifiche <strong>vanno ai gestori</strong>, una per campo: sul sito resta il
            testo di adesso finché non le approvano.
          </li>
        ) : (
          <li>Le modifiche vanno online appena salvate.</li>
        )}
      </ul>

      <div className="adm-schede" role="tablist" aria-label="Pagine del sito">
        {GRUPPI_PAGINE.map((g) => (
          <button
            key={g.chiave}
            type="button"
            role="tab"
            id={`scheda-${g.chiave}`}
            aria-selected={scheda === g.chiave}
            aria-controls={`pannello-${g.chiave}`}
            className={scheda === g.chiave ? "adm-scheda is-attiva" : "adm-scheda"}
            onClick={() => setScheda(g.chiave)}
          >
            {g.titolo}
          </button>
        ))}
        {domande ? (
          <button
            type="button"
            role="tab"
            id="scheda-domande"
            aria-selected={scheda === "domande"}
            aria-controls="pannello-domande"
            className={scheda === "domande" ? "adm-scheda is-attiva" : "adm-scheda"}
            onClick={() => setScheda("domande")}
          >
            Domande frequenti
          </button>
        ) : null}
      </div>

      {GRUPPI_PAGINE.map((g) => (
        <div
          key={g.chiave}
          role="tabpanel"
          id={`pannello-${g.chiave}`}
          aria-labelledby={`scheda-${g.chiave}`}
          hidden={scheda !== g.chiave}
        >
          <ModuloPagina
            gruppo={g}
            valori={valori}
            modificato={modificato}
            inCoda={inCoda}
            inAttesa={inAttesa}
          />
        </div>
      ))}

      {domande ? (
        <div role="tabpanel" id="pannello-domande" aria-labelledby="scheda-domande" hidden={scheda !== "domande"}>
          {domande}
        </div>
      ) : null}

      <details className="adm-note adm-testi__nota">
        <summary>Che cosa non si cambia da qui</summary>
        <p>
          I blocchi a griglia — le tre fasce, i quattro pilastri, i quattro riquadri «cosa
          facciamo», i contatori, le schede e la storia — sono disegno prima che testo, e ogni voce
          è legata a un colore o a un numero della pagina. Si cambiano nel codice, che per una
          griglia disegnata una volta è la frequenza giusta.
        </p>
      </details>
    </>
  );
}

/** Il modulo di una pagina: i suoi campi, e il suo pulsante di salvataggio. */
function ModuloPagina({
  gruppo: g,
  valori,
  modificato,
  inCoda,
  inAttesa,
}: {
  gruppo: (typeof GRUPPI_PAGINE)[number];
  valori: Record<CampoPagina, string>;
  modificato: Set<string>;
  inCoda: boolean;
  inAttesa: Partial<Record<CampoPagina, string>>;
}) {
  const [stato, invia, inCorso] = useActionState(salvaPagine, AZIONE_INIZIALE);
  const campi = CAMPI_PAGINE.filter((c) => c.chiave.startsWith(`${g.chiave}.`));

  return (
    <form className="adm-form" action={invia}>
      <div className="adm-table__head">
        <h2>{g.titolo}</h2>
        <span className="adm-table__meta">
          {campi.length} testi · {campi.filter((c) => modificato.has(c.chiave)).length} modificati
        </span>
        <a href={g.pagina} target="_blank" rel="noreferrer" className="adm-btn adm-testi__apri">
          Apri la pagina ↗
        </a>
      </div>

      <div className="adm-testi">
        {campi.map((c) => (
          <Campo
            key={c.chiave}
            campo={c}
            valore={valori[c.chiave]}
            personalizzato={modificato.has(c.chiave)}
            inAttesa={inAttesa[c.chiave]}
            propone={inCoda}
            erroreSu={stato.campo}
          />
        ))}
      </div>

      <Esito stato={stato} />

      <div className="adm-form__actions adm-testi__salva">
        <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
          {inCorso ? "Salvataggio…" : inCoda ? "Invia ai gestori" : `Salva «${g.titolo}»`}
        </button>
        <button className="adm-btn" type="reset">
          Annulla
        </button>
      </div>
    </form>
  );
}
