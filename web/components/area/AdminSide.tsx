import clsx from "clsx";
import Link from "next/link";
import { esci } from "@/app/(area)/area-riservata/accedi/actions";
import type { Ruolo } from "@/lib/data-area";
import { navVisibile } from "@/lib/nav-area";

/** Uscita: cancella la sessione. È un'azione, non un collegamento alla home. */
export function Esci({ className }: { className?: string }) {
  return (
    <form action={esci}>
      <button type="submit" className={className}>
        esci dall’area riservata
      </button>
    </form>
  );
}

/**
 * Colonna delle sezioni. Le voci sono collegamenti, non pulsanti che nascondono
 * blocchi (§04): l'indirizzo è condivisibile e il tasto indietro funziona.
 */
export function AdminSide({
  ruolo,
  attiva,
  nascoste,
}: {
  ruolo: Ruolo;
  attiva: string;
  /**
   * Le sezioni che la matrice non concede a chi guarda: non compaiono nel menu.
   *
   * §8 del mandato: «il frontend deve nascondere le sezioni non disponibili».
   * Arriva calcolato dalla pagina, che è un componente server e può interrogare
   * la matrice; qui si filtra e basta.
   *
   * **Non è la protezione.** Chi digita l'indirizzo a mano arriva alla sezione,
   * e trova il riquadro «Permessi» che glielo dice; chi manda una Server Action
   * trova il cancello. Questo elenco serve a non mettere in un menu una voce che
   * porta a un rifiuto — che fa cercare un guasto, e insegna che il menu non
   * dice la verità.
   */
  nascoste?: ReadonlySet<string>;
}) {
  return (
    <aside className="adm-side" aria-label="Sezioni dell’area riservata">
      {ruolo.ambitoTitolo ? (
        <div className="adm-scope" style={{ borderLeftColor: ruolo.ambitoColore }}>
          <span className="adm-scope__label">Ambito consentito</span>
          <strong>{ruolo.ambitoTitolo}</strong>
          {ruolo.ambitoNota ? <em>{ruolo.ambitoNota}</em> : null}
        </div>
      ) : null}

      {navVisibile(ruolo, nascoste).map((g) => (
        <div className="adm-navgroup" key={g.label}>
          <span className="adm-navgroup__label">{g.label}</span>
          {g.voci.map((v) => (
            <Link
              key={v.chiave}
              className="adm-navitem"
              href={`/area-riservata/${ruolo.slug}/${v.chiave}`}
              aria-current={v.chiave === attiva ? "true" : "false"}
            >
              <span>{v.testo}</span>
              <span
                className={clsx(
                  "adm-navitem__tag",
                  v.tag === "GDPR" && "adm-navitem__tag--gdpr",
                )}
              >
                {v.tag}
              </span>
            </Link>
          ))}
        </div>
      ))}

      {ruolo.fuoriAmbito ? (
        <div className="adm-out">
          <span className="adm-out__label">Fuori ambito</span>
          <p>{ruolo.fuoriAmbito}</p>
        </div>
      ) : null}

      <div className="adm-links">
        <Esci />
      </div>
    </aside>
  );
}
