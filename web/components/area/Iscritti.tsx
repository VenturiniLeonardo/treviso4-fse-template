"use client";

import clsx from "clsx";
import { useActionState, useState } from "react";
import {
  cancellaDatiRagazzo,
  nuovoIscritto,
  rimuoviIscrizione,
  segnaConsenso,
  segnaModuloConsenso,
  segnaQuota,
  segnaSquadra,
} from "@/app/(area)/area-riservata/iscritti/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE, MODULO_MAX, type StatoAzione } from "@/lib/contenuti";

/**
 * L'elenco degli iscritti: nomi, consensi, quote.
 *
 * È la schermata con i dati più delicati del sito, e la sua forma lo dice.
 *
 * **Il consenso non è una casella da spuntare.** Chiede la data in cui il
 * modulo è stato firmato, e non propone «oggi»: quella data quasi mai coincide
 * con il giorno in cui qualcuno la inserisce, e un consenso datato al giorno
 * dell'inserimento è un consenso che non si può dimostrare. Revocarlo invece è
 * un clic, perché una revoca è immediata per definizione.
 *
 * **Chi non ha il consenso si vede da lontano.** Non è una colonna in mezzo ad
 * altre: è una riga marcata, e in cima c'è il conto. Chi carica un album deve
 * poter sapere in due secondi se può.
 */

export interface VoceIscritto {
  id: number;
  ragazzoId: number;
  nome: string;
  cognome: string;
  eta: number | null;
  unita: string;
  unitaLabel: string;
  anno: string;
  gruppoInterno: string;
  quota: string;
  quotaLabel: string;
  consenso: boolean;
  consensoData: string | null;
  /** dove sta il modulo di carta, se è stato scritto */
  consensoModulo: string;
  /** l'esito della verifica a campione del gestore, se c'è stata */
  verifica: "conforme" | "mancante" | null;
  verificatoIl: string | null;
}

export interface OpzioneQuota {
  valore: string;
  label: string;
}

/** Un pulsante che è una Server Action con dei campi nascosti. */
function Comando({
  azione,
  campi,
  children,
  primary,
  conferma,
}: {
  azione: (stato: StatoAzione, dati: FormData) => Promise<StatoAzione>;
  campi: Record<string, string>;
  children: React.ReactNode;
  primary?: boolean;
  conferma?: string;
}) {
  const [stato, invia, inCorso] = useActionState(azione, AZIONE_INIZIALE);
  return (
    <form action={invia} className="adm-comando">
      {Object.entries(campi).map(([n, v]) => (
        <input type="hidden" name={n} value={v} key={n} />
      ))}
      <button
        className={clsx("adm-btn", primary && "adm-btn--primary")}
        type="submit"
        disabled={inCorso}
        onClick={(e) => {
          if (conferma && !window.confirm(conferma)) e.preventDefault();
        }}
      >
        {children}
      </button>
      <Esito stato={stato} />
    </form>
  );
}

/** Il modulo del consenso: la data si scrive, non si indovina. */
function Consenso({ v }: { v: VoceIscritto }) {
  const [stato, invia, inCorso] = useActionState(segnaConsenso, AZIONE_INIZIALE);

  if (v.consenso) {
    return (
      <form action={invia} className="adm-comando">
        <input type="hidden" name="id" value={v.id} />
        <input type="hidden" name="concesso" value="0" />
        {/* Stessa correzione delle attività: `pill--ok` e `pill--stop` non
            esistono in `site.css`, e questa è la colonna dei **consensi** —
            quella su cui si regge il cancello delle pubblicazioni. Un referente che
            scorre l'elenco cercando chi manca vedeva trenta pastiglie grigie
            identiche. Con `adm-pill` «consenso» è verde e «manca» è rossa, come
            in tutte le altre tabelle dell'area. */}
        <span className="adm-pill adm-pill--ok">consenso · {v.consensoData}</span>{" "}
        <Verifica v={v} />
        <button
          className="adm-btn"
          type="submit"
          disabled={inCorso}
          onClick={(e) => {
            if (
              !window.confirm(
                "Revocare il consenso? Da questo momento le fotografie di questo " +
                  "ragazzo non vanno pubblicate, e gli album dell’unità restano " +
                  "bloccati finché non lo si dichiara assente o non torna il consenso.",
              )
            )
              e.preventDefault();
          }}
        >
          Revoca
        </button>
        <Esito stato={stato} />
      </form>
    );
  }

  return (
    <form action={invia} className="adm-comando" style={{ flexWrap: "wrap", gap: "6px" }}>
      <input type="hidden" name="id" value={v.id} />
      <input type="hidden" name="concesso" value="1" />
      <span className="adm-pill adm-pill--stop">manca</span>
      <input
        type="date"
        name="data"
        required
        aria-label={`Data della firma per ${v.cognome} ${v.nome}`}
        aria-invalid={stato.campo === "data" || undefined}
      />
      <button className="adm-btn" type="submit" disabled={inCorso}>
        Registra
      </button>
      <Esito stato={stato} />
    </form>
  );
}

