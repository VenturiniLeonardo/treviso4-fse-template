"use client";

import clsx from "clsx";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  caricaDocumenti,
  caricaDocumento,
  modificaDocumento,
  nuovaCartella,
  ordinaCartella,
  rimuoviCartella,
  rimuoviDocumento,
  salvaCartella,
  spostaDocumento,
  statoDocumento,
} from "@/app/(area)/area-riservata/documenti/actions";
import {
  ANNO_CORRENTE,
  Comando,
  Esito,
  OpzioniAnno,
} from "@/components/area/GestioneDocumenti";
import { Icona } from "@/components/area/Icone";
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

/**
 * Documenti e archivio: i gruppi di documenti, e dentro ciascuno i suoi file.
 *
 * ## Che cosa è cambiato
 *
 * Erano tre schermate — l'elenco delle cartelle, una cartella, un documento —
 * con tre pagine da attraversare per cambiare il titolo di un PDF. Adesso è
 * **una pagina sola**:
 *
 *  - in cima i comandi, con due icone: «+» crea un gruppo, la freccia in su
 *    carica dei documenti;
 *  - sotto, l'elenco dei gruppi. Un clic su un gruppo ne mostra i documenti;
 *  - ogni gruppo e ogni documento ha la sua matita (modifica) e il suo cestino
 *    (elimina);
 *  - **trascinando** dei file dal computer su un gruppo si aprono con quel
 *    gruppo già scelto; trascinando un documento su un altro gruppo lo si sposta.
 *
 * «Gruppo» è il nome che le persone gli danno: nel codice e nell'indirizzo
 * pubblico resta «cartella» (`/documenti/<chiave>`), e non cambia.
 *
 * ## Il trascinamento è una comodità, non l'unico modo
 *
 * Ogni gesto del mouse ha il suo pulsante: si carica dall'icona anche senza
 * trascinare, e un documento si sposta cambiandone il gruppo nella matita. Chi
 * usa la tastiera o un telefono non perde niente.
 *
 * Il controllo di chi può fare che cosa non sta qui: ogni azione ripassa dal
 * cancello, per l'unità del documento.
 */

const TIPO_DOC = "application/x-sito-documento";

