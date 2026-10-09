import clsx from "clsx";
import Link from "next/link";
import type { Sezione } from "@/lib/data-area";

/**
 * Indirizzo della pagina «funzione non ancora attiva», con il comando premuto e
 * il punto da cui si veniva. Resta il ripiego per i comandi che non hanno una
 * controparte visiva: archiviare un anno, forzare la 2FA, rilasciare una
 * versione. Quelli non sono «aggiungi, modifica, cancella» — sono operazioni di
 * sistema, e senza il sistema sotto non c'è niente da disegnare.
 */
function nonAttiva(comando: string, percorso: string) {
  const q = new URLSearchParams({ cosa: comando, da: percorso });
  return `/area-riservata/manutenzione?${q}`;
}

/**
 * Dove porta un pulsante d'azione della sezione.
 *
 * Tre famiglie:
 *  - «Nuovo…», «Aggiungi…», «Registra…», «Invita…» aprono il modulo di
 *    inserimento della prima tabella della sezione: è l'unico posto dove quella
 *    riga può andare a finire;
 *  - «Esporta…» scaricano il CSV;
 *  - «Anteprima…» aprono la pagina pubblica corrispondente;
 *  - «Carica foto» e «Carica PDF/documento» rimandano alla sezione che quel
 *    caricamento lo fa davvero (album, documenti);
 *  - il resto porta alla schermata che dice perché non è attivo.
 */
function destinazione(
  label: string,
  ruolo: string,
  sezione: string,
  percorso: string,
): { href: string; scarica?: boolean; esterno?: boolean } {
  if (/^esporta/i.test(label)) {
    return { href: `/area-riservata/esporta/${sezione}?ruolo=${ruolo}`, scarica: true };
  }
  if (/^anteprima/i.test(label)) {
    return { href: ANTEPRIME[sezione] ?? "/", esterno: true };
  }
  if (/^carica foto/i.test(label)) {
    return { href: `/area-riservata/${ruolo}/album` };
  }
  if (/^carica (pdf|documento)/i.test(label)) {
    // i referenti di unità non hanno la sezione documenti: per loro resta il ripiego
    return ruolo === "referente"
      ? { href: nonAttiva(label, percorso) }
      : { href: `/area-riservata/${ruolo}/documenti` };
  }
  return { href: nonAttiva(label, percorso) };
}

/**
 * Se un pulsante d'azione ha ancora senso, in questa sezione.
 *
 * Su una sezione con una schermata vera, «Nuova attività» e «Registra
 * iscrizione» non hanno dove portare: il modulo di inserimento è già sulla
 * stessa pagina, poche righe più in basso. Prima puntavano al modulo del
 * prototipo — che scriveva altrove — e togliendo quello sarebbero finiti sulla
 * schermata «questa funzione non è ancora attiva», dicendo il falso su una cosa
 * che funziona.
 *
 * Un pulsante che non c'è è meglio di un pulsante che mente. Gli altri —
 * «Esporta CSV», «Anteprima», «Archivia anno» — restano: quelli portano ancora
 * da qualche parte, o dicono onestamente di non essere attivi.
 */
function mostraAzione(label: string, conSchermata?: boolean): boolean {
  if (!conSchermata) return true;
  return !/^(nuov|aggiungi|registra|invita)/i.test(label);
}

/** Quale pagina pubblica corrisponde a una sezione, per i pulsanti «Anteprima». */
const ANTEPRIME: Record<string, string> = {
  riepilogo: "/",
  presentazione: "/unita",
  circolari: "/documenti",
  pagine: "/",
  unita: "/unita",
  calendario: "/attivita",
  album: "/foto",
  documenti: "/documenti",
  referenti: "/contatti",
  "testi-unita": "/unita",
};

