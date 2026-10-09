"use client";

import clsx from "clsx";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  chiediRitiroAttivita,
  inviaAttivita,
  modificaAttivita,
  nuovaAttivita,
  rimuoviAttivita,
} from "@/app/(area)/area-riservata/attivita/actions";
import { Esito } from "@/components/area/Esito";
import {
  ETICHETTA_TIPO,
  LIMITI_ATTIVITA,
  TIPI_ATTIVITA,
  type TipoAttivita,
  tipoAmmessoPer,
} from "@/lib/attivita";
import {
  AZIONE_INIZIALE,
  ETICHETTA_STATO,
  PILL_STATO,
  type Stato,
  type StatoAzione,
} from "@/lib/contenuti";
import { MOTIVO_RITIRO_MAX } from "@/lib/proposte";

/**
 * Il calendario, dal lato di chi lo scrive.
 *
 * Due schermate in un file, come per gli album: l'elenco e l'editor di una
 * riga. Quale delle due si vede lo decide `?att=` nell'indirizzo, così il tasto
 * indietro del browser funziona e un collegamento a un'attività si può mandare
 * per messaggio.
 *
 * ## Che cosa questa schermata non fa
 *
 * **Non pubblica.** Il pulsante più a destra dice «Manda in revisione», e da lì
 * la voce entra nella coda dei gestori. Un referente di unità che potesse pubblicare
 * da qui renderebbe la coda un passaggio facoltativo.
 *
 * Il social media manager (`propone`) modifica e cancella anche le attività
 * degli altri: su una pubblicata le sue modifiche e la cancellazione diventano
 * una richiesta ai gestori, e la schermata lo dice prima che salvi.
 */

/** Che cosa aspetta i gestori su un'attività: una modifica, la cancellazione, il ritiro. */
export type InAttesa = "modifica" | "elimina" | "ritira";

const ETICHETTA_ATTESA: Record<InAttesa, string> = {
  modifica: "Modifica in attesa",
  elimina: "Cancellazione richiesta",
  ritira: "Ritiro richiesto",
};

export interface VoceAttivita {
  id: number;
  titolo: string;
  /** ISO, per il campo data */
  data: string;
  /** «11 ott 2026», per l'elenco */
  dataTesto: string;
  dow: string;
  tipo: TipoAttivita;
  unita: string[];
  nota: string;
  luogo: string;
  durata: string;
  stato: Stato;
  annoSociale: string;
}

export interface UnitaSceglibile {
  chiave: string;
  label: string;
  /** il colore della fascia, per l'etichetta nell'elenco */
  colore?: string;
}

// --------------------------------------------------------------------------

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

