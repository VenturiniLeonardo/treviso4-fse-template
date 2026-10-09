#!/usr/bin/env node
/**
 * Mette le fotografie del gruppo nei posti fissi del disegno.
 *
 *   cd web && npm run db:foto-sito            # scrive in archivio e in tabella
 *   cd web && npm run db:foto-sito -- --prova /tmp/prova   # solo i ritagli, su file
 *
 * ## Che cosa fa, e perché esiste
 *
 * I posti di `lib/slot-immagini.ts` e le copertine di unità si riempiono
 * **caricando dall'area riservata**, ed è così che devono riempirsi: il giorno
 * che un referente di unità cambia la foto della sua pagina non deve chiedere a
 * nessuno. Questo script non sostituisce quella strada — scrive esattamente le
 * stesse righe e gli stessi file, con la stessa lavorazione — la percorre una
 * volta sola, per la prima messa in linea, quando i riquadri sono molti e
 * riempirli a mano vorrebbe dire lasciare il ritaglio al caso.
 *
 * I ritratti dei referenti senza fotografia mostrano l'avatar anonimo di
 * `AvatarAnonimo`, in components/site/Photo.tsx.
 *
 * Rilanciarlo **sostituisce** quello che c'è, e porta via i file di prima. È il
 * comportamento di `caricaImmagine`, non un'aggiunta: un posto tiene
 * un'immagine sola.
 *
 * ## Le fotografie
 *
 * Gli originali stanno in `web/foto-originali/sito/`, uno per destinazione,
 * ripuliti dei metadati e ridotti a 2400 px di lato — vedi il README lì
 * accanto. In questo repository la cartella è vuota: `POSTI` è vuoto, e lo
 * script non fa niente finché un gruppo non ci mette le sue.
 *
 * **Prima di mettere una fotografia, guardatela a piena risoluzione**: niente
 * volti riconoscibili senza il consenso scritto delle famiglie, anche fuori dal
 * ritaglio, perché l'originale resta nel repository.
 *
 * ## I ritagli
 *
 * Ogni riquadro del disegno ha una sua proporzione, e `object-fit: cover` taglia
 * quello che avanza — **al centro**, che è quasi sempre il posto sbagliato.
 * Perciò ogni riga porta due numeri: la proporzione del riquadro dove la
 * fotografia va a finire, e dove sta la cosa da non tagliare (`fuoco`, in
 * frazione del lato tagliato dell'originale). Il ritaglio si fa qui, una volta,
 * e in pagina non ne resta da fare.
 *
 * Le proporzioni sono **misurate sul foglio di stile**:
 *
 *   - eroe di unità e di «Chi siamo» — 1280 × 520 e 1280 × 420, cioè 2,46:1 e
 *     3,05:1 su desktop, ma su telefono l'altezza la decide il contenuto.
 *     Si pubblica 2,4:1, che è il punto in cui nessuna delle due situazioni
 *     taglia molto e il soggetto resta dentro in entrambe;
 *   - schede di fascia — `.branch-card__media` è alta 190 px in una colonna di
 *     373 px: 1,96:1, cioè 2:1;
 *   - scheda «Foto» della home — 373 × 150: 2,5:1;
 *   - fotografia d'archivio d'unità — 480 × 240: 2:1.
 *
 * ## I metadati
 *
 * Come in `scripts/foto-home.mjs` e nell'azione che carica: `sharp` non copia
 * l'EXIF se non glielo si chiede, e non glielo si chiede. Non è una formalità:
 * una fotografia scattata al campo con il telefono porta nell'EXIF le
 * coordinate del posto in cui il campo ha dormito.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { cancellaCaricato, scriviCaricato } from "@/lib/archivio";
import { percorsoDb } from "@/lib/db/percorso";
import { generaDerivate, LATI, nomeDerivata } from "@/lib/foto/derivate";
import { registraImmagine, togliImmagine } from "@/lib/immagini-store";
import { dimenticaCopertina, registraCopertina, unitaSalvataPerChiave } from "@/lib/unita-store";
import { slotDi } from "@/lib/slot-immagini";

const QUI = dirname(fileURLToPath(import.meta.url));
const ORIGINALI = join(QUI, "..", "foto-originali");

/** Il lato lungo di quello che si pubblica: è il più grande delle derivate. */
const LATO = LATI[0];

