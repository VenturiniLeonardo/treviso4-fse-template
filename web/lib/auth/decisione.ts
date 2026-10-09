import type { UnitaKey } from "@/lib/data";
import { type Azione, type Funzione, type Livello, livelloEffettivo } from "@/lib/permessi";
import type { Sessione } from "@/lib/sessione";

/**
 * La decisione autorizzativa, in forma pura.
 *
 * Separata da `contesto.ts` perché quello importa `next/headers` per leggere il
 * cookie di sessione, e `next/headers` esiste solo dentro Next. Qui non si
 * importa niente che non sia un tipo: la decisione dipende solo dai suoi
 * argomenti, e si può provare su ogni combinazione di ruolo, azione e ambito
 * senza costruire una richiesta HTTP.
 *
 * Non è una separazione fatta per i test: è la separazione che rende evidente
 * che la regola non guarda niente di nascosto.
 */

/** La risorsa su cui si agisce, quando ne esiste una con un ambito. */
export interface Risorsa {
  /**
   * L'unità a cui la risorsa appartiene.
   *
   * `gruppo` è l'unità di nessuno: un contenuto di gruppo è fuori dall'ambito di
   * un referente di unità, e infatti `puoScrivereSu` gli dice no. È voluto — un album di
   * gruppo raccoglie ragazzi di tutte le unità.
   */
  unita?: UnitaKey;
  /** per il registro: che cosa si stava toccando, in una parola */
  descrizione?: string;
}

/** Perché è stato negato. Serve al registro, non all'utente. */
export type Motivo = "sessione" | "ruolo" | "ambito";

/**
 * Rifiuto autorizzativo.
 *
 * `message` è già la frase per l'utente e non dice **quale** dei tre cancelli ha
 * chiuso: distinguere «non hai i permessi» da «questa risorsa non è tua»
 * direbbe a chi tira a indovinare che la risorsa esiste, e in quale unità. Il
 * motivo vero sta in `motivo` e finisce nel registro.
 */
export class Negato extends Error {
  readonly motivo: Motivo;
  readonly azione: Azione;

  constructor(motivo: Motivo, azione: Azione) {
    super(
      motivo === "sessione"
        ? "La sessione è scaduta. Rientrate e riprovate."
        : "Non avete i permessi per questa operazione.",
    );
    this.name = "Negato";
    this.motivo = motivo;
    this.azione = azione;
  }
}

/**
 * L'ambito di una sessione copre questa risorsa?
 *
 * Un referente di unità copre soltanto la propria unità. Gestore e sviluppatore
 * coprono tutto — è il significato di `completo` nella matrice, e il motivo per
 * cui il livello si controlla prima dell'ambito. Il social media manager copre
 * tutto anche lui, ma con `limitato` ogni sua scrittura diventa una proposta:
 * vedi `vaInCoda`.
 */
function copre(sessione: Sessione, risorsa: Risorsa | undefined): boolean {
  if (sessione.r === "gestore" || sessione.r === "sviluppatore") return true;
  // il social media manager lavora su tutte le unità e sul gruppo: per lui
  // `limitato` non restringe l'ambito, chiede l'approvazione (`vaInCoda`)
  if (sessione.r === "social") return true;
  // referente di unità: senza un'unità nella sessione non copre niente, che è il valore
  // prudente e non un caso da tollerare
  if (!sessione.un) return false;
  // nessuna risorsa indicata: l'azione è per costruzione nel proprio ambito
  if (!risorsa?.unita) return true;
  return risorsa.unita === sessione.un;
}

/**
 * Il livello di un ruolo per un'azione, dentro una matrice data.
 *
 * Funzione **pura**: la matrice arriva come argomento. È così perché la
 * decisione autorizzativa va provata su ogni combinazione di ruolo, azione e
 * ambito, e un test che deve prima costruire una sessione di Next e un cookie
 * firmato prova il contorno invece della regola.
 */
