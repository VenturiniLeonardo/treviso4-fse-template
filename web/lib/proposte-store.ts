import { and, asc, eq, isNotNull } from "drizzle-orm";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { adessoIso, isoInMs, msInIso } from "@/lib/db/mappa";
import { proposte as tabella, utenti } from "@/lib/db/schema";
import { improntaDiRevisione } from "@/lib/impronta-revisione";
import { motivoDelRitiro, type PropostaInAttesa, type TipoProposta } from "@/lib/proposte";

/**
 * Le proposte che non hanno un posto loro: testi delle pagine, domande
 * frequenti, fotografie dei riquadri, copertine delle unità.
 *
 * Modulo di solo server. Non fa controlli di permesso, come gli altri store: il
 * cancello sta nelle azioni, e qui arrivano solo scritture già autorizzate.
 *
 * ## La tabella può non esserci
 *
 * Arriva con 0013, e il rilascio compila **prima** di applicare le migrazioni:
 * le letture tornano vuote finché la tabella non c'è, invece di far fallire la
 * compilazione. Le scritture no — scrivere una proposta senza la sua tabella è
 * un errore, e deve vedersi.
 */

let tabellaVista = false;

function tabellaPresente(d: Handle): boolean {
  if (tabellaVista) return true;
  tabellaVista = Boolean(
    d.$client
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proposte'")
      .get(),
  );
  return tabellaVista;
}

function idAutore(d: Handle, utente: string): number | null {
  if (!utente) return null;
  return (
    d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, utente)).get()?.id ?? null
  );
}

/**
 * Scrive una proposta, al posto di quella che c'era per la stessa chiave.
 *
 * Restituisce il file della proposta **sostituita**, se ne aveva uno diverso:
 * chi ricarica la fotografia di un riquadro tre volte prima che qualcuno la
 * guardi lascerebbe in archivio due fotografie che nessuna riga nomina più, e
 * le porta via chi chiama — dopo il commit, come si fa con i file.
 */
export async function proponi(
  tipo: TipoProposta,
  chiave: string,
  valore: string,
  file: string | null,
  autore: string,
): Promise<string | null> {
  try {
    return transazione((d) => {
      const prima = d
        .select({ file: tabella.file })
        .from(tabella)
        .where(and(eq(tabella.tipo, tipo), eq(tabella.chiave, chiave)))
        .get();

      const autoreId = idAutore(d, autore);
      d.insert(tabella)
        .values({ tipo, chiave, valore, file, autoreId, creatoIl: adessoIso() })
        .onConflictDoUpdate({
          target: [tabella.tipo, tabella.chiave],
          set: { valore, file, autoreId, creatoIl: adessoIso() },
        })
        .run();

      return prima?.file && prima.file !== file ? prima.file : null;
    });
  } catch (errore) {
    solleva("proposte-store.proponi", errore);
  }
}

/**
 * Toglie la proposta per questa chiave, e la restituisce.
 *
 * È il primo passo sia dell'approvazione sia del rinvio: chi la prende è l'unico
 * che la decide. Due gestori che premono «approva» sulla stessa voce non
 * devono applicarla due volte — il secondo trova `null` e si sente dire che
 * qualcun altro l'ha già decisa, come per le proposte delle unità.
 */
export async function prendiProposta(
  tipo: TipoProposta,
  chiave: string,
): Promise<PropostaInAttesa | null> {
  try {
    return transazione((d) => {
      const riga = d
        .select({
          valore: tabella.valore,
          file: tabella.file,
          creatoIl: tabella.creatoIl,
          autore: utenti.utente,
        })
        .from(tabella)
        .leftJoin(utenti, eq(tabella.autoreId, utenti.id))
        .where(and(eq(tabella.tipo, tipo), eq(tabella.chiave, chiave)))
        .get();
      if (!riga) return null;

      d.delete(tabella)
        .where(and(eq(tabella.tipo, tipo), eq(tabella.chiave, chiave)))
        .run();
      return {
        tipo,
        chiave,
        valore: riga.valore,
        file: riga.file,
        autore: riga.autore ?? "",
        quando: isoInMs(riga.creatoIl),
      };
    });
  } catch (errore) {
    solleva("proposte-store.prendiProposta", errore);
  }
}

/**
 * Rimette una proposta presa, se applicarla è fallito.
 *
 * Senza, un errore del database a metà approvazione farebbe sparire il lavoro di
 * chi l'aveva preparata, senza traccia: la proposta non c'è più, e la modifica
 * non è online.
 *
 * ## Solo se nel frattempo non ne è arrivata una nuova
 *
 * Fra la presa e il ripristino ci sono due transazioni e un `await`: chi propone
 * può scrivere in mezzo. Un upsert qui sovrascriverebbe la proposta nuova con
 * la vecchia (QA BUG-014). Quindi si inserisce e basta, e se la chiave è già
 * occupata vince la più recente: quella presa è superata, come se chi propone
 * l'avesse sostituita un istante dopo l'approvazione.
 *
 * `true` se è stata rimessa, `false` se era superata. Nel secondo caso il suo
 * file — se ne aveva uno diverso da quello della proposta nuova — non lo nomina
 * più nessuno, e lo porta via chi chiama.
 */
