"use client";

import { useActionState } from "react";
import {
  caricaMarchio,
  ripristinaMarchio,
  salvaContatti,
  salvaIdentita,
} from "@/app/(area)/area-riservata/identita/actions";
import {
  CAMPI_RECAPITI,
  type Identita,
  IDENTITA_INIZIALE,
  type StatoIdentita,
} from "@/lib/identita";

/**
 * Identità del gruppo: nome, sottotitolo e marchio.
 *
 * È stato il primo pezzo dell'area riservata che scriveva davvero, quando le
 * altre sezioni mostravano dati fissi. Dalla fase 14.10 non c'è più nessuna
 * sezione con dati fissi, e la frase è rimasta qui a dire il contrario per
 * cinque fasi: è la famiglia di difetti che l'audit della fase 13 descrive al §1,
 * e la si trova cercando «non è ancora», «arriva con», «dati fissi».
 *
 * I due moduli sono Server Action passate direttamente al form, quindi
 * funzionano anche a JavaScript spento; con JavaScript acceso si aggiungono
 * l'anteprima immediata del marchio e i messaggi senza ricaricare.
 *
 * Il controllo di chi può salvare **non** sta qui: sta nell'azione, sul server.
 * Questo componente nasconde soltanto i comandi a chi non deve vederli.
 */
function Esito({ stato }: { stato: StatoIdentita }) {
  if (stato.stato === "vuoto") return null;
  const errore = stato.stato === "errore";
  return (
    <p className={errore ? "adm-esito adm-esito--ko" : "adm-esito adm-esito--ok"} role="status">
      {stato.messaggio}
    </p>
  );
}

export function Identita({ identita }: { identita: Identita }) {
  const [statoTesti, azioneTesti, salvando] = useActionState(salvaIdentita, IDENTITA_INIZIALE);
  const [statoContatti, azioneContatti, salvandoContatti] = useActionState(
    salvaContatti,
    IDENTITA_INIZIALE,
  );
  const [statoFile, azioneFile, caricando] = useActionState(caricaMarchio, IDENTITA_INIZIALE);
  const [statoReset, azioneReset, ripristinando] = useActionState(
    ripristinaMarchio,
    IDENTITA_INIZIALE,
  );

  const suoMarchio = identita.marchio.src.startsWith("/marchio/");

  return (
    <>
      <form className="adm-form" action={azioneTesti}>
        <h2>Nome del gruppo</h2>
        <span className="adm-note">
          Compare nella barra in alto, nel piede di ogni pagina e nel titolo delle schede
          del browser. La modifica si vede su tutto il sito appena salvata.
        </span>

        <div className="adm-form__grid">
          <label className="adm-field">
            <span className="adm-field__label">Nome</span>
            <input
              type="text"
              name="nome"
              defaultValue={identita.nome}
              maxLength={60}
              required
              aria-invalid={statoTesti.campo === "nome" || undefined}
            />
            <span className="adm-field__hint">
              Come si legge nella barra: «Label». Da 2 a 60 caratteri.
            </span>
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Sottotitolo</span>
            <input
              type="text"
              name="sottotitolo"
              defaultValue={identita.sottotitolo}
              maxLength={80}
              aria-invalid={statoTesti.campo === "sottotitolo" || undefined}
            />
            <span className="adm-field__hint">
              La riga piccola sotto al nome: «Associazione di volontariato». Si può lasciare vuota.
            </span>
          </label>
        </div>

        <Esito stato={statoTesti} />

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={salvando}>
            {salvando ? "Salvataggio…" : "Salva il nome"}
          </button>
          <button className="adm-btn" type="reset">
            Annulla
          </button>
        </div>
      </form>

      <form className="adm-form" action={azioneContatti}>
        <h2>Sede e recapiti</h2>
        <span className="adm-note">
          Compaiono nel piede di ogni pagina, nella pagina Contatti e nelle informative
          privacy. Solo l’email è obbligatoria: gli altri si possono togliere, e dove
          comparivano il sito semplicemente non li scrive.
        </span>

        <div className="adm-form__grid">
          {CAMPI_RECAPITI.map((c) => (
            <label className="adm-field" key={c.chiave}>
              <span className="adm-field__label">{c.label}</span>
              <input
                type={c.tipo}
                name={c.chiave}
                defaultValue={identita[c.chiave]}
                maxLength={120}
                required={c.obbligatorio}
                aria-invalid={statoContatti.campo === c.chiave || undefined}
              />
              <span className="adm-field__hint">{c.hint}</span>
            </label>
          ))}
        </div>

        <Esito stato={statoContatti} />

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={salvandoContatti}>
            {salvandoContatti ? "Salvataggio…" : "Salva i recapiti"}
          </button>
          <button className="adm-btn" type="reset">
            Annulla
          </button>
        </div>
      </form>

      {/* niente encType: con una Server Action lo imposta React, e dichiararlo
          a mano produce un avviso e viene comunque sovrascritto */}
      <form className="adm-form" action={azioneFile}>
        <h2>Marchio del gruppo</h2>
        <span className="adm-note">
          Il logo accanto al nome, in barra e nel piede. PNG o JPEG, fino a 1 MB e
          2000 px di lato. Meglio un PNG quadrato con lo sfondo trasparente.
        </span>

        <div className="adm-marchio">
          <span className="adm-marchio__box">
            <img
              src={identita.marchio.src}
              width={identita.marchio.larghezza}
              height={identita.marchio.altezza}
              alt="Marchio attualmente in uso"
            />
          </span>
          <div className="adm-marchio__info">
            <span className="adm-field__label">In uso adesso</span>
            <span className="adm-marchio__nome">
              {suoMarchio ? "marchio caricato dai referenti" : "marchio consegnato con il sito"}
            </span>
            <span className="adm-field__hint">
              {identita.marchio.larghezza}×{identita.marchio.altezza} px
            </span>
          </div>
        </div>

        <label className="adm-field">
          <span className="adm-field__label">Nuovo file</span>
          <input
            type="file"
            name="file"
            accept="image/png,image/jpeg"
            required
            aria-invalid={statoFile.campo === "file" || undefined}
          />
          <span className="adm-field__hint">
            Il file sostituisce il marchio precedente, che viene cancellato.
          </span>
        </label>

        <Esito stato={statoFile} />

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={caricando}>
            {caricando ? "Caricamento…" : "Carica il marchio"}
          </button>
        </div>
      </form>

      {suoMarchio ? (
        <form className="adm-form" action={azioneReset}>
          <h2>Torna al marchio predefinito</h2>
          <span className="adm-note">
            Rimette il logo consegnato con il sito e cancella il file caricato.
          </span>
          <Esito stato={statoReset} />
          <div className="adm-form__actions">
            <button className="adm-btn" type="submit" disabled={ripristinando}>
              {ripristinando ? "Ripristino…" : "Ripristina il marchio predefinito"}
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}
