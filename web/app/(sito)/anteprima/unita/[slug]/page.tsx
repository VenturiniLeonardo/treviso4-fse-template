import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CorpoUnita } from "@/components/site/CorpoUnita";
import { leggiUnita } from "@/lib/unita-store";
import { unitaInAnteprima } from "@/lib/unita-store";
import { campoUnita, ETICHETTA_TIPO_PERSONA } from "@/lib/unita-contenuti";
import { puo } from "@/lib/auth/contesto";
import { sessioneCorrente } from "@/lib/sessione-server";

/**
 * L'anteprima di una pagina d'unità: come sarebbe se tutto venisse approvato.
 *
 * ## Perché è una rotta a parte e non `?anteprima=1`
 *
 * È la scelta tecnica che regge questa fase, e va scritta perché la strada più
 * ovvia è quella sbagliata.
 *
 * Leggere `searchParams` in `/unita/[slug]` avrebbe fatto **rinunciare alla
 * prerenderizzazione per tutti**: in Next una pagina che legge la query è
 * dinamica sempre, non solo quando la query c'è. Le sei pagine d'unità sarebbero
 * passate da file salvati a rendering a ogni visita, e §04 del piano chiede
 * l'opposto — «una visita non sveglia il database». Un'anteprima per tre referenti
 * gruppo avrebbe rallentato il sito per tutte le famiglie.
 *
 * Con una rotta sua, `/unita/[slug]` non cambia di una riga e questa è dinamica
 * per progetto. Il prezzo è un indirizzo diverso da quello pubblico, e non è un
 * prezzo: un'anteprima **deve** avere un indirizzo suo, così non si condivide
 * per sbaglio credendo di mandare la pagina vera.
 *
 * ## Perché sta in `(sito)` e non in `(area)`
 *
 * Perché deve **essere** la pagina pubblica, con il suo `<body>`, il suo
 * `site.css`, la sua barra e il suo piede. Un'anteprima disegnata dentro il
 * guscio dell'area riservata mostrerebbe i testi giusti in una pagina sbagliata,
 * e la domanda a cui serve rispondere — «viene bene?» — non avrebbe risposta.
 *
 * Il corpo è lo **stesso componente** della pagina vera, `CorpoUnita`: vedi il
 * commento là sul perché non poteva essere una copia.
 *
 * ## La protezione
 *
 * `/anteprima/*` passa dal middleware come `/area-riservata/*`: senza sessione
 * attiva non si entra. Il controllo è **ripetuto qui**, perché una pagina non
 * deve dipendere dal fatto che qualcuno a monte se ne sia ricordato — è la stessa
 * regola che vale per le sezioni dell'area.
 *
 * Nessun controllo di ambito, e va detto: un referente di unità vede l'anteprima di
 * un'altra unità. Non è una dimenticanza. Queste pagine sono **pubbliche**: il
 * loro contenuto è già visibile a chiunque su `/unita/[slug]`, e l'unica cosa in
 * più che l'anteprima mostra sono proposte di testi e recapiti — non nomi di
 * minori, non consensi, non recapiti privati. Un cancello d'ambito qui avrebbe
 * protetto qualcosa che non ha bisogno di protezione, e avrebbe insegnato a non
 * fidarsi di quelli che proteggono davvero.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Anteprima",
  // un'anteprima non va nei motori di ricerca, nemmeno se qualcuno ne
  // condivide l'indirizzo per sbaglio
  robots: { index: false, follow: false },
};

export default async function AnteprimaUnita({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // il middleware ha già fermato chi non è entrato; qui si rifà, perché una
  // pagina non dipende dal fatto che qualcuno a monte se ne sia ricordato
  const sessione = await sessioneCorrente();
  if (!sessione) notFound();

  // L'ambito d'unità, come ovunque nel resto dell'area. Il middleware lascia
  // passare qualunque sessione attiva su `/anteprima` (là il ruolo non conta,
  // serve solo il nonce della CSP), ma questa pagina mostra le bozze **non
  // ancora approvate** di un'unità: un referente di unità non deve vedere le proposte di
  // un'altra. Il cancello è la riga `unita-scheda` della matrice sull'unità —
  // era `puoScrivereSu`, scritto sul ruolo (audit degli accessi, M-2).
  const chiave = (await leggiUnita()).find((u) => u.slug === slug)?.chiave;
  if (!chiave || !(await puo("unita-scheda", { unita: chiave }))) notFound();

  // e chi non legge referenti e recapiti (la riga `referenti`) vede solo i testi proposti
  const esito = await unitaInAnteprima(slug, {
    soloContenuti: !(await puo("referenti", { unita: chiave })),
  });
  if (!esito) notFound();

  const { unita, campi, elenchi } = esito;
  const nulla = campi.length === 0 && elenchi.length === 0;
  const tutte = await leggiUnita();

  return (
    <>
      {/*
        La fascia sta **sopra** la pagina e non dentro il corpo: `CorpoUnita` non
        sa in quale delle due rotte si trova, ed è quello che garantisce che
        l'anteprima e la pagina vera siano la stessa cosa.

        Colori in linea e non una classe di `site.css`: quel foglio disegna il
        sito pubblico approvato, e questa è una fascia che le famiglie non
        vedranno mai. Aggiungerci una regola vorrebbe dire mettere nel disegno
        consegnato un elemento che non gli appartiene.
      */}
      <div
        role="status"
        style={{
          background: "#2b2118",
          color: "#ffdd66",
          padding: "12px 24px",
          fontSize: "14.5px",
          lineHeight: 1.5,
          display: "flex",
          flexWrap: "wrap",
          gap: "10px 18px",
          alignItems: "baseline",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <strong>Anteprima</strong>
        <span>
          {nulla ? (
            <>
              Non c’è niente in attesa: questa è già la pagina pubblica, identica.
            </>
          ) : (
            <>
              Così sarebbe la pagina <strong>se tutto venisse approvato</strong>. In
              attesa:{" "}
              {[
                ...campi.map((c) => campoUnita(c.campo)?.label ?? c.campo),
                ...elenchi.map((t) => ETICHETTA_TIPO_PERSONA[t].toLowerCase()),
              ].join(", ")}
              .
            </>
          )}
        </span>
        <Link href={`/unita/${unita.slug}`} style={{ color: "#fff", textDecoration: "underline" }}>
          vedi la pagina pubblica di adesso
        </Link>
        <Link
          href="/area-riservata/gestore/approvazioni"
          style={{ color: "#fff", textDecoration: "underline" }}
        >
          torna alla coda
        </Link>
      </div>

      <CorpoUnita u={unita} tutte={tutte} />
    </>
  );
}
