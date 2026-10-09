"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { salvaReferente, salvaScheda, togliReferente } from "@/app/(area)/area-riservata/unita/actions";
import { Esito } from "@/components/area/Esito";
import { Icona } from "@/components/area/Icone";
import { AZIONE_INIZIALE } from "@/lib/contenuti";

/**
 * Tutti i referenti del gruppo, unità per unità.
 *
 * ## Che cosa è cambiato
 *
 * «Referenti e recapiti» era la scheda di **una** unità alla volta — testi, recapiti
 * e tre elenchi di nomi — e per sapere chi guida che cosa bisognava passare le
 * sei unità una per una. Adesso i testi stanno in «Unità», e qui c'è l'elenco di
 * chi c'è, tutto insieme:
 *
 *  - un riquadro per ogni referente, con il suo ruolo e da quando;
 *  - l'**unità** di un referente si cambia dal suo riquadro: sposta il nome da un
 *    elenco all'altro, senza doverlo riscrivere;
 *  - «Nuovo referente» aggiunge una persona;
 *  - in cima a ogni unità, il **contatto** che la pagina Contatti mostra alle
 *    famiglie: chi, con che ruolo, a quale numero.
 *
 * Le modifiche vanno online appena salvate: questa schermata la usa chi
 * pubblica (`completo` sulla riga `referenti`). I referenti di unità propongono il proprio
 * elenco dalla loro scheda, e la proposta passa dalla coda.
 *
 * I controlli veri stanno nelle azioni; qui si nasconde e si spiega.
 */

export interface ReferenteVoce {
  tipo: "responsabile" | "staff";
  /** la posizione nell'elenco di quell'unità e di quel tipo */
  indice: number;
  nome: string;
  ruolo: string;
  periodo: string;
}

export interface UnitaReferenti {
  chiave: string;
  nome: string;
  colore: string;
  /** il colore del testo sopra `colore`: nero sul giallo, bianco sugli altri */
  sopra: string;
  contatto: { referente: string; ruoloReferente: string; telefono: string };
  referenti: ReferenteVoce[];
  /** vero se c'è una proposta di un referente di unità in attesa su questa unità */
  inAttesa: boolean;
}

const TIPO_ETICHETTA = { responsabile: "Responsabile", staff: "Staff" } as const;

export function ElencoReferenti({
  unita,
  scelte,
  percorso,
}: {
  unita: UnitaReferenti[];
  scelte: string[];
  percorso: string;
}) {
  const [aperto, setAperto] = useState(false);
  const totale = unita.reduce((n, u) => n + u.referenti.length, 0);

  const indirizzo = (lista: string[]) =>
    lista.length > 0 ? `${percorso}?u=${lista.join(",")}` : percorso;
  const conUnita = (k: string) =>
    indirizzo(scelte.includes(k) ? scelte.filter((x) => x !== k) : [...scelte, k]);

  const visibili = scelte.length === 0 ? unita : unita.filter((u) => scelte.includes(u.chiave));

  return (
    <>
      <div className="adm-filtri">
        <div className="adm-filtri__riga">
          <span className="adm-filtri__etichetta">Unità</span>
          <Link
            className={scelte.length === 0 ? "adm-pillfiltro is-attivo" : "adm-pillfiltro"}
            href={percorso}
          >
            Tutte
          </Link>
          {unita.map((u) => (
            <Link
              key={u.chiave}
              className={scelte.includes(u.chiave) ? "adm-pillfiltro is-attivo" : "adm-pillfiltro"}
              href={conUnita(u.chiave)}
              aria-pressed={scelte.includes(u.chiave)}
            >
              {u.nome}
              {/* il pallino dice «qui c'è qualcosa in attesa», senza aprire */}
              {u.inAttesa ? " ●" : ""}
            </Link>
          ))}
        </div>
      </div>

      <div className="adm-table__head">
        <h2>Referenti</h2>
        <span className="adm-table__meta">
          {totale} {totale === 1 ? "referente" : "referenti"} in {unita.length} unità
        </span>
        <button
          type="button"
          className="adm-btn adm-btn--primary"
          aria-expanded={aperto}
          onClick={() => setAperto((x) => !x)}
        >
          {aperto ? "Chiudi" : "+ Nuovo referente"}
        </button>
      </div>

      {aperto ? <NuovoReferente unita={unita} onFatto={() => setAperto(false)} /> : null}

      {visibili.map((u) => (
        <section
          className="adm-referenti__unita"
          key={u.chiave}
          style={{ ["--colore" as string]: u.colore, ["--sopra" as string]: u.sopra }}
        >
          <header className="adm-referenti__testa">
            <h3>{u.nome}</h3>
            <span className="adm-table__meta">
              {u.referenti.length} {u.referenti.length === 1 ? "referente" : "referenti"}
            </span>
          </header>

          <Contatto unita={u} />

          <div className="adm-referenti__griglia">
            {u.referenti.map((c) => (
              <ReferenteScheda key={`${c.tipo}-${c.indice}-${c.nome}`} referente={c} da={u} unita={unita} />
            ))}
            {u.referenti.length === 0 ? (
              <p className="adm-note">Nessun referente: la pagina mostra i nomi del progetto.</p>
            ) : null}
          </div>
        </section>
      ))}
    </>
  );
}

