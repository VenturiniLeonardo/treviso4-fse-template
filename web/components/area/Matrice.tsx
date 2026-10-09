"use client";

import clsx from "clsx";
import { useActionState, useState } from "react";
import {
  cambiaLivello,
  rimuoviFunzione,
  ripristina,
} from "@/app/(area)/area-riservata/permessi/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";
import {
  ammesso,
  CICLO_LIVELLI,
  type Funzione,
  GRUPPI_FUNZIONI,
  type Livello,
  LIVELLI,
  RIGHE_FISSE,
  RUOLI_DESCRIZIONE,
  RUOLI_MATRICE,
  descriviPermesso,
  tetto,
} from "@/lib/permessi";

/**
 * Matrice dei permessi: funzioni in riga, ruoli in colonna, un segno per cella.
 *
 * Si modifica cliccando nella griglia — un giro fra ✗, ~ e ✓ — non aprendo un
 * modulo: il senso di una matrice è vedere e cambiare nello stesso posto. Ogni
 * cella è un pulsante con il suo `aria-label`, così anche chi non vede il segno
 * sa che cosa sta premendo e su quale incrocio.
 *
 * ## Perché a gruppi, e con la vista per ruolo
 *
 * Ventiquattro righe in fila, con nomi da codice e «Accesso completo» ripetuto
 * in ogni cella, non si leggevano: le poche caselle che dicono qualcosa — i
 * limiti — erano annegate fra quelle tutte uguali. Le righe ora stanno sotto
 * sei argomenti, ciascuna con una frase che dice che cosa apre, e le celle
 * scrivono «Sì» e «No» e usano le parole solo dove c'è un limite. La vista per
 * ruolo risponde alla domanda che di solito si fa davvero: «che cosa può fare
 * il referente di unità?».
 */

type Ruolo = (typeof RUOLI_MATRICE)[number];

