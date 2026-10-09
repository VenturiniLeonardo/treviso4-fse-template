"use client";

import { useActionState } from "react";
import {
  caricaImmagine,
  mostraImmagine,
  nascondiImmagine,
  rimuoviImmagine,
} from "@/app/(area)/area-riservata/immagini/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE, type StatoAzione } from "@/lib/contenuti";
import { indirizzoInAttesa } from "@/lib/proposte";
import type { Slot } from "@/lib/slot-immagini";
import { TAGLIO } from "@/lib/slot-immagini";

/**
 * Le fotografie dei posti fissi del disegno.
 *
 * ## Un riquadro per posto, e uno per referente
 *
 * Ogni posto è un **riquadro** con l'anteprima in alto — l'immagine caricata o il
 * vuoto — e sotto il nome, dove si vede sul sito e i pulsanti. Chi apre questa
 * schermata vede in un colpo solo che cosa manca al sito, che è la ragione per
 * cui i posti si mostrano **tutti** e non solo quelli riempiti.
 *
 * I ritratti dei referenti sono una griglia a parte, un riquadro per persona,
 * raggruppati per unità: la fotografia sta accanto al nome di chi ritrae. Era
 * una colonna di moduli tutti uguali, uno sotto l'altro, in cui il nome del referente
 * era l'unica cosa che distingueva l'uno dall'altro.
 *
 * L'elenco arriva già filtrato dal server: un referente di unità vede i posti della sua
 * pagina, un gestore quelli del sito. Il filtro in interfaccia non è la
 * protezione — quella sta nell'azione, che ricontrolla il cancello del singolo
 * posto — ma evitare di mostrare a qualcuno un modulo che riceverà un rifiuto è
 * il minimo che un'interfaccia debba fare.
 */

export interface ImmagineCaricata {
  file: string;
  larghezza: number;
  altezza: number;
  descrizione: string;
  /** nascosta: il sito non la mostra, qui si vede da `/in-attesa/` */
  nascosta?: boolean;
}

/**
 * Una fotografia proposta che aspetta un gestore: il file, o `null` se la
 * proposta è di togliere quella che c'è — o di rimettere quella nascosta, se
 * `mostra`.
 */
export type ProposteImmagini = Record<string, { file: string | null; mostra?: boolean }>;

export function Immagini({
  posti,
  caricaRitratti,
  inCoda = false,
  soloNascondere = false,
  inAttesa = {},
  etichetteUnita = {},
}: {
  posti: { slot: Slot; immagine: ImmagineCaricata | null }[];
  /** se chi guarda può caricare i ritratti: li carica solo un gestore */
  caricaRitratti: boolean;
  /** chi carica propone soltanto: il social media manager (`vaInCoda`) */
  inCoda?: boolean;
  /** chi le fotografie le nasconde e non le elimina: il social (`nascondeSoltanto`) */
  soloNascondere?: boolean;
  inAttesa?: ProposteImmagini;
  /** il nome di ogni unità, per intestare i gruppi di ritratti */
  etichetteUnita?: Record<string, string>;
}) {
  const fissi = posti.filter((p) => !p.slot.persona);
  const ritratti = posti.filter((p) => p.slot.persona);

  // i ritratti per unità, nell'ordine in cui arrivano: prima il gruppo, poi le unità
  const gruppi: { chiave: string; titolo: string; voci: typeof ritratti }[] = [];
  for (const p of ritratti) {
    const chiave = p.slot.unita ?? "gruppo";
    let g = gruppi.find((x) => x.chiave === chiave);
    if (!g) {
      g = {
        chiave,
        titolo: chiave === "gruppo" ? "Gestori" : (etichetteUnita[chiave] ?? chiave),
        voci: [],
      };
      gruppi.push(g);
    }
    g.voci.push(p);
  }

  return (
    <>
      <div className="adm-table__head">
        <h2>Immagini delle pagine</h2>
        <span className="adm-table__meta">
          {posti.filter((p) => p.immagine).length} su {posti.length} caricate
        </span>
      </div>

      <p className="adm-note">
        Finché un posto è vuoto la pagina mostra un rettangolo nel colore della fascia — non un
        buco e non un errore — quindi si possono riempire con calma, uno per volta.
        {inCoda ? (
          <>
            {" "}
            <strong>
              Ogni fotografia che caricate va ai gestori: sul sito resta quella di adesso
              finché non la approvano.
            </strong>{" "}
            Niente volti riconoscibili: non andrebbero online.
          </>
        ) : null}{" "}
        «Nascondi» toglie subito una fotografia dal sito e la tiene qui, per rimetterla
        {inCoda ? " con l’approvazione dei gestori" : ""}.
        {soloNascondere ? " Eliminarla del tutto spetta a un gestore." : ""}
      </p>

      {fissi.length > 0 ? (
        <>
          <h3 className="adm-foto__titolo">Riquadri del sito</h3>
          <div className="adm-foto__griglia">
            {fissi.map(({ slot, immagine }) => (
              <PostoFoto
                key={slot.chiave}
                slot={slot}
                immagine={immagine}
                puoCaricare
                inCoda={inCoda}
                soloNascondere={soloNascondere}
                proposta={inAttesa[slot.chiave]}
              />
            ))}
          </div>
        </>
      ) : null}

      {gruppi.map((g) => (
        <section key={g.chiave}>
          <h3 className="adm-foto__titolo">Ritratti · {g.titolo}</h3>
          <div className="adm-foto__griglia adm-foto__griglia--ritratti">
            {g.voci.map(({ slot, immagine }) => (
              <PostoFoto
                key={slot.chiave}
                slot={slot}
                immagine={immagine}
                puoCaricare={caricaRitratti}
                inCoda={false}
                proposta={inAttesa[slot.chiave]}
              />
            ))}
          </div>
        </section>
      ))}

      {ritratti.length > 0 && !caricaRitratti ? (
        <p className="adm-note">
          I ritratti li carica un gestore: mandategli la fotografia, insieme al consenso di
          chi vi compare. Potete sempre toglierne uno da qui.
        </p>
      ) : null}
    </>
  );
}

