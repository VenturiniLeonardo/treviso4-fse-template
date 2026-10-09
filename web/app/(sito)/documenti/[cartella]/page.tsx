import { notFound, permanentRedirect } from "next/navigation";
import { cartellaPerChiave } from "@/lib/cartelle-store";

type Params = Promise<{ cartella: string }>;

/**
 * Il vecchio indirizzo di una cartella, quello che i referenti hanno già mandato alle
 * famiglie. Dal 6 ottobre 2026 le cartelle sono tendine dentro `/documenti`:
 * qui si rimanda a `/documenti#<chiave>`, che apre la tendina giusta.
 * Una cartella che non esiste resta una 404.
 */
export default async function PaginaCartella({ params }: { params: Params }) {
  const { cartella } = await params;
  const c = await cartellaPerChiave(cartella);
  if (!c) notFound();
  permanentRedirect(`/documenti#${c.chiave}`);
}
