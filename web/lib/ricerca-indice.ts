import { albumPubblicati } from "@/lib/album";
import { albumAttivi } from "@/lib/funzioni";
import {
  ANNI_DOC,
  CHI_SIAMO,
  labelDiUnita,
} from "@/lib/data";
import { attivitaPubbliche } from "@/lib/attivita-store";
import { leggiCartelle } from "@/lib/cartelle-store";
import { documentiPubblicati } from "@/lib/documenti-store";
import { leggiIdentita } from "@/lib/gruppo";
import { paginelegali } from "@/lib/legale";
import { leggiFaq } from "@/lib/faq-store";
import { scorciatoie } from "@/lib/nav";
import { leggiUnita } from "@/lib/unita-store";
import type { VoceRicerca } from "@/lib/ricerca";

/**
 * L'indice su cui lavora la ricerca del sito pubblico.
 *
 * Non è un motore di ricerca: è l'elenco di quello che il sito **contiene già**,
 * messo in fila una volta per richiesta. Sono meno di duecento voci — sei
 * pagine, sei unità, venti attività, gli album e i documenti pubblicati, cinque
 * domande e sei informative — quindi non serve né un indice invertito né una
 * libreria: il confronto in `lib/ricerca.ts` scorre l'elenco e basta.
 *
 * Sta accanto a `lib/ricerca.ts` e non dentro perché legge gli archivi su disco
 * (album e documenti), e quel file deve poter essere importato dal client.
 *
 * Album e documenti entrano **solo se pubblicati**: `albumPubblicati` e
 * `documentiPubblicati` filtrano già le bozze e le revisioni. È il punto in cui
 * si sbaglia più facilmente — una ricerca che nomina una bozza la rende
 * pubblica, e negli album ci sono foto di minori (§05 del piano).
 */
