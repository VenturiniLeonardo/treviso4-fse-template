import { revalidatePath } from "next/cache";
import { consumaGettone, INTESTAZIONE_GETTONE } from "@/lib/rigenera-avvio";

/**
 * Dichiara scadute tutte le pagine, una volta, all'avvio del processo.
 *
 * La chiama soltanto `instrumentation.ts`, con il gettone che ha appena creato:
 * il perché sta in `lib/rigenera-avvio.ts`. Per chiunque altro non esiste.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!consumaGettone(req.headers.get(INTESTAZIONE_GETTONE))) {
    return new Response("Not Found", { status: 404 });
  }
  revalidatePath("/", "layout");
  return new Response(null, { status: 204 });
}