/** Una sezione dell'area riservata: intestazione, indicatori, avviso, tabelle. */
export function AdminSection({
  sezione,
  chiave,
  ruolo,
  percorso,
  q,
  conSchermata,
  children,
}: {
  sezione: Sezione;
  /** chiave della sezione: serve alla rotta di esportazione */
  chiave: string;
  /** slug del ruolo di cui si sta guardando la vista */
  ruolo: string;
  /** indirizzo della sezione, per tornare indietro dalla pagina di servizio */
  percorso: string;
  /**
   * Testo cercato nella barra.
   *
   * Non filtra niente: le tabelle su cui agiva sono andate via con la fase
   * 14.10. Serve solo a far comparire la fascia che lo dichiara — vedi il
   * commento più sotto.
   */
  q?: string;
  /**
   * Vero se questa sezione ha una schermata vera, collegata al database.
   *
   * Quando lo è, le tabelle e il modulo del prototipo non si disegnano: quella
   * sezione ha già i propri, e due moduli che accettano lo stesso dato in due
   * archivi diversi sono il modo di scriverlo in quello sbagliato.
   */
  conSchermata?: boolean;
  /** corpo su misura, per le sezioni che non sono tabelle e moduli generici */
  children?: React.ReactNode;
}) {
  const cerca = q?.trim() ?? "";

  return (
    <section className="adm-sec" aria-label={sezione.titolo}>
      <div className="adm-head">
        <div className="adm-head__text">
          <span className="adm-crumb">{sezione.crumb}</span>
          <h1 className="adm-title">{sezione.titolo}</h1>
          <span className="adm-note">{sezione.nota}</span>
        </div>
        <div className="adm-actions">
          {sezione.azioni.filter((a) => mostraAzione(a.label, conSchermata)).map((a) => {
            const d = destinazione(a.label, ruolo, chiave, percorso);
            const classe = clsx("adm-btn", a.primary && "adm-btn--primary");
            // un download e un collegamento esterno non sono navigazioni
            // interne: `a` normale, non `Link`
            return d.scarica || d.esterno ? (
              <a
                key={a.label}
                className={classe}
                href={d.href}
                target={d.esterno ? "_blank" : undefined}
                rel={d.esterno ? "noopener" : undefined}
              >
                {a.label}
              </a>
            ) : (
              <Link key={a.label} className={classe} href={d.href}>
                {a.label}
              </Link>
            );
          })}
        </div>
      </div>

      {sezione.kpi && sezione.kpi.length > 0 ? (
        <div className="adm-kpi">
          {sezione.kpi.map((k) => (
            <div className="adm-kpi__cell" key={k.label}>
              <span className="adm-kpi__label">{k.label}</span>
              <span
                className={clsx("adm-kpi__value", k.tone === "red" && "adm-kpi__value--red")}
              >
                {k.valore}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {sezione.avviso ? (
        <div className="adm-notice">
          <span className="adm-notice__tag">{sezione.avviso.tag}</span>
          <p>{sezione.avviso.testo}</p>
          <Link href={sezione.avviso.href}>{sezione.avviso.link}</Link>
        </div>
      ) : null}

      {/*
        Diceva «Righe filtrate per «x» in questa sezione», e non era più vero.

        Quel filtro agiva sulle tabelle del prototipo, che la fase 14.10 ha
        portato via: `?q=` adesso non filtra niente, in nessuna sezione. La
        casella in barra resta perché è nel disegno approvato, ma la fascia dice
        che cosa succede davvero — e dove sono i filtri che funzionano.

        È l'ultima frase di questa famiglia trovata cercando «non è ancora»,
        «arriva con», «dati fissi», come l'audit della fase 13 raccomanda di fare
        prima di chiudere.
      */}
      {cerca ? (
        <div className="adm-filtro" role="status">
          <span>
            Cercato «<strong>{cerca}</strong>». La ricerca dell’area riservata non c’è
            ancora: i filtri che funzionano sono quelli dentro le sezioni — per unità in
            «Unità» e «Calendario», per anno nei documenti, per chi e quando nel registro.
          </span>
          <Link href={percorso} aria-label="chiudi l’avviso di ricerca">chiudi</Link>
        </div>
      ) : null}

      {children}
    </section>
  );
}
