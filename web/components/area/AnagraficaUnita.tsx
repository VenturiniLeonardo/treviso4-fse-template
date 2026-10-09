"use client";

import { useActionState } from "react";
import {
  caricaCopertina,
  mostraCopertina,
  nascondiCopertina,
  rimuoviCopertina,
} from "@/app/(area)/area-riservata/unita/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";
import type { Unita } from "@/lib/data";
import { indirizzoInAttesa } from "@/lib/proposte";
import {
  COPERTINA_CONSIGLIATA,
  COPERTINA_PESO_MAX,
} from "@/lib/unita-contenuti";

/**
 * La fotografia di copertina di un'unità: caricarla, sostituirla, toglierla.
 *
 * Staccata dall'anagrafica il 3 ottobre 2026, perché ora ha due schermate: quella
 * del gestore, sotto nome e numeri, e «Testi delle unità» del social media
 * manager, che la copertina la **propone** (`inCoda`) e nome e numeri non li
 * tocca. Le azioni sono le stesse; la scelta fra pubblicare e proporre la fa il
 * server.
 */
/**
 * «Nascondi» o «Rimetti» per la copertina di un'unità: la usano entrambe le
 * schermate che la mostrano. Nascondere è subito per tutti; rimetterla, per chi
 * propone (`inCoda`), è una richiesta ai gestori — come una copertina nuova.
 */
export function VistaCopertina({ unita, inCoda = false }: { unita: Unita; inCoda?: boolean }) {
  const [statoNascosta, nascondi, nascondendo] = useActionState(nascondiCopertina, AZIONE_INIZIALE);
  const [statoRimessa, rimetti, rimettendo] = useActionState(mostraCopertina, AZIONE_INIZIALE);
  if (!unita.copertina && !unita.copertinaNascosta) return null;
  return (
    <>
      {unita.copertinaNascosta ? (
        <form action={rimetti}>
          <input type="hidden" name="unita" value={unita.chiave} />
          <button className="adm-btn" type="submit" disabled={rimettendo}>
            {rimettendo ? "…" : inCoda ? "Chiedi di rimetterla" : "Rimetti la copertina"}
          </button>
        </form>
      ) : (
        <form action={nascondi}>
          <input type="hidden" name="unita" value={unita.chiave} />
          <button className="adm-btn" type="submit" disabled={nascondendo}>
            {nascondendo ? "…" : "Nascondi la copertina"}
          </button>
        </form>
      )}
      <Esito stato={statoNascosta} />
      <Esito stato={statoRimessa} />
    </>
  );
}

export function CopertinaUnita({
  unita,
  inCoda = false,
  soloNascondere = false,
  proposta,
}: {
  unita: Unita;
  inCoda?: boolean;
  /** il social media manager: la copertina la nasconde, non la elimina */
  soloNascondere?: boolean;
  /** la copertina proposta che aspetta un gestore, se c'è */
  proposta?: { file: string | null; mostra?: boolean };
}) {
  const [statoFile, invia, caricando] = useActionState(caricaCopertina, AZIONE_INIZIALE);
  const [statoTolta, togli, togliendo] = useActionState(rimuoviCopertina, AZIONE_INIZIALE);
  // quella che c'è, visibile o nascosta
  const vista = unita.copertina ?? unita.copertinaNascosta;

  return (
    <>
      <form className="adm-form" action={invia} encType="multipart/form-data">
        <input type="hidden" name="unita" value={unita.chiave} />

        <h2>Fotografia di copertina</h2>
        <span className="adm-note">
          È l’immagine in cima alla pagina dell’unità. Senza, la pagina mostra
          l’immagine predefinita. Viene <strong>ricodificata e ripulita
          dai dati del telefono</strong>: il modello dell’apparecchio e le
          coordinate del posto non escono dal server.
          {inCoda ? (
            <>
              {" "}
              <strong>La fotografia va ai gestori</strong>: in cima alla pagina resta
              quella di adesso finché non la approvano.
            </>
          ) : null}
        </span>

        {proposta ? (
          <div className="adm-notice">
            <span className="adm-notice__tag">In attesa</span>
            <span>
              {proposta.mostra
                ? "C’è la richiesta di rimettere la copertina nascosta, in attesa di approvazione."
                : proposta.file
                  ? "C’è una copertina nuova in attesa di approvazione. Caricandone un’altra, " +
                    "prende il suo posto."
                  : "C’è la richiesta di togliere la copertina, in attesa di approvazione."}
            </span>
            {proposta.file ? (
              <img
                src={indirizzoInAttesa(proposta.file, 400)}
                alt="Copertina proposta"
                loading="lazy"
                style={{ maxWidth: "240px", height: "auto", borderRadius: "4px" }}
              />
            ) : null}
          </div>
        ) : null}

        {vista ? (
          <div className="adm-form__grid">
            <div className="adm-field">
              <span className="adm-field__label">
                {unita.copertina ? "Quella attuale" : "Quella nascosta"}
              </span>
              <img
                src={`${vista.src}?l=400`}
                width={400}
                height={Math.round(
                  (400 * vista.altezza) /
                    vista.larghezza,
                )}
                alt="Copertina caricata"
                style={{
                  maxWidth: "100%",
                  height: "auto",
                  borderRadius: "3px",
                  ...(unita.copertina ? {} : { opacity: 0.45 }),
                }}
              />
              <span className="adm-field__hint">
                {unita.copertina
                  ? `${unita.copertina.larghezza}×${unita.copertina.altezza} px, dall’originale.`
                  : "Nascosta: la pagina dell’unità mostra l’immagine predefinita."}
              </span>
              <VistaCopertina unita={unita} inCoda={inCoda} />
            </div>
          </div>
        ) : null}

        <label className="adm-field">
          <span className="adm-field__label">Scegli una fotografia</span>
          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png"
            aria-invalid={statoFile.campo === "file" || undefined}
          />
          <span className="adm-field__hint">
            JPEG o PNG, fino a {COPERTINA_PESO_MAX / 1024 / 1024} MB. Viene ridotta a{" "}
            {COPERTINA_CONSIGLIATA.larghezza}×{COPERTINA_CONSIGLIATA.altezza} circa e
            tagliata al centro: scegliete una foto che regga un taglio largo e basso.
            Niente ritratti di ragazzi in primo piano — questa immagine è pubblica e
            non passa dal controllo dei consensi degli album.
          </span>
        </label>

        <Esito stato={statoFile} />
        <Esito stato={statoTolta} />

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={caricando}>
            {caricando
              ? "Caricamento…"
              : inCoda
                ? "Invia ai gestori"
                : unita.copertina
                  ? "Sostituisci"
                  : "Carica"}
          </button>
        </div>
      </form>

      {vista && !soloNascondere ? (
        <form className="adm-form" action={togli}>
          <input type="hidden" name="unita" value={unita.chiave} />
          <h2>Togli la copertina</h2>
          <span className="adm-note">
            La pagina dell’unità torna all’immagine predefinita, e il file esce
            dall’archivio.
          </span>
          <div className="adm-form__actions">
            <button
              className="adm-btn"
              type="submit"
              disabled={togliendo}
              onClick={(e) => {
                if (!window.confirm("Togliere la copertina di quest’unità?")) {
                  e.preventDefault();
                }
              }}
            >
              {togliendo ? "…" : inCoda ? "Proponi di toglierla" : "Togli la copertina"}
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}
