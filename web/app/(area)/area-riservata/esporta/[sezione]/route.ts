import { albumAttivi } from "@/lib/funzioni";
import { AZIONE_DI_SEZIONE, ruoloVisibile } from "@/lib/data-area";
import { leggiMatrice } from "@/lib/permessi-store";
import { ETICHETTA_TIPO, quandoCompleto, quandoLeggibile } from "@/lib/registro";
import { applicaFiltri, leggiRegistro, registra } from "@/lib/registro-store";
import { type Azione, RUOLI_MATRICE } from "@/lib/permessi";
import { livelloPer, puo } from "@/lib/auth/contesto";
import { eccezioneAperta } from "@/lib/eccezioni";
import { puoVedere } from "@/lib/sessione";
import { sessioneCorrente } from "@/lib/sessione-server";

/**
 * Esportazione in CSV delle tabelle di una sezione.
 *
 * Esporta **quello che c'è in pagina**, che non è la stessa cosa di quello che
 * c'è in `data-area.ts`: le righe vere passano da `righeDi()`, che restituisce
 * quelle salvate dai referenti se qualcuno ha toccato la tabella e quelle di
 * partenza altrimenti. Leggendo `t.rows` — le righe di partenza, tutte vuote —
 * ogni esportazione usciva con le sole intestazioni, e chi la apriva credeva di
 * aver perso i dati.
 *
 * Due sezioni non hanno tabelle e vanno prese dove stanno davvero: il registro
 * delle operazioni e la matrice dei permessi. Prima uscivano come file di due
 * righe, il che per un registro accessi — materiale da §08 — è peggio di un
 * pulsante assente.
 *
 * Il controllo di ambito si rifà anche qui. Un endpoint che restituisce elenchi
 * di iscritti non può fidarsi del fatto che qualcuno, a monte, abbia già
 * guardato chi sta chiedendo (§05).
 *
 * ## Due controlli, e non uno al posto dell'altro
 *
 * Dalla fase 14 questa rotta interroga anche la matrice, sulla riga `esporta`.
 * **Si aggiunge a `puoVedere`, non lo sostituisce**, e la distinzione è il punto
 * più delicato di tutta la fase: sembrano lo stesso controllo e rispondono a due
 * domande diverse.
 *
 *     matrice (`esporta`)   questo ruolo può esportare, in generale?
 *     `puoVedere`           questo ruolo può aprire *questa vista*?
 *
 * Nel seme `esporta` è `limitato` per referente di unità e gestore. `decidi()`, con
 * `limitato` e **nessuna risorsa**, concede: significa «l'azione è per
 * costruzione nel proprio ambito», che è vero per le altre azioni ma qui no —
 * l'ambito di un'esportazione è la *vista* che si sta esportando, e sta nel
 * parametro `?ruolo=`. Sostituire `puoVedere` con la sola matrice avrebbe
 * quindi permesso a un referente di unità di esportare le tabelle del gestore
 * cambiando una stringa nell'indirizzo: la riga sotto sembra una ridondanza e
 * invece è la sola cosa che regge l'ambito.
 *
 * Non si passa una `Risorsa` con l'unità perché una vista non è un'unità: il
 * gestore esporta tabelle che non appartengono a nessuna unità, e
 * tradurre una vista in una `UnitaKey` avrebbe voluto dire mentire al cancello.
 */

/**
 * Una cella CSV.
 *
 * Le virgolette si raddoppiano e il campo si racchiude sempre. In più, un
 * valore che comincia per `=`, `+`, `-` o `@` viene preceduto da un apostrofo:
 * senza, Excel e LibreOffice lo interpretano come una formula, e un nome
 * scritto da un utente diventa codice che parte all'apertura del file. Le
 * celle qui dentro le scrivono i referenti, quindi il caso è reale.
 */
const cella = (t: string) => {
  const sicuro = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
  return `"${sicuro.replace(/"/g, '""')}"`;
};

const riga = (celle: string[]) => celle.map(cella).join(",");

/**
 * Le sezioni che sanno davvero esportare qualcosa.
 *
 * Deve restare allineato ai blocchi `if (chiave === …)` più sotto, ed è il
 * motivo per cui sta qui accanto e non in `data-area.ts`: sono le stesse
 * chiavi, e due file distanti divergono.
 *
 * Senza questo elenco la rotta rispondeva **200 con un CSV di tre righe** —
 * titolo, chi l'ha esportato, e poi niente — a ogni sezione priva di un
 * blocco: album, documenti, utenti, approvazioni. In interfaccia il pulsante
 * «Esporta» per quelle sezioni non c'è, quindi il caso si incontra solo
 * scrivendo l'indirizzo a mano o riusando un vecchio segnalibro — ma quando si
 * incontra è il difetto peggiore possibile per un'esportazione: un file che si
 * scarica, si apre, e sembra dire che i dati non ci sono più. È lo stesso
 * difetto che l'audit della fase 13 aveva già corretto per il registro e la
 * matrice, e che qui era rimasto aperto per le altre.
 *
 * Un 404 dice l'unica cosa vera: questa sezione non si esporta.
 */
