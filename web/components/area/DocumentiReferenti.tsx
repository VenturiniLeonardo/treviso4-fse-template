"use client";

import clsx from "clsx";
import { useActionState, useState, useTransition } from "react";
import {
  caricaDocumentiReferenti,
  modificaDocumentoReferentiAzione,
  nuovaCartellaReferenti,
  nuovaVersioneReferenti,
  ordinaCartellaReferenti,
  rimuoviCartellaReferenti,
  rimuoviDocumentoReferenti,
  salvaCartellaReferenti,
} from "@/app/(area)/area-riservata/documenti-referenti/actions";
import { Comando, Esito } from "@/components/area/GestioneDocumenti";
import { Icona } from "@/components/area/Icone";
import {
  AZIONE_INIZIALE,
  CARICO_MAX,
  DOC_PER_INVIO,
  DOC_PESO_MAX,
  pesoLeggibile,
  type StatoAzione,
} from "@/lib/contenuti";
import {
  ACCETTA_REFERENTI,
  type CartellaReferenti,
  definizioneDi,
  type DocumentoReferenti,
  FORMATI_REFERENTI_IN_BREVE,
} from "@/lib/documenti-referenti";

/**
 * I documenti per i referenti, con la grafica di «Documenti e archivio».
 *
 * Una pagina sola, come `ArchivioDocumenti`: in cima i comandi (nuova cartella,
 * carica), sotto le cartelle che si aprono con un clic, e dentro ciascuna i
 * suoi documenti con la matita e il cestino. Si trascinano i file del computer
 * su una cartella per caricarli lì, e un documento su un'altra cartella per
 * spostarlo; ogni gesto ha anche il suo pulsante.
 *
 * **Una schermata sola per tutti i ruoli**: `puoCaricare` aggiunge i comandi, e
 * chi non carica — il referente di unità — vede le stesse cartelle nello stesso ordine,
 * senza quelle vuote. I comandi qui nascondono soltanto: il permesso lo
 * controlla ogni azione sul server. `?cartella=` e `?doc=` restano come modo di
 * arrivarci già aperti.
 */

const TIPO_DOC = "application/x-sito-documento-referenti";

/** Il percorso da cui si apre (un PDF) o si scarica (tutto il resto) un documento. */
const indirizzoFile = (d: DocumentoReferenti) => `/area-riservata/documenti-referenti/${d.file}`;

/**
 * «3 ott 2026». Con il fuso scritto: il componente si rende sul server e poi
 * nel browser, e senza fuso le due date potrebbero non coincidere a mezzanotte.
 */
const giorno = (iso: string) =>
  new Date(iso).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Rome",
  });

const conta = (n: number) => `${n} ${n === 1 ? "documento" : "documenti"}`;