export function ArchivioDocumenti({
  cartelle,
  documenti,
  percorso,
  apriCartella,
  apriDocumento,
  motiviNonEliminabili,
}: {
  cartelle: Cartella[];
  documenti: DocumentoSalvato[];
  percorso: string;
  /** il gruppo da mostrare aperto: da `?cartella=` o dal documento di `?doc=` */
  apriCartella?: string;
  /** il documento con la matita già aperta, da `?doc=` */
  apriDocumento?: string;
  /** per i gruppi che non si eliminano, il perché: la chiave è quella del gruppo */
  motiviNonEliminabili: Record<string, string>;
}) {
  const [aperte, setAperte] = useState<Set<string>>(
    () => new Set(apriCartella ? [apriCartella] : []),
  );
  const [pannello, setPannello] = useState<null | "gruppo" | "carica">(null);
  const [daCaricare, setDaCaricare] = useState<{ cartella: string; file: File[] } | null>(null);
  const [sopra, setSopra] = useState<string | null>(null);
  const [esito, setEsito] = useState<StatoAzione>(AZIONE_INIZIALE);
  const [, avvia] = useTransition();

  const caricabili = cartelle.filter((c) => c.chiave !== CARTELLA_CIRCOLARI);
  const senzaFile = documenti.filter((d) => !d.file).length;

  const alterna = (chiave: string) =>
    setAperte((a) => {
      const n = new Set(a);
      if (n.has(chiave)) n.delete(chiave);
      else n.add(chiave);
      return n;
    });

  /** Quello che si sta trascinando è un file del computer o un documento già qui? */
  const trascinaFile = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const trascinaDocumento = (e: React.DragEvent) => e.dataTransfer.types.includes(TIPO_DOC);

  function rilascia(e: React.DragEvent, cartella: Cartella) {
    e.preventDefault();
    setSopra(null);

    if (trascinaDocumento(e)) {
      const id = e.dataTransfer.getData(TIPO_DOC);
      if (!id) return;
      const dati = new FormData();
      dati.set("id", id);
      dati.set("categoria", cartella.chiave);
      avvia(async () => {
        try {
          setEsito(await spostaDocumento(AZIONE_INIZIALE, dati));
          // i documenti si rimostrano dal server: l'azione ha rigenerato la pagina
          setAperte((a) => new Set(a).add(cartella.chiave));
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
    if (cartella.chiave === CARTELLA_CIRCOLARI) {
      setEsito({
        stato: "errore",
        messaggio: "Le circolari le caricano i referenti di unità: sono ciascuna della sua unità.",
      });
      return;
    }
    setEsito(AZIONE_INIZIALE);
    setDaCaricare({ cartella: cartella.chiave, file });
    setPannello("carica");
  }

  return (
    <>
      <div className="adm-doc__barra">
        <div>
          <h2>Cartelle di documenti</h2>
          <span className="adm-table__meta">
            {cartelle.length} {cartelle.length === 1 ? "cartella" : "cartelle"} · {documenti.length}{" "}
            {documenti.length === 1 ? "documento" : "documenti"}
            {senzaFile > 0 ? ` · ${senzaFile} senza file` : ""}
          </span>
        </div>
        <div className="adm-doc__icone">
          <button
            type="button"
            className={clsx("adm-iconbtn", pannello === "gruppo" && "is-attivo")}
            aria-label="Nuova cartella"
            title="Nuova cartella"
            aria-expanded={pannello === "gruppo"}
            onClick={() => setPannello(pannello === "gruppo" ? null : "gruppo")}
          >
            <Icona nome="piu" misura={20} />
          </button>
          <button
            type="button"
            className={clsx("adm-iconbtn", pannello === "carica" && "is-attivo")}
            aria-label="Carica documenti"
            title="Carica documenti"
            aria-expanded={pannello === "carica"}
            onClick={() => {
              setDaCaricare(null);
              setPannello(pannello === "carica" ? null : "carica");
            }}
          >
            <Icona nome="carica" misura={20} />
          </button>
        </div>
      </div>

      {pannello === "gruppo" ? (
        <NuovoGruppo percorso={percorso} onChiudi={() => setPannello(null)} />
      ) : null}
      {pannello === "carica" ? (
        <CaricaDocumenti
          // si rimonta quando cambia il gruppo di destinazione trascinato
          key={daCaricare ? `${daCaricare.cartella}-${daCaricare.file.length}` : "libero"}
          cartelle={caricabili}
          iniziale={daCaricare}
          onChiudi={() => {
            setPannello(null);
            setDaCaricare(null);
          }}
        />
      ) : null}

      {esito.stato !== "vuoto" ? <Esito stato={esito} /> : null}

      <ul className="adm-doc__gruppi">
        {cartelle.map((c, posizione) => {
          const dentro = documenti.filter((d) => d.categoria === c.chiave);
          const visibili = dentro.filter((d) => d.stato === "pubblicato" && d.file).length;
          const aperta = aperte.has(c.chiave);
          return (
            <li
              key={c.chiave}
              className={clsx(
                "adm-doc__gruppo",
                aperta && "is-aperto",
                sopra === c.chiave && "is-sopra",
              )}
              onDragOver={(e) => {
                if (trascinaFile(e) || trascinaDocumento(e)) {
                  e.preventDefault();
                  setSopra(c.chiave);
                }
              }}
              onDragLeave={(e) => {
                // uscire verso un figlio del gruppo non è uscire dal gruppo
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSopra(null);
              }}
              onDrop={(e) => rilascia(e, c)}
            >
              <Gruppo
                cartella={c}
                documenti={dentro}
                visibili={visibili}
                aperta={aperta}
                onAlterna={() => alterna(c.chiave)}
                primo={posizione === 0}
                ultimo={posizione === cartelle.length - 1}
                percorso={percorso}
                cartelle={caricabili}
                apriDocumento={apriDocumento}
                motivoNonEliminabile={
                  dentro.length > 0
                    ? `Per eliminarla, prima spostate i suoi ${dentro.length} documenti in un’altra cartella oppure eliminateli.`
                    : motiviNonEliminabili[c.chiave]
                }
                inserisci={() => {
                  setDaCaricare({ cartella: c.chiave, file: [] });
                  setPannello("carica");
                }}
              />
            </li>
          );
        })}
      </ul>

      {cartelle.length === 0 ? (
        <p className="adm-note">Nessuna cartella: createne una con l’icona «+» qui sopra.</p>
      ) : null}
    </>
  );
}

// --------------------------------------------------------------------------
// Un gruppo
// --------------------------------------------------------------------------

function Gruppo({
  cartella: c,
  documenti,
  visibili,
  aperta,
  onAlterna,
  primo,
  ultimo,
  percorso,
  cartelle,
  apriDocumento,
  motivoNonEliminabile,
  inserisci,
}: {
  cartella: Cartella;
  documenti: DocumentoSalvato[];
  visibili: number;
  aperta: boolean;
  onAlterna: () => void;
  /** il primo e l'ultimo gruppo: non hanno un posto sopra o sotto */
  primo: boolean;
  ultimo: boolean;
  percorso: string;
  cartelle: Cartella[];
  apriDocumento?: string;
  motivoNonEliminabile?: string;
  inserisci: () => void;
}) {
  const [modifica, setModifica] = useState(false);
  const [avviso, setAvviso] = useState<string | null>(null);
  const circolari = c.chiave === CARTELLA_CIRCOLARI;

  return (
    <>
      <div className="adm-doc__testa">
        <button
          type="button"
          className="adm-doc__apri"
          aria-expanded={aperta}
          onClick={onAlterna}
        >
          <Icona nome="freccia" misura={16} className="adm-doc__freccia" />
          <Icona nome="cartella" misura={20} />
          <span className="adm-doc__nome">
            <strong>{c.titolo}</strong>
            {c.descrizione ? <span className="c-muted">{c.descrizione}</span> : null}
          </span>
          <span className="adm-doc__conto">
            {documenti.length} {documenti.length === 1 ? "documento" : "documenti"}
          </span>
          <span className={clsx("adm-pill", `adm-pill--${visibili > 0 ? "ok" : "draft"}`)}>
            {visibili > 0 ? `${visibili} in pagina` : "non compare"}
          </span>
        </button>
        <span className="adm-doc__azioni">
          {/* L'ordine dei gruppi è quello della pagina pubblica. Niente riga di
              registro e niente messaggio: l'esito è l'elenco che si ridisegna. */}
          <Comando
            azione={ordinaCartella}
            campi={{ chiave: c.chiave, verso: "su" }}
            disabled={primo}
            etichetta={`Sposta «${c.titolo}» più in alto`}
            icona
          >
            ↑
          </Comando>
          <Comando
            azione={ordinaCartella}
            campi={{ chiave: c.chiave, verso: "giu" }}
            disabled={ultimo}
            etichetta={`Sposta «${c.titolo}» più in basso`}
            icona
          >
            ↓
          </Comando>
          {!circolari ? (
            <button
              type="button"
              className="adm-iconbtn"
              aria-label={`Carica documenti in «${c.titolo}»`}
              title="Carica documenti qui"
              onClick={inserisci}
            >
              <Icona nome="carica" />
            </button>
          ) : (
            // le circolari le caricano i referenti di unità: al posto del pulsante un
            // vuoto della stessa misura, così le icone restano in colonna
            <span className="adm-iconbtn adm-iconbtn--vuoto" aria-hidden="true" />
          )}
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
          {motivoNonEliminabile ? (
            <button
              type="button"
              className="adm-iconbtn"
              aria-label={`Elimina la cartella «${c.titolo}»`}
              title="Elimina la cartella"
              onClick={() => setAvviso(motivoNonEliminabile)}
            >
              <Icona nome="cestino" />
            </button>
          ) : (
            <Comando
              azione={rimuoviCartella}
              campi={{ chiave: c.chiave, da: percorso }}
              conferma={`Eliminare la cartella «${c.titolo}»? È vuota: non si perde nessun documento.`}
              etichetta={`Elimina la cartella «${c.titolo}»`}
              icona
            >
              <Icona nome="cestino" />
            </Comando>
          )}
        </span>
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
          {modifica ? <ModificaGruppo cartella={c} onChiudi={() => setModifica(false)} /> : null}

          {documenti.length === 0 ? (
            <p className="adm-doc__vuoto">
              {circolari
                ? "Nessuna circolare, per ora. Le caricano i referenti di unità."
                : "Nessun documento. Trascinate qui dei PDF, oppure usate l’icona di caricamento."}
            </p>
          ) : (
            <ul className="adm-doc__lista">
              {documenti.map((d) => (
                <Documento
                  key={`${d.id}-${d.aggiornato}`}
                  d={d}
                  cartelle={cartelle}
                  apertoDa={apriDocumento === d.id}
                />
              ))}
            </ul>
          )}

          <p className="adm-doc__piede">
            <Link href={`/documenti/${c.chiave}`} target="_blank" className="adm-doc__link">
              <Icona nome="apri" misura={15} /> Vedi la pagina pubblica
            </Link>
            <span className="c-muted">/documenti/{c.chiave}</span>
          </p>
        </div>
      ) : null}
    </>
  );
}

function ModificaGruppo({ cartella: c, onChiudi }: { cartella: Cartella; onChiudi: () => void }) {
  const [stato, salva, inCorso] = useActionState(salvaCartella, AZIONE_INIZIALE);
  return (
    <form className="adm-form adm-form--incassato" action={salva}>
      <input type="hidden" name="chiave" value={c.chiave} />
      <h3>Modifica la cartella</h3>
      <span className="adm-note">
        L’indirizzo, <code>/documenti/{c.chiave}</code>, non cambia con il nome: i collegamenti
        già mandati alle famiglie continuano a funzionare.
      </span>
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
          <span className="adm-field__hint">La riga sotto il nome, nella pagina Documenti.</span>
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
  apertoDa,
}: {
  d: DocumentoSalvato;
  cartelle: Cartella[];
  apertoDa: boolean;
}) {
  const [modifica, setModifica] = useState(apertoDa);
  const circolare = d.categoria === CARTELLA_CIRCOLARI;

  return (
    <li className="adm-doc__riga">
      <div
        className="adm-doc__rigatesta"
        // le circolari non si spostano: sono delle unità
        draggable={!circolare}
        onDragStart={(e) => {
          e.dataTransfer.setData(TIPO_DOC, d.id);
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        <Icona nome="documento" misura={20} />
        <span className="adm-doc__titolo">
          <strong>{d.titolo}</strong>
          <span className="c-muted">
            {d.file ? `${d.formato} · ${d.peso} · ` : ""}
            {d.anno === null ? "sempre valido" : `anno sociale ${validitaDocumento(d.anno)}`}
          </span>
        </span>
        <span
          className={clsx("adm-pill", `adm-pill--${d.file ? PILL_STATO[d.stato] : "stop"}`)}
        >
          {d.file ? ETICHETTA_STATO[d.stato] : "senza file"}
        </span>
        <span className="adm-doc__azioni">
          {d.file ? (
            <Link
              className="adm-iconbtn"
              href={`/documento/${d.file}`}
              target="_blank"
              aria-label={`Apri il file di «${d.titolo}»`}
              title="Apri il file"
            >
              <Icona nome="apri" />
            </Link>
          ) : null}
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
            azione={rimuoviDocumento}
            campi={{ id: d.id }}
            conferma={`Eliminare «${d.titolo}» e il suo file? Non si torna indietro.`}
            etichetta={`Elimina «${d.titolo}»`}
            icona
          >
            <Icona nome="cestino" />
          </Comando>
        </span>
      </div>
      {modifica ? (
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
  d: DocumentoSalvato;
  cartelle: Cartella[];
  onChiudi: () => void;
}) {
  const [statoDati, salva, salvando] = useActionState(modificaDocumento, AZIONE_INIZIALE);
  const [statoFile, carica, caricando] = useActionState(caricaDocumento, AZIONE_INIZIALE);
  const diGruppo = d.unita === "gruppo";

  return (
    <div className="adm-doc__editor">
      <form className="adm-form adm-form--incassato" action={salva}>
        <input type="hidden" name="id" value={d.id} />
        <h3>Dati del documento</h3>
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
              <select name="categoria" defaultValue={d.categoria} required>
                {cartelle.map((c) => (
                  <option value={c.chiave} key={c.chiave}>
                    {c.titolo}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="adm-field">
            <span className="adm-field__label">Validità</span>
            <select name="anno" defaultValue={d.anno ?? SEMPRE_VALIDO} required>
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
            rows={2}
            defaultValue={d.avviso}
            maxLength={AVVISO_MAX}
            placeholder="Chi è già tesserato in un altro gruppo non compila questo modulo: chiede il trasferimento al suo gruppo."
          />
          <span className="adm-field__hint">
            Compare in un riquadro giallo sotto il documento, nella pagina pubblica.
          </span>
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
        <h3>{d.file ? "Sostituisci il file" : "Carica il file"}</h3>
        <span className="adm-note">
          PDF o DOCX, fino a {pesoLeggibile(DOC_PESO_MAX)}.{" "}
          {d.file
            ? `Ora: ${d.formato}, ${d.peso}, aggiornato ${d.aggiornamento}. Il precedente viene cancellato.`
            : "Finché manca, in pagina il documento porta alla schermata «non ancora disponibile»."}
        </span>
        <input
          type="file"
          name="file"
          accept=".pdf,.docx,application/pdf"
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

      <div className="adm-form adm-form--incassato">
        <h3>Pubblicazione</h3>
        <span className="adm-note">
          Un documento pubblicato è scaricabile da chiunque visiti il sito. Senza file non si
          può pubblicare.
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
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// I due pannelli in cima
// --------------------------------------------------------------------------

function NuovoGruppo({ percorso, onChiudi }: { percorso: string; onChiudi: () => void }) {
  const [stato, crea, inCorso] = useActionState(nuovaCartella, AZIONE_INIZIALE);
  return (
    <form className="adm-form" action={crea}>
      <input type="hidden" name="da" value={percorso} />
      <h3>Nuova cartella</h3>
      <span className="adm-note">
        Per esempio «Tesseramenti» o «Campi estivi». Il nome diventa anche l’indirizzo della cartella —{" "}
        <code>/documenti/tesseramenti</code> — da mandare alle famiglie; il nome si può cambiare
        dopo, l’indirizzo resta quello.
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
            placeholder="Tesseramenti"
            aria-invalid={stato.campo === "titolo" || undefined}
          />
        </label>
        <label className="adm-field">
          <span className="adm-field__label">Descrizione (facoltativa)</span>
          <input
            type="text"
            name="descrizione"
            maxLength={200}
            placeholder="I moduli da compilare per il tesseramento annuale."
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
 * Il caricamento di più file insieme.
 *
 * Ogni file diventa un documento, con il titolo preso dal nome del file. Il peso
 * complessivo si controlla qui, prima di spedire: sopra `bodySizeLimit` è Next a
 * chiudere la richiesta, e chi carica vedrebbe una pagina «500» senza sapere che
 * cosa ha sbagliato. Il server rifà tutti i controlli.
 *
 * I file trascinati su un gruppo arrivano qui in `iniziale`: si rimettono nel
 * campo `file` con un `DataTransfer`, così il form resta quello di sempre e
 * funziona lo stesso anche se i file li sceglie chi clicca.
 */
function CaricaDocumenti({
  cartelle,
  iniziale,
  onChiudi,
}: {
  cartelle: Cartella[];
  iniziale: { cartella: string; file: File[] } | null;
  onChiudi: () => void;
}) {
  const [stato, carica, caricando] = useActionState(caricaDocumenti, AZIONE_INIZIALE);
  const [avviso, setAvviso] = useState<string | null>(null);
  const [scelti, setScelti] = useState<File[]>(iniziale?.file ?? []);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (iniziale && iniziale.file.length > 0 && campo.current) {
      const dt = new DataTransfer();
      for (const f of iniziale.file) dt.items.add(f);
      campo.current.files = dt.files;
    }
  }, [iniziale]);

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
      <input type="hidden" name="unita" value="gruppo" />
      <h3>Carica documenti</h3>
      <span className="adm-note">
        PDF o DOCX, fino a {pesoLeggibile(DOC_PESO_MAX)} l’uno, al massimo {DOC_PER_INVIO} per
        volta e {pesoLeggibile(CARICO_MAX)} in tutto. Ogni file diventa un documento, con il
        titolo preso dal nome del file: «modulo_tesseramento.pdf» diventa «Modulo tesseramento».
        Titolo e nota si correggono dopo, con la matita.
      </span>

      <div className="adm-form__grid">
        <label className="adm-field">
          <span className="adm-field__label">Cartella</span>
          <select name="cartella" defaultValue={iniziale?.cartella ?? cartelle[0]?.chiave} required>
            {cartelle.map((c) => (
              <option value={c.chiave} key={c.chiave}>
                {c.titolo}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field">
          <span className="adm-field__label">Validità</span>
          <select name="anno" defaultValue={SEMPRE_VALIDO} required>
            <OpzioniAnno />
          </select>
          <span className="adm-field__hint">
            «Sempre valido» per i moduli che non cambiano: a settembre non passano in archivio.
            L’anno in corso è {ANNO_CORRENTE.replace("-", "/")}.
          </span>
        </label>
        <label className="adm-field adm-field--larga">
          <span className="adm-field__label">File</span>
          <input
            ref={campo}
            type="file"
            name="file"
            accept=".pdf,.docx,application/pdf"
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