/**
 * Dove va ogni fotografia, con che proporzione e con che fuoco.
 *
 * `posto` è la chiave di `lib/slot-immagini.ts`, oppure `{ unita }` per la
 * copertina di un'unità — sono due tabelle diverse e due funzioni diverse, ma
 * la lavorazione del file è la stessa. `file` sta in `web/foto-originali/sito/`,
 * salvo `cartella` esplicita (una sottocartella di `foto-originali/`).
 *
 * `nota` non finisce da nessuna parte nel sito: è per chi legge questo file e
 * vuole sapere perché quello scatto sta in quel posto senza doverlo aprire.
 *
 * Per esempio:
 *
 *   { posto: "home.fascia-verde", file: "home-fascia-verde.jpg", proporzione: 2.0, fuoco: 0.66,
 *     nota: "Le tende del campo sul prato, all'alba. Nessuna persona." },
 *   { unita: "u5", file: "unita-u5-copertina.jpg", proporzione: 2.4, fuoco: 0.6,
 *     nota: "Una persona di spalle sulla cresta." },
 */
const POSTI = [];

/**
 * I posti da **svuotare**: c'era una fotografia, e non ci deve più essere.
 *
 * Togliere una riga da `POSTI` non basta: un database in cui questo script è
 * già passato ha le righe e i file in archivio, e le pagine continuerebbero a
 * servirli. Per questo il comando, prima di riempire, **svuota** questi posti —
 * a ogni esecuzione, e senza danno se sono già vuoti. Svuotati, i riquadri
 * tornano al fondo rigato del colore di fascia (vedi `ImmagineSlot` in
 * components/site/Photo.tsx).
 *
 * Per esempio: `"home.galleria"`, oppure `{ unita: "u1" }` per una
 * copertina.
 */
const DA_SVUOTARE = [];

/**
 * Il ritaglio: la fascia della proporzione chiesta, centrata sul fuoco.
 *
 * Taglia **su un lato solo** — quello in eccesso — e non entrambi: da una foto
 * verticale si prende una fascia orizzontale, da una troppo larga una colonna.
 * Il fuoco è in frazione del lato tagliato e viene ricondotto dentro i bordi,
 * così un valore ottimistico non fa uscire il rettangolo dall'immagine.
 */
function ritaglio(larghezza, altezza, proporzione, fuoco) {
  const attuale = larghezza / altezza;
  if (Math.abs(attuale - proporzione) < 0.01) {
    return { left: 0, top: 0, width: larghezza, height: altezza };
  }
  if (attuale > proporzione) {
    // troppo larga: si stringe in orizzontale, il fuoco vale sulla larghezza
    const w = Math.round(altezza * proporzione);
    const left = Math.min(Math.max(Math.round(larghezza * fuoco - w / 2), 0), larghezza - w);
    return { left, top: 0, width: w, height: altezza };
  }
  const h = Math.round(larghezza / proporzione);
  const top = Math.min(Math.max(Math.round(altezza * fuoco - h / 2), 0), altezza - h);
  return { left: 0, top, width: larghezza, height: h };
}

/** L'immagine pubblicabile: ritagliata, ridotta, e senza un byte di EXIF. */
async function prepara(percorso, proporzione, fuoco) {
  const base = sharp(percorso).rotate();
  const meta = await base.metadata();
  const taglio = ritaglio(meta.width, meta.height, proporzione, fuoco);
  const dati = await base
    .extract(taglio)
    .resize({ width: LATO, withoutEnlargement: true, kernel: "lanczos3" })
    // NIENTE `withMetadata()`: vedi la nota in cima
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  const uscita = await sharp(dati).metadata();
  return {
    dati,
    misure: { larghezza: uscita.width, altezza: uscita.height },
    sorgente: `${meta.width}×${meta.height}`,
  };
}

/** Porta via un originale e le sue tre derivate. Come `portaVia` nell'azione. */
async function portaVia(nome) {
  await cancellaCaricato(nome);
  for (const lato of LATI) await cancellaCaricato(nomeDerivata(nome, lato));
}

/** Il nome del file di copertina che c'è adesso, per poterlo portare via. */
async function copertinaPrecedente(unita) {
  const u = await unitaSalvataPerChiave(unita);
  // `copertina.src` è `/copertina/<file>`: il nome è l'ultimo segmento
  return u?.copertina ? (u.copertina.src.split("/").pop() ?? null) : null;
}