export function ArchivioDocumentiReferenti({
  cartelle,
  documenti,
  percorso,
  puoCaricare,
  apriCartella,
  apriDocumento,
}: {
  cartelle: CartellaReferenti[];
  documenti: DocumentoReferenti[];
  percorso: string;
  puoCaricare: boolean;
  /** la cartella da mostrare aperta: da `?cartella=` o dal documento di `?doc=` */
  apriCartella?: number;
  /** il documento con la matita già aperta, da `?doc=` */
  apriDocumento?: number;
}) {
  const [aperte, setAperte] = useState<Set<number>>(
    () => new Set(apriCartella !== undefined ? [apriCartella] : []),
  );
  const [pannello, setPannello] = useState<null | "cartella" | "carica">(null);
  const [daCaricare, setDaCaricare] = useState<{ cartella: number; file: File[] } | null>(null);
  const [sopra, setSopra] = useState<number | null>(null);
  const [esito, setEsito] = useState<StatoAzione>(AZIONE_INIZIALE);
  const [, avvia] = useTransition();

  // il referente di unità non vede le cartelle vuote: non c'è niente da aprire
  const visibili = puoCaricare ? cartelle : cartelle.filter((c) => c.documenti > 0);
  const ultimo = documenti.reduce<string | null>(
    (u, d) => (u === null || d.caricatoIl > u ? d.caricatoIl : u),
    null,
  );

  const alterna = (id: number) =>
    setAperte((a) => {
      const n = new Set(a);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** Quello che si sta trascinando è un file del computer o un documento già qui? */
  const trascinaFile = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const trascinaDocumento = (e: React.DragEvent) => e.dataTransfer.types.includes(TIPO_DOC);

  function rilascia(e: React.DragEvent, cartella: CartellaReferenti) {
    e.preventDefault();
    setSopra(null);

    if (trascinaDocumento(e)) {
      const d = documenti.find((x) => String(x.id) === e.dataTransfer.getData(TIPO_DOC));
      if (!d || d.cartellaId === cartella.id) return;
      // lo spostamento è la stessa azione della matita, con la cartella nuova
      const dati = new FormData();
      dati.set("id", String(d.id));
      dati.set("titolo", d.titolo);
      dati.set("nota", d.nota);
      dati.set("cartella", String(cartella.id));
      avvia(async () => {
        try {
          const r = await modificaDocumentoReferentiAzione(AZIONE_INIZIALE, dati);
          setEsito(
            r.stato === "fatto"
              ? { stato: "fatto", messaggio: `«${d.titolo}» spostato in «${cartella.titolo}».` }
              : r,
          );
          setAperte((a) => new Set(a).add(cartella.id));
        } catch {
          // il server non ha risposto: un errore qui non deve buttare giù la pagina
          setEsito({
            stato: "errore",
            messaggio: "Il server non ha risposto. Ricaricate la pagina e controllate dove si trova il documento.",
          });
        }
      });
      return;
    }

    const file = [...e.dataTransfer.files];
    if (file.length === 0) return;
    setEsito(AZIONE_INIZIALE);
    setDaCaricare({ cartella: cartella.id, file });
    setPannello("carica");
  }

  return (
    <>
      <div className="adm-doc__barra">
        <div>
          <h2>Cartelle</h2>
          <span className="adm-table__meta">
            {visibili.length} {visibili.length === 1 ? "cartella" : "cartelle"} ·{" "}
            {conta(documenti.length)}
            {ultimo ? ` · ultimo caricamento ${giorno(ultimo)}` : ""} · riservate ai referenti, non
            compaiono sul sito
          </span>
        </div>
        {puoCaricare ? (
          <div className="adm-doc__icone">
            <button
              type="button"
              className={clsx("adm-iconbtn", pannello === "cartella" && "is-attivo")}
              aria-label="Nuova cartella"
              title="Nuova cartella"
              aria-expanded={pannello === "cartella"}
              onClick={() => setPannello(pannello === "cartella" ? null : "cartella")}
            >
              <Icona nome="piu" misura={20} />
            </button>
            <button
              type="button"
              className={clsx("adm-iconbtn", pannello === "carica" && "is-attivo")}
              aria-label="Carica documenti"
              title="Carica documenti"
              aria-expanded={pannello === "carica"}
              disabled={cartelle.length === 0}
              onClick={() => {
                setDaCaricare(null);
                setPannello(pannello === "carica" ? null : "carica");
              }}
            >
              <Icona nome="carica" misura={20} />
            </button>
          </div>
        ) : null}
      </div>

      {puoCaricare && pannello === "cartella" ? (
        <NuovaCartella onChiudi={() => setPannello(null)} />
      ) : null}
      {puoCaricare && pannello === "carica" ? (
        <CaricaDocumenti
          // si rimonta quando cambia la cartella di destinazione trascinata
          key={daCaricare ? `${daCaricare.cartella}-${daCaricare.file.length}` : "libero"}
          cartelle={cartelle}
          iniziale={daCaricare}
          onChiudi={() => {
            setPannello(null);
            setDaCaricare(null);
          }}
        />
      ) : null}

      {esito.stato !== "vuoto" ? <Esito stato={esito} /> : null}

      <ul className="adm-doc__gruppi">
        {visibili.map((c, posizione) => {
          const dentro = documenti.filter((d) => d.cartellaId === c.id);
          const aperta = aperte.has(c.id);
          return (
            <li
              key={c.id}
              className={clsx("adm-doc__gruppo", aperta && "is-aperto", sopra === c.id && "is-sopra")}
              onDragOver={
                puoCaricare
                  ? (e) => {
                      if (trascinaFile(e) || trascinaDocumento(e)) {
                        e.preventDefault();
                        setSopra(c.id);
                      }
                    }
                  : undefined
              }
              onDragLeave={(e) => {
                // uscire verso un figlio della cartella non è uscire dalla cartella
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSopra(null);
              }}
              onDrop={puoCaricare ? (e) => rilascia(e, c) : undefined}
            >
              <Cartella
                cartella={c}
                documenti={dentro}
                aperta={aperta}
                onAlterna={() => alterna(c.id)}
                primo={posizione === 0}
                ultimo={posizione === visibili.length - 1}
                percorso={percorso}
                cartelle={cartelle}
                puoCaricare={puoCaricare}
                apriDocumento={apriDocumento}
                inserisci={() => {
                  setDaCaricare({ cartella: c.id, file: [] });
                  setPannello("carica");
                }}
              />
            </li>
          );
        })}
      </ul>

      {visibili.length === 0 ? (
        <p className="adm-doc__vuoto">
          {puoCaricare
            ? "Nessuna cartella, per ora: createne una con l’icona «+» qui sopra, poi caricateci i documenti."
            : "Nessun documento, per ora: quando i gestori ne caricano uno, lo trovate qui."}
        </p>
      ) : null}
    </>
  );
}

// --------------------------------------------------------------------------
// Una cartella
// --------------------------------------------------------------------------

function Cartella({
  cartella: c,
  documenti,
  aperta,
  onAlterna,
  primo,
  ultimo,
  percorso,
  cartelle,
  puoCaricare,
  apriDocumento,
  inserisci,
}: {
  cartella: CartellaReferenti;
  documenti: DocumentoReferenti[];
  aperta: boolean;
  onAlterna: () => void;
  /** la prima e l'ultima cartella: non hanno un posto sopra o sotto */
  primo: boolean;
  ultimo: boolean;
  percorso: string;
  cartelle: CartellaReferenti[];
  puoCaricare: boolean;
  apriDocumento?: number;
  inserisci: () => void;
}) {
  const [modifica, setModifica] = useState(false);
  const [avviso, setAvviso] = useState<string | null>(null);

  return (
    <>
      <div className="adm-doc__testa">
        <button type="button" className="adm-doc__apri" aria-expanded={aperta} onClick={onAlterna}>
          <Icona nome="freccia" misura={16} className="adm-doc__freccia" />
          <Icona nome="cartella" misura={20} />
          <span className="adm-doc__nome">
            <strong>{c.titolo}</strong>
            {c.descrizione ? <span className="c-muted">{c.descrizione}</span> : null}
          </span>
          <span className="adm-doc__conto">{conta(documenti.length)}</span>
          {puoCaricare ? (
            <span className={clsx("adm-pill", `adm-pill--${documenti.length > 0 ? "ok" : "draft"}`)}>
              {documenti.length > 0 ? "visibile ai referenti" : "vuota, nascosta"}
            </span>
          ) : null}
        </button>
        {puoCaricare ? (
          <span className="adm-doc__azioni">
            {/* L'ordine è quello in cui i referenti di unità vedono le cartelle. Niente
                messaggio: l'esito è l'elenco che si ridisegna. */}
            <Comando
              azione={ordinaCartellaReferenti}
              campi={{ id: String(c.id), verso: "su" }}
              disabled={primo}
              etichetta={`Sposta «${c.titolo}» più in alto`}
              icona
            >
              ↑
            </Comando>
            <Comando
              azione={ordinaCartellaReferenti}
              campi={{ id: String(c.id), verso: "giu" }}
              disabled={ultimo}
              etichetta={`Sposta «${c.titolo}» più in basso`}
              icona
            >
              ↓
            </Comando>
            <button
              type="button"
              className="adm-iconbtn"
              aria-label={`Carica documenti in «${c.titolo}»`}
              title="Carica documenti qui"
              onClick={inserisci}
            >
              <Icona nome="carica" />
            </button>
            <button
              type="button"
              className={clsx("adm-iconbtn", modifica && "is-attivo")}
              aria-label={`Modifica la cartella «${c.titolo}»`}
              title="Modifica nome e descrizione"
              aria-expanded={modifica}
              onClick={() => {
                setModifica((m) => !m);
                if (!aperta) onAlterna();
              }}
            >
              <Icona nome="matita" />
            </button>
            {documenti.length > 0 ? (
              <button
                type="button"
                className="adm-iconbtn"
                aria-label={`Elimina la cartella «${c.titolo}»`}
                title="Elimina la cartella"
                onClick={() =>
                  setAvviso(
                    `Per eliminarla, prima spostate in un’altra cartella o eliminate i suoi ${conta(documenti.length)}.`,
                  )
                }
              >
                <Icona nome="cestino" />
              </button>
            ) : (
              <Comando
                azione={rimuoviCartellaReferenti}
                campi={{ id: String(c.id), da: percorso }}
                conferma={`Eliminare la cartella «${c.titolo}»? È vuota: non si perde nessun documento.`}
                etichetta={`Elimina la cartella «${c.titolo}»`}
                icona
              >
                <Icona nome="cestino" />
              </Comando>
            )}
          </span>
        ) : null}
      </div>

      {avviso ? (
        <p className="adm-esito adm-esito--ko" role="status">
          {avviso}{" "}
          <button type="button" className="adm-doc__chiudi" onClick={() => setAvviso(null)}>
            Ho capito
          </button>
        </p>
      ) : null}

      {aperta ? (
        <div className="adm-doc__corpo">
          {modifica ? <ModificaCartella cartella={c} onChiudi={() => setModifica(false)} /> : null}

          {documenti.length === 0 ? (
            <p className="adm-doc__vuoto">
              Nessun documento. Trascinate qui dei file, oppure usate l’icona di caricamento.
              Finché è vuota, i referenti di unità non la vedono.
            </p>
          ) : (
            <ul className="adm-doc__lista">
              {documenti.map((d) => (
                <Documento
                  key={`${d.id}-${d.file}-${d.cartellaId}-${d.titolo}`}
                  d={d}
                  cartelle={cartelle}
                  puoCaricare={puoCaricare}
                  apertoDa={apriDocumento === d.id}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </>
  );
}

function ModificaCartella({ cartella: c, onChiudi }: { cartella: CartellaReferenti; onChiudi: () => void }) {
  const [stato, salva, inCorso] = useActionState(salvaCartellaReferenti, AZIONE_INIZIALE);
  return (
    <form className="adm-form adm-form--incassato" action={salva}>
      <input type="hidden" name="id" value={c.id} />
      <h3>Modifica la cartella</h3>
      <div className="adm-form__grid">
        <label className="adm-field">
          <span className="adm-field__label">Nome</span>
          <input
            type="text"
            name="titolo"
            defaultValue={c.titolo}
            maxLength={60}
            required
            aria-invalid={stato.campo === "titolo" || undefined}
          />
        </label>
        <label className="adm-field">
          <span className="adm-field__label">Descrizione (facoltativa)</span>
          <input
            type="text"
            name="descrizione"
            defaultValue={c.descrizione}
            maxLength={200}
            aria-invalid={stato.campo === "descrizione" || undefined}
          />
          <span className="adm-field__hint">La riga sotto il nome, nell’elenco.</span>
        </label>
      </div>
      <Esito stato={stato} />
      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" disabled={inCorso}>
          {inCorso ? "Salvataggio…" : "Salva"}
        </button>
        <button className="adm-btn" type="button" onClick={onChiudi}>
          Chiudi
        </button>
      </div>
    </form>
  );
}

// --------------------------------------------------------------------------
// Un documento
// --------------------------------------------------------------------------

function Documento({
  d,
  cartelle,
  puoCaricare,
  apertoDa,
}: {
  d: DocumentoReferenti;
  cartelle: CartellaReferenti[];
  puoCaricare: boolean;
  apertoDa: boolean;
}) {
  const [modifica, setModifica] = useState(puoCaricare && apertoDa);
  const pdf = d.formato === "PDF";

  return (
    <li className="adm-doc__riga">
      <div
        className="adm-doc__rigatesta"
        draggable={puoCaricare}
        onDragStart={(e) => {
          e.dataTransfer.setData(TIPO_DOC, String(d.id));
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        <Icona nome="documento" misura={20} />
        <span className="adm-doc__titolo">
          <strong>{d.titolo}</strong>
          <span className="c-muted" title={definizioneDi(d.formato)?.nome}>
            {d.formato} · {pesoLeggibile(d.byte)} · caricato il {giorno(d.caricatoIl)}
          </span>
          {d.nota ? <span className="c-muted">{d.nota}</span> : null}
        </span>
        <span className="adm-doc__azioni">
          {/* Un PDF il browser lo mostra; gli altri formati la rotta li manda
              sempre come allegato, quindi lo stesso indirizzo li scarica. */}
          <a
            className="adm-iconbtn"
            href={indirizzoFile(d)}
            target={pdf ? "_blank" : undefined}
            rel={pdf ? "noopener" : undefined}
            aria-label={`${pdf ? "Apri" : "Scarica"} «${d.titolo}»`}
            title={pdf ? "Apri il file" : "Scarica il file"}
          >
            <Icona nome="apri" />
          </a>
          {puoCaricare ? (
            <>
              <button
                type="button"
                className={clsx("adm-iconbtn", modifica && "is-attivo")}
                aria-label={`Modifica «${d.titolo}»`}
                title="Modifica"
                aria-expanded={modifica}
                onClick={() => setModifica((m) => !m)}
              >
                <Icona nome="matita" />
              </button>
              <Comando
                azione={rimuoviDocumentoReferenti}
                campi={{ id: String(d.id) }}
                conferma={`Eliminare «${d.titolo}» e il suo file? Non si torna indietro.`}
                etichetta={`Elimina «${d.titolo}»`}
                icona
              >
                <Icona nome="cestino" />
              </Comando>
            </>
          ) : null}
        </span>
      </div>
      {puoCaricare && modifica ? (
        <EditorDocumento d={d} cartelle={cartelle} onChiudi={() => setModifica(false)} />
      ) : null}
    </li>
  );
}

function EditorDocumento({
  d,
  cartelle,
  onChiudi,
}: {
  d: DocumentoReferenti;
  cartelle: CartellaReferenti[];
  onChiudi: () => void;
}) {
  const [statoDati, salva, salvando] = useActionState(modificaDocumentoReferentiAzione, AZIONE_INIZIALE);
  const [statoFile, carica, caricando] = useActionState(nuovaVersioneReferenti, AZIONE_INIZIALE);

  return (
    <div className="adm-doc__editor">
      <form className="adm-form adm-form--incassato" action={salva}>
        <input type="hidden" name="id" value={d.id} />
        <h3>Dati del documento</h3>
        <span className="adm-note">
          {definizioneDi(d.formato)?.nome ?? d.formato}, {pesoLeggibile(d.byte)} · caricato il{" "}
          {giorno(d.caricatoIl)}
          {d.autore ? ` da ${d.autore}` : ""}.
        </span>
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
          <label className="adm-field">
            <span className="adm-field__label">Cartella</span>
            <select
              name="cartella"
              defaultValue={String(d.cartellaId)}
              required
              aria-invalid={statoDati.campo === "cartella" || undefined}
            >
              {cartelle.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.titolo}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="adm-field">
          <span className="adm-field__label">Nota (facoltativa)</span>
          <input
            type="text"
            name="nota"
            defaultValue={d.nota}
            maxLength={500}
            placeholder="Approvato nella riunione del 2 ottobre."
            aria-invalid={statoDati.campo === "nota" || undefined}
          />
          <span className="adm-field__hint">La riga sotto il titolo, nell’elenco.</span>
        </label>
        <Esito stato={statoDati} />
        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" disabled={salvando}>
            {salvando ? "Salvataggio…" : "Salva i dati"}
          </button>
          <button className="adm-btn" type="button" onClick={onChiudi}>
            Chiudi
          </button>
        </div>
      </form>

      <form className="adm-form adm-form--incassato" action={carica}>
        <input type="hidden" name="id" value={d.id} />
        <h3>Sostituisci il file</h3>
        <span className="adm-note">
          {FORMATI_REFERENTI_IN_BREVE}, fino a {pesoLeggibile(DOC_PESO_MAX)}. Titolo, nota e cartella
          restano; il file di adesso viene cancellato.
        </span>
        <input
          type="file"
          name="file"
          accept={ACCETTA_REFERENTI}
          required
          aria-invalid={statoFile.campo === "file" || undefined}
        />
        <Esito stato={statoFile} />
        <div className="adm-form__actions">
          <button className="adm-btn" disabled={caricando}>
            {caricando ? "Caricamento…" : "Carica"}
          </button>
        </div>
      </form>
    </div>
  );
}

// --------------------------------------------------------------------------
// I due pannelli in cima
// --------------------------------------------------------------------------

function NuovaCartella({ onChiudi }: { onChiudi: () => void }) {
  // senza `da` l'azione non porta altrove: la cartella nuova compare nell'elenco
  const [stato, crea, inCorso] = useActionState(nuovaCartellaReferenti, AZIONE_INIZIALE);
  return (
    <form className="adm-form" action={crea}>
      <h3>Nuova cartella</h3>
      <span className="adm-note">
        Per esempio «Comunità referenti», «Formazione» o «Regolamenti». Nome e descrizione si possono
        cambiare in seguito.
      </span>
      <div className="adm-form__grid">
        <label className="adm-field">
          <span className="adm-field__label">Nome</span>
          <input
            type="text"
            name="titolo"
            maxLength={60}
            required
            autoFocus
            placeholder="Comunità referenti"
            aria-invalid={stato.campo === "titolo" || undefined}
          />
        </label>
        <label className="adm-field">
          <span className="adm-field__label">Descrizione (facoltativa)</span>
          <input
            type="text"
            name="descrizione"
            maxLength={200}
            placeholder="Verbali e programmi delle riunioni."
            aria-invalid={stato.campo === "descrizione" || undefined}
          />
        </label>
      </div>
      <Esito stato={stato} />
      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" disabled={inCorso}>
          {inCorso ? "Creazione…" : "Crea la cartella"}
        </button>
        <button className="adm-btn" type="button" onClick={onChiudi}>
          Annulla
        </button>
      </div>
    </form>
  );
}

/**
 * Il caricamento di più file insieme. Il peso complessivo si controlla qui,
 * prima di spedire, per la stessa ragione di «Documenti e archivio»: sopra
 * `bodySizeLimit` è Next a chiudere la richiesta, con una pagina «500» al posto
 * di un messaggio. I file trascinati su una cartella arrivano in `iniziale` e
 * si rimettono nel campo con un `DataTransfer`.
 */
function CaricaDocumenti({
  cartelle,
  iniziale,
  onChiudi,
}: {
  cartelle: CartellaReferenti[];
  iniziale: { cartella: number; file: File[] } | null;
  onChiudi: () => void;
}) {
  const [stato, carica, caricando] = useActionState(caricaDocumentiReferenti, AZIONE_INIZIALE);
  const [avviso, setAvviso] = useState<string | null>(null);
  const [scelti, setScelti] = useState<File[]>(iniziale?.file ?? []);

  // ref a callback: il campo riceve i file trascinati appena c'è
  const riempi = (campo: HTMLInputElement | null) => {
    if (campo && iniziale && iniziale.file.length > 0 && campo.files?.length === 0) {
      const dt = new DataTransfer();
      for (const f of iniziale.file) dt.items.add(f);
      campo.files = dt.files;
    }
  };

  function pesaEInvia(e: React.FormEvent<HTMLFormElement>) {
    const file = new FormData(e.currentTarget)
      .getAll("file")
      .filter((f): f is File => f instanceof File && f.size > 0);
    const totale = file.reduce((s, f) => s + f.size, 0);
    if (file.length > DOC_PER_INVIO) {
      e.preventDefault();
      setAvviso(
        `Avete scelto ${file.length} file: in una volta sola se ne caricano al massimo ` +
          `${DOC_PER_INVIO}. Caricateli in due riprese.`,
      );
      return;
    }
    if (totale > CARICO_MAX) {
      e.preventDefault();
      setAvviso(
        `${file.length} file per ${pesoLeggibile(totale)}: in una volta sola si possono mandare ` +
          `al massimo ${pesoLeggibile(CARICO_MAX)}. Caricateli in due o tre riprese.`,
      );
      return;
    }
    setAvviso(null);
  }

  return (
    <form className="adm-form" action={carica} onSubmit={pesaEInvia}>
      <h3>Carica documenti</h3>
      <span className="adm-note">
        {FORMATI_REFERENTI_IN_BREVE}, fino a {pesoLeggibile(DOC_PESO_MAX)} l’uno, al massimo{" "}
        {DOC_PER_INVIO} per volta e {pesoLeggibile(CARICO_MAX)} in tutto. Ogni file diventa un
        documento, con il titolo preso dal nome: «verbale_coca_ottobre.docx» diventa «Verbale coca
        ottobre». I referenti di unità lo vedono appena caricato; titolo e nota si correggono con la matita.
      </span>

      <div className="adm-form__grid">
        <label className="adm-field">
          <span className="adm-field__label">Cartella</span>
          <select
            name="cartella"
            defaultValue={String(iniziale?.cartella ?? cartelle[0]?.id ?? "")}
            required
          >
            {cartelle.map((c) => (
              <option value={c.id} key={c.id}>
                {c.titolo}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field adm-field--larga">
          <span className="adm-field__label">File</span>
          <input
            ref={riempi}
            type="file"
            name="file"
            accept={ACCETTA_REFERENTI}
            multiple
            required
            onChange={(e) => setScelti([...(e.target.files ?? [])])}
            aria-invalid={stato.campo === "file" || undefined}
          />
          <span className="adm-field__hint">
            {scelti.length > 0
              ? `${scelti.length} ${scelti.length === 1 ? "file scelto" : "file scelti"}: ${scelti
                  .slice(0, 4)
                  .map((f) => f.name)
                  .join(", ")}${scelti.length > 4 ? "…" : ""}`
              : "Si possono selezionare più file insieme, o trascinarli su una cartella dell’elenco."}
          </span>
        </label>
      </div>

      {avviso ? (
        <p className="adm-esito adm-esito--ko" role="alert">
          {avviso}
        </p>
      ) : (
        <Esito stato={stato} />
      )}

      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" disabled={caricando}>
          {caricando ? "Caricamento…" : "Carica"}
        </button>
        <button className="adm-btn" type="button" onClick={onChiudi}>
          Chiudi
        </button>
      </div>
    </form>
  );
}
