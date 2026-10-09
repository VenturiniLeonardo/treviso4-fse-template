import type { UnitaKey } from "@/lib/data";

/**
 * Quanto può essere lungo ciascun campo di un'attività, in caratteri.
 *
 * Dall'audit di sicurezza (VAL-01): solo il titolo si controllava, e solo che
 * non fosse vuoto; nota, luogo e durata arrivavano nel database grandi quanto
 * il corpo della richiesta (24 MB, alzati per le fotografie). Larghi per un
 * calendario vero, stretti per un deposito. Li riusano il modulo (`maxLength`)
 * e la Server Action, così il limite è uno solo.
 */
export const LIMITI_ATTIVITA = {
  titolo: 120,
  nota: 2000,
  luogo: 120,
  durata: 60,
} as const;

/**
 * Una data `AAAA-MM-GG` che esiste davvero nel calendario.
 *
 * La forma non basta: `2026-02-31` e `2026-13-45` la rispettano. Si fa il giro
 * completo — dalla stringa a una data e ritorno — e si accetta solo se torna
 * uguale.
 */
export function dataValida(data: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const giorno = new Date(`${data}T00:00:00Z`);
  return !Number.isNaN(giorno.getTime()) && giorno.toISOString().slice(0, 10) === data;
}

/**
 * Che cos'è un'attività, e a chi si rivolge. Modulo puro, senza dipendenze
 * di runtime: lo leggono anche i componenti del browser.
 *
 * ## La decisione di fase 8
 *
 * Nel repository c'erano due elenchi di «tipo» in disaccordo — quello del
 * calendario pubblico (`gruppo`, `unità`, `campo`, `escursione`, `distretto`,
 * `servizio`) e quello dell'editor (`riunione`, `uscita di unità`, `uscita di
 * squadra`, `campo`, `festa`, `servizio`). Non erano due proposte per la
 * stessa cosa: erano **due assi schiacciati in una colonna sola**.
 *
 *   che cosa è   →  riunione, uscita, campo, festa, servizio…   →  `tipo`
 *   a chi si rivolge → tutto il gruppo, un'unità, alcune unità  →  l'ambito
 *
 * Adesso sono separati. `tipo` porta solo il primo; il secondo lo portano
 * `unita_id` e `unita_chiavi`, che nella tabella c'erano già. Il calendario
 * pubblico continua a poter scrivere «di gruppo» accanto a una data, perché lo
 * **ricava** invece di leggerlo da una colonna che diceva due cose insieme.
 *
 * `distretto` resta fra i tipi: è l'unico valore del vecchio elenco che non è né
 * l'uno né l'altro asse — descrive un'attività a cui il gruppo partecipa senza
 * organizzarla.
 */

export const TIPI_ATTIVITA = [
  "riunione",
  "uscita",
  "uscita-squadra",
  "attivita-squadra",
  "campo",
  "escursione",
  "festa",
  "servizio",
  "distretto",
] as const;

export type TipoAttivita = (typeof TIPI_ATTIVITA)[number];

/**
 * Come si scrive un tipo per chi lo legge.
 *
 * Le chiavi restano stabili nel database; queste si possono riscrivere senza
 * migrazioni, ed è il motivo per cui le chiavi non sono già le etichette.
 */
export const ETICHETTA_TIPO: Record<TipoAttivita, string> = {
  riunione: "riunione",
  uscita: "uscita",
  "uscita-squadra": "uscita di squadra",
  "attivita-squadra": "attività di squadra",
  campo: "campo",
  escursione: "escursione",
  festa: "festa",
  servizio: "servizio",
  distretto: "distretto",
};

export const eTipoValido = (t: string): t is TipoAttivita =>
  (TIPI_ATTIVITA as readonly string[]).includes(t);

/** Le unità della fascia verde: le sole che hanno le squadre. */
export const FASCIA_VERDE: readonly UnitaKey[] = ["u3", "u4"];

/**
 * I tipi che valgono solo per la fascia verde, e non si possono dare a
 * un'attività di gruppo né a una che coinvolge un'altra fascia.
 *
 * `uscita-squadra` non c'è di proposito: era nel vocabolario prima di
 * questa regola, e restringerla adesso potrebbe rendere non più salvabili
 * righe che esistono già.
 */
const TIPI_FASCIA_VERDE: readonly TipoAttivita[] = ["attivita-squadra"];

export const eDellaFasciaVerde = (tipo: TipoAttivita): boolean =>
  TIPI_FASCIA_VERDE.includes(tipo);

/** Vero se il tipo si può dare a un'attività con queste unità (vuoto = gruppo). */
export function tipoAmmessoPer(tipo: TipoAttivita, unita: readonly string[]): boolean {
  if (!eDellaFasciaVerde(tipo)) return true;
  return unita.length > 0 && unita.every((u) => (FASCIA_VERDE as readonly string[]).includes(u));
}

/**
 * L'ambito di un'attività, nella forma che il codice usa.
 *
 * `gruppo` è l'assenza di un elenco, non un valore in mezzo agli altri: è la
 * stessa scelta di `unita_id IS NULL` nello schema, e di `CHIAVE_GRUPPO` in
 * `lib/db/mappa.ts`. Chi ha bisogno dell'elenco vero delle unità coinvolte usa
 * `unitaCoinvolte`.
 */
export type Ambito =
  | { genere: "gruppo" }
  | { genere: "unita"; chiave: UnitaKey }
  | { genere: "alcune"; chiavi: UnitaKey[] };