// --------------------------------------------------------------------------

/** I campi di un referente, per il modulo di creazione e quello di modifica. */
function CampiReferente({
  predefinito,
  unita,
  unitaCorrente,
  stato,
}: {
  predefinito?: ReferenteVoce;
  unita: UnitaReferenti[];
  unitaCorrente?: string;
  stato: { campo?: string };
}) {
  return (
    <div className="adm-form__grid">
      <label className="adm-field">
        <span className="adm-field__label">Nome e cognome</span>
        <input
          type="text"
          name="nome"
          defaultValue={predefinito?.nome ?? ""}
          maxLength={80}
          required
          aria-invalid={stato.campo === "nome" || undefined}
        />
      </label>
      <label className="adm-field">
        <span className="adm-field__label">Ruolo</span>
        <input
          type="text"
          name="ruolo"
          defaultValue={predefinito?.ruolo ?? ""}
          maxLength={60}
          placeholder="Ref1, Referente di unità…"
        />
        <span className="adm-field__hint">Come lo chiama l’unità: «Ref1», «Referente di unità».</span>
      </label>
      <label className="adm-field">
        <span className="adm-field__label">Unità</span>
        <select name="unitaNuova" defaultValue={unitaCorrente ?? unita[0]?.chiave} required>
          {unita.map((u) => (
            <option value={u.chiave} key={u.chiave}>
              {u.nome}
            </option>
          ))}
        </select>
        {predefinito ? (
          <span className="adm-field__hint">
            Cambiandola, il referente passa all’altra unità: compare lì, e non più qui.
          </span>
        ) : null}
      </label>
      <label className="adm-field">
        <span className="adm-field__label">Funzione</span>
        <select name="tipoNuovo" defaultValue={predefinito?.tipo ?? "responsabile"} required>
          <option value="responsabile">Responsabile (guida l’unità)</option>
          <option value="staff">Staff (affianca i responsabili)</option>
        </select>
      </label>
      <label className="adm-field">
        <span className="adm-field__label">Da quando</span>
        <input
          type="text"
          name="periodo"
          defaultValue={predefinito?.periodo ?? ""}
          maxLength={40}
          placeholder="dal 2022"
        />
      </label>
    </div>
  );
}

function NuovoReferente({ unita, onFatto }: { unita: UnitaReferenti[]; onFatto: () => void }) {
  const [stato, invia, inCorso] = useActionState(salvaReferente, AZIONE_INIZIALE);
  const modulo = useRef<HTMLFormElement>(null);
  // dopo l'aggiunta le caselle si svuotano: lasciare il nome lì inviterebbe ad aggiungerlo due volte
  useEffect(() => {
    if (stato.stato === "fatto") modulo.current?.reset();
  }, [stato]);
  return (
    <form className="adm-form" action={invia} ref={modulo}>
      <h3>Nuovo referente</h3>
      <span className="adm-note">
        Compare subito nella pagina dell’unità. Il ritratto si carica dopo, da «Foto del sito».
      </span>
      <CampiReferente unita={unita} stato={stato} />
      <Esito stato={stato} />
      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" disabled={inCorso}>
          {inCorso ? "Salvataggio…" : "Aggiungi il referente"}
        </button>
        <button className="adm-btn" type="button" onClick={onFatto}>
          Chiudi
        </button>
      </div>
    </form>
  );
}

