import type { Metadata } from "next";
import { CorniceAccesso } from "@/components/area/CorniceAccesso";
import { ModuloAccesso } from "@/components/area/ModuloAccesso";

export const metadata: Metadata = {
  title: "Accesso",
  robots: { index: false, follow: false },
};

/** Schermata di accesso: il primo dei due passi. */
export default async function Accedi({
  searchParams,
}: {
  searchParams: Promise<{ da?: string }>;
}) {
  const { da } = await searchParams;

  return (
    <CorniceAccesso
      titolo="Accesso per i referenti"
      sottotitolo="Quest’area contiene elenchi di iscritti e consensi. Gli accessi sono registrati."
    >
      <ModuloAccesso da={da} />
    </CorniceAccesso>
  );
}
