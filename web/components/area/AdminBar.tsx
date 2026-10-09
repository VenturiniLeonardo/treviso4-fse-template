import clsx from "clsx";
import { MenuProfilo } from "@/components/area/MenuProfilo";
import type { Ruolo } from "@/lib/data-area";
import type { Identita } from "@/lib/identita";
import type { Sessione } from "@/lib/sessione";

/**
 * Barra superiore dell'area riservata: marchio, ambito e utente.
 *
 * Nome e iniziali vengono dalla sessione, non dai dati del mockup: chi è entrato
 * deve vedere sé stesso. Se l'admin sta guardando la vista di un altro ruolo,
 * la barra lo dice, altrimenti sembrerebbe di essere quell'altro.
 */
export function AdminBar({ ruolo, sessione, identita }: {
  ruolo: Ruolo;
  sessione: Sessione;
  /** marchio e nome scelti dai referenti: la barra usa gli stessi del sito */
  identita: Identita;
  /** indirizzo della sezione: è l'azione del modulo di ricerca */
  percorso?: string;
  /** testo cercato, per ripresentarlo nel campo */
  q?: string;
}) {
  const b = ruolo.barraBadge;
  const inPrestito = sessione.r !== ruolo.slug;

  const testoBadge = b.testo;

  return (
    <header className={clsx("adm-bar", ruolo.barraTema === "dark" && "adm-bar--dark")}>
      <div className="adm-bar__left">
        <span className="adm-bar__brand">
          <img
            src={identita.marchio.src}
            width={identita.marchio.larghezza}
            height={identita.marchio.altezza}
            alt=""
          />
          <span>{ruolo.barraTitolo}</span>
        </span>
        {/* svuotati i conteggi inventati, un badge senza testo lascerebbe un
            rettangolo grigio in barra: se non c'è niente da dire, non si dice */}
        {testoBadge ? <span className="adm-bar__sep" aria-hidden="true"></span> : null}
        {!testoBadge ? null : b.tipo === "unita" ? (
          <span className="adm-badge adm-badge--unit">
            <img src={`/assets/${b.logo}`} width={240} height={240} alt="" />
            {/* Il nome dell'unità in un elemento suo e non come testo nudo
                accanto all'immagine: dentro un contenitore `flex` un testo
                sciolto diventa una riga anonima, che non si può accorciare con
                i puntini. In una barra alta 48 px fissi, un nome d'unità lungo
                a 800 px andava a capo su tre righe e la pastiglia
                usciva sopra e sotto la barra — misurata a 64,5 px di altezza,
                da −8,8 a 55,8. Ora si accorcia (§ admin.css). */}
            <span className="adm-badge__testo">{b.testo}</span>
          </span>
        ) : b.tipo === "contorno" ? (
          <span className="adm-badge adm-badge--outline">{testoBadge}</span>
        ) : (
          <span className="adm-badge">{testoBadge}</span>
        )}
      </div>
      <div className="adm-bar__right">
        <MenuProfilo
          sessione={sessione}
          ruoloMostrato={inPrestito ? ruolo.barraRuolo : undefined}
        />
      </div>
    </header>
  );
}
