/**
 * I grafici della dashboard dello sviluppatore.
 *
 * ## Perché HTML e non SVG, né una libreria
 *
 * Sono tre forme — colonne, barre orizzontali, misuratori — e tutte si
 * disegnano con dei riquadri e una percentuale. In HTML seguono la larghezza
 * della colonna senza deformare le scritte (un SVG in `viewBox` le
 * stirerebbe), prendono i colori dalle stesse variabili del resto dell'area —
 * quindi il tema scuro arriva da solo — e si compongono sul server: nessun
 * JavaScript per vederli. L'unico pezzo che gira nel browser è il
 * suggerimento al passaggio del mouse (§ Suggerimento.tsx), e senza di lui
 * ogni valore resta leggibile nella tabella sotto il grafico.
 *
 * ## Le regole che seguono
 *
 *  - **Un colore d'accento, e il grigio.** Il grafico dell'attività e quello
 *    del traffico mettono in evidenza la serie che conta e lasciano il resto
 *    in grigio: non c'è una tavolozza di categorie da imparare.
 *  - **I colori di stato sono solo per gli esiti** — verde, giallo, rosso — e
 *    non stanno mai da soli: accanto c'è sempre l'icona e la parola.
 *  - **Ogni grafico ha la sua tabella**, chiusa in un `<details>`: è quello
 *    che legge un lettore di schermo, e quello che resta quando il colore non
 *    basta.
 */

import { Icona, type NomeIcona } from "@/components/area/Icone";
import { Suggerimento } from "@/components/area/Suggerimento";
import type { EsitoControllo } from "@/lib/diagnostica";

/* ------------------------------------------------------------------------ *
 * La scala
 * ------------------------------------------------------------------------ */

/**
 * Il primo numero «tondo» (1, 2 o 5 per una potenza di dieci) non minore di
 * `n`: il tetto dell'asse. Con il massimo vero come tetto la colonna più alta
 * toccherebbe sempre il bordo e le tacche cadrebbero su numeri come 37.
 */
export function tettoTondo(n: number): number {
  if (n <= 0) return 1;
  const potenza = 10 ** Math.floor(Math.log10(n));
  for (const passo of [1, 2, 5, 10]) {
    if (passo * potenza >= n) return passo * potenza;
  }
  return 10 * potenza;
}

const numero = (n: number) => n.toLocaleString("it-IT");

/* ------------------------------------------------------------------------ *
 * Colonne impilate
 * ------------------------------------------------------------------------ */

export interface SerieColonne {
  chiave: string;
  etichetta: string;
  /** `accento` per la serie che conta, `tenue` per il contesto */
  tono: "accento" | "tenue";
}

export interface PuntoColonne {
  /** per l'asse: «23» */
  breve: string;
  /** per il suggerimento e la tabella: «mercoledì 23 settembre» */
  lungo: string;
  valori: Record<string, number>;
}

/**
 * Colonne impilate nel tempo, con la legenda sopra e l'asse a tre tacche.
 * La serie `accento` sta in basso, appoggiata alla linea di base, così la sua
 * altezza si legge senza sottrarre niente.
 */