/** Il riquadro di un referente, con la matita e il cestino. */
function ReferenteScheda({ referente, da, unita }: { referente: ReferenteVoce; da: UnitaReferenti; unita: UnitaReferenti[] }) {
  const [modifica, setModifica] = useState(false);
  const [stato, salva, inCorso] = useActionState(salvaReferente, AZIONE_INIZIALE);
  const [statoTogli, togli, togliendo] = useActionState(togliReferente, AZIONE_INIZIALE);

  return (
    <article className="adm-referente">
      {modifica ? (
        <form action={salva} className="adm-referente__modulo">
          <input type="hidden" name="unita" value={da.chiave} />
          <input type="hidden" name="tipo" value={referente.tipo} />
          <input type="hidden" name="indice" value={referente.indice} />
          <input type="hidden" name="nomeAtteso" value={referente.nome} />
          <CampiReferente predefinito={referente} unita={unita} unitaCorrente={da.chiave} stato={stato} />
          <Esito stato={stato} />
          <div className="adm-form__actions">
            <button className="adm-btn adm-btn--primary" disabled={inCorso}>
              {inCorso ? "Salvataggio…" : "Salva"}
            </button>
            <button className="adm-btn" type="button" onClick={() => setModifica(false)}>
              Annulla
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="adm-referente__testa">
            <span className="adm-referente__iniziali" aria-hidden="true">
              {/* «Ref1 — Sara Villa»: le iniziali sono della persona, dopo il ruolo */}
              {(referente.nome.split("—").pop() ?? "")
                .split(/\s+/)
                .filter((p) => /^\p{L}/u.test(p))
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase()}
            </span>
            <span className="adm-referente__nome">
              <strong>{referente.nome}</strong>
              <span className="c-muted">
                {[referente.ruolo, referente.periodo].filter(Boolean).join(" · ") || "—"}
              </span>
            </span>
          </div>
          <span className="adm-pill adm-pill--draft">{TIPO_ETICHETTA[referente.tipo]}</span>
          <span className="adm-referente__azioni">
            <button
              type="button"
              className="adm-iconbtn"
              aria-label={`Modifica ${referente.nome}`}
              title="Modifica o sposta di unità"
              onClick={() => setModifica(true)}
            >
              <Icona nome="matita" />
            </button>
            <form
              action={togli}
              onSubmit={(e) => {
                const ultimo = da.referenti.filter((c) => c.tipo === referente.tipo).length === 1;
                const testo =
                  `Togliere ${referente.nome} da ${da.nome}?` +
                  (ultimo
                    ? " È l’ultimo di questo elenco: la pagina mostrerà di nuovo i nomi predefiniti."
                    : "");
                if (!window.confirm(testo)) e.preventDefault();
              }}
            >
              <input type="hidden" name="unita" value={da.chiave} />
              <input type="hidden" name="tipo" value={referente.tipo} />
              <input type="hidden" name="indice" value={referente.indice} />
              <input type="hidden" name="nomeAtteso" value={referente.nome} />
              <button
                className="adm-iconbtn"
                aria-label={`Togli ${referente.nome}`}
                title="Togli"
                disabled={togliendo}
              >
                <Icona nome="cestino" />
              </button>
            </form>
          </span>
          <Esito stato={statoTogli} />
        </>
      )}
    </article>
  );
}

/**
 * Il contatto che la pagina Contatti dà alle famiglie, per unità.
 *
 * Sono tre campi della scheda — chi, che ruolo, che numero — e si salvano con la
 * stessa azione della scheda (`salvaScheda`): il modulo manda solo questi, e
 * l'azione non tocca quelli che non vede. Il telefono si può lasciare vuoto: la
 * pagina Contatti non lo scrive.
 */
function Contatto({ unita: u }: { unita: UnitaReferenti }) {
  const [modifica, setModifica] = useState(false);
  const [stato, salva, inCorso] = useActionState(salvaScheda, AZIONE_INIZIALE);
  const c = u.contatto;

  return (
    <div className="adm-referenti__contatto">
      {modifica ? (
        <form action={salva} className="adm-form adm-form--incassato">
          <input type="hidden" name="unita" value={u.chiave} />
          <h4>Contatto per le famiglie</h4>
          <div className="adm-form__grid">
            <label className="adm-field">
              <span className="adm-field__label">Chi risponde</span>
              <input type="text" name="referente" defaultValue={c.referente} maxLength={80} />
              <span className="adm-field__hint">Come compare in Contatti: «Ref1 — Mario Rossi».</span>
            </label>
            <label className="adm-field">
              <span className="adm-field__label">Come si chiama il ruolo</span>
              <input type="text" name="ruoloReferente" defaultValue={c.ruoloReferente} maxLength={40} />
              <span className="adm-field__hint">«Referente di unità», «Responsabile», «Coordinatore».</span>
            </label>
            <label className="adm-field">
              <span className="adm-field__label">Telefono</span>
              <input type="tel" name="telefono" defaultValue={c.telefono} maxLength={40} />
              <span className="adm-field__hint">Facoltativo: vuoto, il numero non compare.</span>
            </label>
          </div>
          <Esito stato={stato} />
          <div className="adm-form__actions">
            <button className="adm-btn adm-btn--primary" disabled={inCorso}>
              {inCorso ? "Salvataggio…" : "Salva il contatto"}
            </button>
            <button className="adm-btn" type="button" onClick={() => setModifica(false)}>
              Chiudi
            </button>
          </div>
        </form>
      ) : (
        <>
          <span className="adm-referenti__contatto-etichetta">Contatto per le famiglie</span>
          <span className="adm-referenti__contatto-valore">
            {c.referente ? <strong>{c.referente}</strong> : <span className="c-muted">nessun nome</span>}
            {c.ruoloReferente ? <span className="c-muted"> · {c.ruoloReferente}</span> : null}
            {c.telefono ? <span> · {c.telefono}</span> : <span className="c-muted"> · senza telefono</span>}
          </span>
          <button
            type="button"
            className="adm-iconbtn"
            aria-label={`Modifica il contatto di ${u.nome}`}
            title="Modifica il contatto"
            onClick={() => setModifica(true)}
          >
            <Icona nome="matita" />
          </button>
        </>
      )}
    </div>
  );
}
