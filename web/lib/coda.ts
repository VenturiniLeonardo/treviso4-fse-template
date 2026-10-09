import type { VoceCoda } from "@/components/area/Coda";
import { leggiAlbum } from "@/lib/album";
import { attivitaInRevisione, isoDaEvento, leggiAttivita } from "@/lib/attivita-store";
import { validitaDocumento } from "@/lib/contenuti";
import { labelDiUnita, type UnitaKey } from "@/lib/data";
import { displayInEtichetta } from "@/lib/db/mappa";
import { leggiDocumenti } from "@/lib/documenti-store";
import { leggiFaq } from "@/lib/faq-store";
import { albumAttivi } from "@/lib/funzioni";
import { tutteLeImmagini } from "@/lib/immagini-store";
import { improntaDiRevisione } from "@/lib/impronta-revisione";
import { statoConsensi } from "@/lib/iscritti-store";
import { campoPagina, GRUPPI_PAGINE, predefinitoDi } from "@/lib/pagine-contenuti";
import { leggiTestiPagine } from "@/lib/pagine-store";
import {
  chiedeDiMostrare,
  indirizzoInAttesa,
  motivoDelRitiro,
  type PropostaInAttesa,
} from "@/lib/proposte";
import { improntaProposta, leggiProposteInAttesa } from "@/lib/proposte-store";
import { slotDi } from "@/lib/slot-immagini";
import { campoUnita, ETICHETTA_TIPO_PERSONA } from "@/lib/unita-contenuti";
import { leggiProposte, leggiUnita, personeInRevisione } from "@/lib/unita-store";
import { concesso } from "@/lib/auth/contesto";
import { campiAttivitaDa, ETICHETTA_TIPO, unitaPerCancello } from "@/lib/attivita";
import { TUTTE_LE_UNITA } from "@/lib/data";
import { eccezioneAperta } from "@/lib/eccezioni";
import type { Azione } from "@/lib/permessi";

/**
 * Le voci della coda di approvazione, e i numeri che le stanno sopra.
 *
 * Stava dentro la pagina delle sezioni, come corpo di «Approvazioni». È uscito
 * il 3 ottobre 2026 perché la stessa coda la guarda adesso anche chi propone —
 * il social media manager, in «In attesa di approvazione» e sulla sua dashboard
 * — e due copie della costruzione delle voci sarebbero due code che prima o poi
 * mostrano cose diverse.
 *
 * La coda continua a non avere un archivio suo: legge lo stato di album,
 * documenti e attività, e le tre tabelle dove le modifiche aspettano
 * (`unita_proposte`, `unita_persone` in revisione, `proposte`).
 *
 * ## Chi propone vede la sua parte, e senza consensi
 *
 * `vista: "chi-propone"` è la coda del social media manager, e ne toglie due
 * cose (decisione del 4 ottobre 2026: il suo compito sono contenuti, fotografie
 * e calendario, e nient'altro):
 *
 *  - le voci che non sono contenuto: circolari e documenti, elenchi dei referenti,
 *    e nelle schede delle unità ritrovo, telefono e nomi (`contenuto` nel
 *    catalogo). Li propongono i referenti di unità, e un elenco di quello che altri
 *    stanno cambiando è proprio l'accesso che non deve avere;
 *  - i nomi degli iscritti senza consenso, sugli album. Sono nomi di minori, e
 *    la riga `iscritti` della matrice li dà a chi pubblica: chi approva li vede,
 *    ed è lui che deve.
 */