/**
 * L'esito della verifica a campione, accanto al consenso (audit I-1).
 *
 * «Modulo non trovato» si vede da lontano, come «manca»: è il referente di unità che
 * deve ritrovarlo, o revocare il consenso se non c'è. «Verificato» resta
 * discreto, perché è il caso normale.
 */
function Verifica({ v }: { v: VoceIscritto }) {
  if (v.verifica === "mancante") {
    return (
      <span
        className="adm-pill adm-pill--stop"
        title={
          "Alla verifica a campione il modulo firmato non si è trovato. Ritrovatelo, oppure " +
          "revocate il consenso."
        }
      >
        modulo non trovato
      </span>
    );
  }
  if (v.verifica === "conforme") {
    return <span className="c-muted adm-note">verificato</span>;
  }
  return null;
}

/** Dove sta il modulo di carta: serve a chi fa la verifica per trovarlo. */
function ModuloConsenso({ v }: { v: VoceIscritto }) {
  const [stato, invia, inCorso] = useActionState(segnaModuloConsenso, AZIONE_INIZIALE);
  return (
    <form action={invia}>
      <label className="adm-field">
        <span className="adm-field__label">Dove sta il modulo del consenso</span>
        <input type="hidden" name="id" value={v.id} />
        <input
          type="text"
          name="modulo"
          defaultValue={v.consensoModulo}
          maxLength={MODULO_MAX}
          placeholder="Raccoglitore dei consensi in sede, 2026-27"
          aria-invalid={stato.campo === "modulo" || undefined}
        />
        <span className="adm-field__hint">
          Facoltativo. I gestori controllano a campione che il modulo firmato ci sia.
        </span>
      </label>
      <Esito stato={stato} />
      <div className="adm-form__actions">
        <button className="adm-btn" type="submit" disabled={inCorso}>
          Salva il posto del modulo
        </button>
      </div>
    </form>
  );
}

/**
 * La squadra.
 *
 * Un componente suo e non un `<form>` inline: l'azione va passata a
 * `useActionState`, se no il suo esito si perde e chi salva non sa se ha
 * salvato. Un form che non dice niente è un form di cui non ci si fida, e a
 * quel punto lo si compila due volte.
 */
function Squadra({ v }: { v: VoceIscritto }) {
  const [stato, invia, inCorso] = useActionState(segnaSquadra, AZIONE_INIZIALE);
  return (
    <form action={invia}>
      <label className="adm-field">
        <span className="adm-field__label">Squadra o squadra</span>
        <input type="hidden" name="id" value={v.id} />
        <input
          name="gruppoInterno"
          type="text"
          defaultValue={v.gruppoInterno}
          placeholder="Rossi"
        />
      </label>
      <div className="adm-form__actions">
        <button className="adm-btn" type="submit" disabled={inCorso}>
          Salva la squadra
        </button>
        <Esito stato={stato} />
      </div>
    </form>
  );
}

/**
 * La cancellazione dell'art. 17, legata a una richiesta.
 *
 * Dal 4 ottobre 2026 (audit degli accessi, SoD-3) non si cancella una persona
 * «perché sì»: si sceglie la richiesta di cancellazione a cui si sta dando
 * seguito, e deve averla aperta un'altra persona — di solito il gestore,
 * nella sezione «Privacy». Senza una richiesta così il comando non c'è, e lo
 * dice. L'azione ricontrolla tutto sul server.
 */
