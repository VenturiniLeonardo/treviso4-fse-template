import type { Metadata } from "next";
import { metadatiPagina } from "@/lib/metadati";
import { Crumbs } from "@/components/site/Crumbs";
import { ElencoDocumenti } from "@/components/site/Documenti";
import { leggiCartelle } from "@/lib/cartelle-store";
import { INTRO } from "@/lib/data";
import { documentiPubblicati } from "@/lib/documenti-store";

export const metadata: Metadata = metadatiPagina(
  "Label",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.",
  "/documenti",
);

/**
 * Tutti i documenti, cartella per cartella: ogni cartella è una tendina che si
 * apre sul posto. Vedi `components/site/Documenti.tsx`.
 */
export default async function PaginaDocumenti() {
  const [cartelle, documenti] = await Promise.all([
    leggiCartelle(),
    documentiPubblicati(),
  ]);

  return (
    <main id="contenuto">
      <div className="wrap section--tight stack gap-14">
        <Crumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Label" },
          ]}
        />
        <h1 className="h1">Label</h1>
        <p className="lead" style={{ maxWidth: "640px" }}>
          {INTRO.documenti}
        </p>
      </div>

      <div
        className="wrap"
        style={{ paddingTop: "34px", paddingBottom: "76px" }}
      >
        <ElencoDocumenti cartelle={cartelle} documenti={documenti} />
      </div>
    </main>
  );
}