/** I campi comuni a creazione e modifica. */
function CampiAttivita({
  voce,
  unita,
  stato,
  soloLaMia,
}: {
  voce?: VoceAttivita;
  unita: UnitaSceglibile[];
  stato: StatoAzione;
  /** per un referente di unità: la sua, e non si sceglie */
  soloLaMia?: UnitaSceglibile;
}) {
  const invalido = (campo: string) => (stato.campo === campo ? true : undefined);

  return (
    <>
      <label className="adm-field">
        <span className="adm-field__label">Titolo</span>
        <input
          name="titolo"
          type="text"
          defaultValue={voce?.titolo ?? ""}
          maxLength={LIMITI_ATTIVITA.titolo}
          required
          aria-invalid={invalido("titolo")}
        />
        <span className="adm-field__hint">Come lo leggeranno le famiglie nel calendario.</span>
      </label>

      <div className="adm-form__grid">
        <label className="adm-field">
          <span className="adm-field__label">Data</span>
          <input
            name="data"
            type="date"
            defaultValue={voce?.data ?? ""}
            required
            aria-invalid={invalido("data")}
          />
          <span className="adm-field__hint">
            {/* l'anno sociale e il giorno della settimana si ricavano: chiederli
                vorrebbe dire poter ricevere una risposta sbagliata */}
            L’anno sociale e il giorno della settimana si calcolano da soli.
          </span>
        </label>

        <label className="adm-field">
          <span className="adm-field__label">Che cosa è</span>
          <select name="tipo" defaultValue={voce?.tipo ?? "uscita"} aria-invalid={invalido("tipo")}>
            {/* a un referente di unità fuori dalla fascia verde non si propone un tipo
                che il server gli rifiuterebbe */}
            {TIPI_ATTIVITA.filter(
              (t) => !soloLaMia || tipoAmmessoPer(t, [soloLaMia.chiave]),
            ).map((t) => (
              <option key={t} value={t}>
                {ETICHETTA_TIPO[t]}
              </option>
            ))}
          </select>
          {!soloLaMia && (
            <span className="adm-field__hint">
              «Attività di squadra» vale solo per le unità della fascia verde.
            </span>
          )}
        </label>
      </div>

      {soloLaMia ? (
        <>
          <input type="hidden" name="unita" value={soloLaMia.chiave} />
          <p className="adm-note">
            L’attività è di <strong>{soloLaMia.label}</strong>. Per un’attività di gruppo, o
            insieme a un’altra unità, chiedete ai gestori: da qui si scrive solo per la
            propria.
          </p>
        </>
      ) : (
        <fieldset className="adm-field">
          <legend className="adm-field__label">Unità coinvolte</legend>
          <div className="adm-actions">
            {unita.map((u) => (
              <label
                key={u.chiave}
                /* Lo stile è qui e non in `admin.css`: due proprietà non
                   valgono una classe nuova. */
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <input
                  type="checkbox"
                  name="unita"
                  value={u.chiave}
                  defaultChecked={voce?.unita.includes(u.chiave)}
                />
                {u.label}
              </label>
            ))}
          </div>
          <span className="adm-field__hint">
            Nessuna spuntata significa <strong>tutto il gruppo</strong>.
          </span>
        </fieldset>
      )}

      <label className="adm-field">
        <span className="adm-field__label">Nota</span>
        <textarea
          name="nota"
          rows={3}
          defaultValue={voce?.nota ?? ""}
          maxLength={LIMITI_ATTIVITA.nota}
        />
        <span className="adm-field__hint">
          Una o due frasi per le famiglie. Niente nomi di ragazzi.
        </span>
      </label>

      <div className="adm-form__grid">
        <label className="adm-field">
          <span className="adm-field__label">Luogo</span>
          <input
            name="luogo"
            type="text"
            defaultValue={voce?.luogo ?? ""}
            maxLength={LIMITI_ATTIVITA.luogo}
          />
        </label>
        <label className="adm-field">
          <span className="adm-field__label">Durata</span>
          <input
            name="durata"
            type="text"
            defaultValue={voce?.durata ?? ""}
            maxLength={LIMITI_ATTIVITA.durata}
            placeholder="giornata intera"
          />
        </label>
      </div>
    </>
  );
}

// --------------------------------------------------------------------------

const MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

/** «2026-10» → «ottobre 2026». Le attività senza data valida finiscono in coda, senza titolo. */
function titoloMese(chiave: string): string {
  const [anno, mese] = chiave.split("-");
  const n = Number(mese);
  return n >= 1 && n <= 12 ? `${MESI[n - 1]} ${anno}` : "Senza data";
}

/**
 * Il calendario, letto mese per mese e filtrabile per unità.
 *
 * ## Che cosa è cambiato
 *
 * Era un elenco unico, in ordine di inserimento, con in fondo il modulo lungo
 * per crearne una: per trovare le uscite di un'unità bisognava leggerle tutte.
 * Adesso:
 *
 *  - in cima ci sono le unità come pastiglie, **una o più**: ogni clic ne
 *    aggiunge o ne toglie una, e nessuna scelta vuol dire «tutte». La scelta sta
 *    nell'indirizzo (`?u=u1,u4`), come per le altre schermate: una
 *    vista filtrata si condivide e si ritrova col tasto indietro;
 *  - le attività sono divise per mese, con la data in evidenza a sinistra e le
 *    unità come etichette colorate nel colore della fascia;
 *  - le attività già passate non si mostrano: «Mostra anche le
 *    passate» le riporta;
 *  - «Nuova attività» è un pulsante in cima che apre il modulo, non un modulo
 *    di dieci campi in fondo a una pagina che si scorre.
 *
 * Il filtro non è una protezione: l'elenco arriva già limitato a quello che chi
 * guarda può toccare, e le azioni ripassano dal cancello.
 */
