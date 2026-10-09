"use client";

export interface Chip {
  chiave: string;
  label: string;
  /** tinta della pastiglia quando è attiva: gruppo | gialla | verde | rossa | corrente */
  tone?: string;
}

/**
 * Gruppo di filtri a pastiglie. Il filtraggio resta lato client (§04): venti
 * attività o dodici album non meritano un giro sul server. `aria-pressed`
 * comunica lo stato, come nel sito consegnato.
 */
export function Chips({
  chips,
  attivo,
  onSelect,
  labelledBy,
}: {
  chips: Chip[];
  attivo: string;
  onSelect: (chiave: string) => void;
  labelledBy: string;
}) {
  return (
    <div className="chips" role="group" aria-labelledby={labelledBy}>
      {chips.map((c) => (
        <button
          key={c.chiave}
          className="chip"
          type="button"
          data-tone={c.tone ?? ""}
          aria-pressed={c.chiave === attivo}
          onClick={() => onSelect(c.chiave)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