async function main() {
  const i = process.argv.indexOf("--prova");
  const prova = i >= 0 ? process.argv[i + 1] : null;

  // Prima di toccare qualunque cosa: gli originali ci sono tutti? Scoprirlo a
  // metà vorrebbe dire riquadri svuotati e altri riempiti, con l'errore di
  // `sharp` «Input file is missing» che non dice perché.
  const mancanti = POSTI.map((p) => join(p.cartella ?? "sito", p.file)).filter(
    (f) => !existsSync(join(ORIGINALI, f)),
  );
  if (mancanti.length) {
    console.error(`Mancano ${mancanti.length} originali in web/foto-originali/:`);
    for (const f of mancanti) console.error(`  ${f}`);
    console.error("\nNon è stato scritto niente.");
    process.exit(1);
  }

  if (prova) {
    await mkdir(prova, { recursive: true });
    console.log(`prova: nessuna scrittura in archivio, i ritagli vanno in ${prova}\n`);
  } else {
    console.log(`database: ${percorsoDb()}\n`);
  }

  for (const p of DA_SVUOTARE) {
    const chiave = typeof p === "string" ? p : `unita.${p.unita}.copertina`;
    if (prova) {
      console.log(`  - ${chiave.padEnd(30)} da svuotare`);
      continue;
    }
    const precedente =
      typeof p === "string" ? await togliImmagine(p) : await dimenticaCopertina(p.unita);
    if (precedente) await portaVia(precedente);
    console.log(`  - ${chiave.padEnd(30)} ${precedente ? "svuotato" : "già vuoto"}`);
  }

  for (const p of POSTI) {
    const chiave = p.posto ?? `unita.${p.unita}.copertina`;

    // un posto che il disegno non ha più non si riempie: è il controllo che fa
    // `registraImmagine`, anticipato qui per dirlo con un nome di file accanto
    if (p.posto && !slotDi(p.posto)) {
      console.log(`  ! ${chiave} — questo posto non esiste più nel disegno`);
      continue;
    }

    const percorso = join(ORIGINALI, p.cartella ?? "sito", p.file);
    const { dati, misure, sorgente } = await prepara(percorso, p.proporzione, p.fuoco);

    if (prova) {
      await writeFile(join(prova, `${chiave}.jpg`), dati);
      console.log(
        `  ${chiave.padEnd(30)} ${sorgente} → ${misure.larghezza}×${misure.altezza} ` +
          `(${(dati.length / 1024).toFixed(0)} kB)`,
      );
      continue;
    }

    /*
     * Il nome è quello che genererebbe l'azione che carica, prefisso compreso:
     * `immagine-<posto>-<ms>.jpg` e `copertina-<unita>-<ms>.jpg`.
     *
     * Non è un vezzo. `lib/archivio-orfani.ts` riconosce i file
     * dell'applicazione **dal prefisso** (`PREFISSI`), e un nome fuori
     * dall'elenco è invisibile a `npm run db:orfani`: la riga risulterebbe
     * «senza file» e il file non risulterebbe orfano — cioè il contrario, due
     * volte. Un allarme falso che compare a ogni controllo è un allarme che
     * si impara a ignorare.
     */
    const adesso = Date.now();
    const nome = p.unita
      ? `copertina-${p.unita}-${adesso}.jpg`
      : `immagine-${p.posto.replace(/[^a-z0-9]+/gi, "-")}-${adesso}.jpg`;
    const esito = await generaDerivate(dati, nome);

    await scriviCaricato(nome, dati);
    for (const d of esito.derivate) await scriviCaricato(d.nome, d.dati);

    if (p.unita) {
      // `registraCopertina` non restituisce il file di prima: si legge com'era
      // per poterlo portare via, come fa `copertinaPrecedente` nell'azione
      const precedente = await copertinaPrecedente(p.unita);
      await registraCopertina(p.unita, nome, "image/jpeg", misure, "");
      if (precedente && precedente !== nome) await portaVia(precedente);
    } else {
      // descrizione vuota di proposito: questi riquadri sono decorativi e
      // stanno sopra un titolo che dice già che cosa si vede — vedi
      // `ImmagineSlot` in components/site/Photo.tsx
      const precedente = await registraImmagine(p.posto, nome, "image/jpeg", misure, "", "");
      if (precedente) await portaVia(precedente);
    }

    console.log(
      `  ${chiave.padEnd(30)} ${sorgente} → ${misure.larghezza}×${misure.altezza} ` +
        `(${(dati.length / 1024).toFixed(0)} kB + 3 derivate)`,
    );
  }

  console.log(
    prova
      ? "\nFatto. Guardate i ritagli, e correggete `fuoco` nella tabella qui sopra."
      : "\nFatto. Le pagine si aggiornano al prossimo rilascio, o subito in sviluppo.",
  );
}

await main();