export function ElencoAttivita({
  voci,
  inAttesa = {},
  percorso,
  unita,
  soloLaMia,
  scelte = [],
  passate = false,
  oggi,
}: {
  voci: VoceAttivita[];
  /** le richieste che aspettano i gestori, per id d'attività */
  inAttesa?: Record<number, InAttesa>;
  percorso: string;
  unita: UnitaSceglibile[];
  soloLaMia?: UnitaSceglibile;
  /** le unità filtrate; vuoto = tutte */
  scelte?: string[];
  /** se si vedono anche le attività già passate */
  passate?: boolean;
  /** la data di oggi, ISO: la dà il server, perché l'orologio del browser non fa fede */
  oggi: string;
}) {
  const [stato, crea, inCorso] = useActionState(nuovaAttivita, AZIONE_INIZIALE);
  const [aperto, setAperto] = useState(false);
  const info = (k: string) => unita.find((u) => u.chiave === k);
  const etichetta = (k: string) => info(k)?.label ?? k;

  /** L'indirizzo per un certo insieme di unità e per «anche le passate» sì o no. */
  const indirizzo = (unitaScelte: string[], conPassate: boolean) => {
    const q = new URLSearchParams();
    if (unitaScelte.length > 0) q.set("u", unitaScelte.join(","));
    if (conPassate) q.set("passate", "1");
    const testo = q.toString();
    return testo ? `${percorso}?${testo}` : percorso;
  };
  /** Una unità in più o in meno fra le scelte, con il resto com'è. */
  const conUnita = (u: string) =>
    indirizzo(scelte.includes(u) ? scelte.filter((x) => x !== u) : [...scelte, u], passate);

  const filtrate = voci
    .filter((v) => scelte.length === 0 || v.unita.some((u) => scelte.includes(u)) || (v.unita.length === 0 && scelte.includes("gruppo")))
    .sort((a, b) => a.data.localeCompare(b.data));
  const visibili = passate ? filtrate : filtrate.filter((v) => v.data === "" || v.data >= oggi);
  const nascostePassate = filtrate.length - visibili.length;

  const mesi: { chiave: string; voci: VoceAttivita[] }[] = [];
  for (const v of visibili) {
    const chiave = v.data ? v.data.slice(0, 7) : "";
    const ultimo = mesi[mesi.length - 1];
    if (ultimo && ultimo.chiave === chiave) ultimo.voci.push(v);
    else mesi.push({ chiave, voci: [v] });
  }

  return (
    <>
      <div className="adm-filtri">
        <div className="adm-filtri__riga">
          <span className="adm-filtri__etichetta">Unità</span>
          {soloLaMia ? (
            <span className="adm-pillfiltro is-attivo">{soloLaMia.label}</span>
          ) : (
            <>
              <Link
                className={scelte.length === 0 ? "adm-pillfiltro is-attivo" : "adm-pillfiltro"}
                href={indirizzo([], passate)}
                aria-current={scelte.length === 0 ? "page" : undefined}
              >
                Tutte
              </Link>
              {unita.map((u) => {
                const attiva = scelte.includes(u.chiave);
                return (
                  <Link
                    key={u.chiave}
                    className={attiva ? "adm-pillfiltro is-attivo" : "adm-pillfiltro"}
                    href={conUnita(u.chiave)}
                    aria-pressed={attiva}
                  >
                    {u.label}
                  </Link>
                );
              })}
            </>
          )}
        </div>
        <div className="adm-filtri__riga">
          <span className="adm-filtri__etichetta">Quando</span>
          <Link
            className={!passate ? "adm-pillfiltro is-attivo" : "adm-pillfiltro"}
            href={indirizzo(scelte, false)}
          >
            Da oggi
          </Link>
          <Link className={passate ? "adm-pillfiltro is-attivo" : "adm-pillfiltro"} href={indirizzo(scelte, true)}>
            Anche le passate
          </Link>
        </div>
      </div>

      <div className="adm-table__head">
        <h2>Attività in calendario</h2>
        <span className="adm-table__meta">
          {visibili.length} {visibili.length === 1 ? "attività" : "attività"}
          {nascostePassate > 0 ? ` · ${nascostePassate} già passate non mostrate` : ""}
        </span>
        <button
          className="adm-btn adm-btn--primary"
          type="button"
          aria-expanded={aperto}
          onClick={() => setAperto((x) => !x)}
        >
          {aperto ? "Chiudi" : "+ Nuova attività"}
        </button>
      </div>

      {/* nascosto e non tolto, come la modifica dell'account in `Utenti.tsx`: il
          modulo resta nell'HTML del server, dove lo trova la verifica HTTP */}
      <form action={crea} className="adm-form" hidden={!aperto}>
        <h2>Nuova attività</h2>
        <span className="adm-note">
          «Manda in revisione» la passa ai gestori, che la trovano nella coda di
          approvazione: compare nel calendario pubblico quando l’approvano. «Salva in
          bozza» la tiene per voi, da mandare più tardi.
        </span>

        <CampiAttivita unita={unita} stato={stato} soloLaMia={soloLaMia} />

        <Esito stato={stato} />

        <div className="adm-form__actions">
          <button
            className="adm-btn adm-btn--primary"
            type="submit"
            name="invio"
            value="revisione"
            disabled={inCorso}
          >
            {inCorso ? "Salvataggio…" : "Manda in revisione"}
          </button>
          <button className="adm-btn" type="submit" name="invio" value="bozza" disabled={inCorso}>
            Salva in bozza
          </button>
        </div>
      </form>

      {mesi.length === 0 ? (
        <div className="adm-table__box">
          <div className="adm-tr adm-tr--vuota">
            <span className="c-muted">
              {scelte.length > 0
                ? "Nessuna attività per le unità scelte."
                : "Nessuna attività in programma."}{" "}
              {nascostePassate > 0 ? (
                <Link href={indirizzo(scelte, true)}>Mostra anche le passate</Link>
              ) : null}
            </span>
          </div>
        </div>
      ) : (
        mesi.map((m) => (
          <section className="adm-cal__mese" key={m.chiave || "senza-data"}>
            <h3 className="adm-cal__titolo">{titoloMese(m.chiave)}</h3>
            <div className="adm-table__box">
              {m.voci.map((v) => {
                const giorno = v.data ? Number(v.data.slice(8, 10)) : null;
                const dow = v.dow ? v.dow.slice(0, 3) : "";
                const sue = v.unita.length === 0 ? ["gruppo"] : v.unita;
                return (
                  <div className="adm-cal__riga" key={v.id}>
                    <span className="adm-cal__data" aria-label={`${v.dow} ${v.dataTesto}`}>
                      <strong>{giorno ?? "—"}</strong>
                      <span>{dow}</span>
                    </span>
                    <span className="adm-cal__corpo">
                      <Link href={`${percorso}?att=${v.id}`} className="adm-cal__titolo-riga">
                        {v.titolo}
                      </Link>
                      <span className="adm-cal__meta">
                        <span>{ETICHETTA_TIPO[v.tipo]}</span>
                        {v.luogo ? <span>· {v.luogo}</span> : null}
                        {sue.map((k) => (
                          <span
                            key={k}
                            className="adm-cal__unita"
                            style={{ ["--colore" as string]: info(k)?.colore ?? "#003366" }}
                          >
                            {k === "gruppo" ? "Tutto il gruppo" : etichetta(k)}
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className={`adm-pill adm-pill--${PILL_STATO[v.stato]}`}>
                      {inAttesa[v.id] ? ETICHETTA_ATTESA[inAttesa[v.id]] : ETICHETTA_STATO[v.stato]}
                    </span>
                    <Link className="adm-btn" href={`${percorso}?att=${v.id}`}>
                      Modifica
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </>
  );
}

// --------------------------------------------------------------------------

export function ModificaAttivita({
  voce,
  percorso,
  unita,
  soloLaMia,
  propone = false,
  inAttesa,
}: {
  voce: VoceAttivita;
  percorso: string;
  unita: UnitaSceglibile[];
  soloLaMia?: UnitaSceglibile;
  /**
   * Chi propone soltanto (`vaInCoda`): su un'attività pubblicata le modifiche e
   * la cancellazione vanno ai gestori, e non la ritira da qui.
   */
  propone?: boolean;
  /** che cosa aspetta già i gestori su quest'attività, se qualcosa */
  inAttesa?: InAttesa;
}) {
  const [stato, salva, inCorso] = useActionState(modificaAttivita, AZIONE_INIZIALE);
  const proponePubblicata = propone && voce.stato === "pubblicato";

  return (
    <>
      <p className="adm-links">
        <Link href={percorso}>← Tutte le attività</Link>
      </p>

      <form action={salva} className="adm-form">
        <input type="hidden" name="id" value={voce.id} />
        <div className="adm-table__head">
          <h2>{voce.titolo}</h2>
          <span className="adm-table__meta">
            <span className={`adm-pill adm-pill--${PILL_STATO[voce.stato]}`}>
              {ETICHETTA_STATO[voce.stato]}
            </span>{" "}
            anno sociale {voce.annoSociale}
          </span>
        </div>

        {inAttesa ? (
          <span className="adm-note">
            {inAttesa === "modifica"
              ? propone
                ? "Le vostre modifiche aspettano i gestori: qui sotto le ritrovate. " +
                  "Salvando di nuovo, le sostituite."
                : "C’è una modifica proposta in attesa: la trovate nella coda di approvazione."
              : inAttesa === "ritira"
                ? "È stato chiesto il ritiro dal calendario: aspetta i gestori, nella coda di approvazione."
                : "È stata chiesta la cancellazione: aspetta i gestori, nella coda di approvazione."}
          </span>
        ) : null}

        {proponePubblicata ? (
          <span className="adm-note">
            È nel calendario pubblico: le modifiche vanno ai gestori, e fino alla loro
            approvazione le famiglie continuano a vedere la versione di adesso.
          </span>
        ) : null}

        <CampiAttivita voce={voce} unita={unita} stato={stato} soloLaMia={soloLaMia} />

        <Esito stato={stato} />

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
            {inCorso ? "Salvataggio…" : proponePubblicata ? "Proponi le modifiche" : "Salva i dati"}
          </button>
        </div>
      </form>

      <div className="adm-form">
        <h2>Pubblicazione</h2>
        <span className="adm-note">
          {proponePubblicata
            ? "È nel calendario pubblico. Per toglierla chiedetene il ritiro — torna in bozza — " +
              "o la cancellazione: li decidono i gestori, e fino ad allora resta dov’è."
            : voce.stato === "pubblicato"
            ? "È nel calendario pubblico. Se la modificate e non potete pubblicare, " +
              "torna ai gestori per l’approvazione; per toglierla subito, ritiratela."
            : voce.stato === "in-revisione"
              ? "È dai gestori, in attesa di approvazione. Potete ritirarla se " +
                "vi accorgete di qualcosa."
              : "È una bozza: la vedete solo voi. Quando è pronta mandatela ai gestori."}
        </span>

        <div className="adm-form__actions">
          {voce.stato === "bozza" ? (
            <Comando
              azione={inviaAttivita}
              campi={{ id: String(voce.id), verso: "in-revisione" }}
              primary
            >
              Manda in revisione
            </Comando>
          ) : null}
          {voce.stato !== "bozza" && !proponePubblicata ? (
            <Comando azione={inviaAttivita} campi={{ id: String(voce.id), verso: "bozza" }}>
              Ritira in bozza
            </Comando>
          ) : null}
          {proponePubblicata && inAttesa !== "ritira" ? <ChiediRitiro id={voce.id} /> : null}
          {proponePubblicata ? (
            <Comando
              azione={rimuoviAttivita}
              campi={{ id: String(voce.id) }}
              conferma="Chiedere ai gestori di cancellare quest’attività?"
            >
              Chiedi di cancellarla
            </Comando>
          ) : voce.stato !== "pubblicato" ? (
            <Comando
              azione={rimuoviAttivita}
              campi={{ id: String(voce.id) }}
              conferma={
                propone
                  ? "Cancellare quest’attività? Se non l’avete creata voi, o se è già stata " +
                    "pubblicata, la richiesta va ai gestori."
                  : "Cancellare quest’attività? Non si recupera."
              }
            >
              Cancella
            </Comando>
          ) : null}
        </div>
      </div>
    </>
  );
}

/**
 * «Chiedi il ritiro»: per chi un'attività pubblicata non la ritira da sé (il
 * social media manager, audit degli accessi M-1b). Il motivo è obbligatorio,
 * perché è quello che chi decide legge nella coda.
 */
function ChiediRitiro({ id }: { id: number }) {
  const [stato, invia, inCorso] = useActionState(chiediRitiroAttivita, AZIONE_INIZIALE);
  const [aperto, setAperto] = useState(false);
  if (!aperto) {
    return (
      <button className="adm-btn" type="button" onClick={() => setAperto(true)}>
        Chiedi il ritiro
      </button>
    );
  }
  return (
    <form action={invia} className="adm-form" style={{ width: "100%" }}>
      <input type="hidden" name="id" value={id} />
      <label className="adm-field">
        <span className="adm-field__label">Perché va ritirata?</span>
        <textarea
          name="motivo"
          rows={3}
          maxLength={MOTIVO_RITIRO_MAX}
          required
          aria-invalid={(stato.stato === "errore" && stato.campo === "motivo") || undefined}
        />
      </label>
      <span className="adm-note">
        Ritirata, torna in bozza: non è cancellata, e si può rimettere nel calendario.
      </span>
      <Esito stato={stato} />
      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
          {inCorso ? "Invio…" : "Manda la richiesta"}
        </button>
        <button className="adm-btn" type="button" onClick={() => setAperto(false)}>
          Annulla
        </button>
      </div>
    </form>
  );
}
