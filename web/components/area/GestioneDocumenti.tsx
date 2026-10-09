"use client";

import clsx from "clsx";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  caricaDocumenti,
  caricaDocumento,
  modificaDocumento,
  nuovoDocumento,
  rimuoviCartella,
  rimuoviDocumento,
  salvaCartella,
  statoDocumento,
} from "@/app/(area)/area-riservata/documenti/actions";
import {
  AVVISO_MAX,
  AZIONE_INIZIALE,
  CARICO_MAX,
  type Cartella,
  CARTELLA_CIRCOLARI,
  DOC_PER_INVIO,
  DOC_PESO_MAX,
  type DocumentoSalvato,
  ETICHETTA_STATO,
  pesoLeggibile,
  PILL_STATO,
  SEMPRE_VALIDO,
  type StatoAzione,
  validitaDocumento,
} from "@/lib/contenuti";
import { ANNI_DOC, labelDiUnita } from "@/lib/data";

/**
 * Gestione dei documenti: le cartelle, i documenti di ciascuna, l'editor.
 *
 * Tre viste della stessa rotta, come per gli album: l'elenco delle cartelle,
 * una cartella (`?cartella=`) e un documento (`?doc=`). I comandi qui
 * nascondono soltanto: il permesso lo controlla ogni azione sul server.
 *
 * ## Dalle categorie alle cartelle
 *
 * Fino alla migrazione 0012 la schermata era un elenco per anno, con sei
 * categorie fisse. La richiesta dei gestori del 25 settembre 2026 è stata di
 * poter aprire «Tesseramenti» o «Campi estivi» e trovarci tutti i moduli — moduli
 * che non cambiano da un anno all'altro. Quindi la cartella viene prima
 * dell'anno, e l'anno diventa facoltativo: «sempre valido» è la scelta di
 * partenza quando si carica in una cartella del gruppo.
 */

export function Esito({ stato }: { stato: StatoAzione }) {
  if (stato.stato === "vuoto") return null;
  return (
    <p
      className={clsx("adm-esito", stato.stato === "errore" ? "adm-esito--ko" : "adm-esito--ok")}
      role="status"
    >
      {stato.messaggio}
    </p>
  );
}