export function livelloNellaMatrice(
  matrice: readonly Funzione[],
  azione: Azione,
  ruolo: string,
): Livello {
  const funzione = matrice.find((f) => f.id === azione);
  // Una funzione che non è nella matrice non è un permesso aperto: è un
  // permesso che nessuno ha. Se un giorno qualcuno toglie una riga dalla
  // matrice, le azioni che ne dipendono si chiudono invece di aprirsi.
  //
  // E quello che c'è passa sotto il tetto del ruolo (`tetto()` in
  // `lib/permessi.ts`): un valore rimasto in tabella da prima dei tetti, o
  // scritto a mano nel database, non apre quello che la natura del ruolo
  // esclude. `leggiMatrice` li applica già; ripeterlo qui costa niente e tiene
  // vera la regola anche per chi passa una matrice costruita a mano.
  return livelloEffettivo(azione, ruolo, funzione?.livelli[ruolo] ?? "nessuno");
}

/**
 * Con questo livello, si può agire su un account di questo ruolo?
 *
 * È la quarta domanda dell'autorizzazione, e sta qui perché è **una regola, non
 * un dettaglio di un'azione**: il modulo delle decisioni è il posto dove si
 * guarda per sapere chi può fare che cosa, e una regola di questo peso scritta
 * dentro `utenti/actions.ts` sarebbe stata invisibile a chi legge.
 *
 * ## Perché `copre()` non basta
 *
 * Sulle altre righe `limitato` vuol dire «la propria unità», e `copre()` lo
 * verifica confrontando due chiavi d'unità. Sulla riga `utenti` l'ambito non è
 * un'unità: è **quali account si possono toccare**, e la risposta è «i referenti
 * unità e il social media manager». Un gestore fa il ricambio di settembre
 * e sceglie chi prepara i contenuti che lui approva, ma non si dà da sé un pari
 * grado.
 *
 * `decidi()` con `limitato` e nessuna risorsa **concede**, quindi senza questa
 * funzione un `contesto("utenti")` avrebbe lasciato passare un gestore su
 * qualunque account — e la matrice sarebbe sembrata stretta mentre non lo era.
 *
 * ## Perché non l'ho messa dentro `decidi`
 *
 * Perché `decidi` risponde a «questa sessione può fare quest'azione su questa
 * risorsa», e il ruolo di un account bersaglio non è una `Risorsa`: infilarlo lì
 * avrebbe voluto dire un campo in più in `Risorsa` che nove azioni su dieci
 * lasciano vuoto, e un campo facoltativo in una struttura di autorizzazione è
 * un permesso che si apre quando qualcuno si dimentica di riempirlo. Due
 * funzioni, due domande, entrambe pure.
 */
export function puoAgireSuRuolo(
  livello: Exclude<Livello, "nessuno">,
  ruoloBersaglio: string,
): boolean {
  if (livello === "completo") return true;
  // il social media manager prepara contenuti che il gestore approva: è un
  // ruolo sotto il suo, non un pari grado, e chi approva sceglie chi propone
  return ruoloBersaglio === "referente" || ruoloBersaglio === "social";
}

/**
 * Questa scrittura va **in coda** invece che online?
 *
 * È la regola del social media manager, decisa il 3 ottobre 2026: carica album,
 * cambia foto e testi di tutte le unità e del sito, ma **ogni** modifica passa
 * dall'approvazione del gestore o dello sviluppatore. Nella matrice è
 * `limitato` nel secondo senso di `LIVELLI` — «con l'approvazione di un altro
 * ruolo» — su ogni riga che gli è aperta.
 *
 * ## Perché dipende anche dal ruolo, e non solo dal livello
 *
 * Perché `limitato` vuol dire già un'altra cosa per il referente di unità: la propria
 * unità, con i testi che vanno online subito (il «metà e metà» del 31 agosto).
 * Leggere `limitato` come «in coda» per tutti avrebbe fermato le circolari e i
 * motti dei referenti di unità; leggerlo come «la propria unità» per il social media
 * manager l'avrebbe lasciato pubblicare. I due significati restano entrambi, e
 * questa funzione è il posto in cui si sceglie fra loro.
 *
 * ## Perché dipende anche dal livello, e non solo dal ruolo
 *
 * Perché la matrice decide. Se un amministratore mette una riga a `completo`
 * per il social media manager, la sua scelta è che lì pubblichi da solo — e lo
 * vede scritto nella griglia. Un controllo sul solo ruolo avrebbe fatto mentire
 * la schermata «Permessi».
 */
