import { leggiCaricato } from "@/lib/archivio";
import { puo } from "@/lib/auth/contesto";
import { fileInterno, filePubblico } from "@/lib/documenti-store";
import { contentDisposition } from "@/lib/nome-file";

/**
 * Serve i moduli caricati dai referenti.
 *
 * `?scarica=1` fa scendere il file invece di aprirlo nel browser: è la
 * differenza fra i due pulsanti della pagina Documenti, e si fa con
 * `Content-Disposition`, non con due copie del file.
 *
 * Il nome del file allegato è quello del documento, non quello interno: chi
 * scarica «Modulo di iscrizione 2026–2027.pdf» non deve ritrovarsi
 * `doc-2026-2027-modulo-...-1786977180984.pdf` nella cartella dei download.
 *
 * Come per le fotografie, un documento **non pubblicato** esce solo per chi lo
 * gestisce. Serve perché chi carica un modulo deve poterlo riaprire per
 * controllarlo prima di pubblicarlo.
 *
 * ## Chi decide, da qui in avanti
 *
 * Era `puoPubblicare(sessione)`, un predicato scritto in `lib/sessione.ts`.
 * Adesso è la riga `documenti` della matrice, cioè la stessa che
 * l'amministratore vede a schermo: fino alla fase 14 questa rotta era fra le
 * sei che la matrice **non** governava, e cambiarla dalla schermata non
 * apriva né chiudeva questa porta. I livelli del seme: sviluppatore e referente
 * gruppo `completo`, referente di unità `limitato` — le circolari della propria unità.
 * Per questo la decisione porta l'unità del documento (vedi sotto): senza,
 * `limitato` scavalcherebbe l'ambito.
 *
 * ## Perché `puo()` e non `contesto()`
 *
 * `contesto()` scrive nel registro **anche i rifiuti**, che è giusto per una
 * scrittura e sbagliato qui: questa è una `GET` che serve un file, e ogni
 * richiesta a un documento in bozza lascerebbe una riga di log. `puo()`
 * interroga la stessa `decidi()` sulla stessa matrice e non registra niente.
 * La regola per il resto del progetto: **le scritture passano da `contesto()`,
 * le letture da `puo()`.** L'eccezione dichiarata è l'elenco iscritti, dove
 * leggere *è* l'operazione da tracciare perché sono nomi di minori.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  const pubblico = await filePubblico(file);
  let trovato = pubblico;

  if (!trovato) {
    const interno = await fileInterno(file);
    if (!interno) return new Response("Non trovato", { status: 404 });

    // Stessa risposta per «non esiste» e «non ti compete»: distinguerle
    // confermerebbe a chi tira a indovinare che il file c'è. `puo()` copre
    // anche il caso «nessuna sessione»: `decidi` lo rifiuta col motivo
    // `sessione`, quindi non serve controllarlo a parte.
    //
    // L'ambito del documento — la sua unità — entra nella decisione, come nella
    // rotta delle fotografie. Dalla fase 14 `documenti` vale `limitato` per il
    // referente di unità (le circolari della sua unità), non più `nessuno`: senza
    // l'ambito, `limitato` senza risorsa passa sempre, e un referente di unità potrebbe
    // scaricare la bozza di un'altra unità o della modulistica di gruppo. Con
    // l'unità, `limitato` copre solo la propria; `completo` — gestore e
    // sviluppatore — copre tutto.
    if (!(await puo("documenti", { unita: interno.unita }))) {
      return new Response("Non trovato", { status: 404 });
    }
    trovato = interno;
  }

  const dati = await leggiCaricato(file);
  if (!dati) return new Response("Non trovato", { status: 404 });

  const scarica = new URL(req.url).searchParams.get("scarica") === "1";
  const estensione = trovato.formato.toLowerCase();
  // Solo caratteri sicuri nel nome: virgolette e ritorni a capo dentro un
  // Content-Disposition sono un modo classico di iniettare intestazioni. Quelli
  // scartati diventano un trattino invece di sparire, altrimenti «2026–2027»
  // arriverebbe nella cartella dei download come «20262027».
  const nome =
    trovato.titolo
      .replace(/[^\p{L}\p{N} .,_-]/gu, "-")
      .replace(/-{2,}/g, "-")
      .trim() + `.${estensione}`;

  return new Response(new Uint8Array(dati), {
    headers: {
      "Content-Type": trovato.tipo,
      "Content-Length": String(dati.length),
      "Content-Disposition": contentDisposition(nome, scarica),
      // Una bozza non finisce in nessuna cache condivisa: vedi la rotta delle
      // fotografie, il motivo è lo stesso.
      "Cache-Control": pubblico
        ? "public, max-age=31536000, immutable"
        : "private, no-store",
      ...(pubblico ? {} : { Vary: "Cookie" }),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
