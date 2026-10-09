"use client";

import clsx from "clsx";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  cancellaFotoCestino,
  caricaFoto,
  cambiaPasswordAlbum,
  cambiaStato,
  chiediRitiroAlbum,
  modificaAlbum,
  mostraFotoAlbum,
  nascondiFotoAlbum,
  nuovoAlbum,
  rimuoviAlbum,
  rimuoviFoto,
  ripristinaFotoCestino,
  riprovaConversione,
  ritiraAssenza,
  dichiaraAssente,
} from "@/app/(area)/area-riservata/album/actions";
import {
  type AlbumSalvato,
  AZIONE_INIZIALE,
  CARICO_MAX,
  ETICHETTA_STATO,
  FOTO_LATO_MAX,
  FOTO_PESO_MAX,
  type FotoNelCestino,
  GIORNI_CESTINO,
  pesoLeggibile,
  PILL_STATO,
  type StatoAzione,
} from "@/lib/contenuti";
import { FILTRI_UNITA, labelDiUnita } from "@/lib/data";
import {
  PASSWORD_ALBUM_MAX,
  PASSWORD_ALBUM_MIN,
  proponiPasswordAlbum,
} from "@/lib/album-password";
import { MOTIVO_RITIRO_MAX } from "@/lib/proposte";

/**
 * Gestione degli album: elenco, creazione, caricamento delle fotografie e
 * passaggi di stato.
 *
 * L'elenco e l'editor sono due viste della stessa rotta, distinte da `?album=`:
 * niente finestre modali, l'indirizzo dice sempre dove si è e il tasto indietro
 * funziona. È la stessa scelta fatta per le sezioni (§04 del piano).
 *
 * Quello che si vede qui dipende dai permessi, ma **non** è quello che li fa
 * rispettare: ogni azione ricontrolla l'ambito sul server. Qui si nascondono i
 * comandi che non servono, per non proporre una strada chiusa.
 */