export function Comando({
  azione,
  campi,
  children,
  primary,
  conferma,
  disabled,
  etichetta,
  icona,
}: {
  azione: (stato: StatoAzione, dati: FormData) => Promise<StatoAzione>;
  campi: Record<string, string>;
  children: React.ReactNode;
  primary?: boolean;
  conferma?: string;
  disabled?: boolean;
  /** il nome del pulsante per chi non lo vede, quando il testo è un simbolo */
  etichetta?: string;
  /** un pulsante quadrato con la sola icona, come matita e cestino */
  icona?: boolean;
}) {
  const [stato, invia, inCorso] = useActionState(azione, AZIONE_INIZIALE);
  return (
    <form action={invia} className="adm-comando">
      {Object.entries(campi).map(([n, v]) => (
        <input type="hidden" name={n} value={v} key={n} />
      ))}
      <button
        className={clsx(icona ? "adm-iconbtn" : "adm-btn", primary && "adm-btn--primary")}
        type="submit"
        disabled={inCorso || disabled}
        aria-label={etichetta}
        title={etichetta}
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

const conta = (n: number) => `${n} ${n === 1 ? "documento" : "documenti"}`;

/** L'anno sociale in corso, quello che la pagina pubblica mette in testa. */
export const ANNO_CORRENTE = ANNI_DOC.find((a) => a.corrente)?.chiave ?? ANNI_DOC[0].chiave;

/**
 * Le opzioni del menù dell'anno: prima «sempre valido», poi gli anni sociali.
 *
 * L'anno del documento si aggiunge se non è fra quelli del codice — un anno
 * aperto a settembre sta in `anni_sociali` prima che in `ANNI_DOC` — perché un
 * menù che non contiene il valore attuale lo cambierebbe in silenzio al primo
 * salvataggio.
 */
export function OpzioniAnno({ attuale }: { attuale?: string | null }) {
  const anni = ANNI_DOC.map((a) => ({ chiave: a.chiave, label: a.label }));
  if (attuale && !anni.some((a) => a.chiave === attuale)) {
    anni.push({ chiave: attuale, label: attuale.replace("-", " – ") });
  }
  return (
    <>
      <option value={SEMPRE_VALIDO}>Sempre valido — non scade</option>
      {anni.map((a) => (
        <option value={a.chiave} key={a.chiave}>
          Anno sociale {a.label}
        </option>
      ))}
    </>
  );
}

// --------------------------------------------------------------------------
// Una cartella
// --------------------------------------------------------------------------

const GRIGLIA = "minmax(0, 1.9fr) 70px 80px 105px 130px";
const GRIGLIA_CON_UNITA = "minmax(0, 1.6fr) minmax(0, 1fr) 70px 80px 105px 130px";

/** I documenti divisi per validità: prima i sempre validi, poi gli anni, dal più recente. */
function perValidita(documenti: DocumentoSalvato[]) {
  const anni = [...new Set(documenti.map((d) => d.anno).filter((a): a is string => a !== null))]
    .sort()
    .reverse();
  return [
    { chiave: SEMPRE_VALIDO, titolo: "Sempre validi", docs: documenti.filter((d) => d.anno === null) },
    ...anni.map((a) => ({
      chiave: a,
      titolo: `Anno sociale ${validitaDocumento(a)}${a === ANNO_CORRENTE ? " · in corso" : ""}`,
      docs: documenti.filter((d) => d.anno === a),
    })),
  ].filter((g) => g.docs.length > 0);
}

/**
 * Il caricamento di più file insieme.
 *
 * Ogni file diventa un documento, con il titolo preso dal nome del file. Il peso
 * complessivo si controlla qui, prima di spedire, per la stessa ragione delle
 * fotografie: sopra `bodySizeLimit` è Next a chiudere la richiesta, e chi carica
 * vede una pagina «500» senza sapere che cosa ha sbagliato. Il server rifà tutti
 * i controlli; questo è l'unico che non può fare, perché riguarda ciò che non
 * gli arriva.
 */
function CaricaInCartella({
  cartella,
  unita,
  annoPredefinito,
}: {
  cartella: Cartella;
  unita: string;
  annoPredefinito: string;
}) {
  const [stato, carica, caricando] = useActionState(caricaDocumenti, AZIONE_INIZIALE);
  const [avviso, setAvviso] = useState<string | null>(null);

  function pesaEInvia(e: React.FormEvent<HTMLFormElement>) {
    const scelti = new FormData(e.currentTarget)
      .getAll("file")
      .filter((f): f is File => f instanceof File && f.size > 0);
    const totale = scelti.reduce((s, f) => s + f.size, 0);
    if (scelti.length > DOC_PER_INVIO) {
      e.preventDefault();
      setAvviso(
        `Avete scelto ${scelti.length} file: in una volta sola se ne caricano al massimo ` +
          `${DOC_PER_INVIO}. Caricateli in due riprese.`,
      );
      return;
    }
    if (totale > CARICO_MAX) {
      e.preventDefault();
      setAvviso(
        `${scelti.length} file per ${pesoLeggibile(totale)}: in una volta sola si possono ` +
          `mandare al massimo ${pesoLeggibile(CARICO_MAX)}. Caricateli in due o tre riprese.`,
      );
      return;
    }
    setAvviso(null);
  }

  return (
    <form className="adm-form adm-form--editor" action={carica} onSubmit={pesaEInvia}>
      <input type="hidden" name="cartella" value={cartella.chiave} />
      <input type="hidden" name="unita" value={unita} />

      <h2>Carica documenti in «{cartella.titolo}»</h2>
      <span className="adm-note">
        PDF o DOCX, fino a {pesoLeggibile(DOC_PESO_MAX)} l’uno, al massimo {DOC_PER_INVIO} per
        volta e {pesoLeggibile(CARICO_MAX)} in tutto. Ogni file diventa un documento, con il
        titolo preso dal nome del file: «modulo_tesseramento.pdf» diventa «Modulo tesseramento».
        Titolo e nota si correggono dopo, dal documento.
      </span>

      <div className="adm-form__grid">
        <label className="adm-field">
          <span className="adm-field__label">File</span>
          <input
            type="file"
            name="file"
            accept=".pdf,.docx,application/pdf"
            multiple
            required
            aria-invalid={stato.campo === "file" || undefined}
          />
          <span className="adm-field__hint">Si possono selezionare più file insieme.</span>
        </label>
        <label className="adm-field">
          <span className="adm-field__label">Validità</span>
          <select name="anno" defaultValue={annoPredefinito} required>
            <OpzioniAnno />
          </select>
          <span className="adm-field__hint">
            «Sempre valido» per i moduli che non cambiano: a settembre non passano in
            archivio.
          </span>
        </label>
      </div>

      <label className="adm-scelta">
        <input type="checkbox" name="pubblica" value="1" defaultChecked />
        <span>
          <strong>Pubblicali subito</strong>
          <em>
            Compaiono nella pagina appena caricati. Togliete il segno per controllarli prima:
            restano in bozza.
          </em>
        </span>
      </label>

      {avviso ? (
        <p className="adm-esito adm-esito--ko" role="alert">
          {avviso}
        </p>
      ) : (
        <Esito stato={stato} />
      )}

      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" type="submit" disabled={caricando}>
          {caricando ? "Caricamento…" : "Carica"}
        </button>
      </div>
    </form>
  );
}

/**
 * Una cartella: il caricamento, i suoi documenti divisi per validità, la voce
 * senza file e — per chi le gestisce — nome, descrizione ed eliminazione.
 *
 * ## `unitaFissa`, per la sezione «Circolari» del referente di unità
 *
 * È **la stessa schermata**, sulla cartella delle circolari e con due
 * differenze: l'unità non si sceglie — la porta la sessione — e le impostazioni
 * della cartella non ci sono, perché la cartella è di tutto il sito. L'unità
 * viaggia in un campo nascosto e non in un menù: un menù con sei unità di cui
 * cinque danno un rifiuto è un modo di far sbagliare le persone. Il controllo
 * vero resta nell'azione, che confronta l'unità inviata con quella della
 * sessione.
 *
 * ## La cartella delle circolari, vista dal gestore
 *
 * Si vede e si corregge, ma non ci si carica: un documento del gruppo fra le
 * circolari viola `documenti_circolari_hanno_unita`, e le circolari le carica il
 * referente dell'unità a cui riguardano.
 */
export function VistaCartella({
  cartella,
  documenti,
  percorso,
  unitaFissa,
  eliminabile,
  motivoNonEliminabile,
}: {
  cartella: Cartella;
  /** i documenti di questa cartella; per il referente di unità, solo quelli della sua unità */
  documenti: DocumentoSalvato[];
  percorso: string;
  /** presente nella sezione del referente di unità: fissa l'unità e toglie le impostazioni */
  unitaFissa?: { chiave: string; label: string };
  eliminabile?: boolean;
  /** perché il pulsante «Elimina la cartella» non c'è, detto a chi lo cerca */
  motivoNonEliminabile?: string;
}) {
  const circolari = cartella.chiave === CARTELLA_CIRCOLARI;
  // il gestore non carica fra le circolari: vedi la nota sopra
  const puoCaricare = !circolari || Boolean(unitaFissa);
  const conUnita = circolari && !unitaFissa;
  const griglia = conUnita ? GRIGLIA_CON_UNITA : GRIGLIA;

  const [statoVoce, creaVoce, creandoVoce] = useActionState(nuovoDocumento, AZIONE_INIZIALE);
  const [statoCartella, salva, salvando] = useActionState(salvaCartella, AZIONE_INIZIALE);

  const gruppi = perValidita(documenti);
  const sempre = documenti.filter((d) => d.anno === null).length;
  const correnti = documenti.filter((d) => d.anno === ANNO_CORRENTE).length;
  const senzaFile = documenti.filter((d) => !d.file).length;

  return (
    <>
      {unitaFissa ? null : (
        <div className="adm-torna">
          <Link className="adm-btn" href={percorso}>
            ← Tutte le cartelle
          </Link>
          <Link className="adm-btn" href={`/documenti/${cartella.chiave}`} target="_blank">
            Vedi la pagina pubblica
          </Link>
        </div>
      )}

      <div className="adm-kpi">
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">Documenti</span>
          <span className="adm-kpi__value">{documenti.length}</span>
        </div>
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">Sempre validi</span>
          <span className="adm-kpi__value">{sempre}</span>
        </div>
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">Dell’anno in corso</span>
          <span className="adm-kpi__value">{correnti}</span>
        </div>
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">Ancora senza file</span>
          <span className={clsx("adm-kpi__value", senzaFile > 0 && "adm-kpi__value--red")}>
            {senzaFile}
          </span>
        </div>
      </div>

      {puoCaricare ? (
        <CaricaInCartella
          cartella={cartella}
          unita={unitaFissa?.chiave ?? "gruppo"}
          // le circolari sono quasi sempre di un'uscita dell'anno; i moduli di
          // una cartella del gruppo, quasi sempre per sempre
          annoPredefinito={unitaFissa ? ANNO_CORRENTE : SEMPRE_VALIDO}
        />
      ) : (
        <div className="adm-notice">
          <span className="adm-notice__tag">Circolari</span>
          <p>
            Le circolari le caricano i referenti di unità, dalla loro sezione «Circolari e liste»:
            ciascuna è della sua unità. Qui le vedete tutte, e potete correggerle o toglierle
            dalla pagina.
          </p>
        </div>
      )}

      {gruppi.map((g) => (
        <div className="adm-table" key={g.chiave}>
          <div className="adm-table__head">
            <h2>{g.titolo}</h2>
            <span className="adm-table__meta">{conta(g.docs.length)}</span>
          </div>
          <div className="adm-table__box">
            <div className="adm-tr adm-tr--head" style={{ gridTemplateColumns: griglia }}>
              <span className="adm-th">Titolo</span>
              {conUnita ? <span className="adm-th">Unità</span> : null}
              <span className="adm-th">Tipo</span>
              <span className="adm-th">Peso</span>
              <span className="adm-th">Stato</span>
              <span className="adm-th">Azioni</span>
            </div>
            {g.docs.map((d) => (
              <div className="adm-tr" style={{ gridTemplateColumns: griglia }} key={d.id}>
                <span className="c-strong">{d.titolo}</span>
                {conUnita ? <span className="c-muted">{labelDiUnita(d.unita)}</span> : null}
                {/* `data-etichetta`: al telefono la riga diventa una scheda e
                    l'intestazione della tabella sparisce (§ admin.css, ≤900 px).
                    Queste due celle sono un formato e un peso — «PDF», «1,2 MB»,
                    o un trattino quando il file non c'è ancora — e da sole non si
                    spiegano: nella scheda comparivano due «—» in fila senza modo
                    di sapere quale fosse il tipo e quale il peso. Le altre celle
                    non ne hanno bisogno: il titolo porta già la propria parola. */}
                <span className="c-mono" data-etichetta="Tipo">
                  {d.file ? d.formato : "—"}
                </span>
                <span className="c-mono" data-etichetta="Peso">
                  {d.file ? d.peso : "—"}
                </span>
                <span
                  className={clsx(
                    "adm-pill",
                    `adm-pill--${d.file ? PILL_STATO[d.stato] : "stop"}`,
                  )}
                >
                  {d.file ? ETICHETTA_STATO[d.stato] : "senza file"}
                </span>
                <span className="adm-riga-azioni">
                  <Link className="adm-btn" href={`${percorso}?doc=${encodeURIComponent(d.id)}`}>
                    Modifica
                  </Link>
                  {d.file ? (
                    <Link className="adm-btn" href={`/documento/${d.file}`} target="_blank">
                      Apri
                    </Link>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {gruppi.length === 0 ? (
        <div className="adm-table">
          <div className="adm-table__box">
            <div className="adm-tr adm-tr--vuota">
              <span className="c-muted">
                {puoCaricare
                  ? "Nessun documento in questa cartella: caricate i primi qui sopra."
                  : "Nessuna circolare, per ora."}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {puoCaricare ? (
        <form className="adm-form" action={creaVoce}>
          {/* L'unità e la cartella: campi nascosti, non tendine. Vedi la nota
              sopra su `unitaFissa`. */}
          <input type="hidden" name="unita" value={unitaFissa?.chiave ?? "gruppo"} />
          <input type="hidden" name="categoria" value={cartella.chiave} />

          <h2>{unitaFissa ? "Nuova circolare, senza file" : "Nuova voce, senza file"}</h2>
          <span className="adm-note">
            Per annunciare un documento prima di averlo: la voce compare nell’elenco e si
            completa caricando il file quando il modulo è pronto.
            {unitaFissa ? (
              <>
                {" "}
                Le circolari di <strong>{unitaFissa.label}</strong> le pubblicate voi: non
                passano dalla coda dei gestori.
              </>
            ) : null}
          </span>

          <div className="adm-form__grid">
            <label className="adm-field">
              <span className="adm-field__label">Titolo</span>
              <input
                type="text"
                name="titolo"
                maxLength={90}
                required
                placeholder="Autorizzazione uscita invernale"
                aria-invalid={statoVoce.campo === "titolo" || undefined}
              />
            </label>
            <label className="adm-field">
              <span className="adm-field__label">Validità</span>
              <select
                name="anno"
                defaultValue={unitaFissa ? ANNO_CORRENTE : SEMPRE_VALIDO}
                required
                aria-invalid={statoVoce.campo === "anno" || undefined}
              >
                <OpzioniAnno />
              </select>
            </label>
          </div>

          <label className="adm-field">
            <span className="adm-field__label">Nota</span>
            <input
              type="text"
              name="nota"
              maxLength={200}
              placeholder="Da compilare e riconsegnare ai referenti di unità entro il 15 ottobre."
            />
            <span className="adm-field__hint">La riga di spiegazione sotto al titolo.</span>
          </label>

          <Esito stato={statoVoce} />

          <div className="adm-form__actions">
            <button className="adm-btn adm-btn--primary" type="submit" disabled={creandoVoce}>
              {creandoVoce ? "Creazione…" : "Crea la scheda del documento"}
            </button>
            <button className="adm-btn" type="reset">
              Annulla
            </button>
          </div>
        </form>
      ) : null}

      {unitaFissa ? null : (
        <form className="adm-form" action={salva}>
          <input type="hidden" name="chiave" value={cartella.chiave} />
          <h2>La cartella</h2>
          <span className="adm-note">
            Indirizzo: <code>/documenti/{cartella.chiave}</code> — non cambia quando si
            cambia il nome, così i collegamenti già mandati alle famiglie continuano a
            funzionare.
          </span>

          <div className="adm-form__grid">
            <label className="adm-field">
              <span className="adm-field__label">Nome</span>
              <input
                type="text"
                name="titolo"
                defaultValue={cartella.titolo}
                maxLength={60}
                required
                aria-invalid={statoCartella.campo === "titolo" || undefined}
              />
            </label>
            <label className="adm-field">
              <span className="adm-field__label">Descrizione (facoltativa)</span>
              <input
                type="text"
                name="descrizione"
                defaultValue={cartella.descrizione}
                maxLength={200}
                aria-invalid={statoCartella.campo === "descrizione" || undefined}
              />
              <span className="adm-field__hint">La riga sotto il nome, nella pagina Documenti.</span>
            </label>
          </div>

          <Esito stato={statoCartella} />

          <div className="adm-form__actions">
            <button className="adm-btn adm-btn--primary" type="submit" disabled={salvando}>
              {salvando ? "Salvataggio…" : "Salva"}
            </button>
          </div>
        </form>
      )}

      {/* Fuori dal modulo del nome, e non per ordine: «Elimina» è un `<form>`
          suo, con la sua azione, e un modulo dentro un altro modulo non è HTML
          valido — il browser lo scarta, e React lo segnala come errore di
          idratazione. È lo stesso motivo per cui «Pubblicazione», nell'editor
          del documento, è un riquadro a parte. */}
      {unitaFissa || (!eliminabile && !motivoNonEliminabile) ? null : (
        <div className="adm-form">
          <h2>Eliminare la cartella</h2>
          {eliminabile ? (
            <>
              <span className="adm-note">
                È vuota: eliminandola non si perde nessun documento. Il suo indirizzo,
                /documenti/{cartella.chiave}, smette di funzionare.
              </span>
              <div className="adm-form__actions">
                <Comando
                  azione={rimuoviCartella}
                  campi={{ chiave: cartella.chiave, da: percorso }}
                  conferma={`Eliminare la cartella «${cartella.titolo}»? È vuota: non si perde nessun documento.`}
                >
                  Elimina la cartella
                </Comando>
              </div>
            </>
          ) : (
            <span className="adm-note">{motivoNonEliminabile}</span>
          )}
        </div>
      )}
    </>
  );
}

// --------------------------------------------------------------------------
// Editor
// --------------------------------------------------------------------------

/**
 * Un documento: i suoi dati, il file, la pubblicazione.
 *
 * La cartella si cambia da qui, ma solo fra le cartelle del gruppo: una
 * circolare resta fra le circolari — è della sua unità, lo dice il `CHECK` — e
 * un documento del gruppo non ci può entrare. Per questo il menù delle
 * circolari non c'è, e quello del gruppo non offre la loro cartella: una voce
 * che il database rifiuta non va messa in un menù.
 */
export function ModificaDocumento({
  documento: d,
  cartelle,
  indietro,
}: {
  documento: DocumentoSalvato;
  cartelle: Cartella[];
  /** dove porta «←»: la cartella del documento, o la sezione del referente di unità */
  indietro: { href: string; label: string };
}) {
  const [statoDati, salva, salvando] = useActionState(modificaDocumento, AZIONE_INIZIALE);
  const [statoFile, carica, caricando] = useActionState(caricaDocumento, AZIONE_INIZIALE);

  const diGruppo = d.unita === "gruppo";
  const scelte = cartelle.filter((c) => c.chiave !== CARTELLA_CIRCOLARI);

  return (
    <>
      <div className="adm-torna">
        <Link className="adm-btn" href={indietro.href}>
          ← {indietro.label}
        </Link>
        <span
          className={clsx("adm-pill", `adm-pill--${d.file ? PILL_STATO[d.stato] : "stop"}`)}
        >
          {d.file ? ETICHETTA_STATO[d.stato] : "senza file"}
        </span>
        {d.file ? (
          <Link className="adm-btn" href={`/documento/${d.file}`} target="_blank">
            Apri il file
          </Link>
        ) : null}
      </div>

      {/*
        `key` sull'ultima modifica: il modulo si rimonta dopo ogni salvataggio.
        Dopo un'azione React rimette i campi al loro valore predefinito, e per un
        `<select>` il predefinito è quello del **primo** montaggio — cambiato
        «Tesseramenti» in «Campi estivi» e salvato, il menù tornava a dire
        «Tesseramenti», e il salvataggio successivo avrebbe riportato indietro il
        documento senza che nessuno l'avesse chiesto.
      */}
      <form className="adm-form" action={salva} key={d.aggiornato}>
        <h2>Dati del documento</h2>
        <span className="adm-note">
          {d.anno === null ? "Sempre valido" : `Anno sociale ${validitaDocumento(d.anno)}`} ·
          nella pagina pubblica compare dentro la sua cartella.
        </span>

        <input type="hidden" name="id" value={d.id} />

        <div className="adm-form__grid">
          <label className="adm-field">
            <span className="adm-field__label">Titolo</span>
            <input
              type="text"
              name="titolo"
              defaultValue={d.titolo}
              maxLength={90}
              required
              aria-invalid={statoDati.campo === "titolo" || undefined}
            />
          </label>
          {diGruppo ? (
            <label className="adm-field">
              <span className="adm-field__label">Cartella</span>
              <select
                name="categoria"
                defaultValue={d.categoria}
                required
                aria-invalid={statoDati.campo === "categoria" || undefined}
              >
                {scelte.map((c) => (
                  <option value={c.chiave} key={c.chiave}>
                    {c.titolo}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="adm-field">
            <span className="adm-field__label">Validità</span>
            <select
              name="anno"
              defaultValue={d.anno ?? SEMPRE_VALIDO}
              required
              aria-invalid={statoDati.campo === "anno" || undefined}
            >
              <OpzioniAnno attuale={d.anno} />
            </select>
          </label>
        </div>

        <label className="adm-field">
          <span className="adm-field__label">Nota</span>
          <input type="text" name="nota" defaultValue={d.nota} maxLength={200} />
        </label>

        <label className="adm-field">
          <span className="adm-field__label">Avviso (facoltativo)</span>
          <textarea
            name="avviso"
            rows={3}
            defaultValue={d.avviso}
            maxLength={AVVISO_MAX}
            placeholder="Chi è già tesserato in un altro gruppo non compila questo modulo: chiede il trasferimento al suo gruppo."
            aria-invalid={statoDati.campo === "avviso" || undefined}
          />
          <span className="adm-field__hint">
            Compare in un riquadro giallo sotto il documento, nella pagina pubblica: per
            dire chi non deve usarlo o che cosa fare prima. Vuoto, il riquadro non c’è.
          </span>
        </label>

        <Esito stato={statoDati} />

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={salvando}>
            {salvando ? "Salvataggio…" : "Salva i dati"}
          </button>
          <button className="adm-btn" type="reset">
            Annulla
          </button>
        </div>
      </form>

      <form className="adm-form" action={carica}>
        <h2>{d.file ? "Sostituisci il file" : "Carica il file"}</h2>
        <span className="adm-note">
          PDF o DOCX, fino a {pesoLeggibile(DOC_PESO_MAX)}.{" "}
          {d.file
            ? `Attualmente: ${d.formato}, ${d.peso}, aggiornato ${d.aggiornamento}. Il file precedente viene cancellato.`
            : "Finché manca, in pagina il documento porta alla schermata «non ancora disponibile»."}
        </span>

        <input type="hidden" name="id" value={d.id} />

        <label className="adm-field">
          <span className="adm-field__label">File</span>
          <input
            type="file"
            name="file"
            accept=".pdf,.docx,application/pdf"
            required
            aria-invalid={statoFile.campo === "file" || undefined}
          />
          <span className="adm-field__hint">
            Peso, formato e data di aggiornamento si ricavano dal file: non vanno scritti
            a mano.
          </span>
        </label>

        <Esito stato={statoFile} />

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={caricando}>
            {caricando ? "Caricamento…" : "Carica"}
          </button>
        </div>
      </form>

      <div className="adm-form">
        <h2>Pubblicazione</h2>
        <span className="adm-note">
          Un documento pubblicato è scaricabile da chiunque visiti il sito. Senza file non
          si può pubblicare.
        </span>

        <div className="adm-form__actions">
          {d.stato !== "pubblicato" ? (
            <Comando azione={statoDocumento} campi={{ id: d.id, stato: "pubblicato" }} primary>
              Pubblica
            </Comando>
          ) : (
            <Comando azione={statoDocumento} campi={{ id: d.id, stato: "bozza" }}>
              Togli dalla pagina pubblica
            </Comando>
          )}
          <Comando
            azione={rimuoviDocumento}
            campi={{ id: d.id, da: indietro.href }}
            conferma="Eliminare la voce e il suo file? Non si torna indietro."
          >
            Elimina
          </Comando>
        </div>
      </div>
    </>
  );
}