export async function rimettiProposta(p: PropostaInAttesa): Promise<boolean> {
  try {
    return transazione((d) => {
      const n = d
        .insert(tabella)
        .values({
          tipo: p.tipo,
          chiave: p.chiave,
          valore: p.valore,
          file: p.file,
          autoreId: idAutore(d, p.autore),
          // l'ora di quando era stata proposta: torna al suo posto in coda
          creatoIl: msInIso(p.quando) ?? adessoIso(),
        })
        .onConflictDoNothing({ target: [tabella.tipo, tabella.chiave] })
        .run().changes;
      return n > 0;
    });
  } catch (errore) {
    solleva("proposte-store.rimettiProposta", errore);
  }
}

/** Le proposte in attesa, le più vecchie prima. Facoltativamente di un tipo solo. */
export async function leggiProposteInAttesa(tipo?: TipoProposta): Promise<PropostaInAttesa[]> {
  const d = dbSeEsiste();
  if (!d || !tabellaPresente(d)) return [];

  try {
    return d
      .select({
        tipo: tabella.tipo,
        chiave: tabella.chiave,
        valore: tabella.valore,
        file: tabella.file,
        creatoIl: tabella.creatoIl,
        autore: utenti.utente,
      })
      .from(tabella)
      .leftJoin(utenti, eq(tabella.autoreId, utenti.id))
      .where(tipo ? eq(tabella.tipo, tipo) : undefined)
      .orderBy(asc(tabella.creatoIl), asc(tabella.id))
      .all()
      .map((r) => ({
        tipo: r.tipo as TipoProposta,
        chiave: r.chiave,
        valore: r.valore,
        file: r.file,
        autore: r.autore ?? "",
        quando: isoInMs(r.creatoIl),
      }));
  } catch (errore) {
    solleva("proposte-store.leggiProposteInAttesa", errore);
  }
}

/**
 * Il file di una fotografia in attesa, se c'è una proposta che lo nomina.
 *
 * Lo usa la rotta `/in-attesa/[file]`, che serve soltanto file nominati qui:
 * come `/immagine/` e `/copertina/`, nessun altro file dell'archivio esce da lì.
 */
export async function fileInAttesa(
  nome: string,
): Promise<{ tipo: string; proposta: string; chiave: string } | null> {
  const d = dbSeEsiste();
  if (!d || !tabellaPresente(d)) return null;

  try {
    const riga = d
      .select({ valore: tabella.valore, proposta: tabella.tipo, chiave: tabella.chiave })
      .from(tabella)
      .where(eq(tabella.file, nome))
      .get();
    if (!riga) return null;
    const dati = JSON.parse(riga.valore) as { tipo?: unknown };
    return {
      tipo: typeof dati.tipo === "string" ? dati.tipo : "image/jpeg",
      // di che proposta è, e su che cosa: la rotta ne ricava il cancello
      proposta: riga.proposta,
      chiave: riga.chiave,
    };
  } catch (errore) {
    solleva("proposte-store.fileInAttesa", errore);
  }
}

/**
 * I file nominati dalle proposte, per il lavoro notturno.
 *
 * Sincrona e con l'handle passato da fuori, come `copertineRegistrate`: la
 * chiama `nomiAttesi` dentro la sua lettura.
 */
export function fileDelleProposte(d: Handle): string[] {
  if (!tabellaPresente(d)) return [];
  return d
    .select({ file: tabella.file })
    .from(tabella)
    .where(isNotNull(tabella.file))
    .all()
    .map((r) => r.file)
    .filter((f): f is string => f !== null);
}

/**
 * L'impronta di una proposta: la coda la mette nella scheda, l'approvazione la
 * ricontrolla. Valore e file, cioè quello che chi approva ha guardato.
 */
export function improntaProposta(p: { valore: string; file: string | null }): string {
  return improntaDiRevisione({ valore: p.valore, file: p.file });
}

/**
 * Toglie la richiesta di ritiro su questo contenuto, se ce n'è una.
 *
 * Chi ritira, riporta in bozza o elimina direttamente un album o un'attività
 * ha già fatto quello che la richiesta chiedeva — o l'ha resa senza oggetto:
 * in coda resterebbe una voce che nessuno può più decidere. Le altre proposte
 * sullo stesso contenuto (una modifica di un'attività) restano dove sono.
 */
export async function togliRitiro(tipo: "album" | "attivita", chiave: string): Promise<void> {
  const d = dbSeEsiste();
  if (!d || !tabellaPresente(d)) return;
  const riga = d
    .select({ valore: tabella.valore })
    .from(tabella)
    .where(and(eq(tabella.tipo, tipo), eq(tabella.chiave, chiave)))
    .get();
  if (riga && motivoDelRitiro(riga.valore) !== null) await prendiProposta(tipo, chiave);
}