export function vaInCoda(
  ruolo: string,
  livello: Exclude<Livello, "nessuno">,
): boolean {
  return ruolo === "social" && livello === "limitato";
}

/**
 * Questa sessione **cancella da sé** solo i contenuti che ha creato?
 *
 * È l'altra metà della regola del social media manager. Con l'audit degli
 * accessi del 4 ottobre 2026 voleva dire «agisce solo sui propri»: vedeva e
 * toccava soltanto gli album e le attività che aveva creato (`creato_da`,
 * 0014). Dal 6 ottobre 2026 tiene aggiornato il sito al posto dei referenti di unità e
 * lavora anche su quelli degli altri — sempre con l'approvazione (`vaInCoda`) —
 * e la domanda «è tuo?» resta solo dove una cosa sparirebbe senza che nessuno
 * la guardi: cancellare una bozza, ritirare dal sito. Quello che ha creato lui e
 * che non è mai stato online lo cancella da sé; il resto lo chiede.
 *
 * Dipende dal livello come `vaInCoda`, e per la stessa ragione: se un
 * amministratore un giorno potesse dargli `completo`, la regola cadrebbe con la
 * sua scelta e non contro.
 */
export function soloIPropri(ruolo: string, livello: Exclude<Livello, "nessuno">): boolean {
  return vaInCoda(ruolo, livello);
}

/**
 * Questa sessione le fotografie le **nasconde** soltanto, senza eliminarle?
 *
 * Il social media manager, dal 6 ottobre 2026: «per le foto può nasconderle ma
 * non eliminarle». Nascondere non mette online niente, quindi è subito; il file
 * resta, e lo elimina — se va eliminato — un gestore. Vale per le fotografie
 * degli album, dei riquadri e delle copertine.
 *
 * Una funzione sua e non `vaInCoda` riusata: sono due regole diverse che oggi
 * colpiscono lo stesso ruolo, e chi legge un'azione deve capire quale delle due
 * la ferma.
 */
export function nascondeSoltanto(ruolo: string, livello: Exclude<Livello, "nessuno">): boolean {
  return ruolo === "social" && livello === "limitato";
}

/**
 * Una fotografia caricata in un riquadro va **in coda** invece che online?
 *
 * Per chiunque abbia `limitato` sulla riga del riquadro: il social media
 * manager (che propone tutto) e, dal 4 ottobre 2026, il **referente di unità** sui
 * riquadri della propria pagina. Prima i suoi andavano online subito, ed era
 * l'unica strada per cui una fotografia arrivava sul sito senza passare dal
 * gestore — che è chi fa rispettare la regola dei volti (audit M-3). I
 * testi del referente di unità restano «metà e metà»: questa regola è delle sole
 * fotografie.
 */
export function immagineInCoda(livello: Exclude<Livello, "nessuno">): boolean {
  return livello === "limitato";
}

/**
 * La decisione dei tre cancelli, in forma pura.
 *
 * Qui c'è **tutta** la logica autorizzativa; `contesto()` le mette attorno la
 * sessione e il registro. Separarle serve a poterla provare su tutte le
 * combinazioni senza inventarsi una richiesta HTTP — e a rendere evidente che la
 * decisione non dipende da niente che non sia negli argomenti.
 */
export function decidi(
  matrice: readonly Funzione[],
  sessione: Sessione | null,
  azione: Azione,
  risorsa?: Risorsa,
): { ok: true; livello: Exclude<Livello, "nessuno"> } | { ok: false; motivo: Motivo } {
  if (!sessione) return { ok: false, motivo: "sessione" };

  const livello = livelloNellaMatrice(matrice, azione, sessione.r);
  if (livello === "nessuno") return { ok: false, motivo: "ruolo" };

  if (livello === "limitato" && !copre(sessione, risorsa)) {
    return { ok: false, motivo: "ambito" };
  }
  return { ok: true, livello };
}