function Esito({ stato }: { stato: StatoAzione }) {
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
  /** domanda prima di procedere, per le cose che non si disfano */
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

/**
 * Il campo della password di un album, con la proposta casuale.
 *
 * In chiaro e non puntini: è una password da ricopiare in un avviso alle
 * famiglie, e chi la sceglie deve vedere che cosa sta per consegnare. La
 * proposta iniziale arriva dal server — generarla qui durante il rendering
 * darebbe due valori diversi fra server e browser — e il pulsante ne chiede
 * un'altra al browser, con le stesse regole (`lib/album-password.ts`).
 */
function CampoPassword({
  iniziale,
  invalido,
  suggerimento,
}: {
  iniziale?: string;
  invalido: boolean;
  suggerimento: string;
}) {
  const [valore, setValore] = useState(() => iniziale ?? proponiPasswordAlbum());
  return (
    <label className="adm-field">
      <span className="adm-field__label">Password dell’album</span>
      <span className="adm-password">
        <input
          type="text"
          name="password"
          value={valore}
          onChange={(e) => setValore(e.target.value)}
          minLength={PASSWORD_ALBUM_MIN}
          maxLength={PASSWORD_ALBUM_MAX}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="c-mono"
          aria-invalid={invalido || undefined}
        />
        <button
          className="adm-btn"
          type="button"
          onClick={() => setValore(proponiPasswordAlbum())}
        >
          Proponine un’altra
        </button>
      </span>
      <span className="adm-field__hint">{suggerimento}</span>
    </label>
  );
}

// --------------------------------------------------------------------------
// Elenco
// --------------------------------------------------------------------------

export function ElencoAlbum({
  album,
  percorso,
  puoPubblicare,
  unitaAmmesse,
  senzaPassword,
  passwordProposta,
  passwordAutomatica = false,
}: {
  album: AlbumSalvato[];
  /** gli indirizzi degli album che non hanno ancora una password */
  senzaPassword: string[];
  /** la proposta del modulo «Nuovo album», generata sul server */
  passwordProposta: string;
  passwordAutomatica?: boolean;
  /** indirizzo della sezione: serve a costruire i collegamenti all'editor */
  percorso: string;
  puoPubblicare: boolean;
  /** le unità per cui questa sessione può creare un album */
  unitaAmmesse: string[];
}) {
  const [stato, crea, inCorso] = useActionState(nuovoAlbum, AZIONE_INIZIALE);
  const unita = FILTRI_UNITA.filter((f) => unitaAmmesse.includes(f.chiave));

  return (
    <>
      <div className="adm-table">
        <div className="adm-table__head">
          <h2>Album dell’unità</h2>
          <span className="adm-table__meta">
            {album.length} album ·{" "}
            {album.reduce((n, a) => n + a.foto.length, 0)} fotografie
          </span>
        </div>
        <div className="adm-table__box">
          <div className="adm-tr adm-tr--head" style={{ gridTemplateColumns: GRIGLIA }}>
            <span className="adm-th">Album</span>
            <span className="adm-th">Unità</span>
            <span className="adm-th">Data</span>
            <span className="adm-th">Foto</span>
            <span className="adm-th">Stato</span>
            <span className="adm-th">Azioni</span>
          </div>
          {album.map((a) => (
            <div className="adm-tr" style={{ gridTemplateColumns: GRIGLIA }} key={a.slug}>
              <span className="c-strong">{a.titolo}</span>
              <span className="c-muted">{labelDiUnita(a.unita)}</span>
              <span className="c-mono">{a.data}</span>
              <span className="c-mono-right" data-etichetta="Foto">
                {a.foto.length}
              </span>
              <span className={`adm-pill adm-pill--${PILL_STATO[a.stato]}`}>
                {ETICHETTA_STATO[a.stato]}
              </span>
              <span className="adm-riga-azioni">
                {senzaPassword.includes(a.slug) ? (
                  <Link
                    className="adm-btn adm-btn--avviso"
                    href={`${percorso}?album=${a.slug}#password`}
                    title="Le famiglie non possono aprire quest’album finché non ha una password"
                  >
                    Serve la password
                  </Link>
                ) : null}
                <Link className="adm-btn" href={`${percorso}?album=${a.slug}`}>
                  Modifica
                </Link>
                {a.stato === "pubblicato" ? (
                  <Link className="adm-btn" href={`/foto/${a.slug}`} target="_blank">
                    Vedi
                  </Link>
                ) : null}
              </span>
            </div>
          ))}
          {album.length === 0 ? (
            <div className="adm-tr adm-tr--vuota">
              <span className="c-muted">
                Nessun album, ancora. Createne uno con il modulo qui sotto.
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <form className="adm-form" action={crea}>
        <h2>Nuovo album</h2>
        <span className="adm-note">
          L’album nasce in bozza e non è visibile al pubblico.{" "}
          {puoPubblicare
            ? "Potete pubblicarlo voi quando è pronto."
            : "Quando è pronto lo mandate ai gestori, che controllano i consensi e pubblicano."}
        </span>

        <div className="adm-form__grid">
          <label className="adm-field">
            <span className="adm-field__label">Titolo</span>
            <input
              type="text"
              name="titolo"
              maxLength={90}
              required
              placeholder="Gita in montagna"
              aria-invalid={stato.campo === "titolo" || undefined}
            />
            <span className="adm-field__hint">Come comparirà nella pagina Foto.</span>
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Unità</span>
            <select name="unita" required defaultValue={unita[0]?.chiave}>
              {unita.map((u) => (
                <option value={u.chiave} key={u.chiave}>
                  {u.label}
                </option>
              ))}
            </select>
            <span className="adm-field__hint">Decide il colore di fascia e il filtro.</span>
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Anno sociale</span>
            <input
              type="text"
              name="anno"
              required
              defaultValue={ANNO_CORRENTE}
              placeholder="2026 – 2027"
              aria-invalid={stato.campo === "anno" || undefined}
            />
            <span className="adm-field__hint">Con il trattino lungo: «2026 – 2027».</span>
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Mese</span>
            <input
              type="text"
              name="data"
              required
              placeholder="Luglio 2026"
              aria-invalid={stato.campo === "data" || undefined}
            />
            <span className="adm-field__hint">Quando si è svolta l’attività.</span>
          </label>
        </div>

        <label className="adm-field">
          <span className="adm-field__label">Riga di presentazione</span>
          <input
            type="text"
            name="sottotitolo"
            maxLength={160}
            placeholder="Una settimana in casa di vacanze, fra boschi e prati."
          />
          <span className="adm-field__hint">
            Una frase sola, in cima alla pagina dell’album. Niente nomi di ragazzi.
          </span>
        </label>

        {passwordAutomatica ? <p className="adm-note">La password viene generata automaticamente e resta riservata ai gestori.</p> : (
        <CampoPassword
          // dopo un album creato se ne propone una nuova: il prossimo non deve
          // nascere con la password di quello appena fatto
          key={stato.stato === "fatto" ? stato.messaggio : "modulo"}
          iniziale={stato.stato === "fatto" ? undefined : passwordProposta}
          invalido={stato.campo === "password"}
          suggerimento={
            "Le famiglie la inseriscono per vedere le fotografie. Ve ne proponiamo una " +
            `a caso; potete sceglierne un’altra, di almeno ${PASSWORD_ALBUM_MIN} caratteri e senza spazi.`
          }
        />
        )}

        <Esito stato={stato} />

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
            {inCorso ? "Creazione…" : "Crea l’album"}
          </button>
          <button className="adm-btn" type="reset">
            Annulla
          </button>
        </div>
      </form>
    </>
  );
}

/**
 * Larghezze delle colonne. La somma delle fisse resta sotto i 500 px, come
 * nelle tabelle del mockup: oltre quella soglia la griglia non entra più nella
 * colonna centrale e le intestazioni si accavallano. Sotto i 900 px ci pensa
 * `admin.css`, che impila tutto a schede.
 */
const GRIGLIA = "minmax(0, 1.8fr) 105px 100px 50px 95px 140px";

/** L'anno sociale corrente, come lo scrivono gli album già presenti. */
const ANNO_CORRENTE = "2026 – 2027";

// --------------------------------------------------------------------------
// Editor di un album
// --------------------------------------------------------------------------

/**
 * Chi blocca la pubblicazione, e il pulsante per dichiararlo assente.
 *
 * §5 del piano: la dichiarazione non è «pubblica comunque». Per questo il
 * pulsante non dice «sblocca» e la conferma non chiede «sei sicuro?», ma fa
 * ripetere l'affermazione: *questo bambino non compare in queste fotografie*.
 * Chi la firma dovrebbe aver guardato le foto, e l'unico modo di ricordarglielo
 * è scriverlo dove sta per premere.
 *
 * Il caso «non verificabile» ha un riquadro suo: nessun iscritto registrato per
 * quell'unità e quell'anno non è «tutti a posto», e il trigger in quel caso
 * lascia passare tutto — è il limite vero di questa serratura, e va detto qui e
 * non solo nella documentazione.
 */
function RiquadroConsensi({
  album,
  consensi,
}: {
  album: AlbumSalvato;
  consensi: Consensi;
}) {
  if (!consensi.verificabile) {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Consensi</span>
        <p>
          Per <strong>{album.unita === "gruppo" ? "il gruppo" : album.unita}</strong> e l’anno{" "}
          {album.anno} non risulta nessun iscritto registrato: il sito non può controllare i
          consensi, e <strong>non bloccherà la pubblicazione</strong>. Controllate sulla carta.
        </p>
      </div>
    );
  }

  return (
    <>
      {consensi.bloccanti.length > 0 ? (
        <div className="adm-notice" role="alert">
          <span className="adm-notice__tag">Pubblicazione bloccata</span>
          <p>
            {consensi.bloccanti.length === 1
              ? "Un iscritto non ha"
              : `${consensi.bloccanti.length} iscritti non hanno`}{" "}
            il consenso alla pubblicazione delle immagini. Finché è così, l’album non va
            online — lo impedisce il database, non questa schermata.
          </p>
          <p className="adm-note">
            Se una di queste persone <strong>non compare</strong> in queste fotografie,
            dichiaratelo: la dichiarazione vale per questo album e per nessun altro, e resta
            registrata col vostro nome.
          </p>
          <div className="adm-form__actions">
            {consensi.bloccanti.map((b) => (
              <Comando
                key={b.iscrizioneId}
                azione={dichiaraAssente}
                campi={{ slug: album.slug, iscrizione: String(b.iscrizioneId) }}
                conferma={`Dichiarate che ${b.nome} NON compare in nessuna delle fotografie di questo album. Rimane scritto che l’avete dichiarato voi. Confermate?`}
              >
                {b.nome} non c’è in queste foto
              </Comando>
            ))}
          </div>
        </div>
      ) : (
        <span className="adm-note">
          Nessun consenso mancante fra gli iscritti di quest’unità. Resta da guardare le
          fotografie: il sito sa chi ha dato il consenso, non chi è inquadrato.
        </span>
      )}

      {consensi.assenze.length > 0 ? (
        <div className="adm-table__box">
          <div className="adm-tr adm-tr--head" style={{ gridTemplateColumns: "minmax(0,1fr) 200px 130px" }}>
            <span className="adm-th">Dichiarati assenti da questo album</span>
            <span className="adm-th">Da</span>
            <span className="adm-th">Azioni</span>
          </div>
          {consensi.assenze.map((a) => (
            <div
              className="adm-tr"
              key={a.iscrizioneId}
              style={{ gridTemplateColumns: "minmax(0,1fr) 200px 130px" }}
            >
              <span>{a.nome}</span>
              <span className="c-muted adm-note">
                {a.da} · {a.il.slice(0, 10)}
              </span>
              <Comando
                azione={ritiraAssenza}
                campi={{ slug: album.slug, iscrizione: String(a.iscrizioneId) }}
                conferma="Ritirare la dichiarazione? Se il consenso manca ancora, l’album torna bloccato."
              >
                Ritira
              </Comando>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

export interface Consensi {
  /** chi impedisce la pubblicazione: senza consenso e non dichiarato assente */
  bloccanti: { iscrizioneId: number; nome: string }[];
  /** chi è già stato dichiarato assente, con chi l'ha dichiarato e quando */
  assenze: { iscrizioneId: number; nome: string; da: string; il: string }[];
  /** `false` quando per quest'unità e quest'anno non c'è nessun iscritto */
  verificabile: boolean;
}

export function ModificaAlbum({
  album,
  percorso,
  puoPubblicare,
  consensi,
  password,
  passwordRiservata = false,
  passwordProposta,
  soloNascondere = false,
  puoEliminare = true,
  cestino = null,
  ritiroChiesto = null,
}: {
  album: AlbumSalvato;
  /**
   * Le fotografie eliminate, che restano qui `GIORNI_CESTINO` giorni (audit
   * degli accessi, A-1). `null` per chi non le può rimettere: il cestino è di
   * chi pubblica.
   */
  cestino?: FotoNelCestino[] | null;
  /** il motivo, se il ritiro di quest'album è già stato chiesto ai gestori */
  ritiroChiesto?: string | null;
  /**
   * Le fotografie si nascondono soltanto, e un album pubblicato non si ritira
   * da qui: il social media manager (`nascondeSoltanto`). Le azioni lo
   * rifiuterebbero comunque; qui si evita di mostrare un pulsante che dice no.
   */
  soloNascondere?: boolean;
  /** se mostrare «Elimina l'album»: il social solo per un album suo e vuoto */
  puoEliminare?: boolean;
  /** la password attuale in chiaro, o `null` se l'album non ne ha ancora una */
  password: string | null;
  /**
   * La password non si mostra e non si cambia da qui: il social media manager,
   * su un album che è stato pubblicato. Da lì in poi è la chiave con cui le
   * famiglie vedono fotografie di minori, e la custodisce chi pubblica (audit
   * degli accessi, A-2 e A-3). Quando è vero, `password` arriva già `null`.
   */
  passwordRiservata?: boolean;
  passwordProposta: string;
  percorso: string;
  puoPubblicare: boolean;
  /**
   * `null` per chi non ha la riga `iscritti`: il social media manager carica le
   * fotografie, ma i nomi dei ragazzi senza consenso non sono suoi da leggere.
   * Li vede chi pubblica, che è chi li deve controllare.
   */
  consensi: Consensi | null;
}) {
  const [statoDati, salva, salvando] = useActionState(modificaAlbum, AZIONE_INIZIALE);
  const nascoste = album.foto.filter((f) => f.nascosta).length;
  // la copertina è la prima fra le visibili, come per il pubblico (`perFile`)
  const copertina = album.foto.find((f) => !f.nascosta)?.file;
  const [statoFoto, carica, caricando] = useActionState(caricaFoto, AZIONE_INIZIALE);
  const [statoPassword, salvaPassword, salvandoPassword] = useActionState(
    cambiaPasswordAlbum,
    AZIONE_INIZIALE,
  );

  /*
   * Il peso complessivo si controlla qui, prima di spedire.
   *
   * Il server rifiuta ordinatamente la singola fotografia troppo pesante, ma il
   * **totale** dell'invio non arriva mai fino a lui: sopra `bodySizeLimit` è
   * Next a chiudere la richiesta, e chi ha caricato vede una pagina «500» senza
   * sapere che cosa ha sbagliato. Con quaranta file per volta consentiti, una
   * ventina di fotografie di un campo ci arriva senza fatica.
   *
   * Non sostituisce nessun controllo del server: quelli restano tutti. Aggiunge
   * l'unico che il server non può fare, perché riguarda ciò che non gli arriva.
   */
  const [troppoPesante, setTroppoPesante] = useState<string | null>(null);

  function pesaEInvia(e: React.FormEvent<HTMLFormElement>) {
    const scelti = new FormData(e.currentTarget)
      .getAll("foto")
      .filter((f): f is File => f instanceof File);
    const totale = scelti.reduce((s, f) => s + f.size, 0);
    if (totale > CARICO_MAX) {
      e.preventDefault();
      setTroppoPesante(
        `${scelti.length} file per ${pesoLeggibile(totale)}: in una volta sola ` +
          `si possono mandare al massimo ${pesoLeggibile(CARICO_MAX)}. ` +
          "Caricatele in due o tre riprese.",
      );
      return;
    }
    setTroppoPesante(null);
  }

  return (
    <>
      <div className="adm-torna">
        <Link className="adm-btn" href={percorso}>
          ← Tutti gli album
        </Link>
        <span className={`adm-pill adm-pill--${PILL_STATO[album.stato]}`}>
          {ETICHETTA_STATO[album.stato]}
        </span>
        {album.stato === "pubblicato" ? (
          <Link className="adm-btn" href={`/foto/${album.slug}`} target="_blank">
            Vedi la pagina pubblica
          </Link>
        ) : null}
      </div>

      <form className="adm-form" action={salva}>
        <h2>Dati dell’album</h2>
        <span className="adm-note">
          Indirizzo pubblico: <code>/foto/{album.slug}</code> — non cambia quando si
          modifica il titolo, così i collegamenti già condivisi continuano a funzionare.
        </span>

        <input type="hidden" name="slug" value={album.slug} />

        <div className="adm-form__grid">
          <label className="adm-field">
            <span className="adm-field__label">Titolo</span>
            <input
              type="text"
              name="titolo"
              defaultValue={album.titolo}
              maxLength={90}
              required
              aria-invalid={statoDati.campo === "titolo" || undefined}
            />
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Mese</span>
            <input type="text" name="data" defaultValue={album.data} required />
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Etichetta</span>
            <input type="text" name="tag" defaultValue={album.tag} maxLength={60} />
            <span className="adm-field__hint">
              La pastiglia sull’album in evidenza, in cima alla pagina Foto.
            </span>
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Foto escluse per consenso</span>
            <input
              type="number"
              name="escluse"
              defaultValue={album.escluse}
              min={0}
              max={999}
              aria-invalid={statoDati.campo === "escluse" || undefined}
            />
            <span className="adm-field__hint">
              Quante ne avete tolte in fase di scelta. Il numero compare in fondo alla
              pagina pubblica, senza nomi.
            </span>
          </label>
        </div>

        <label className="adm-field">
          <span className="adm-field__label">Riga di presentazione</span>
          <input
            type="text"
            name="sottotitolo"
            defaultValue={album.sottotitolo}
            maxLength={160}
          />
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

      {passwordRiservata ? (
        <div className="adm-form" id="password">
          <h2>Password dell’album</h2>
          <div className="adm-notice">
            <span className="adm-notice__tag">Riservata</span>
            <p>
              La password dell’album è la chiave con cui le famiglie
              vedono le fotografie, e la custodiscono i gestori. Se va cambiata, chiedete
              a loro.
            </p>
          </div>
        </div>
      ) : (
      <form className="adm-form" action={salvaPassword} id="password">
        <h2>Password dell’album</h2>
        {password ? (
          <span className="adm-note">
            Le famiglie la inseriscono nella pagina pubblica per vedere le fotografie.
            Cambiandola, chi aveva già aperto l’album dovrà inserire quella nuova.
          </span>
        ) : (
          <div className="adm-notice">
            <span className="adm-notice__tag">Da fare</span>
            <p>
              Quest’album non ha ancora una password, quindi nessuna famiglia può
              vederne le fotografie e non si può pubblicare. Ve ne proponiamo una qui
              sotto: salvatela, o sceglietene un’altra.
            </p>
          </div>
        )}
        <input type="hidden" name="slug" value={album.slug} />
        <CampoPassword
          iniziale={password ?? passwordProposta}
          invalido={statoPassword.campo === "password"}
          suggerimento={`Almeno ${PASSWORD_ALBUM_MIN} caratteri, senza spazi.`}
        />
        <Esito stato={statoPassword} />
        <div className="adm-form__actions">
          <button
            className="adm-btn adm-btn--primary"
            type="submit"
            disabled={salvandoPassword}
          >
            {salvandoPassword ? "Salvataggio…" : "Salva la password"}
          </button>
        </div>
      </form>
      )}

      <form className="adm-form" action={carica} onSubmit={pesaEInvia}>
        <h2>Carica fotografie</h2>
        <span className="adm-note">
          {/* Le due misure si ricavano dalle costanti e non si scrivono a mano.
              Erano «8 MB e 4000 px», cioè i valori di prima della fase 7: da
              allora sono 20 MB e 8000 px, e il testo era rimasto indietro —
              l'interfaccia prometteva un limite più stretto di quello che il
              server applica, quindi rifiutava nella testa di chi legge
              fotografie che avrebbe accettato. */}
          JPEG o PNG, fino a {Math.round(FOTO_PESO_MAX / (1024 * 1024))} MB e{" "}
          {FOTO_LATO_MAX} px di lato, al massimo 40 per volta e{" "}
          {Math.round(CARICO_MAX / (1024 * 1024))} MB in tutto per invio. Caricate
          soltanto immagini di ragazzi con il consenso alla pubblicazione: l’elenco di chi
          non ce l’ha è nella sezione iscritti.
        </span>

        <input type="hidden" name="slug" value={album.slug} />

        <label className="adm-field">
          <span className="adm-field__label">File</span>
          <input
            type="file"
            name="foto"
            /*
              HEIC **non** è in questo elenco, ed è deliberato.
              Il server non lo sa convertire — il libvips distribuito con
              `sharp` non porta il decodificatore HEVC — quindi offrirlo nel
              selettore di file vorrebbe dire lasciar scegliere qualcosa che
              verrà rifiutato. Se uno arriva lo stesso, il messaggio spiega
              come cambiare l'impostazione della fotocamera.
              AVIF invece si converte, quindi c'è.
            */
            accept="image/jpeg,image/png,image/avif"
            multiple
            required
            aria-invalid={statoFoto.campo === "foto" || undefined}
          />
          <span className="adm-field__hint">
            Si possono selezionare più file insieme. La prima fotografia dell’album fa da
            copertina nella pagina Foto.
          </span>
        </label>

        {troppoPesante ? (
          <p className="adm-esito adm-esito--ko" role="alert">
            {troppoPesante}
          </p>
        ) : (
          <Esito stato={statoFoto} />
        )}

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={caricando}>
            {caricando ? "Caricamento…" : "Carica"}
          </button>
        </div>
      </form>

      <div className="adm-table">
        <div className="adm-table__head">
          <h2>Fotografie nell’album</h2>
          <span className="adm-table__meta">
            {album.foto.length}{" "}
            {album.foto.length === 1 ? "fotografia" : "fotografie"}
            {nascoste > 0 ? ` · ${nascoste} ${nascoste === 1 ? "nascosta" : "nascoste"}` : ""}
          </span>
        </div>
        <span className="adm-note">
          «Nascondi» toglie subito la fotografia dalla pagina dell’album e la tiene qui;
          {soloNascondere
            ? " per rimetterla, se l’album è pubblicato, serve di nuovo l’approvazione dei gestori."
            : ` «Elimina» la sposta nel cestino: per ${GIORNI_CESTINO} giorni un gestore può ` +
              "rimetterla, poi viene cancellata dal server."}
        </span>
        {album.foto.length > 0 ? (
          <div className="adm-provini">
            {album.foto.map((f, i) => (
              <div className="adm-provino" key={f.file}>
                <img
                  src={`/foto-file/${f.file}?l=400`}
                  width={f.larghezza}
                  height={f.altezza}
                  alt={f.didascalia || `Fotografia ${i + 1}`}
                  loading="lazy"
                  // una nascosta resta qui, sbiadita: sul sito non c'è
                  style={f.nascosta ? { opacity: 0.45 } : undefined}
                />
                <div className="adm-provino__piede">
                  <span className="adm-provino__misure">
                    {f.nascosta ? "nascosta · " : f.file === copertina ? "copertina · " : ""}
                    {f.larghezza}×{f.altezza}
                    {/*
                      Lo stato della conversione, ma solo quando non è quello
                      normale: scrivere «pronta» su ogni riquadro sarebbe
                      rumore su centocinquanta fotografie che stanno bene.
                    */}
                    {f.conversione === "attesa" ? " · in conversione" : ""}
                  </span>
                  {f.nascosta ? (
                    <Comando azione={mostraFotoAlbum} campi={{ slug: album.slug, file: f.file }}>
                      Rimetti
                    </Comando>
                  ) : (
                    <Comando azione={nascondiFotoAlbum} campi={{ slug: album.slug, file: f.file }}>
                      Nascondi
                    </Comando>
                  )}
                  {soloNascondere ? null : (
                    <Comando
                      azione={rimuoviFoto}
                      campi={{ slug: album.slug, file: f.file }}
                      conferma={
                        `Eliminare questa fotografia? Resta nel cestino per ${GIORNI_CESTINO} ` +
                        "giorni, poi viene cancellata dal server."
                      }
                    >
                      Elimina
                    </Comando>
                  )}
                </div>
                {f.conversione === "errore" ? (
                  /* Lo stile sta qui e non in `admin.css`: quel foglio ha
                     modifiche non committate di un'altra sessione, e §21 del
                     mandato dice di non toccarlo. Sono tre proprietà. */
                  <div
                    className="adm-notice"
                    role="alert"
                    style={{
                      margin: "6px 0 0",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: "6px",
                    }}
                  >
                    <span className="adm-notice__tag">Non convertita</span>
                    <p>{f.motivo}</p>
                    <p className="adm-note">
                      Si vede lo stesso, servita dal file originale. Le versioni
                      ridotte però mancano, quindi pesa più del dovuto per chi
                      guarda la pagina.
                    </p>
                    {f.lavoroId ? (
                      <Comando
                        azione={riprovaConversione}
                        campi={{ slug: album.slug, lavoro: String(f.lavoroId) }}
                      >
                        Riprova
                      </Comando>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="adm-table__box">
            <div className="adm-tr adm-tr--vuota">
              <span className="c-muted">
                Nessuna fotografia. L’album resta visibile finché non ne
                caricate almeno una.
              </span>
            </div>
          </div>
        )}
      </div>

      {cestino && cestino.length > 0 ? <Cestino slug={album.slug} foto={cestino} /> : null}

      <div className="adm-form">
        <h2>Pubblicazione</h2>
        <span className="adm-note">
          {puoPubblicare
            ? "Potete pubblicare direttamente: controllate prima i consensi delle unità coinvolte."
            : "La pubblicazione spetta ai gestori. Mandate l’album in revisione: comparirà nella loro coda di approvazioni."}
        </span>

        {ritiroChiesto ? (
          <span className="adm-note">
            Avete chiesto ai gestori di ritirarlo («{ritiroChiesto}»). Resta online finché
            non decidono; la richiesta la ritrovate in «In attesa di approvazione».
          </span>
        ) : null}

        {consensi ? (
          <RiquadroConsensi album={album} consensi={consensi} />
        ) : (
          <span className="adm-note">
            I consensi degli iscritti li controllano i gestori prima di pubblicare. Non
            caricate fotografie in cui si riconosca il volto di qualcuno: non andrebbero online.
          </span>
        )}

        <div className="adm-form__actions">
          {album.stato !== "in-revisione" && album.stato !== "pubblicato" ? (
            <Comando
              azione={cambiaStato}
              campi={{ slug: album.slug, stato: "in-revisione" }}
              primary={!puoPubblicare}
            >
              Manda in revisione
            </Comando>
          ) : null}

          {puoPubblicare && album.stato !== "pubblicato" ? (
            <Comando
              azione={cambiaStato}
              campi={{ slug: album.slug, stato: "pubblicato" }}
              primary
              conferma="Pubblicare l’album? Le fotografie diventano visibili a chi ha la password dell’album."
            >
              Pubblica
            </Comando>
          ) : null}

          {album.stato !== "bozza" && !(soloNascondere && album.stato === "pubblicato") ? (
            <Comando azione={cambiaStato} campi={{ slug: album.slug, stato: "bozza" }}>
              {album.stato === "pubblicato" ? "Ritira dalla pubblicazione" : "Riporta in bozza"}
            </Comando>
          ) : null}

          {soloNascondere && album.stato === "pubblicato" && !ritiroChiesto ? (
            <ChiediRitiro slug={album.slug} />
          ) : null}

          {puoEliminare ? (
            <Comando
              azione={rimuoviAlbum}
              campi={{ slug: album.slug, da: percorso }}
              conferma="Eliminare l’album e tutte le sue fotografie? Non si torna indietro."
            >
              Elimina l’album
            </Comando>
          ) : null}
        </div>
      </div>
    </>
  );
}

/**
 * Il cestino dell'album: le fotografie eliminate negli ultimi trenta giorni.
 *
 * Lo vede chi pubblica, e solo lui le rimette o le cancella per sempre: una
 * fotografia rimessa torna online, e una cancellata non torna più (audit degli
 * accessi, A-1). Sbiadite come le nascoste, perché sul sito non ci sono.
 */
function Cestino({ slug, foto }: { slug: string; foto: FotoNelCestino[] }) {
  const giorniFa = (ms: number) => Math.floor((Date.now() - ms) / 86_400_000);
  return (
    <div className="adm-table">
      <div className="adm-table__head">
        <h2>Cestino</h2>
        <span className="adm-table__meta">
          {foto.length} {foto.length === 1 ? "fotografia eliminata" : "fotografie eliminate"}
        </span>
      </div>
      <span className="adm-note">
        Le fotografie eliminate restano qui {GIORNI_CESTINO} giorni, poi il server le cancella da
        solo. «Rimetti» la riporta nell’album al posto che aveva; «Cancella ora» non aspetta —
        per esempio se una famiglia ha ritirato il consenso.
      </span>
      <div className="adm-provini">
        {foto.map((f, i) => {
          const restano = Math.max(0, GIORNI_CESTINO - giorniFa(f.eliminataIl));
          return (
            <div className="adm-provino" key={f.file}>
              <img
                src={`/foto-file/${f.file}?l=400`}
                width={f.larghezza}
                height={f.altezza}
                alt={f.didascalia || `Fotografia eliminata ${i + 1}`}
                loading="lazy"
                style={{ opacity: 0.45 }}
              />
              <div className="adm-provino__piede">
                <span className="adm-provino__misure">
                  {f.eliminataDa ? `eliminata da ${f.eliminataDa} · ` : "eliminata · "}
                  {restano === 0 ? "si cancella stanotte" : `ancora ${restano} giorni`}
                </span>
                <Comando azione={ripristinaFotoCestino} campi={{ slug, file: f.file }}>
                  Rimetti
                </Comando>
                <Comando
                  azione={cancellaFotoCestino}
                  campi={{ slug, file: f.file }}
                  conferma="Cancellare per sempre questa fotografia? Non si torna indietro."
                >
                  Cancella ora
                </Comando>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * «Chiedi il ritiro»: per chi un album online non lo ritira da sé (il social
 * media manager, audit degli accessi M-1b). Il motivo è obbligatorio, perché è
 * quello che chi decide legge nella coda.
 */
function ChiediRitiro({ slug }: { slug: string }) {
  const [stato, invia, inCorso] = useActionState(chiediRitiroAlbum, AZIONE_INIZIALE);
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
      <input type="hidden" name="slug" value={slug} />
      <label className="adm-field">
        <span className="adm-field__label">Perché va ritirato?</span>
        <textarea
          name="motivo"
          rows={3}
          maxLength={MOTIVO_RITIRO_MAX}
          required
          aria-invalid={(stato.stato === "errore" && stato.campo === "motivo") || undefined}
        />
      </label>
      <span className="adm-note">
        La richiesta va ai gestori, e l’album resta online finché non decidono. Se una
        fotografia va tolta subito, nascondetela.
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