/**
 * Un posto: il riquadro con l'anteprima, il nome e i pulsanti.
 *
 * Esportato perché lo usa anche la schermata «Unità», per la fotografia
 * d'archivio: è lo stesso posto, caricato con la stessa azione, ma sta accanto
 * alle altre cose di quell'unità.
 */
export function PostoFoto({
  slot,
  immagine,
  puoCaricare,
  inCoda,
  soloNascondere = false,
  proposta,
}: {
  slot: Slot;
  immagine: ImmagineCaricata | null;
  puoCaricare: boolean;
  inCoda: boolean;
  /** il social media manager: nasconde, ma non elimina */
  soloNascondere?: boolean;
  proposta?: { file: string | null; mostra?: boolean };
}) {
  const [statoCarica, carica, caricando] = useActionState<StatoAzione, FormData>(
    caricaImmagine,
    AZIONE_INIZIALE,
  );
  const [statoTogli, togli, togliendo] = useActionState<StatoAzione, FormData>(
    rimuoviImmagine,
    AZIONE_INIZIALE,
  );
  const [statoNascosta, nascondi, nascondendo] = useActionState<StatoAzione, FormData>(
    nascondiImmagine,
    AZIONE_INIZIALE,
  );
  const [statoRimessa, rimetti, rimettendo] = useActionState<StatoAzione, FormData>(
    mostraImmagine,
    AZIONE_INIZIALE,
  );
  const ritratto = slot.forma === "ritratto";

  return (
    <article className={ritratto ? "adm-foto adm-foto--ritratto" : "adm-foto"}>
      <div className={ritratto ? "adm-foto__anteprima adm-foto__anteprima--ritratto" : "adm-foto__anteprima"}>
        {immagine ? (
          <img
            // una nascosta non esce da `/immagine/`: la si guarda da dietro il cancello
            src={immagine.nascosta ? indirizzoInAttesa(immagine.file, 400) : `/immagine/${immagine.file}?l=400`}
            width={immagine.larghezza}
            height={immagine.altezza}
            alt={immagine.descrizione || `Anteprima di ${slot.nome}`}
            loading="lazy"
            style={immagine.nascosta ? { opacity: 0.45 } : undefined}
          />
        ) : (
          <span className="adm-foto__vuoto">Nessuna fotografia</span>
        )}
      </div>

      <div className="adm-foto__corpo">
        <h4>{ritratto && slot.persona ? slot.persona : slot.nome}</h4>
        <span className="adm-foto__dove">
          {slot.dove}. Taglio: {TAGLIO[slot.forma]}.
        </span>
        <span
          className={immagine && !immagine.nascosta ? "adm-pill adm-pill--ok" : "adm-pill adm-pill--draft"}
        >
          {immagine
            ? `${immagine.nascosta ? "nascosta" : "online"} · ${immagine.larghezza}×${immagine.altezza}`
            : "vuoto"}
        </span>

        {/*
          La riga sul consenso, solo dove ritrae qualcuno.

          Non è un modulo da spuntare e non finge di essere una raccolta di
          consensi: è la frase che ricorda a chi carica che la fotografia di una
          persona la mette online quella persona, non chi ha il file.
        */}
        {slot.persona ? (
          <span className="adm-foto__consenso">
            Caricatela solo se {slot.persona} è d’accordo a comparire sul sito.
          </span>
        ) : null}

        {/* La proposta che aspetta, accanto a quella online. */}
        {proposta ? (
          <div className="adm-notice">
            <span className="adm-notice__tag">In attesa</span>
            <span>
              {proposta.mostra
                ? "C’è la richiesta di rimettere sul sito questa fotografia, da approvare."
                : proposta.file
                  ? "C’è una fotografia nuova da approvare. Caricandone un’altra, prende il suo posto."
                  : "C’è la richiesta di togliere questa fotografia, da approvare."}
            </span>
            {proposta.file ? (
              <img
                src={indirizzoInAttesa(proposta.file, 400)}
                alt="Fotografia proposta"
                loading="lazy"
                style={{ maxWidth: "160px", height: "auto", borderRadius: "4px" }}
              />
            ) : null}
          </div>
        ) : null}

        {puoCaricare ? (
          <form className="adm-foto__carica" action={carica}>
            <input type="hidden" name="slot" value={slot.chiave} />
            <input
              type="file"
              name="file"
              accept="image/jpeg,image/png"
              required
              aria-label={`Fotografia per ${slot.nome}`}
              aria-invalid={statoCarica.campo === "file" || undefined}
            />
            {/*
              La descrizione è facoltativa davvero: queste immagini sono
              decorative, e lasciata vuota esce con `alt=""` — che per uno
              screen reader è il comportamento giusto. Sta in un riquadro chiuso
              perché quasi nessuno la scrive.
            */}
            <details className="adm-foto__descrizione">
              <summary>Descrizione dell’immagine (facoltativa)</summary>
              <input type="text" name="descrizione" maxLength={200} aria-label="Descrizione dell’immagine (facoltativa)" />
            </details>
            <div className="adm-foto__azioni">
              <button className="adm-btn adm-btn--primary" type="submit" disabled={caricando}>
                {caricando
                  ? "Caricamento…"
                  : inCoda
                    ? "Invia ai gestori"
                    : immagine
                      ? "Sostituisci"
                      : "Carica"}
              </button>
            </div>
            <Esito stato={statoCarica} />
          </form>
        ) : null}

        {/* nascondere e rimettere: i ritratti no, si tolgono e basta */}
        {immagine && !slot.persona ? (
          immagine.nascosta ? (
            <form action={rimetti}>
              <input type="hidden" name="slot" value={slot.chiave} />
              <button className="adm-btn" type="submit" disabled={rimettendo}>
                {rimettendo ? "…" : inCoda ? "Chiedi di rimetterla" : "Rimetti sul sito"}
              </button>
            </form>
          ) : (
            <form action={nascondi}>
              <input type="hidden" name="slot" value={slot.chiave} />
              <button className="adm-btn" type="submit" disabled={nascondendo}>
                {nascondendo ? "…" : "Nascondi"}
              </button>
            </form>
          )
        ) : null}
        <Esito stato={statoNascosta} />
        <Esito stato={statoRimessa} />

        {immagine && !soloNascondere ? (
          <form action={togli}>
            <input type="hidden" name="slot" value={slot.chiave} />
            <button
              className="adm-btn"
              type="submit"
              disabled={togliendo}
              onClick={(e) => {
                if (!inCoda && !window.confirm("Eliminare questa fotografia? Il file viene cancellato dal server.")) {
                  e.preventDefault();
                }
              }}
            >
              {togliendo ? "Tolgo…" : inCoda ? "Proponi di togliere" : "Elimina la fotografia"}
            </button>
          </form>
        ) : null}
        <Esito stato={statoTogli} />
      </div>
    </article>
  );
}
