import type { Metadata } from "next";
import { metadatiPagina } from "@/lib/metadati";
import { Calendario } from "@/components/site/Calendario";
import { Crumbs } from "@/components/site/Crumbs";
import { attivitaPubbliche, isoDaEvento } from "@/lib/attivita-store";
import { ETICHETTA_TIPO } from "@/lib/attivita";
import { ANNI_DOC, INTRO } from "@/lib/data";
import { documentiPubblicati } from "@/lib/documenti-store";

export const metadata: Metadata = metadatiPagina(
  "Label",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do.",
  "/attivita",
);

/*
 * La pagina è statica e si rigenera quando un referente tocca un'attività. Ma le
 * attività passate escono anche senza che nessuno tocchi niente: basta che
 * cambi il giorno. Una rigenerazione all'ora le toglie entro un'ora dalla
 * mezzanotte.
 */
export const revalidate = 3600;

/** La data di oggi in Italia, `AAAA-MM-GG`: il server può stare in UTC. */
function oggiIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
}

export default async function Attivita() {
  /*
   * Dal database, non più da `EVENTI`.
   *
   * Le sole pubblicate: una bozza è di chi la sta scrivendo, e una in revisione
   * di chi deve approvarla. `attivitaPubbliche` ricade sul seme quando la
   * tabella è vuota o il database non c'è — cioè in compilazione, dove questa
   * pagina viene prerenderizzata.
   *
   * `tipo` esce dallo store come chiave (`uscita-squadra`); l'etichetta si
   * mette qui, che è l'unico posto che sa come si scrive per le famiglie.
   */
  // solo da oggi in poi: un'attività già passata non serve a chi organizza la
  // settimana. Quella di oggi resta fino a domani.
  const oggi = oggiIso();
  const eventi = (await attivitaPubbliche())
    .filter((a) => (isoDaEvento(a.giorno, a.mese, a.anno) ?? "") >= oggi)
    .map((a) => ({
      ...a,
      tipo: ETICHETTA_TIPO[a.tipoChiave] ?? a.tipo,
    }));

  // il programma dell'anno in corso, se i gestori l'hanno caricato: è la
  // voce «Programma delle attività» della modulistica, categoria «campi»
  const calendario = (await documentiPubblicati()).find(
    (d) =>
      d.anno === ANNI_DOC[0].chiave &&
      d.file &&
      /programma|calendario/i.test(d.titolo),
  );

  return (
    <main id="contenuto">
      <div className="wrap section--tight headrow">
        <div className="stack gap-14 measure">
          <Crumbs items={[{ label: "Home", href: "/" }, { label: "Label" }]} />
          <h1 className="h1">Label</h1>
          <p className="lead measure--sm">{INTRO.attivita}</p>
        </div>
        {/* Il pulsante porta al file vero, e c'è solo se il file c'è. Prima
            portava sempre a /documenti, dove un calendario da scaricare poteva
            non esserci affatto: sul sito appena messo in linea non c'è. */}
        {calendario ? (
          <a className="btn btn--primary" href={`/documento/${calendario.file}?scarica=1`}>
            Scarica il calendario ({calendario.formato})
          </a>
        ) : null}
      </div>

      <Calendario eventi={eventi} />
    </main>
  );
}