export async function costruisciIndice(): Promise<VoceRicerca[]> {
  const identita = await leggiIdentita();
  // spenti gli album (`lib/funzioni.ts`), la ricerca non porta a una 404
  const fotoAccese = await albumAttivi();
  const album = fotoAccese ? await albumPubblicati() : [];
  const documenti = await documentiPubblicati();
  // i nomi delle cartelle dal database: sono i referenti a sceglierli, e la ricerca
  // deve trovare «Tesseramenti» se in pagina c'è scritto «Tesseramenti»
  const cartelle = await leggiCartelle();

  const etichettaAnno = (chiave: string | null) =>
    chiave === null
      ? "sempre valido"
      : `anno ${ANNI_DOC.find((a) => a.chiave === chiave)?.label ?? chiave}`;
  const etichettaCartella = (chiave: string) =>
    cartelle.find((c) => c.chiave === chiave)?.titolo ?? chiave;

  const voci: VoceRicerca[] = [];

  // ------------------------------------------------------------- le pagine
  // Sono le stesse voci del menu, con la riga di spiegazione che serve già
  // alla pagina 404: un elenco secco di sei parole non aiuta chi cerca.
  for (const s of scorciatoie(fotoAccese)) {
    voci.push({ titolo: s.label, testo: s.testo, href: s.href, sezione: "Pagina" });
  }
  voci.push({
    titolo: "Area riservata",
    testo: "L'accesso dei referenti per aggiornare album, documenti e recapiti.",
    href: "/area-riservata",
    sezione: "Pagina",
    chiavi: "accesso login gestori unità sviluppatore",
  });

  // ------------------------------------------------------------- le unità
  // Le unità con i contenuti correnti: se un referente cambia il motto o il ritrovo,
  // la ricerca lo trova. Con `UNITA` avrebbe continuato a cercare nei testi del
  // codice, cioè in quello che la pagina non dice più.
  for (const u of await leggiUnita()) {
    voci.push({
      titolo: u.nome,
      testo: `${u.ramoPlurale} · ${u.eta} · «${u.motto}»`,
      href: `/unita/${u.slug}`,
      sezione: "Unità",
      chiavi: [u.ramo, u.referente, u.ruoloReferente, u.ritrovo, u.occhiello, u.fondazione]
        .join(" "),
    });
  }

  // Le tre fasce non sono pagine, ma è come le cerca chi non conosce i nomi
  // delle unità: «fascia verde», «fascia rossa», «8-11 anni».
  for (const b of CHI_SIAMO.fasce) {
    voci.push({
      titolo: b.titolo,
      testo: `${b.kicker} — ${b.testo}`,
      href: "/chi-siamo",
      sezione: "Fasce",
      chiavi: b.chiave,
    });
  }

  // ---------------------------------------------------------- le attività
  // Dal database, non più da `EVENTI`: è la stessa svista già corretta qui sopra
  // per le unità e le domande. `attivitaPubbliche` filtra bozze e revisioni — e
  // ricade sul seme quando la tabella è vuota, come fa la pagina `/attivita` —
  // così ricerca e calendario dicono sempre la stessa cosa: appena un referente
  // aggiunge o toglie un'attività, la lente la trova o smette di trovarla.
  // Il calendario non ha ancore per singola data: si porta alla pagina, dove
  // l'attività è nel mese suo.
  for (const e of await attivitaPubbliche()) {
    voci.push({
      titolo: e.titolo,
      testo: `${e.giorno} ${e.mese} ${e.anno} · ${e.luogo} · ${e.durata}`,
      href: "/attivita",
      sezione: "Attività",
      chiavi: `${e.tipo} ${e.nota} ${e.unita.map(labelDiUnita).join(" ")}`,
    });
  }

  // --------------------------------------------------------------- le foto
  for (const a of album) {
    voci.push({
      titolo: a.titolo,
      testo: `${a.data} · ${a.foto.length} foto · ${a.sottotitolo}`,
      href: `/foto/${a.slug}`,
      sezione: "Foto",
      chiavi: `${a.tag} ${a.anno} ${labelDiUnita(a.unita)}`,
    });
  }

  // ---------------------------------------------------------- i documenti
  // Ogni documento porta alla sua cartella, `/documenti/<chiave>`: era
  // un'ancora della pagina unica, prima che le cartelle avessero una pagina
  // ciascuna. Il file, quando c'è, si apre e si scarica da lì.
  for (const d of documenti) {
    voci.push({
      titolo: d.titolo,
      // la nota può mancare — i documenti caricati a cartelle intere non ce
      // l'hanno — e la riga non deve finire con un separatore appeso
      testo: [etichettaCartella(d.categoria), etichettaAnno(d.anno), d.nota]
        .filter(Boolean)
        .join(" · "),
      href: `/documenti/${d.categoria}`,
      sezione: "Documenti",
      chiavi: `${d.formato} modulo modulistica ${d.aggiornamento}`,
    });
  }

  // Le cartelle stesse, ma solo quelle con qualcosa dentro: chi cerca
  // «tesseramento» vuole la cartella con tutti i moduli, non uno solo. Una
  // cartella vuota non compare nella pagina Documenti, e la ricerca non deve
  // portare dove la pagina non porta.
  for (const c of cartelle) {
    const quanti = documenti.filter((d) => d.categoria === c.chiave).length;
    if (quanti === 0) continue;
    voci.push({
      titolo: c.titolo,
      testo: c.descrizione || `${quanti} ${quanti === 1 ? "documento" : "documenti"} da vedere o scaricare`,
      href: `/documenti/${c.chiave}`,
      sezione: "Documenti",
      chiavi: "cartella modulistica moduli",
    });
  }

  // ----------------------------------------------------- domande frequenti
  // le domande dallo store: con `FAQ` la ricerca avrebbe continuato a trovare
  // le domande del codice, cioè quelle che la pagina non mostra più
  for (const f of await leggiFaq()) {
    voci.push({
      titolo: f.domanda,
      testo: f.risposta.slice(0, 150).trim() + "…",
      href: "/contatti",
      sezione: "Domande frequenti",
      chiavi: f.risposta,
    });
  }

  // ------------------------------------------------------- pagine legali
  for (const p of paginelegali(identita)) {
    voci.push({
      titolo: p.breve,
      testo: p.sommario,
      href: `/legale/${p.slug}`,
      sezione: "Informative",
      chiavi: `${p.titolo} ${p.sezioni.map((s) => s.titolo).join(" ")}`,
    });
  }
  // Le preferenze cookie sono un pannello con dei comandi, non un testo: hanno
  // una rotta loro e non stanno in `paginelegali`.
  voci.push({
    titolo: "Preferenze cookie",
    testo: "Che cosa memorizza il sito e come cambiare la scelta.",
    href: "/legale/preferenze-cookie",
    sezione: "Informative",
    chiavi: "consenso tracciamento statistiche",
  });

  return voci;
}