export async function vociDellaCoda({
  vista,
}: {
  vista: "chi-approva" | "chi-propone";
}): Promise<{
  voci: VoceCoda[];
  indicatori: { daApprovare: number; bozze: number; senzaFile: number; escluse: number };
}> {
  const unitaTutte = await leggiUnita();
  const slugDi = (chiave: string): string | undefined => {
    const u = unitaTutte.find((x) => x.chiave === chiave);
    return u ? `/anteprima/unita/${u.slug}` : undefined;
  };
  const tutto = vista === "chi-approva";
  const [tuttiAlbum, tuttiDocumenti, tutteAttivita, tutteLeProposte, tuttePersone, tutteSulSito, calendario] = await Promise.all([
    leggiAlbum(),
    tutto ? leggiDocumenti() : [],
    attivitaInRevisione(),
    leggiProposte(),
    tutto ? personeInRevisione() : [],
    leggiProposteInAttesa(),
    leggiAttivita(),
  ]);
  // La coda è un'altra porta di lettura: applica gli stessi permessi delle
  // sezioni, compresi ambito e autore, prima di costruire anteprime e conteggi.
  const filtra = async <T,>(voci: T[], ammessa: (voce: T) => Promise<boolean>): Promise<T[]> => {
    const esiti = await Promise.all(voci.map(ammessa));
    return voci.filter((_, i) => esiti[i]);
  };
  const puoLeggere = async (azione: Azione, unita?: UnitaKey, autore?: string) => {
    const ctx = await concesso(azione, { unita });
    return !!ctx && (tutto ? ctx.livello === "completo" : !autore || autore === ctx.sessione.u);
  };
  // album e attività: tutti quelli dell'ambito. Il social media manager, dal 6
  // ottobre 2026, lavora anche su quelli degli altri, e vede che cosa aspetta
  const album = await filtra(tuttiAlbum, async (a) => !!(await concesso("album-carica", { unita: a.unita })));
  const documenti = await filtra(tuttiDocumenti, (d) => puoLeggere("documenti", d.unita));
  const attivita = await filtra(
    tutteAttivita,
    async (a) => !!(await concesso("attivita", { unita: unitaPerCancello(a.unita) })),
  );
  const proposte = await filtra(
    tutto ? tutteLeProposte : tutteLeProposte.filter((p) => campoUnita(p.campo)?.contenuto),
    (p) => puoLeggere("unita-scheda", p.unita as UnitaKey, p.autore),
  );
  const personeProposte = await filtra(tuttePersone, (p) => puoLeggere("referenti", p.unita as UnitaKey));
  const sulSito = await filtra(tutteSulSito, async (p) => {
    if (p.tipo === "album") {
      const a = tuttiAlbum.find((x) => x.slug === p.chiave);
      return !!a && (await puoLeggere("album-carica", a.unita, p.autore));
    }
    if (p.tipo === "attivita") {
      const a = calendario.find((x) => String(x.id) === p.chiave);
      if (!a) return Promise.resolve(false);
      return puoLeggere("attivita", unitaPerCancello(a.unita), p.autore);
    }
    if (p.tipo === "copertina") return puoLeggere("unita-anagrafica", p.chiave as UnitaKey, p.autore);
    if (p.tipo === "immagine") {
      const slot = slotDi(p.chiave);
      if (!slot || slot.persona) return Promise.resolve(false);
      return puoLeggere(slot.unita ? "unita-scheda" : "pagine", slot.unita as UnitaKey || undefined, p.autore);
    }
    return puoLeggere("pagine", undefined, p.autore);
  });
  const letturaConsensi = await concesso("iscritti-elenco");
  const mostraConsensi = tutto && letturaConsensi && await eccezioneAperta(letturaConsensi.sessione, "iscritti");

  const consensiDi = (a: (typeof album)[number]) => {
    if (!mostraConsensi) return undefined;
    const etichetta = displayInEtichetta(a.anno);
    if (!etichetta) return undefined;
    return statoConsensi(etichetta, a.unita === "gruppo" ? undefined : a.unita) ?? undefined;
  };

  // le proposte delle unità, una voce per unità: chi approva decide la scheda
  // intera, e la chiave le porta tutte (vedi `decidiProposta`)
  const perUnita = new Map<string, typeof proposte>();
  for (const p of proposte) {
    if (!perUnita.has(p.unita)) perUnita.set(p.unita, []);
    perUnita.get(p.unita)!.push(p);
  }

  const fotoAccese = await albumAttivi();
  const voci: VoceCoda[] = [
    ...album
      .filter((a) => fotoAccese && a.stato === "in-revisione")
      .map(
        (a): VoceCoda => ({
          tipo: "album",
          chiave: a.slug,
          versione: improntaDiRevisione(a),
          titolo: a.titolo,
          ambito: labelDiUnita(a.unita),
          quando: a.aggiornato,
          autore: a.autore,
          foto: a.foto.length,
          escluse: a.escluse,
          senzaConsenso: consensiDi(a),
          anteprima: a.sottotitolo || `${a.data} · anno sociale ${a.anno}`,
        }),
      ),
    ...documenti
      .filter((d) => d.stato === "in-revisione")
      .map(
        (d): VoceCoda => ({
          tipo: "documento",
          chiave: d.id,
          versione: improntaDiRevisione(d),
          titolo: d.titolo,
          ambito: d.anno === null ? validitaDocumento(null) : `anno ${validitaDocumento(d.anno)}`,
          quando: d.aggiornato,
          autore: d.autore,
          conFile: Boolean(d.file),
          anteprima: d.nota || "Nessuna nota.",
        }),
      ),
    ...[...perUnita.entries()].map(([unita, campi]): VoceCoda => ({
      tipo: "campo",
      chiave: `${unita}|${campi.map((c) => c.campo).join(",")}`,
      anteprimaHref: slugDi(unita),
      titolo:
        campi.length === 1
          ? (campoUnita(campi[0].campo)?.label ?? campi[0].campo)
          : `${campi.length} modifiche alla scheda`,
      ambito: labelDiUnita(unita as UnitaKey),
      quando: campi[0].quando,
      autore: campi[0].autore,
      anteprima:
        campi.length === 1
          ? campoUnita(campi[0].campo)?.approvazione
            ? "Un recapito o un nome: va pubblicato da un gestore."
            : "Un testo della scheda dell’unità."
          : `${campi.map((c) => campoUnita(c.campo)?.label ?? c.campo).join(", ")}.`,
      confronto: campi.map((c) => ({
        etichetta: campoUnita(c.campo)?.label ?? c.campo,
        prima: c.attuale,
        dopo: c.proposto,
      })),
    })),
    ...personeProposte.map(
      (p): VoceCoda => ({
        tipo: "persone",
        chiave: `${p.unita}|${p.tipo}`,
        anteprimaHref: slugDi(p.unita),
        titolo: ETICHETTA_TIPO_PERSONA[p.tipo],
        ambito: labelDiUnita(p.unita),
        quando: p.quando,
        autore: p.autore,
        anteprima:
          `${p.proposte.length} ${p.proposte.length === 1 ? "nome" : "nomi"} proposti ` +
          `(adesso in pagina: ${p.quantiOra}).`,
        confronto: [
          {
            etichetta: "L’elenco proposto",
            prima: `${p.quantiOra} ${p.quantiOra === 1 ? "nome" : "nomi"} in pagina`,
            dopo: p.proposte
              .map((x) => [x.nome, x.ruolo, x.periodo].filter(Boolean).join(" · "))
              .join(" / "),
          },
        ],
      }),
    ),
    ...attivita.map(
      (a): VoceCoda => ({
        tipo: "attivita",
        chiave: String(a.id),
        versione: improntaDiRevisione(a),
        titolo: a.titolo,
        ambito: a.unita.includes("gruppo")
          ? "tutto il gruppo"
          : a.unita.map(labelDiUnita).join(" e "),
        quando: Date.now(),
        autore: "",
        anteprima: `${a.dow} ${a.giorno} ${a.mese} ${a.anno} · ${a.luogo || "luogo da definire"}`,
      }),
    ),
    ...(await vociDelSito(sulSito, unitaTutte, calendario, tuttiAlbum)),
  ].sort((a, b) => a.quando - b.quando);

  return {
    voci,
    indicatori: {
      daApprovare: voci.length,
      bozze: album.filter((a) => a.stato === "bozza").length,
      senzaFile: documenti.filter((d) => !d.file).length,
      escluse: album.reduce((n, a) => n + a.escluse, 0),
    },
  };
}

