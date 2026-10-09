"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Chips } from "@/components/site/Chips";
import { Photo, trama } from "@/components/site/Photo";
import type { AlbumSalvato } from "@/lib/contenuti";
import { fasciaDiUnita, FILTRI_UNITA, labelDiUnita } from "@/lib/data";

/**
 * Album raggruppati per anno sociale e filtrabili per unità.
 *
 * `children` è l'album in evidenza: nel mockup sta fra la barra dei filtri e
 * l'elenco degli anni, e la barra dei filtri fa parte di questo componente
 * perché ne condivide lo stato.
 */
/**
 * Che cosa dice il contatore in barra.
 *
 * Diceva sempre «N album pubblicati», e con dodici album vuoti quella riga
 * annunciava un archivio che non c'è: gli album sono pubblicati per davvero —
 * lo stato nel database è quello — ma pubblicato e visibile non sono la stessa
 * cosa se dentro non c'è ancora nessuna fotografia. Adesso la riga distingue i
 * tre casi, così il numero in alto e le schede sotto raccontano la stessa cosa.
 */
function conteggio(totale: number, conFoto: number): string {
  if (totale === 0) return "nessun album";
  if (conFoto === totale) return `${totale} ${totale === 1 ? "album pubblicato" : "album pubblicati"}`;
  if (conFoto === 0) return `${totale} album, fotografie in preparazione`;
  return `${totale} album, ${conFoto} con fotografie`;
}

export function Galleria({
  album,
  children,
}: {
  album: AlbumSalvato[];
  children?: React.ReactNode;
}) {
  const [attivo, setAttivo] = useState("tutte");

  const chips = [
    { chiave: "tutte", label: "Tutti gli album" },
    ...FILTRI_UNITA.map((f) => ({ chiave: f.chiave, label: f.label, tone: f.fascia })),
  ];

  const visibili = useMemo(
    () => (attivo === "tutte" ? album : album.filter((a) => a.unita === attivo)),
    [album, attivo],
  );

  // gli anni vengono dagli album stessi, non da un elenco fisso: un album
  // nuovo può inaugurare un anno che prima non c'era
  const anni = [...new Set(album.map((a) => a.anno))]
    .sort()
    .reverse()
    .map((anno) => ({ anno, album: visibili.filter((a) => a.anno === anno) }))
    .filter((g) => g.album.length > 0);

  return (
    <>
      <div className="filterbar">
        <div className="filterbar__inner">
          <span className="filterbar__label" id="etichetta-unita">
            Unità
          </span>
          <Chips chips={chips} attivo={attivo} onSelect={setAttivo} labelledBy="etichetta-unita" />
          <span className="filterbar__count" role="status">
            {conteggio(visibili.length, visibili.filter((a) => a.foto.length > 0).length)}
          </span>
        </div>
      </div>

      {children}

      <div className="wrap stack gap-34" style={{ paddingTop: "56px" }}>
        {anni.map((g) => (
          <section className="stack gap-18" key={g.anno} aria-label={`Anno ${g.anno}`}>
            <div className="section-rule">
              <span className="section-rule__year">{g.anno}</span>
              <span className="section-rule__line" aria-hidden="true"></span>
              <span className="section-rule__count">
                {g.album.length} {g.album.length === 1 ? "album" : "album"}
              </span>
            </div>
            <div className="grid grid--3">
              {g.album.map((a) => {
                const col = fasciaDiUnita(a.unita);
                return (
                  <Link key={a.slug} className="card album" href={`/foto/${a.slug}`}>
                    {/* La copertina è la prima foto caricata, ed è pubblica anche
                        se l'album ha la password: è l'unica fotografia che
                        `/foto-file` serve senza. Finché non ce n'è nessuna resta
                        il riquadro rigato del disegno, senza etichetta. */}
                    {a.foto[0] ? (
                      <span className="album__cover album__cover--vera">
                        <img
                          src={`/foto-file/${a.foto[0].file}?l=400`}
                          width={a.foto[0].larghezza}
                          height={a.foto[0].altezza}
                          alt=""
                        />
                        <span className={`pill pill--${a.unita} album__badge`}>
                          {labelDiUnita(a.unita)}
                        </span>
                      </span>
                    ) : (
                      <Photo className="album__cover" style={trama(col.tinta)}>
                        <span className={`pill pill--${a.unita} album__badge`}>
                          {labelDiUnita(a.unita)}
                        </span>
                      </Photo>
                    )}
                    <span className="album__body">
                      <span className="album__title">{a.titolo}</span>
                      <span className="album__foot">
                        <span className="album__date">{a.data}</span>
                        <span className="album__count">
                          {a.foto.length > 0 ? `${a.foto.length} foto` : "in preparazione"}
                        </span>
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}

        {/* Come nel calendario: «nessun album del tutto» non è «nessun album
            per questo filtro», e non va detto di cambiarlo. */}
        {album.length === 0 ? (
          <div className="empty">
            <strong>Label</strong>
            <span>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
              incididunt ut labore et dolore magna aliqua. Ut.
            </span>
          </div>
        ) : visibili.length === 0 ? (
          <div className="empty">
            <strong>Nessun album per questa unità</strong>
            <span>Provate a scegliere un altro filtro.</span>
          </div>
        ) : null}
      </div>
    </>
  );
}