function Lucchetto() {
  return (
    <svg className="matrice__lucchetto" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function Cella({
  funzione,
  ruolo,
  livello,
  modificabile,
}: {
  funzione: Funzione;
  ruolo: Ruolo;
  livello: Livello;
  modificabile: boolean;
}) {
  const [stato, invia, inCorso] = useActionState(cambiaLivello, AZIONE_INIZIALE);

  const corrente = LIVELLI.find((l) => l.valore === livello) ?? LIVELLI[2];
  /*
   * Il prossimo livello viene da `CICLO_LIVELLI`, non dall'ordine di `LIVELLI`.
   *
   * `LIVELLI` è l'ordine della legenda — dal più permissivo al meno — e usarlo
   * anche per i clic significava che da «nessuno» il primo clic dava
   * «completo». Vedi il commento su `CICLO_LIVELLI`: la matrice applica subito,
   * quindi arrivare a «limitato» passando da «completo» apriva per qualche
   * secondo un permesso pieno.
   */
  /*
   * Il giro passa solo dai livelli sotto il tetto del ruolo (audit degli
   * accessi, M-5): «completo» per il social alla riga degli iscritti non è un
   * clic sbagliato da correggere dopo, è un clic che non c'è. Se sotto il tetto
   * c'è un solo livello, la cella è bloccata e dice perché.
   */
  const giro = CICLO_LIVELLI.filter((l) => ammesso(funzione.id, ruolo.chiave, l));
  const nelCiclo = giro.indexOf(corrente.valore);
  const valoreProssimo = giro[(nelCiclo + 1) % giro.length];
  const prossimo = LIVELLI.find((l) => l.valore === valoreProssimo) ?? LIVELLI[2];
  const bloccata = giro.length <= 1 || nelCiclo === -1;
  const perche = RIGHE_FISSE[funzione.id]?.perche ?? tetto(funzione.id, ruolo.chiave).perche;
  const etichetta = descriviPermesso(funzione.id, ruolo.chiave, livello);

  const contenuto = (
    <span className={`matrice__chip matrice__chip--${corrente.valore}`}>
      <span className="matrice__segno" aria-hidden="true">
        {corrente.segno}
      </span>
      <span className="matrice__testo" aria-hidden="true">
        {etichetta}
      </span>
      {modificabile && bloccata ? <Lucchetto /> : null}
    </span>
  );

  if (!modificabile || bloccata) {
    return (
      <span
        className="matrice__cella"
        title={modificabile && perche ? `Non si cambia: ${perche}` : undefined}
      >
        {contenuto}
        <span className="visually-hidden">
          {ruolo.label}: {etichetta}
          {modificabile && bloccata && perche ? `. Non si cambia: ${perche}` : ""}
        </span>
      </span>
    );
  }

  return (
    <form action={invia} className="matrice__cella">
      <input type="hidden" name="id" value={funzione.id} />
      <input type="hidden" name="ruolo" value={ruolo.chiave} />
      <input type="hidden" name="livello" value={prossimo.valore} />
      <button
        type="submit"
        disabled={inCorso}
        className={clsx("matrice__tasto", stato.stato === "errore" && "matrice__tasto--ko")}
        title={
          `Ora: ${etichetta}. Clic per passare a «${descriviPermesso(funzione.id, ruolo.chiave, prossimo.valore)}»` +
          (perche ? `. Al massimo: ${perche}` : "")
        }
      >
        {contenuto}
        <span className="visually-hidden">
          {funzione.nome}, {ruolo.label}: {etichetta}. Premi per passare a{" "}
          {descriviPermesso(funzione.id, ruolo.chiave, prossimo.valore)}.
        </span>
      </button>
    </form>
  );
}

function TogliFunzione({ id, nome }: { id: string; nome: string }) {
  const [stato, invia, inCorso] = useActionState(rimuoviFunzione, AZIONE_INIZIALE);
  return (
    <form action={invia} className="matrice__togli">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={inCorso}
        title={`Togli «${nome}» dalla matrice: l’azione si chiude per tutti`}
        onClick={(e) => {
          if (!window.confirm(`Togliere «${nome}» dalla matrice? L’azione si chiude per tutti i ruoli.`))
            e.preventDefault();
        }}
      >
        Togli riga
      </button>
      <Esito stato={stato} />
    </form>
  );
}

/** Le funzioni in tabella, sotto il loro argomento; quelle sconosciute in «Altro». */
function raggruppa(funzioni: Funzione[]) {
  const perId = new Map(funzioni.map((f) => [f.id, f]));
  const usate = new Set<string>();
  const gruppi = GRUPPI_FUNZIONI.map((g) => ({
    titolo: g.titolo,
    righe: g.righe.flatMap((r) => {
      const f = perId.get(r.id);
      if (!f) return [];
      usate.add(f.id);
      return [{ funzione: f, spiegazione: r.spiegazione }];
    }),
  }));
  const altre = funzioni.filter((f) => !usate.has(f.id));
  if (altre.length > 0) {
    gruppi.push({ titolo: "Altro", righe: altre.map((f) => ({ funzione: f, spiegazione: "" })) });
  }
  return gruppi.filter((g) => g.righe.length > 0);
}

function NomeFunzione({ funzione, spiegazione }: { funzione: Funzione; spiegazione: string }) {
  return (
    <>
      <span className="matrice__nome">{funzione.nome}</span>
      {spiegazione ? <span className="matrice__spiega">{spiegazione}</span> : null}
    </>
  );
}

export function Matrice({
  funzioni,
  modificabile,
}: {
  funzioni: Funzione[];
  /** solo l'admin modifica: agli altri la matrice si legge */
  modificabile: boolean;
}) {
  const [statoRipristino, azzera, azzerando] = useActionState(ripristina, AZIONE_INIZIALE);
  const [vista, setVista] = useState<string>("tutti");
  const gruppi = raggruppa(funzioni);
  const ruoloScelto = RUOLI_MATRICE.find((r) => r.chiave === vista);
  const colonne = RUOLI_MATRICE.length + 1;

  return (
    <>
      {/* Come si legge: prima dei dati, perché senza la chiave i segni non dicono niente */}
      <section className="matrice-guida" aria-label="Come si legge la matrice">
        {LIVELLI.map((l) => (
          <div key={l.valore} className={`matrice-guida__voce matrice-guida__voce--${l.valore}`}>
            <span className={`matrice__chip matrice__chip--${l.valore}`}>
              <span className="matrice__segno" aria-hidden="true">
                {l.segno}
              </span>
              <span className="matrice__testo">{l.label}</span>
            </span>
            <p>{l.nota}</p>
          </div>
        ))}
        {modificabile ? (
          <div className="matrice-guida__voce">
            <span className="matrice__chip matrice__chip--nessuno">
              <Lucchetto />
              <span className="matrice__testo">Bloccata</span>
            </span>
            <p>Regola fissa, non si cambia da qui. Passa sopra la casella per leggere il motivo.</p>
          </div>
        ) : null}
      </section>

      {/* l'avviso è per chi la può cambiare: a chi la legge basta la guida */}
      {modificabile ? (
        <div className="adm-notice matrice-avviso">
          <span className="adm-notice__tag">Vale subito</span>
          <p>
            Clicca una casella per cambiarla: gira fra <strong>No</strong>, <strong>In parte</strong>{" "}
            e <strong>Sì</strong>. Il permesso si apre o si chiude <strong>all’istante</strong>, per
            tutti, e la modifica resta nel registro con il tuo nome. Se qualcosa si incastra,
            «Ripristina» riporta tutto ai valori di partenza.
          </p>
        </div>
      ) : null}

      <div className="adm-table">
        <div className="adm-table__head">
          <h2>Chi può fare che cosa</h2>
          <span className="adm-table__meta">
            {funzioni.length} funzioni · {RUOLI_MATRICE.length} ruoli
          </span>
          {modificabile ? (
            <span className="adm-table__comandi">
              <form action={azzera} className="adm-comando">
                <button
                  className="adm-btn"
                  type="submit"
                  disabled={azzerando}
                  onClick={(e) => {
                    if (!window.confirm("Riportare tutti i permessi ai valori di partenza?"))
                      e.preventDefault();
                  }}
                >
                  Ripristina
                </button>
              </form>
            </span>
          ) : null}
        </div>

        <div className="matrice-viste" role="tablist" aria-label="Come vedere la matrice">
          {[{ chiave: "tutti", label: "Tutti i ruoli" }, ...RUOLI_MATRICE].map((v) => (
            <button
              key={v.chiave}
              type="button"
              role="tab"
              aria-selected={vista === v.chiave}
              className={clsx("matrice-viste__voce", vista === v.chiave && "is-attiva")}
              onClick={() => setVista(v.chiave)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <Esito stato={statoRipristino} />

        {ruoloScelto ? (
          <VistaRuolo ruolo={ruoloScelto} gruppi={gruppi} modificabile={modificabile} />
        ) : (
          <div className="adm-table__box">
            <table className="matrice">
              <thead>
                <tr>
                  <th scope="col">Che cosa</th>
                  {RUOLI_MATRICE.map((r) => (
                    <th scope="col" key={r.chiave}>
                      <span className="matrice__ruolo">{r.label}</span>
                      <span className="matrice__ruolo-nota">{RUOLI_DESCRIZIONE[r.chiave]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              {gruppi.map((g) => (
                <tbody key={g.titolo}>
                  <tr className="matrice__gruppo">
                    <th scope="colgroup" colSpan={colonne}>
                      {g.titolo}
                    </th>
                  </tr>
                  {g.righe.map(({ funzione: f, spiegazione }) => (
                    <tr key={f.id}>
                      <th scope="row">
                        <NomeFunzione funzione={f} spiegazione={spiegazione} />
                        {/* togliere una riga è raro e distruttivo: sta qui, discreto,
                            e non in una colonna tutta sua accanto ai permessi */}
                        {modificabile && !RIGHE_FISSE[f.id] ? <TogliFunzione id={f.id} nome={f.nome} /> : null}
                      </th>
                      {RUOLI_MATRICE.map((r) => (
                        <td key={r.chiave}>
                          <Cella
                            funzione={f}
                            ruolo={r}
                            livello={f.livelli[r.chiave] ?? "nessuno"}
                            modificabile={modificabile}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
              {funzioni.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={colonne}>
                      <span className="c-muted">Nessuna funzione in matrice.</span>
                    </td>
                  </tr>
                </tbody>
              ) : null}
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Un ruolo solo: le stesse righe, una sotto l'altra, con il conto in cima.
 * Le celle sono le stesse della griglia, quindi anche qui si cambiano col clic.
 */
function VistaRuolo({
  ruolo,
  gruppi,
  modificabile,
}: {
  ruolo: Ruolo;
  gruppi: ReturnType<typeof raggruppa>;
  modificabile: boolean;
}) {
  const conta = { completo: 0, limitato: 0, nessuno: 0 } as Record<Livello, number>;
  for (const g of gruppi) for (const { funzione } of g.righe) conta[funzione.livelli[ruolo.chiave] ?? "nessuno"]++;

  return (
    <div className="matrice-ruolo">
      <p className="matrice-ruolo__sintesi">
        <strong>{ruolo.label}</strong> ({RUOLI_DESCRIZIONE[ruolo.chiave]}):{" "}
        <span className="matrice-ruolo__conto matrice-ruolo__conto--completo">{conta.completo} sì</span>
        <span className="matrice-ruolo__conto matrice-ruolo__conto--limitato">{conta.limitato} in parte</span>
        <span className="matrice-ruolo__conto matrice-ruolo__conto--nessuno">{conta.nessuno} no</span>
      </p>
      {gruppi.map((g) => (
        <section key={g.titolo} className="matrice-ruolo__gruppo">
          <h3>{g.titolo}</h3>
          <ul>
            {g.righe.map(({ funzione: f, spiegazione }) => (
              <li key={f.id}>
                <div>
                  <NomeFunzione funzione={f} spiegazione={spiegazione} />
                </div>
                <Cella
                  funzione={f}
                  ruolo={ruolo}
                  livello={f.livelli[ruolo.chiave] ?? "nessuno"}
                  modificabile={modificabile}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