function Cancellazione({
  v,
  richieste,
}: {
  v: VoceIscritto;
  richieste: { id: number; etichetta: string }[];
}) {
  const [stato, invia, inCorso] = useActionState(cancellaDatiRagazzo, AZIONE_INIZIALE);
  if (richieste.length === 0) {
    return (
      <span className="c-muted adm-note">
        Cancellare tutto (art. 17) richiede una richiesta di cancellazione aperta, da
        un’altra persona, nella sezione «Privacy».
      </span>
    );
  }
  return (
    <form action={invia} className="adm-comando" style={{ flexWrap: "wrap", gap: "6px" }}>
      <input type="hidden" name="ragazzo" value={v.ragazzoId} />
      <select name="richiesta" aria-label="Richiesta di cancellazione a cui si dà seguito" required>
        {richieste.map((r) => (
          <option key={r.id} value={r.id}>
            {r.etichetta}
          </option>
        ))}
      </select>
      <button
        className="adm-btn"
        type="submit"
        disabled={inCorso}
        onClick={(e) => {
          if (
            !window.confirm(
              "Cancellare TUTTI i dati di questa persona, compresi gli anni precedenti? " +
                "È l’articolo 17 e non si torna indietro. La richiesta scelta sarà segnata " +
                "come eseguita.",
            )
          )
            e.preventDefault();
        }}
      >
        Cancella tutto (art. 17)
      </button>
      <Esito stato={stato} />
    </form>
  );
}

/** Il menù della quota: cambia e basta, il registro lo scrive l'azione. */
function Quota({ v, opzioni }: { v: VoceIscritto; opzioni: OpzioneQuota[] }) {
  const [stato, invia, inCorso] = useActionState(segnaQuota, AZIONE_INIZIALE);
  return (
    <form action={invia} className="adm-comando">
      <input type="hidden" name="id" value={v.id} />
      <select
        name="quota"
        defaultValue={v.quota}
        disabled={inCorso}
        aria-label={`Quota di ${v.cognome} ${v.nome}`}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {opzioni.map((o) => (
          <option key={o.valore} value={o.valore}>
            {o.label}
          </option>
        ))}
      </select>
      <Esito stato={stato} />
    </form>
  );
}

