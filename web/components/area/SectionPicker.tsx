"use client";

import { useRouter } from "next/navigation";
import { Esci } from "@/components/area/AdminSide";
import type { Ruolo } from "@/lib/data-area";
import { navVisibile } from "@/lib/nav-area";

/**
 * Scelta della sezione su telefono. Le sezioni sono rotte vere, quindi il menu
 * a tendina non nasconde e mostra blocchi: cambia pagina. Senza JavaScript resta
 * comunque raggiungibile tutto dalla colonna laterale.
 */
export function SectionPicker({
  ruolo,
  attiva,
  nascoste,
}: {
  ruolo: Ruolo;
  attiva: string;
  /**
   * Le sezioni che la matrice non concede, come per `AdminSide`: la tendina è
   * lo stesso menu su schermo stretto e deve tacere le stesse voci. La sezione
   * aperta resta fra le opzioni anche se nascosta (vedi `navVisibile`).
   */
  nascoste?: ReadonlySet<string>;
}) {
  const router = useRouter();

  return (
    <div className="adm-picker">
      <label htmlFor="adm-picker-select">Sezione</label>
      <select
        id="adm-picker-select"
        value={attiva}
        onChange={(e) => router.push(`/area-riservata/${ruolo.slug}/${e.target.value}`)}
      >
        {navVisibile(ruolo, nascoste, attiva).flatMap((g) =>
          g.voci.map((v) => (
            <option key={v.chiave} value={v.chiave}>
              {v.testo}
            </option>
          )),
        )}
      </select>
      <div className="adm-picker__links">
        <Esci />
      </div>
    </div>
  );
}