const ESPORTABILI = new Set(["log", "attivita", "calendario", "iscritti", "messaggi", "privacy", "permessi"]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sezione: string }> },
) {
  const sessione = await sessioneCorrente();
  if (!sessione) return new Response("Non autorizzato", { status: 401 });

  const { sezione: chiave } = await params;
  const url = new URL(req.url);
  const slugRuolo = url.searchParams.get("ruolo") ?? sessione.r;

  // la matrice: questo ruolo esporta?  —  `puoVedere`: questa vista è sua?
  // Vedi la nota in cima: servono entrambi, e nessuno dei due basta.
  if (!(await puo("esporta")) || !puoVedere(sessione, slugRuolo)) {
    return new Response("Non autorizzato", { status: 403 });
  }

  const ruolo = ruoloVisibile(slugRuolo, await albumAttivi());
  const sezione = ruolo && Object.hasOwn(ruolo.sezioni, chiave) ? ruolo.sezioni[chiave] : undefined;
  if (!ruolo || !sezione) return new Response("Sezione non trovata", { status: 404 });
  // stessa risposta di una sezione che non esiste: da fuori le due situazioni
  // sono la stessa cosa — «da qui non esce un file»
  if (!ESPORTABILI.has(chiave)) {
    return new Response("Questa sezione non si esporta", { status: 404 });
  }

  /*
   * E la riga di matrice del **dato**, la stessa che apre la pagina.
   *
   * `esporta` e `puoVedere` dicono se questo ruolo esporta e se la vista è
   * sua; non se il dato della sezione gli è concesso. Finché ogni sezione
   * sensibile vive solo nella vista del ruolo che la possiede l'effetto
   * coincide, ma per collocazione e non per garanzia: una sezione spostata di
   * vista, o una riga chiusa dalla schermata «Permessi», avrebbe lasciato il
   * file scaricabile dopo aver chiuso la pagina (audit di sicurezza, AUTHZ-04).
   * Il registro non ha una riga sua, e resta governato dai due controlli sopra.
   */
  const azioneDelDato = AZIONE_DI_SEZIONE[chiave] as Azione | undefined;
  if (azioneDelDato && !(await puo(azioneDelDato))) {
    return new Response("Non autorizzato", { status: 403 });
  }

  /*
   * L'elenco degli iscritti lo esporta chi lo **tiene** — la riga `iscritti`,
   * non quella di consultazione: il file serve per l'uscita, e un gestore
   * che lo consulta per controllare i consensi non ha bisogno di una copia di
   * tutte le unità su un portatile (audit degli accessi, M-4).
   */
  if (chiave === "iscritti" && (await livelloPer("iscritti")) === "nessuno") {
    return new Response("Non autorizzato", { status: 403 });
  }

  // per l'amministratore elenchi di persone e posta sono letture eccezionali:
  // senza un motivo registrato negli ultimi trenta minuti, niente file (M-8)
  if (
    (chiave === "iscritti" && !(await eccezioneAperta(sessione, "iscritti"))) ||
    (chiave === "messaggi" && !(await eccezioneAperta(sessione, "messaggi")))
  ) {
    return new Response(
      "Prima aprite l’accesso eccezionale dalla sezione, scrivendo il motivo.",
      { status: 403 },
    );
  }

  const righe: string[] = [];

  // intestazione del documento: chi l'ha esportato e da dove, perché un CSV
  // con elenchi di iscritti gira, e deve dire da dove viene
  righe.push(cella(`${ruolo.titoloPagina} — ${sezione.titolo}`));
  righe.push(cella(`esportato da ${sessione.n}`));
  righe.push("");

  /*
   * Qui c'era il ciclo sulle tabelle del prototipo, che leggeva `righeDi()`.
   *
   * Con la fase 14.10 quelle tabelle non esistono più: ogni sezione ha la sua
   * schermata, e i dati stanno negli store. Il ciclo avrebbe continuato a
   * girare a vuoto — e un'esportazione che esce con le sole intestazioni è
   * peggio di un pulsante assente, che è la cosa che l'audit della fase 13
   * aveva già corretto per il registro e la matrice.
   *
   * Ogni sezione esportabile ha quindi il suo blocco, che legge dove il dato sta
   * davvero. Le sezioni senza blocco escono con la sola intestazione del
   * documento, e i loro pulsanti «Esporta» sono stati togli dalle azioni: vedi
   * `lib/data-area.ts`.
   */
  if (chiave === "log") {
    // l'IP e la data per intero solo allo sviluppatore, come in pagina: il
    // ruolo vero della sessione, non quello della vista esportata
    const sviluppatore = sessione.r === "sviluppatore";
    const tutte = await leggiRegistro({ conIndirizzi: sviluppatore });
    const giorni = [1, 7, 30].includes(Number(url.searchParams.get("quando")))
      ? Number(url.searchParams.get("quando"))
      : undefined;
    // stessi filtri della pagina: si esporta quello che si sta guardando
    const voci = applicaFiltri(
      tutte,
      {
        utente: url.searchParams.get("chi") ?? undefined,
        tipo: url.searchParams.get("che") ?? undefined,
        giorni,
      },
      Date.now(),
    );
    righe.push(cella("Registro delle operazioni"));
    // esportare il registro finisce nel registro: è la copia di tutto quello che
    // è successo, e chi la prende si vede (vale anche per il gestore, che dal
    // 4 ottobre 2026 lo può leggere)
    await registra(sessione, "configurazione", `Esportato il registro (${voci.length} voci) in CSV`, "esporta");
    righe.push(
      riga([
        "Quando",
        "Utente",
        "Nome",
        "Ruolo",
        "Tipo",
        "Operazione",
        "Origine",
        "Esito",
        ...(sviluppatore ? ["IP"] : []),
      ]),
    );
    for (const v of voci) {
      righe.push(
        riga([
          sviluppatore ? quandoCompleto(v.quando) : quandoLeggibile(v.quando),
          v.utente,
          v.nome,
          v.ruolo,
          ETICHETTA_TIPO[v.tipo] ?? v.tipo,
          v.operazione,
          v.origine,
          v.esito ?? "ok",
          ...(sviluppatore ? [v.indirizzo ?? ""] : []),
        ]),
      );
    }
    righe.push("");
  }

  /*
   * Attività e calendario: la stessa cosa vista da due ambiti.
   *
   * Un referente di unità esporta le proprie; un gestore tutte. Il filtro qui **è**
   * parte della protezione, a differenza degli elenchi in pagina: un CSV si
   * scarica e si gira, e una riga di troppo non si ritira più.
   */
  if (chiave === "attivita" || chiave === "calendario") {
    const { attivitaDiUnita, leggiAttivita } = await import("@/lib/attivita-store");
    const { ETICHETTA_TIPO: TIPO_ATT } = await import("@/lib/attivita");
    const mie =
      sessione.r === "referente" && sessione.un
        ? await attivitaDiUnita(sessione.un as Parameters<typeof attivitaDiUnita>[0])
        : await leggiAttivita();

    righe.push(cella("Attività"));
    righe.push(riga(["Data", "Titolo", "Tipo", "Unità", "Luogo", "Durata", "Stato", "Anno sociale"]));
    for (const a of mie) {
      righe.push(
        riga([
          `${a.dow} ${a.giorno} ${a.mese} ${a.anno}`,
          a.titolo,
          TIPO_ATT[a.tipoChiave] ?? a.tipoChiave,
          a.unita.join(" e "),
          a.luogo,
          a.durata,
          a.stato,
          a.anno_sociale,
        ]),
      );
    }
    righe.push("");
  }

  /*
   * Elenco iscritti: nomi e date di nascita di minori in un file che si scarica.
   *
   * Due cose in più rispetto alle altre esportazioni, e nessuna è di comodo.
   *
   * L'ambito **filtra**: un referente di unità esporta la propria unità e nient'altro.
   * In pagina il filtro è una gentilezza — la protezione sta nelle azioni — ma un
   * CSV esce dal server e non si ritira: qui è la protezione.
   *
   * E l'esportazione **si registra**, come si registra l'apertura dell'elenco:
   * §14 del piano vuole poter rispondere a «chi ha visto questi nomi, e quando»,
   * e uno scarico è una visione che resta su un disco.
   */
  if (chiave === "iscritti") {
    const store = await import("@/lib/iscritti-store");
    const { ANNI_DOC: ANNI, labelDiUnita: label } = await import("@/lib/data");

    // l'ambito dalla matrice, come nella sezione: `limitato` è la propria unità
    const ridotto = (await livelloPer("iscritti-elenco")) === "limitato";
    const suaUnita = ridotto
      ? ((sessione.un ?? "") as Parameters<typeof label>[0])
      : undefined;
    const anno = ANNI.find((a) => a.corrente)?.chiave ?? ANNI[0].chiave;
    const voci = store.elencoIscritti({ unita: suaUnita, anno });

    righe.push(cella(`Iscritti ${anno.replace("-", "/")}`));
    if (ridotto) {
      /*
       * L'esportazione del referente di unità è quella «per l'uscita»: chi c'è, in che
       * squadra, e chi non va fotografato. Età e quota restano nel sito — la
       * quota è un dato economico della famiglia, e un file su un telefono non
       * ha bisogno di saperlo (audit degli accessi, M-4).
       */
      righe.push(riga(["Cognome", "Nome", "Gruppo interno", "Consenso immagini"]));
      for (const i of voci) {
        righe.push(riga([i.cognome, i.nome, i.gruppoInterno, i.consenso ? "sì" : "no"]));
      }
    } else {
      righe.push(riga(["Cognome", "Nome", "Età", "Unità", "Gruppo interno", "Quota", "Consenso immagini", "Data consenso"]));
      for (const i of voci) {
        righe.push(
          riga([
            i.cognome,
            i.nome,
            String(i.eta ?? ""),
            label(i.unita),
            i.gruppoInterno,
            store.ETICHETTA_QUOTA[i.quota] ?? i.quota,
            i.consenso ? "sì" : "no",
            i.consensoData ?? "",
          ]),
        );
      }
    }
    righe.push("");

    await registra(
      sessione,
      "iscritti",
      `Esportato l’elenco iscritti${suaUnita ? ` di ${label(suaUnita)}` : ""} ` +
        `(${voci.length} ${voci.length === 1 ? "nome" : "nomi"}) in CSV`,
      "esporta",
    );
  }

  /*
   * Messaggi dal modulo contatti. Contengono nomi, email e telefoni di chi
   * scrive: la riga d'intestazione del documento dice già da dove viene e chi
   * l'ha scaricato, e serve a questo.
   */
  if (chiave === "messaggi") {
    const { elenco } = await import("@/lib/messaggi-store");
    const { MOTIVI_CONTATTO } = await import("@/lib/data");

    righe.push(cella("Messaggi dal modulo contatti"));
    righe.push(riga(["Quando", "Nome", "Email", "Telefono", "Motivo", "Stato", "Messaggio"]));
    for (const m of elenco()) {
      righe.push(
        riga([
          // la data resta in ISO e non «11 ott 2026»: in un foglio di calcolo
          // una colonna ISO si ordina, una in italiano no
          m.quando,
          m.nome,
          m.email,
          m.telefono,
          MOTIVI_CONTATTO.find((x) => x.chiave === m.motivo)?.label ?? m.motivo,
          m.stato,
          m.messaggio,
        ]),
      );
    }
    righe.push("");
  }

  /** Richieste GDPR: §15 del piano vuole poterle rendicontare. */
  if (chiave === "privacy") {
    const gdpr = await import("@/lib/gdpr-store");
    righe.push(cella("Richieste degli interessati"));
    righe.push(riga(["Arrivata il", "Diritto", "Descrizione", "Stato", "Chiusa il", "Aperta da", "Giorni"]));
    for (const r of gdpr.elenco()) {
      righe.push(
        riga([
          r.arrivataIl.slice(0, 10),
          gdpr.ETICHETTA_DIRITTO[r.diritto] ?? r.diritto,
          r.descrizione,
          gdpr.ETICHETTA_STATO[r.stato] ?? r.stato,
          r.chiusaIl ?? "",
          r.apertaDa ?? "",
          String(r.giorni ?? ""),
        ]),
      );
    }
    righe.push("");
  }

  if (chiave === "permessi") {
    const funzioni = await leggiMatrice();
    righe.push(cella("Matrice dei permessi"));
    righe.push(riga(["Funzione", ...RUOLI_MATRICE.map((r) => r.label)]));
    for (const f of funzioni) {
      righe.push(riga([f.nome, ...RUOLI_MATRICE.map((r) => f.livelli[r.chiave] ?? "nessuno")]));
    }
    righe.push("");
  }

  if (sezione.kpi?.length) {
    righe.push(cella("Indicatori"));
    for (const k of sezione.kpi) righe.push(riga([k.label, k.valore]));
  }

  const nome = `${slugRuolo}-${chiave}.csv`;

  return new Response(
    // BOM: senza, Excel apre il file in Latin-1 e le lettere accentate si
    // rompono. È il dettaglio che fa dire «il vostro export non funziona».
    "﻿" + righe.join("\r\n"),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nome}"`,
        // elenchi di iscritti: non devono restare in nessuna cache
        "Cache-Control": "no-store",
      },
    },
  );
}