export function Colonne({
  titolo,
  serie,
  punti,
  ogni = 1,
}: {
  titolo: string;
  serie: SerieColonne[];
  punti: PuntoColonne[];
  /** un'etichetta dell'asse ogni quanti punti */
  ogni?: number;
}) {
  const ordinate = [...serie].sort((a, b) => (a.tono === "accento" ? -1 : b.tono === "accento" ? 1 : 0));
  const totale = (p: PuntoColonne) => serie.reduce((t, s) => t + (p.valori[s.chiave] ?? 0), 0);
  const tetto = tettoTondo(Math.max(0, ...punti.map(totale)));
  const tacche = [tetto, tetto / 2, 0];

  return (
    <figure className="graf">
      <div className="graf__legenda" aria-hidden="true">
        {ordinate.map((s) => (
          <span key={s.chiave} className="graf__voce">
            <span className={`graf__campione graf__campione--${s.tono}`} />
            {s.etichetta}
          </span>
        ))}
      </div>

      <Suggerimento>
        <div className="graf__piano" aria-hidden="true">
          <div className="graf__assey">
            {tacche.map((t) => (
              <span key={t} style={{ bottom: `${(t / tetto) * 100}%` }}>
                {numero(t)}
              </span>
            ))}
          </div>
          <div className="graf__area">
            {tacche.map((t) => (
              <span
                key={t}
                className={t === 0 ? "graf__griglia graf__griglia--base" : "graf__griglia"}
                style={{ bottom: `${(t / tetto) * 100}%` }}
              />
            ))}
            <div className="graf__colonne" style={{ gridTemplateColumns: `repeat(${punti.length}, minmax(0, 1fr))` }}>
              {punti.map((p, i) => {
                const righe = ordinate.map((s) => `${numero(p.valori[s.chiave] ?? 0)} ${s.etichetta.toLowerCase()}`);
                return (
                  <div
                    key={i}
                    className="graf__slot"
                    data-suggerimento={`${p.lungo}\n${righe.join("\n")}`}
                  >
                    <div className="graf__pila" style={{ height: `${(totale(p) / tetto) * 100}%` }}>
                      {ordinate.map((s) =>
                        (p.valori[s.chiave] ?? 0) > 0 ? (
                          <span
                            key={s.chiave}
                            className={`graf__pezzo graf__pezzo--${s.tono}`}
                            style={{ flexGrow: p.valori[s.chiave] }}
                          />
                        ) : null,
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div />
          <div className="graf__assex" style={{ gridTemplateColumns: `repeat(${punti.length}, minmax(0, 1fr))` }}>
            {punti.map((p, i) => (
              <span key={i}>{i % ogni === 0 || i === punti.length - 1 ? p.breve : ""}</span>
            ))}
          </div>
        </div>
      </Suggerimento>

      <details className="graf__tabella">
        <summary>Vedi i dati</summary>
        <table>
          <caption className="visually-hidden">{titolo}</caption>
          <thead>
            <tr>
              <th scope="col">Quando</th>
              {ordinate.map((s) => (
                <th key={s.chiave} scope="col">
                  {s.etichetta}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {punti.map((p, i) => (
              <tr key={i}>
                <th scope="row">{p.lungo}</th>
                {ordinate.map((s) => (
                  <td key={s.chiave}>{numero(p.valori[s.chiave] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/* ------------------------------------------------------------------------ *
 * Misuratori e barre di stato
 * ------------------------------------------------------------------------ */

const ICONA_ESITO: Record<EsitoControllo, NomeIcona> = { ok: "spunta", aperto: "attesa", guasto: "allarme" };
const PAROLA_ESITO: Record<EsitoControllo, string> = { ok: "a posto", aperto: "da guardare", guasto: "guasto" };

/**
 * Quanto è pieno qualcosa rispetto al suo limite: disco, memoria, carico.
 * La barra si riempie con il colore dell'esito; accanto, sempre, la
 * percentuale scritta e l'icona — il colore da solo non dice niente a chi
 * non lo distingue.
 */
export function Misuratore({
  etichetta,
  percentuale,
  esito,
  dettaglio,
}: {
  etichetta: string;
  /** 0–100; oltre 100 la barra resta piena e il numero dice quanto */
  percentuale: number | null;
  esito: EsitoControllo;
  dettaglio: string;
}) {
  return (
    <div className="graf-misura">
      <div className="graf-misura__testa">
        <span className="graf-misura__nome">{etichetta}</span>
        <span className="graf-misura__valore">
          {percentuale === null ? "—" : `${Math.round(percentuale)}%`}
          <span className={`graf-stato graf-stato--${esito}`} title={PAROLA_ESITO[esito]}>
            <Icona nome={ICONA_ESITO[esito]} misura={12} />
            <span className="visually-hidden">{PAROLA_ESITO[esito]}</span>
          </span>
        </span>
      </div>
      <div
        className="graf-misura__binario"
        role="meter"
        aria-label={etichetta}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentuale === null ? undefined : Math.min(100, Math.round(percentuale))}
      >
        {percentuale !== null ? (
          <span
            className={`graf-misura__pieno graf-misura__pieno--${esito}`}
            style={{ width: `${Math.max(2, Math.min(100, percentuale))}%` }}
          />
        ) : null}
      </div>
      <span className="graf-misura__dettaglio">{dettaglio}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Anello
 * ------------------------------------------------------------------------ */

export interface SpicchioAnello {
  chiave: string;
  etichetta: string;
  valore: number;
  esito: EsitoControllo;
}

/**
 * Le parti di un totale, in un anello: quanti controlli sono a posto, da
 * configurare, guasti. È l'unica forma di questa pagina in SVG — un arco non
 * si fa con dei riquadri — e il testo resta fuori dal disegno, nella legenda
 * e al centro, così non si deforma.
 *
 * Fra uno spicchio e l'altro uno spazio di due unità del colore della
 * superficie: è quello che li separa, non un bordo. La legenda dice sempre il
 * numero accanto al nome, perché il colore da solo non basta a nessuno.
 */
export function Anello({
  spicchi,
  totale,
  sotto,
  titolo,
}: {
  spicchi: SpicchioAnello[];
  totale: string;
  sotto: string;
  titolo: string;
}) {
  const r = 52;
  const giro = 2 * Math.PI * r;
  const somma = spicchi.reduce((t, s) => t + s.valore, 0) || 1;
  const visibili = spicchi.filter((s) => s.valore > 0);
  const spazio = visibili.length > 1 ? 3 : 0;
  let partenza = 0;

  return (
    <figure className="graf-anello">
      <div className="graf-anello__disegno">
        <svg viewBox="0 0 132 132" role="img" aria-label={`${titolo}: ${spicchi.map((s) => `${s.valore} ${s.etichetta}`).join(", ")}`}>
          <circle cx="66" cy="66" r={r} className="graf-anello__binario" />
          {visibili.map((s) => {
            const lunghezza = Math.max(0, (s.valore / somma) * giro - spazio);
            const arco = (
              <circle
                key={s.chiave}
                cx="66"
                cy="66"
                r={r}
                className={`graf-anello__arco graf-anello__arco--${s.esito}`}
                strokeDasharray={`${lunghezza} ${giro - lunghezza}`}
                strokeDashoffset={-partenza}
              />
            );
            partenza += (s.valore / somma) * giro;
            return arco;
          })}
        </svg>
        <div className="graf-anello__centro" aria-hidden="true">
          <strong>{totale}</strong>
          <span>{sotto}</span>
        </div>
      </div>
      <ul className="graf-anello__legenda">
        {spicchi.map((s) => (
          <li key={s.chiave}>
            <span className={`graf-anello__punto graf-misura__pieno--${s.esito}`} />
            {s.etichetta}
            <strong>{numero(s.valore)}</strong>
          </li>
        ))}
      </ul>
    </figure>
  );
}