export function Iscritti({
  voci,
  unita,
  anni,
  quote,
  annoCorrente,
  unitaFissa,
  soloLettura = false,
  puoCancellare,
  richiesteCancellazione = [],
}: {
  voci: VoceIscritto[];
  unita: { chiave: string; label: string }[];
  anni: string[];
  quote: OpzioneQuota[];
  annoCorrente: string;
  /** per un referente di unità: la sua, e non si sceglie */
  unitaFissa?: { chiave: string; label: string };
  /**
   * Consultare senza registrare: il gestore, che pubblica le fotografie e
   * quindi non attesta i consensi che le sbloccano (riga `iscritti`, audit
   * SoD-1). Niente moduli: i valori si leggono e basta.
   */
  soloLettura?: boolean;
  /** chi ha la riga `gdpr` completa vede la cancellazione dell'art. 17 */
  puoCancellare: boolean;
  /** le richieste di cancellazione aperte da altri, a cui si può dare seguito */
  richiesteCancellazione?: { id: number; etichetta: string }[];
}) {
  const [stato, crea, inCorso] = useActionState(nuovoIscritto, AZIONE_INIZIALE);
  const [apri, setApri] = useState<number | null>(null);

  const mancano = voci.filter((v) => !v.consenso);

  return (
    <div className="flex flex-col gap-4">
      {mancano.length > 0 ? (
        <div className="adm-notice" role="status">
          <span className="adm-notice__tag">Consensi</span>
          <p>
            {mancano.length === 1
              ? "Manca un consenso alla pubblicazione delle immagini: "
              : `Mancano ${mancano.length} consensi alla pubblicazione delle immagini: `}
            <strong>{mancano.map((v) => `${v.cognome} ${v.nome}`).join(", ")}</strong>. Finché
            manca, gli album dell’unità non vanno online.
          </p>
        </div>
      ) : voci.length > 0 ? (
        <div className="adm-notice" role="status">
          <span className="adm-notice__tag">Consensi</span>
          <p>Ci sono tutti. Gli album dell’unità possono andare in approvazione.</p>
        </div>
      ) : null}

      <div className="adm-table">
        <div className="adm-table__head">
          <h2>Iscritti {annoCorrente}</h2>
          <span className="adm-table__meta">
            {voci.length} · consensi {voci.length - mancano.length}/{voci.length}
          </span>
        </div>

        <div className="adm-table__box">
          {voci.length === 0 ? (
            <div className="adm-tr adm-tr--vuota">
              <span className="c-muted">
                Nessun iscritto. Le schede sanitarie restano cartacee: qui stanno nome,
                età, squadra, consenso e quota, e nient’altro.
              </span>
            </div>
          ) : null}

          {voci.map((v) => (
            <div
              key={v.id}
              className="adm-tr"
              style={{ gridTemplateColumns: "minmax(0, 1.4fr) 70px 130px minmax(0, 1fr) 150px 90px" }}
            >
              <span>
                <strong>
                  {v.cognome} {v.nome}
                </strong>
                {unitaFissa ? null : (
                  <>
                    <br />
                    <span className="c-muted adm-note">{v.unitaLabel}</span>
                  </>
                )}
              </span>
              <span className="c-muted">{v.eta === null ? "—" : `${v.eta} anni`}</span>
              <span className="c-muted">{v.gruppoInterno || "—"}</span>
              {soloLettura ? (
                <>
                  <span>
                    {v.consenso ? (
                      <>
                        <span className="adm-pill adm-pill--ok">consenso · {v.consensoData}</span>{" "}
                        <Verifica v={v} />
                      </>
                    ) : (
                      <span className="adm-pill adm-pill--stop">manca</span>
                    )}
                  </span>
                  <span className="c-muted">{v.quotaLabel}</span>
                  <span />
                </>
              ) : (
                <>
                  <Consenso v={v} />
                  <Quota v={v} opzioni={quote} />
                  <button
                    type="button"
                    className="adm-btn"
                    onClick={() => setApri(apri === v.id ? null : v.id)}
                    aria-expanded={apri === v.id}
                  >
                    Altro
                  </button>
                </>
              )}

              {/* nascosto e non tolto finché non si preme «Altro»: i moduli restano
                  nell'HTML del server, dove li trova la verifica HTTP */}
              {!soloLettura ? (
                <div style={{ gridColumn: "1 / -1" }} className="adm-form" hidden={apri !== v.id}>
                  <Squadra v={v} />
                  {v.consenso ? <ModuloConsenso v={v} /> : null}

                  <div className="adm-form__actions">
                    <Comando
                      azione={rimuoviIscrizione}
                      campi={{ id: String(v.id) }}
                      conferma={
                        "Togliere l’iscrizione di quest’anno? I dati anagrafici e gli " +
                        "anni precedenti restano."
                      }
                    >
                      Toglie l’iscrizione di quest’anno
                    </Comando>

                    {puoCancellare ? (
                      <Cancellazione v={v} richieste={richiesteCancellazione} />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {soloLettura ? null : (
      <form action={crea} className="adm-form">
        <h2>Registra un’iscrizione</h2>
        <span className="adm-note">
          Se il ragazzo era già iscritto un altro anno, cercatelo prima: iscriverlo di
          nuovo per nome crea un doppione, e due persone con lo stesso nome esistono.
        </span>

        <div className="adm-form__grid">
          <label className="adm-field">
            <span className="adm-field__label">Cognome</span>
            <input
              name="cognome"
              type="text"
              aria-invalid={stato.campo === "cognome" || undefined}
            />
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Nome</span>
            <input name="nome" type="text" />
          </label>
        </div>

        <div className="adm-form__grid">
          <label className="adm-field">
            <span className="adm-field__label">Data di nascita</span>
            <input name="natoIl" type="date" />
            <span className="adm-field__hint">Facoltativa: serve solo a mostrare l’età.</span>
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Squadra o squadra</span>
            <input name="gruppoInterno" type="text" />
          </label>
        </div>

        <div className="adm-form__grid">
          {unitaFissa ? (
            <input type="hidden" name="unita" value={unitaFissa.chiave} />
          ) : (
            <label className="adm-field">
              <span className="adm-field__label">Unità</span>
              <select name="unita" aria-invalid={stato.campo === "unita" || undefined}>
                {unita.map((u) => (
                  <option key={u.chiave} value={u.chiave}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="adm-field">
            <span className="adm-field__label">Anno sociale</span>
            <select name="anno" defaultValue={annoCorrente}>
              {anni.map((a) => (
                <option key={a} value={a}>
                  {a.replace("-", " – ")}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Esito stato={stato} />

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
            {inCorso ? "Salvataggio…" : "Registra"}
          </button>
        </div>
      </form>
      )}
    </div>
  );
}