/**
 * Le voci di `proposte`: testi delle pagine, domande frequenti, fotografie.
 *
 * Una voce per proposta, non per pagina: chi approva deve poter prendere il
 * titolo nuovo della home e lasciare la citazione com'è. Il confronto mostra il
 * testo che c'è adesso e quello che ci sarebbe; per le fotografie, le due
 * immagini una accanto all'altra.
 */
async function vociDelSito(
  sulSito: PropostaInAttesa[],
  unitaTutte: Awaited<ReturnType<typeof leggiUnita>>,
  calendario: Awaited<ReturnType<typeof leggiAttivita>>,
  tuttiAlbum: Awaited<ReturnType<typeof leggiAlbum>>,
): Promise<VoceCoda[]> {
  if (sulSito.length === 0) return [];

  const [testi, faq, immagini] = await Promise.all([
    leggiTestiPagine(),
    leggiFaq(),
    tutteLeImmagini(),
  ]);

  const comune = (p: PropostaInAttesa) => ({
    tipo: p.tipo,
    chiave: p.chiave,
    versione: improntaProposta(p),
    quando: p.quando,
    autore: p.autore,
    proposta: true as const,
  });

  return sulSito.flatMap((p): VoceCoda[] => {
    // la richiesta di ritirare un album pubblicato (M-1b), con il motivo
    if (p.tipo === "album") {
      const a = tuttiAlbum.find((x) => x.slug === p.chiave);
      if (!a) return [];
      const motivo = motivoDelRitiro(p.valore);
      const online = a.stato === "pubblicato";
      return [
        {
          ...comune(p),
          titolo: a.titolo,
          ambito: a.unita === "gruppo" ? "tutto il gruppo" : labelDiUnita(a.unita),
          anteprima: !online
            ? "Chiesto il ritiro, ma l’album non è più online: decidere non cambia niente."
            : motivo === null
              ? "Una richiesta che non si riesce a leggere: rimandatela."
              : "Ritirare l’album dalla pagina Foto: torna in bozza ai referenti dell’unità.",
          ...(motivo ? { motivo } : {}),
          approva: "Ritira l’album",
          ...(online ? { anteprimaHref: `/foto/${a.slug}` } : {}),
        },
      ];
    }
    if (p.tipo === "attivita") {
      const a = calendario.find((x) => String(x.id) === p.chiave);
      if (!a) return [];
      let richiesta: { azione?: string; campi?: unknown } = {};
      try {
        richiesta = JSON.parse(p.valore) as typeof richiesta;
      } catch {
        // una riga malformata si mostra come tale; l'approvazione la rifiuterà
      }
      const ambito = a.unita.includes("gruppo")
        ? "tutto il gruppo"
        : a.unita.map(labelDiUnita).join(" e ");
      const online = a.stato === "pubblicato";
      const motivo = motivoDelRitiro(p.valore);
      if (motivo !== null) {
        return [
          {
            ...comune(p),
            titolo: a.titolo,
            ambito,
            anteprima: online
              ? `Ritirare dal calendario l’attività del ${a.dow} ${a.giorno} ${a.mese} ${a.anno}: ` +
                "torna in bozza, e si può rimettere."
              : "Chiesto il ritiro, ma l’attività non è più nel calendario: decidere non cambia niente.",
            motivo,
            approva: "Ritira dal calendario",
            ...(online ? { anteprimaHref: "/attivita" } : {}),
          },
        ];
      }
      if (richiesta.azione === "elimina") {
        return [
          {
            ...comune(p),
            titolo: a.titolo,
            ambito,
            anteprima:
              `Cancellare l’attività del ${a.dow} ${a.giorno} ${a.mese} ${a.anno}` +
              (online ? ": è nel calendario pubblico, e approvando sparisce." : "."),
            approva: "Approva la cancellazione",
            ...(online ? { anteprimaHref: "/attivita" } : {}),
          },
        ];
      }
      // il confronto mostra solo quello che cambia: chi approva deve vedere la
      // virgola corretta, non sette righe uguali
      const dopo = campiAttivitaDa(richiesta.campi, TUTTE_LE_UNITA);
      const unitaTesto = (u: readonly string[]) =>
        u.length === 0 || u.includes("gruppo") ? "tutto il gruppo" : u.map((k) => labelDiUnita(k as UnitaKey)).join(", ");
      const righe = dopo
        ? [
            { etichetta: "Titolo", prima: a.titolo, dopo: dopo.titolo },
            { etichetta: "Data", prima: isoDaEvento(a.giorno, a.mese, a.anno) ?? "", dopo: dopo.data },
            { etichetta: "Che cosa è", prima: ETICHETTA_TIPO[a.tipoChiave], dopo: ETICHETTA_TIPO[dopo.tipo] },
            { etichetta: "Unità", prima: unitaTesto(a.unita), dopo: unitaTesto(dopo.unita) },
            { etichetta: "Luogo", prima: a.luogo, dopo: dopo.luogo },
            { etichetta: "Durata", prima: a.durata, dopo: dopo.durata },
            { etichetta: "Nota", prima: a.nota, dopo: dopo.nota },
          ].filter((r) => r.prima !== r.dopo)
        : [];
      return [
        {
          ...comune(p),
          titolo: a.titolo,
          ambito,
          anteprima: dopo
            ? righe.length === 0
              ? "Una modifica che non cambia niente rispetto a quella online."
              : "Modifiche a un’attività del calendario pubblico: fino all’approvazione resta " +
                "quella di adesso."
            : "Una proposta che non si riesce a leggere: rimandatela.",
          confronto: righe,
          anteprimaHref: online ? "/attivita" : undefined,
        },
      ];
    }

    if (p.tipo === "pagina") {
      const campo = campoPagina(p.chiave);
      if (!campo) return [];
      const gruppo = GRUPPI_PAGINE.find((g) => p.chiave.startsWith(`${g.chiave}.`));
      return [
        {
          ...comune(p),
          titolo: campo.label,
          ambito: gruppo ? `pagina ${gruppo.titolo}` : "testi delle pagine",
          anteprima: "Un testo di una pagina pubblica.",
          anteprimaHref: gruppo?.pagina,
          confronto: [
            {
              etichetta: campo.label,
              prima: testi[campo.chiave] ?? "",
              // vuoto vuol dire «il testo del progetto»: si mostra quello
              dopo: p.valore.trim() === "" ? predefinitoDi(campo.chiave) : p.valore,
            },
          ],
        },
      ];
    }

    if (p.tipo === "faq") {
      let proposte: { domanda: string }[] = [];
      try {
        proposte = JSON.parse(p.valore) as { domanda: string }[];
      } catch {
        // una riga malformata si mostra come tale; l'approvazione la rifiuterà
      }
      return [
        {
          ...comune(p),
          titolo: "Domande frequenti",
          ambito: "pagina Contatti",
          anteprima:
            proposte.length === 0
              ? "Tornare alle domande del progetto."
              : `${proposte.length} ${proposte.length === 1 ? "domanda" : "domande"} al posto ` +
                `delle ${faq.length} di adesso.`,
          anteprimaHref: "/contatti",
          confronto: [
            {
              etichetta: "Le domande",
              prima: faq.map((v) => v.domanda).join(" / "),
              dopo: proposte.map((v) => v.domanda).join(" / "),
            },
          ],
        },
      ];
    }

    if (p.tipo === "immagine") {
      const slot = slotDi(p.chiave);
      if (!slot) return [];
      const adesso = immagini.get(p.chiave);
      const visibile = adesso && !adesso.nascosta ? adesso : undefined;
      const rimettere = chiedeDiMostrare(p);
      return [
        {
          ...comune(p),
          titolo: slot.nome,
          ambito: slot.unita ? `${labelDiUnita(slot.unita as UnitaKey)} · ${slot.dove}` : slot.dove,
          anteprima: rimettere
            ? "Rimettere sul sito la fotografia nascosta."
            : p.file
              ? "Una fotografia nuova per questo riquadro."
              : "Togliere la fotografia.",
          immagini: {
            prima: visibile ? `/immagine/${visibile.file}?l=400` : null,
            dopo: rimettere
              ? adesso?.nascosta
                ? indirizzoInAttesa(adesso.file, 400)
                : null
              : p.file
                ? indirizzoInAttesa(p.file, 400)
                : null,
          },
        },
      ];
    }

    const unita = unitaTutte.find((u) => u.chiave === p.chiave);
    if (!unita) return [];
    return [
      {
        ...comune(p),
        titolo: "Fotografia di copertina",
        ambito: unita.nome,
        anteprima: chiedeDiMostrare(p)
          ? "Rimettere la copertina nascosta in cima alla pagina dell’unità."
          : p.file
            ? "Una fotografia nuova in cima alla pagina dell’unità."
            : "Togliere la copertina: la pagina torna all’immagine predefinita.",
        anteprimaHref: `/unita/${unita.slug}`,
        immagini: {
          prima: unita.copertina ? `${unita.copertina.src}?l=400` : null,
          dopo: chiedeDiMostrare(p)
            ? unita.copertinaNascosta
              ? `${unita.copertinaNascosta.src}?l=400`
              : null
            : p.file
              ? indirizzoInAttesa(p.file, 400)
              : null,
        },
      },
    ];
  });
}