/** Legge l'ambito dalle due colonne, con la regola del `CHECK`. */
export function ambitoDa(
  unitaChiave: string | null,
  unitaChiavi: string,
): Ambito {
  if (unitaChiave) return { genere: "unita", chiave: unitaChiave as UnitaKey };
  const elenco = separa(unitaChiavi);
  return elenco.length > 0 ? { genere: "alcune", chiavi: elenco } : { genere: "gruppo" };
}

/** Da testo a elenco, tollerando spazi e virgole di troppo. */
export function separa(chiavi: string): UnitaKey[] {
  return chiavi
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "") as UnitaKey[];
}

/** Da elenco a testo, nella forma che la colonna si aspetta. */
export const unisci = (chiavi: readonly string[]): string => chiavi.join(",");

/**
 * Come si scrive un ambito accanto a una data, per le famiglie.
 *
 * È la funzione che sostituisce il vecchio `tipo: "gruppo"`: quella parola
 * adesso non sta più in una colonna, si ricava. `etichettaUnita` arriva da chi
 * chiama perché `lib/data.ts` non si importa qui — questo modulo lo leggono
 * anche i componenti, e tirarsi dietro l'anagrafica per una stringa sarebbe
 * sproporzionato.
 */
export function etichettaAmbito(
  ambito: Ambito,
  etichettaUnita: (chiave: UnitaKey) => string,
): string {
  switch (ambito.genere) {
    case "gruppo":
      return "di gruppo";
    case "unita":
      return etichettaUnita(ambito.chiave);
    case "alcune":
      return ambito.chiavi.map(etichettaUnita).join(" e ");
  }
}

/**
 * L'unità da passare al cancello autorizzativo per un'attività.
 *
 * `Risorsa.unita` è **una** chiave, e un'attività può riguardarne più d'una.
 * La regola è: un referente di unità governa le attività che sono **soltanto** della
 * propria unità. Quelle di gruppo e quelle che ne coinvolgono due o più sono del
 * gestore.
 *
 * Per dirlo si restituisce `gruppo`, che in `Risorsa` significa già «l'unità di
 * nessuno» e che il cancello rifiuta a qualunque referente di unità. Non è un trucco:
 * un'uscita di u1 **e** u2 non è dell'unità 1, e lasciarla
 * modificare al referente di una delle due vorrebbe dire che può cambiare la data a
 * un'attività dell'altra senza che l'altra lo sappia.
 *
 * La conseguenza da conoscere: un referente di unità **non** può creare un'attività
 * insieme a un'altra unità, e deve chiederlo al gestore. È il comportamento
 * prudente, ed è quello che si può allargare in seguito senza rischi — al
 * contrario no.
 *
 * Sta qui, in un modulo puro, e non accanto alle Server Action: un file
 * `"use server"` esporta soltanto funzioni async, quindi là questa regola non
 * sarebbe provabile se non passando da una sessione finta.
 */
export function unitaPerCancello(unita: readonly string[]): UnitaKey {
  const unaSola = unita.length === 1 && unita[0] !== "gruppo";
  return (unaSola ? unita[0] : "gruppo") as UnitaKey;
}

/** I campi di un'attività come li scrive chi la crea o la modifica. */
export interface CampiAttivita {
  titolo: string;
  /** ISO, `AAAA-MM-GG` */
  data: string;
  tipo: TipoAttivita;
  unita: UnitaKey[];
  nota: string;
  luogo: string;
  durata: string;
}

/**
 * I campi di un'attività letti da un JSON, ricontrollati; `null` se non vanno.
 *
 * Servono alla modifica proposta dal social media manager, che aspetta in
 * `proposte` e si applica quando un gestore approva. Erano già stati
 * controllati quando sono stati proposti, ma fra la proposta e l'approvazione
 * sono passati da una tabella che qualcuno può aver toccato a mano, e finiscono
 * nel calendario pubblico. Le stesse regole del modulo, nello stesso ordine.
 *
 * Le unità ammesse arrivano da fuori: questo modulo lo leggono anche i
 * componenti del browser, e l'elenco delle unità sta in `lib/data.ts`.
 */
export function campiAttivitaDa(
  grezzo: unknown,
  unitaAmmesse: readonly string[],
): CampiAttivita | null {
  if (typeof grezzo !== "object" || grezzo === null) return null;
  const c = grezzo as Record<string, unknown>;
  const stringa = (v: unknown) => (typeof v === "string" ? v.trim() : null);
  const titolo = stringa(c.titolo);
  const data = stringa(c.data);
  const tipo = stringa(c.tipo);
  const nota = stringa(c.nota) ?? "";
  const luogo = stringa(c.luogo) ?? "";
  const durata = stringa(c.durata) ?? "";
  if (!titolo || !data || !tipo || !dataValida(data) || !eTipoValido(tipo)) return null;
  if (!Array.isArray(c.unita) || !c.unita.every((u) => typeof u === "string" && unitaAmmesse.includes(u))) {
    return null;
  }
  const unita = [...new Set(c.unita as string[])] as UnitaKey[];
  if (!tipoAmmessoPer(tipo, unita)) return null;
  const lunghezze = { titolo, nota, luogo, durata };
  for (const campo of Object.keys(LIMITI_ATTIVITA) as (keyof typeof LIMITI_ATTIVITA)[]) {
    if (lunghezze[campo].length > LIMITI_ATTIVITA[campo]) return null;
  }
  return { titolo, data, tipo, unita, nota, luogo, durata };
}
