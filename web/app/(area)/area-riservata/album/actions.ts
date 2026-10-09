"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  aggiornaAlbum,
  aggiungiFoto,
  albumPerIndirizzo,
  cancellaDalCestino,
  cambiaStatoAlbum,
  creaAlbum,
  creatoreAlbum,
  eliminaAlbum,
  idAlbumPerIndirizzo,
  GIORNI_CESTINO,
  nascondiFoto,
  ripristinaFoto,
  togliFoto,
} from "@/lib/album";
import { MOTIVO_RITIRO_MAX, type RichiestaRitiro } from "@/lib/proposte";
import { proponi, togliRitiro } from "@/lib/proposte-store";
import {
  assenzeDichiarateDa,
  dichiaraAssenza,
  HA_DICHIARATO_CHI_PUBBLICA,
  iscrittoPerId,
  togliAssenza,
} from "@/lib/iscritti-store";
import { trovaUtente } from "@/lib/utenti";
import {
  FOTO_PESO_MAX,
  pesoLeggibile,
  type Stato,
  type StatoAzione,
} from "@/lib/contenuti";
import { riprova, statoCoda } from "@/lib/foto/coda";
import { TUTTE_LE_UNITA, type UnitaKey } from "@/lib/data";
import { contesto, Negato, puo } from "@/lib/auth/contesto";
import { nascondeSoltanto, soloIPropri } from "@/lib/auth/decisione";
import { eSuo } from "@/lib/auth/propri";
import { type Sessione } from "@/lib/sessione";
import { sessioneCorrente } from "@/lib/sessione-server";
import { fuPubblicato, registra } from "@/lib/registro-store";
import { impostaPasswordAlbum, serraturaPerIndirizzo } from "@/lib/album-accesso";
import { errorePasswordAlbum, proponiPasswordAlbum } from "@/lib/album-password";

/**
 * Scritture sugli album.
 *
 * Ogni azione ricontrolla l'ambito, senza eccezioni. Il middleware ferma la
 * *navigazione* verso una pagina, ma una Server Action è un endpoint: ci si
 * arriva con una richiesta costruita a mano, senza aver mai aperto la pagina.
 * §05 del piano lo dice per le scritture — «il referente di unità non vede meno cose in
 * interfaccia, non gliele restituisce proprio il server» — ed è qui che si
 * realizza.
 *
 * La divisione dei compiti è quella del piano: il referente di unità prepara e manda in
 * revisione, il gestore pubblica. Serve perché negli album ci sono foto di
 * minori, e il controllo dei consensi lo fa chi ha l'elenco completo.
 */

const NEGATO: StatoAzione = {
  stato: "errore",
  messaggio: "Non avete i permessi per intervenire su questo album.",
};

/** Le pagine pubbliche che cambiano quando cambia un album. */
function aggiornaFoto(slug?: string) {
  revalidatePath("/foto");
  if (slug) revalidatePath(`/foto/${slug}`);
  revalidatePath("/");
}

/** Sessione valida, o `null`. Il chiamante decide che cosa farne. */
async function chiEntra(): Promise<Sessione | null> {
  return sessioneCorrente();
}

/**
 * Verifica che questa sessione possa scrivere su questo album.
 *
 * ## Chi decide, dalla fase 14
 *
 * Era `puoScrivereSu(sessione, album.unita)`, un predicato di
 * `lib/sessione.ts`. Adesso è la riga `album-carica` della matrice, con l'unità
 * dell'album come ambito. La decisione è **identica** — con `limitato`,
 * `decidi()` fa esattamente quel confronto, e i livelli del seme sono quelli
 * che il predicato applicava — ma la prende la matrice che l'amministratore
 * vede a schermo. Fino a qui questo file era fra i sei che la matrice non
 * governava, e cambiare la riga `album-carica` non apriva né chiudeva niente.
 *
 * L'ordine dei controlli non si tocca: prima la sessione, poi l'esistenza
 * dell'album, poi l'ambito. Chiedere l'ambito di un album che non c'è avrebbe
 * prodotto un rifiuto invece di un «non esiste più», e sono due cose diverse
 * per chi legge il registro.
 */
async function permesso(
  slug: string,
): Promise<
  | {
      ok: true;
      sessione: Sessione;
      unita: UnitaKey;
      soloPropri: boolean;
      nascondeSoltanto: boolean;
      /** se cancella da sé solo i propri: è lui ad aver creato quest'album? */
      suo: boolean;
    }
  | { ok: false; esito: StatoAzione }
> {
  const sessione = await chiEntra();
  if (!sessione) return { ok: false, esito: NEGATO };

  const album = await albumPerIndirizzo(slug);
  if (!album) {
    return {
      ok: false,
      esito: { stato: "errore", messaggio: "Questo album non esiste più." },
    };
  }

  let ctx;
  try {
    ctx = await contesto("album-carica", { unita: album.unita, descrizione: `album «${slug}»` });
  } catch (errore) {
    if (errore instanceof Negato) return { ok: false, esito: NEGATO };
    throw errore;
  }

  /*
   * Il social media manager lavora su tutti gli album, anche su quelli degli
   * altri e su quelli già pubblicati (6 ottobre 2026): tiene aggiornato il sito
   * al posto dei referenti di unità. Fino ad allora toccava solo i suoi, e solo in
   * bozza (audit degli accessi, A-4 e M-1). Quello che lo tiene nella revisione
   * è la regola di ogni modifica fatta da chi non pubblica — un album online
   * torna ai gestori prima che la modifica entri (BIZ-01) —, e quello che
   * resta solo dei gestori lo dice ogni azione: la password, il ritiro,
   * l'eliminazione delle fotografie.
   */

  // l'unità viene restituita perché i due cancelli di pubblicazione la usano
  // come ambito, e rileggere l'album sarebbe un secondo giro sul database
  return {
    ok: true,
    sessione,
    unita: album.unita,
    soloPropri: soloIPropri(ctx.sessione.r, ctx.livello),
    nascondeSoltanto: nascondeSoltanto(ctx.sessione.r, ctx.livello),
    suo: eSuo(ctx.sessione, ctx.livello, creatoreAlbum(slug)),
  };
}

/**
 * Chi ha dichiarato un'assenza su quest'album non lo pubblica (audit degli
 * accessi, SoD-1). Non esportata: in un file `"use server"` ogni funzione
 * esportata è un indirizzo che chiunque può chiamare.
 */
async function haDichiarato(slug: string, utente: string): Promise<boolean> {
  const id = await idAlbumPerIndirizzo(slug);
  return id !== null && assenzeDichiarateDa(id, utente) > 0;
}

/**
 * Questa sessione può **pubblicare** un album di questa unità?
 *
 * Separata da `permesso` perché è una riga di matrice diversa —
 * `album-pubblica`, che nel seme il referente di unità non ha — ed è il cancello dei
 * consensi: chi mette online fotografie di minori è chi ha l'elenco completo.
 *
 * Passa da `contesto()` e non da `puo()` benché restituisca un booleano: qui il
 * rifiuto **va registrato**, perché è una scrittura tentata e non una lettura.
 * Il booleano serve solo a lasciare a chi chiama il messaggio giusto, che nei
 * due punti d'uso è diverso e spiega che cosa fare invece.
 */
async function permessoDiPubblicare(unita: UnitaKey, slug: string): Promise<boolean> {
  try {
    await contesto("album-pubblica", { unita, descrizione: `album «${slug}»` });
    return true;
  } catch (errore) {
    if (errore instanceof Negato) return false;
    throw errore;
  }
}

/**
 * Questa sessione copre l'unità di questo iscritto?
 *
 * Il permesso sull'album non basta per toccare un ragazzo: l'iscrizione arriva
 * dal modulo, e `iscrittoPerId` non filtra per unità. Senza questo un referente
 * unità poteva dichiarare assente — o riportare presente — il ragazzo di
 * un'altra unità (audit di sicurezza, AUTHZ-02). L'unità si ricava
 * dall'iscrizione in archivio, e decide la riga `iscritti` della matrice.
 */
async function ambitoDellIscritto(iscritto: { unita: string; id: number }): Promise<boolean> {
  try {
    await contesto("iscritti", {
      unita: iscritto.unita as UnitaKey,
      descrizione: `assenza dell'iscrizione ${iscritto.id}`,
    });
    return true;
  } catch (errore) {
    if (errore instanceof Negato) return false;
    throw errore;
  }
}

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

// --------------------------------------------------------------------------
// Creazione
// --------------------------------------------------------------------------

export async function nuovoAlbum(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const sessione = await chiEntra();
  if (!sessione) return NEGATO;

  const titolo = testo(formData, "titolo");
  const anno = testo(formData, "anno");
  const data = testo(formData, "data");
  const sottotitolo = testo(formData, "sottotitolo");
  const unita = testo(formData, "unita") as UnitaKey;

  if (titolo.length < 3 || titolo.length > 90) {
    return { stato: "errore", campo: "titolo", messaggio: "Il titolo deve stare fra 3 e 90 caratteri." };
  }
  if (!/^\d{4} – \d{4}$/.test(anno)) {
    return {
      stato: "errore",
      campo: "anno",
      messaggio: "L’anno sociale si scrive «2026 – 2027», con il trattino lungo.",
    };
  }
  if (data === "" || data.length > 40) {
    return { stato: "errore", campo: "data", messaggio: "Indicate il mese e l’anno, per esempio «Agosto 2026»." };
  }
  // `TUTTE_LE_UNITA` comprende anche «gruppo», che è la voce delle attività
  // comuni: un album di gruppo lo crea un gestore, e il controllo qui sotto
  // se ne occupa da solo
  if (!TUTTE_LE_UNITA.includes(unita)) {
    return { stato: "errore", campo: "unita", messaggio: "Scegliete l’unità dell’album." };
  }
  // La password nasce con l'album, non dopo: un album senza è un album che
  // qualcuno si dimentica di proteggere. Il modulo ne propone una casuale.
  const password = sessione.r === "social" ? proponiPasswordAlbum() : testo(formData, "password");
  const erratoPassword = errorePasswordAlbum(password);
  if (erratoPassword) return { stato: "errore", campo: "password", messaggio: erratoPassword };
  // Un referente di unità crea album solo per la propria unità — e non di gruppo, che
  // nel modello è l'unità di nessuno. L'unità arriva dal form, quindi è il
  // punto in cui una richiesta costruita a mano proverebbe a passare: il
  // cancello la confronta con quella della sessione, non con quella inviata.
  try {
    await contesto("album-carica", { unita, descrizione: `album nuovo «${titolo}»` });
  } catch (errore) {
    if (errore instanceof Negato) return NEGATO;
    throw errore;
  }

  const slug = await creaAlbum(
    { titolo, anno, unita, data, sottotitolo, tag: testo(formData, "tag") || titolo },
    Date.now(),
    sessione.u,
  );

  impostaPasswordAlbum(slug, password);

  aggiornaFoto(slug);
  // la password non va nel registro: lo leggono anche i referenti di altre unità
  await registra(sessione, "contenuto", `Creato l’album «${titolo}», protetto da password`, "album");
  return {
    stato: "fatto",
    messaggio:
      sessione.r === "social"
        ? `Album «${titolo}» creato in bozza. La password è riservata ai gestori. Ora potete caricare le fotografie.`
        : `Album «${titolo}» creato in bozza, con la password «${password}». La ritrovate nella scheda dell’album. Ora si possono caricare le fotografie.`,
  };
}

// --------------------------------------------------------------------------
// Modifica
// --------------------------------------------------------------------------

export async function modificaAlbum(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  const titolo = testo(formData, "titolo");
  if (titolo.length < 3 || titolo.length > 90) {
    return { stato: "errore", campo: "titolo", messaggio: "Il titolo deve stare fra 3 e 90 caratteri." };
  }

  const escluse = Number(testo(formData, "escluse") || "0");
  if (!Number.isInteger(escluse) || escluse < 0 || escluse > 999) {
    return { stato: "errore", campo: "escluse", messaggio: "Le foto escluse sono un numero da 0 a 999." };
  }

  // Come per le fotografie aggiunte (BIZ-01): un album online modificato da
  // chi non può pubblicare torna ai gestori, prima che la modifica entri.
  const ritirato =
    (await albumPerIndirizzo(slug))?.stato === "pubblicato" &&
    !(await puo("album-pubblica", { unita: p.unita }));
  if (ritirato) await cambiaStatoAlbum(slug, "in-revisione", Date.now(), p.sessione.u);

  await aggiornaAlbum(
    slug,
    {
      titolo,
      data: testo(formData, "data"),
      sottotitolo: testo(formData, "sottotitolo"),
      tag: testo(formData, "tag") || titolo,
      escluse,
    },
    Date.now(),
    p.sessione.u,
  );

  aggiornaFoto(slug);
  await registra(
    p.sessione,
    "contenuto",
    `Modificato l’album «${titolo}»` + (ritirato ? ", che torna in revisione" : ""),
    "album",
  );
  return {
    stato: "fatto",
    messaggio: ritirato
      ? "Album aggiornato. Era pubblicato: con le modifiche torna ai gestori per " +
        "l’approvazione, e fino ad allora non è visibile nella pagina Foto."
      : "Album aggiornato.",
  };
}

/**
 * Cambia la password dell'album.
 *
 * Chi l'aveva già aperto con quella vecchia deve rimetterla: il cookie è
 * legato alla versione della password, e `impostaPasswordAlbum` ne fa una
 * nuova a ogni chiamata. È voluto, ed è detto nel messaggio: cambiare password
 * serve proprio quando quella vecchia è finita dove non doveva.
 */
export async function cambiaPasswordAlbum(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  const password = testo(formData, "password");
  const errato = errorePasswordAlbum(password);
  if (errato) return { stato: "errore", campo: "password", messaggio: errato };

  /*
   * La password di un album che le famiglie hanno già aperto è la chiave di
   * fotografie di minori online (audit degli accessi, A-3).
   *
   * Il social media manager non la cambia più, una volta che l'album è stato
   * pubblicato: la sceglie quando lo crea, e da lì in poi la custodisce chi
   * pubblica. Un referente di unità sì — se gira, va cambiata subito — ma come ogni
   * altra modifica a un album online da chi non può pubblicare, l'album torna
   * in approvazione: chi pubblica sa che la chiave è cambiata.
   */
  if (p.sessione.r === "social") {
    return {
      stato: "errore",
      messaggio:
        "La password di un album già pubblicato la cambiano i gestori: chiedete a loro.",
    };
  }
  const ritirato =
    (await albumPerIndirizzo(slug))?.stato === "pubblicato" &&
    !(await puo("album-pubblica", { unita: p.unita }));
  if (ritirato) await cambiaStatoAlbum(slug, "in-revisione", Date.now(), p.sessione.u);

  // l'album può essere ancora solo nel seme: `aggiornaAlbum` lo scrive in
  // tabella senza cambiare niente, e solo dopo c'è una riga da aggiornare
  await aggiornaAlbum(slug, {}, Date.now(), p.sessione.u);
  impostaPasswordAlbum(slug, password);

  aggiornaFoto(slug);
  await registra(
    p.sessione,
    "contenuto",
    `Cambiata la password dell’album «${slug}»` + (ritirato ? ", che torna in revisione" : ""),
    "album",
  );
  return {
    stato: "fatto",
    messaggio:
      `Password salvata: «${password}». Chi aveva aperto l’album con quella di prima ` +
      "dovrà inserire questa." +
      (ritirato
        ? " L’album era pubblicato: torna ai gestori per l’approvazione, e fino ad " +
          "allora non è visibile nella pagina Foto."
        : ""),
  };
}

// --------------------------------------------------------------------------
// Fotografie
// --------------------------------------------------------------------------

export async function caricaFoto(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  const files = formData.getAll("foto").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { stato: "errore", campo: "foto", messaggio: "Scegliete almeno una fotografia." };
  }
  if (files.length > 40) {
    return {
      stato: "errore",
      campo: "foto",
      messaggio: "Al massimo 40 fotografie per volta: caricatele in più riprese.",
    };
  }

  /*
   * Un album già online che riceve fotografie da chi non può pubblicare torna
   * in approvazione, **prima** che le fotografie entrino.
   *
   * Dall'audit di sicurezza (BIZ-01): le foto aggiunte a un album pubblicato
   * comparivano subito nella pagina Foto, saltando il gestore che controlla
   * i consensi. Rifiutare il caricamento avrebbe chiesto al referente di unità i tre
   * passi a mano — ritirare, caricare, rimandare in revisione — per arrivare
   * allo stesso punto; qui li fa l'azione, e il messaggio lo dice.
   */
  const ritirato =
    (await albumPerIndirizzo(slug))?.stato === "pubblicato" &&
    !(await puo("album-pubblica", { unita: p.unita }));
  if (ritirato) await cambiaStatoAlbum(slug, "in-revisione", Date.now(), p.sessione.u);

  const adesso = Date.now();
  let caricate = 0;
  const rifiutate: string[] = [];

  for (const [i, file] of files.entries()) {
    if (file.size > FOTO_PESO_MAX) {
      rifiutate.push(`${file.name} (${pesoLeggibile(file.size)}, troppo pesante)`);
      continue;
    }

    const dati = Buffer.from(await file.arrayBuffer());
    // il timestamp va spostato di uno a ogni file, altrimenti due foto caricate
    // nello stesso millisecondo si prenderebbero lo stesso nome
    const esito = await aggiungiFoto(slug, dati, "", adesso + i, p.sessione.u);

    if (!esito.ok) {
      rifiutate.push(`${file.name} (${esito.errore})`);
      continue;
    }
    // Il lato massimo lo controlla `aggiungiFoto`, **prima** di scrivere:
    // qui c'era un controllo dopo, che disfaceva con `togliFoto` — e lasciava
    // sul disco le tre derivate già prodotte dalla coda. Vedi il commento là.
    caricate++;
  }

  // nessuna fotografia nuova: l'album è quello che era stato approvato, e
  // torna online com'era. Se il database non lo lascia ripubblicare (un
  // consenso ritirato nel frattempo), resta in revisione: è il lato sicuro.
  if (ritirato && caricate === 0) {
    try {
      await cambiaStatoAlbum(slug, "pubblicato", Date.now(), p.sessione.u);
    } catch (errore) {
      console.error(`album: «${slug}» resta in revisione:`, errore);
    }
  }
  aggiornaFoto(slug);

  if (caricate === 0) {
    return {
      stato: "errore",
      campo: "foto",
      messaggio: `Nessuna fotografia caricata. ${rifiutate.join("; ")}`,
    };
  }
  await registra(
    p.sessione,
    "contenuto",
    `Caricate ${caricate} ${caricate === 1 ? "fotografia" : "fotografie"} in «${slug}»` +
      (ritirato ? ", che torna in revisione" : ""),
    "album",
  );
  /*
   * Che cosa si dice a chi ha appena caricato.
   *
   * «Caricate 12 fotografie» sarebbe vero e incompleto: sul disco ci sono, ma
   * nella pagina non si vedranno finché la coda non le ha convertite — una alla
   * volta, come vuole §8. Senza dirlo, chi ricarica e non le vede pensa che sia
   * andato storto qualcosa e ricarica di nuovo.
   */
  const coda = statoCoda();
  const inLavorazione = coda.inAttesa + coda.inCorso;

  return {
    stato: "fatto",
    messaggio:
      `Caricate ${caricate} ${caricate === 1 ? "fotografia" : "fotografie"}.` +
      (inLavorazione > 0
        ? ` ${inLavorazione === 1 ? "Una è" : `${inLavorazione} sono`} in conversione:` +
          " compariranno nella pagina fra poco, potete chiudere questa schermata."
        : "") +
      (rifiutate.length ? ` Scartate: ${rifiutate.join("; ")}` : "") +
      (ritirato
        ? " L’album era pubblicato: con le fotografie nuove torna ai gestori per" +
          " l’approvazione, e fino ad allora non è visibile nella pagina Foto."
        : ""),
  };
}

/**
 * Rimette in coda una conversione fallita.
 *
 * Sta qui e non in una schermata di manutenzione perché chi deve premerlo è
 * chi ha caricato la fotografia e la vede col riquadro rosso, non un
 * amministratore che guarda un elenco di lavori. Il permesso è quello
 * dell'album: chi può togliere quella fotografia può anche farla riconvertire.
 */
export async function riprovaConversione(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  const id = Number(testo(formData, "lavoro"));
  if (!Number.isInteger(id) || id <= 0) {
    return { stato: "errore", messaggio: "Non trovo il lavoro da riprovare." };
  }

  const albumId = await idAlbumPerIndirizzo(slug);
  if (albumId === null) return { stato: "errore", messaggio: "Quest’album non esiste più." };

  if (!riprova(id, albumId)) {
    return {
      stato: "errore",
      messaggio: "Quel lavoro non è più in errore: forse qualcun altro l’ha già ripreso.",
    };
  }

  aggiornaFoto(slug);
  return {
    stato: "fatto",
    messaggio: "Ci riprovo. Ricaricate la pagina fra qualche istante.",
  };
}

export async function rimuoviFoto(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  // il social media manager le fotografie le nasconde, non le elimina: il file
  // resta, e se va eliminato lo fa un gestore (6 ottobre 2026)
  if (p.nascondeSoltanto) return SOLO_NASCONDERE;

  /*
   * Togliere una fotografia da un album pubblicato è una modifica a un
   * contenuto approvato, e fino al 4 ottobre 2026 era l'unica che non lo
   * riportava in approvazione — e nemmeno nel registro (audit degli accessi,
   * A-1: il file è cancellato dal server, quindi senza traccia non si poteva
   * più sapere chi e quando). Adesso vale la regola delle altre: chi non può
   * pubblicare rimanda l'album ai gestori, **prima** di toccarlo.
   */
  const file = testo(formData, "file");
  const ritirato =
    (await albumPerIndirizzo(slug))?.stato === "pubblicato" &&
    !(await puo("album-pubblica", { unita: p.unita }));
  if (ritirato) await cambiaStatoAlbum(slug, "in-revisione", Date.now(), p.sessione.u);

  const fatto = await togliFoto(slug, file, Date.now(), p.sessione.u);
  aggiornaFoto(slug);
  if (fatto) {
    await registra(
      p.sessione,
      "eliminazione",
      `Eliminata la fotografia «${file.slice(0, 80)}» dall’album «${slug}», ` +
        `nel cestino per ${GIORNI_CESTINO} giorni` +
        (ritirato ? "; l’album torna in revisione" : ""),
      "album",
    );
  }
  return fatto
    ? {
        stato: "fatto",
        messaggio:
          `Fotografia eliminata dall’album. Resta nel cestino per ${GIORNI_CESTINO} giorni, ` +
          "da cui un gestore può rimetterla; poi viene cancellata dal server." +
          (ritirato ? " L’album era pubblicato: torna ai gestori per l’approvazione." : ""),
      }
    : { stato: "errore", messaggio: "Quella fotografia non c’è più." };
}

/**
 * Il cestino di un album è dei gestori: rimettere una fotografia la rimette
 * online, cancellarla per sempre non si disfa. Tutt'e due chiedono
 * `album-pubblica` sull'unità dell'album, oltre al permesso sull'album.
 */
async function permessoSulCestino(
  slug: string,
): Promise<{ ok: true; sessione: Sessione } | { ok: false; esito: StatoAzione }> {
  const p = await permesso(slug);
  if (!p.ok) return p;
  if (!(await permessoDiPubblicare(p.unita, slug))) {
    return {
      ok: false,
      esito: {
        stato: "errore",
        messaggio: "Il cestino degli album lo gestiscono i gestori: chiedete a loro.",
      },
    };
  }
  return { ok: true, sessione: p.sessione };
}

/** Rimette nell'album una fotografia del cestino. */
export async function ripristinaFotoCestino(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const p = await permessoSulCestino(slug);
  if (!p.ok) return p.esito;

  /*
   * Rimettere una fotografia in un album pubblicato è mettere online qualcosa:
   * vale la regola di chi pubblica, e chi ha dichiarato delle assenze su
   * quest'album non è chi ci rimette le fotografie (SoD-1).
   */
  if (
    (await albumPerIndirizzo(slug))?.stato === "pubblicato" &&
    (await haDichiarato(slug, p.sessione.u))
  ) {
    return { stato: "errore", messaggio: HA_DICHIARATO_CHI_PUBBLICA };
  }

  const file = testo(formData, "file");
  if (!(await ripristinaFoto(slug, file, p.sessione.u))) {
    return { stato: "errore", messaggio: "Quella fotografia non è più nel cestino." };
  }
  aggiornaFoto(slug);
  await registra(
    p.sessione,
    "contenuto",
    `Rimessa dal cestino la fotografia «${file.slice(0, 80)}» dell’album «${slug}»`,
    "album",
  );
  return { stato: "fatto", messaggio: "Fotografia rimessa nell’album, al posto che aveva." };
}

/** Cancella per sempre una fotografia del cestino, senza aspettare i trenta giorni. */
export async function cancellaFotoCestino(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const p = await permessoSulCestino(slug);
  if (!p.ok) return p.esito;

  const file = testo(formData, "file");
  if (!(await cancellaDalCestino(slug, file))) {
    return { stato: "errore", messaggio: "Quella fotografia non è più nel cestino." };
  }
  aggiornaFoto(slug);
  await registra(
    p.sessione,
    "eliminazione",
    `Cancellata per sempre dal cestino la fotografia «${file.slice(0, 80)}» dell’album «${slug}»`,
    "album",
  );
  return { stato: "fatto", messaggio: "Fotografia cancellata dal server." };
}

const SOLO_NASCONDERE: StatoAzione = {
  stato: "errore",
  messaggio:
    "Le fotografie non si eliminano da qui: nascondetela, e sparisce subito dall’album. " +
    "Se va eliminata del tutto, lo fa un gestore.",
};

/**
 * Nasconde una fotografia dell'album: sparisce subito dalla pagina, il file resta.
 *
 * Subito per tutti, e **senza** riportare in revisione un album pubblicato:
 * togliere una fotografia dalla vista non mette online niente, ed è il gesto che
 * serve rapido — una fotografia sbagliata si toglie adesso. È il «togliere» del
 * social media manager, che le fotografie non le elimina (6 ottobre 2026).
 */
export async function nascondiFotoAlbum(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  const file = testo(formData, "file");
  const fatto = await nascondiFoto(slug, file, true, p.sessione.u);
  if (!fatto) return { stato: "errore", messaggio: "Quella fotografia non c’è più." };
  aggiornaFoto(slug);
  await registra(
    p.sessione,
    "contenuto",
    `Nascosta la fotografia «${file.slice(0, 80)}» dell’album «${slug}»`,
    "album",
  );
  return {
    stato: "fatto",
    messaggio: "Fotografia nascosta: non compare più nell’album. Resta qui, e si può rimettere.",
  };
}

/**
 * Rimette una fotografia nascosta. Questo mette online qualcosa, quindi segue la
 * regola di ogni altra modifica: un album pubblicato, toccato da chi non può
 * pubblicare, torna ai gestori **prima** che la fotografia ricompaia
 * (BIZ-01, come `caricaFoto`).
 */
export async function mostraFotoAlbum(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  const file = testo(formData, "file");
  const album = await albumPerIndirizzo(slug);
  if (!album?.foto.some((f) => f.file === file && f.nascosta)) {
    return { stato: "errore", messaggio: "Quella fotografia non è nascosta, o non c’è più." };
  }
  const ritirato =
    album.stato === "pubblicato" && !(await puo("album-pubblica", { unita: p.unita }));
  if (ritirato) await cambiaStatoAlbum(slug, "in-revisione", Date.now(), p.sessione.u);

  await nascondiFoto(slug, file, false, p.sessione.u);
  aggiornaFoto(slug);
  await registra(
    p.sessione,
    "contenuto",
    `Rimessa la fotografia «${file.slice(0, 80)}» dell’album «${slug}»` +
      (ritirato ? ", che torna in revisione" : ""),
    "album",
  );
  return {
    stato: "fatto",
    messaggio: ritirato
      ? "Fotografia rimessa. L’album era pubblicato: torna ai gestori per l’approvazione, " +
        "e fino ad allora non è visibile nella pagina Foto."
      : "Fotografia rimessa nell’album.",
  };
}

// --------------------------------------------------------------------------
// Dichiarazioni di assenza — §5 del piano
// --------------------------------------------------------------------------

/**
 * Dichiara che un iscritto non compare nelle fotografie di questo album.
 *
 * §6 del piano assegna `dichiaraAssenza` al **referente di unità**, e il permesso è
 * quello dell'album: `album-carica`, `limitato` per il referente di unità. È la scelta
 * giusta fra le due possibili — l'altra era `iscritti` — perché l'ambito da
 * verificare è quello dell'**album**: chi dichiara sta affermando qualcosa sulle
 * proprie fotografie, non sui dati di un iscritto.
 *
 * Quello che questa azione **non** fa: non tocca il consenso. Un consenso
 * mancante resta mancante, e resterà mancante per il prossimo album. Una
 * dichiarazione vale per un album e per uno solo, ed è tutto il senso di §5.
 */
export async function dichiaraAssente(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const iscrizione = Number(testo(formData, "iscrizione"));
  if (!Number.isInteger(iscrizione) || iscrizione <= 0) {
    return { stato: "errore", messaggio: "Iscritto non trovato." };
  }

  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  const id = await idAlbumPerIndirizzo(slug);
  if (id === null) return { stato: "errore", messaggio: "Quest’album non esiste più." };

  const chi = trovaUtente(p.sessione.u);
  if (!chi) {
    return {
      stato: "errore",
      messaggio:
        "Non riesco a risalire al vostro account: una dichiarazione senza autore " +
        "non si può registrare.",
    };
  }

  const iscritto = iscrittoPerId(iscrizione);
  if (!iscritto) return { stato: "errore", messaggio: "Iscritto non trovato." };
  if (!(await ambitoDellIscritto(iscritto))) return NEGATO;

  const fatto = dichiaraAssenza(id, iscrizione, chi.id);
  aggiornaFoto(slug);

  await registra(
    p.sessione,
    "consenso",
    `Dichiarato assente da «${slug}»: ${iscritto.cognome} ${iscritto.nome}`,
    "album",
  );

  return {
    stato: "fatto",
    messaggio: fatto
      ? `Dichiarato: ${iscritto.cognome} ${iscritto.nome} non compare in queste fotografie.`
      : "Era già dichiarato.",
  };
}

/** Ritira una dichiarazione. Che sia stata ritirata resta nel registro. */
export async function ritiraAssenza(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const iscrizione = Number(testo(formData, "iscrizione"));
  if (!Number.isInteger(iscrizione)) {
    return { stato: "errore", messaggio: "Iscritto non trovato." };
  }

  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  const id = await idAlbumPerIndirizzo(slug);
  if (id === null) return { stato: "errore", messaggio: "Quest’album non esiste più." };

  const iscritto = iscrittoPerId(iscrizione);
  if (!iscritto) return { stato: "errore", messaggio: "Quella dichiarazione non c’è più." };
  if (!(await ambitoDellIscritto(iscritto))) return NEGATO;

  if (!togliAssenza(id, iscrizione)) {
    return { stato: "errore", messaggio: "Quella dichiarazione non c’è più." };
  }
  aggiornaFoto(slug);

  await registra(
    p.sessione,
    "consenso",
    `Ritirata la dichiarazione di assenza da «${slug}»: ${iscritto.cognome} ${iscritto.nome}`,
    "album",
  );

  return {
    stato: "fatto",
    messaggio: "Dichiarazione ritirata: l’album torna bloccato se il consenso manca.",
  };
}

// --------------------------------------------------------------------------
// Ciclo di approvazione
// --------------------------------------------------------------------------

export async function cambiaStato(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const nuovo = testo(formData, "stato") as Stato;
  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  if (!["bozza", "in-revisione", "pubblicato"].includes(nuovo)) {
    return { stato: "errore", messaggio: "Stato non riconosciuto." };
  }

  /*
   * Ritirare un album online lo decide chi l'ha pubblicato. Il «ritiro libero»
   * fu deciso per il referente di unità, sulla propria unità; il social media manager
   * lo aveva ereditato su tutte (audit degli accessi, M-1b). Ora lo chiede.
   */
  if (nuovo !== "pubblicato" && p.soloPropri) {
    if ((await albumPerIndirizzo(slug))?.stato === "pubblicato") {
      return {
        stato: "errore",
        messaggio:
          "Un album già online lo ritira un gestore: usate «Chiedi il ritiro», " +
          "dicendo perché.",
      };
    }
  }

  // Il passaggio che conta: pubblicare è dei gestori. Un referente di unità può
  // mandare in revisione e ritirare, non mettere online foto di minori.
  if (nuovo === "pubblicato" && !(await permessoDiPubblicare(p.unita, slug))) {
    return {
      stato: "errore",
      messaggio:
        "La pubblicazione spetta ai gestori, che controllano i consensi. " +
        "Mandate l’album in revisione: lo vedranno nella loro coda.",
    };
  }

  // e chi ha dichiarato delle assenze su quest'album non è chi lo pubblica
  if (nuovo === "pubblicato" && (await haDichiarato(slug, p.sessione.u))) {
    return { stato: "errore", messaggio: HA_DICHIARATO_CHI_PUBBLICA };
  }

  // Senza password un album pubblicato resterebbe chiuso a tutti: la pagina
  // direbbe «non ancora accessibile» e nessuno se ne accorgerebbe dall'area.
  if (nuovo === "pubblicato" && !serraturaPerIndirizzo(slug)?.versione) {
    return {
      stato: "errore",
      messaggio:
        "Prima di pubblicare impostate la password dell’album: senza, le famiglie " +
        "non possono aprirlo.",
    };
  }

  await cambiaStatoAlbum(slug, nuovo, Date.now(), p.sessione.u);
  // ritirato da chi può: una richiesta di ritiro in coda non ha più oggetto
  if (nuovo !== "pubblicato") await togliRitiro("album", slug);
  aggiornaFoto(slug);
  await registra(
    p.sessione,
    nuovo === "pubblicato" ? "pubblicazione" : "contenuto",
    `Album «${slug}» → ${nuovo}`,
    "album",
  );

  const detto: Record<Stato, string> = {
    bozza: "Album riportato in bozza: non è più visibile al pubblico.",
    "in-revisione": "Album inviato ai gestori per l’approvazione.",
    pubblicato: "Album pubblicato: è online nella pagina Foto, per chi ha la password.",
  };
  return { stato: "fatto", messaggio: detto[nuovo] };
}

export async function rimuoviAlbum(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  /*
   * Il social media manager le fotografie non le elimina, e un album si porta
   * via le sue. Elimina da sé soltanto un album **suo** e **vuoto** — quello
   * creato per sbaglio —; per il resto nasconde le fotografie, o chiede a un
   * gestore (6 ottobre 2026).
   */
  if (p.nascondeSoltanto) {
    const a = await albumPerIndirizzo(slug);
    if (!p.suo || (a?.foto.length ?? 0) > 0) {
      return {
        stato: "errore",
        messaggio:
          "Un album con delle fotografie, o creato da un’altra persona, lo elimina un referente " +
          "gruppo. Le singole fotografie potete nasconderle.",
      };
    }
  }

  /*
   * Cancellare un album che è stato online è una cosa da gestori: rompe un
   * indirizzo che qualcuno può aver condiviso, e butta via materiale approvato
   * in due.
   *
   * Prima valeva solo per l'album pubblicato **adesso**, e un referente di unità ci
   * arrivava in due passi: riportarlo in bozza, poi eliminarlo (audit di
   * sicurezza, BIZ-03). Ritirare resta suo — è il modo di togliere subito una
   * fotografia contestata —, cancellare no: se il registro dice che l'album è
   * stato pubblicato, serve chi pubblica.
   */
  const album = await albumPerIndirizzo(slug);
  const statoOnline =
    album?.stato === "pubblicato" ||
    (album !== undefined &&
      fuPubblicato([`Album «${slug}» →`, `(${slug})`, `l’album «${album.titolo}»`]));
  if (statoOnline && !(await permessoDiPubblicare(p.unita, slug))) {
    return {
      stato: "errore",
      messaggio:
        album?.stato === "pubblicato"
          ? "Un album pubblicato lo elimina un gestore. Riportatelo in bozza e chiedete."
          : "Quest’album è stato pubblicato: lo elimina un gestore. Chiedete a loro.",
    };
  }

  await eliminaAlbum(slug);
  await togliRitiro("album", slug);
  aggiornaFoto(slug);
  await registra(p.sessione, "eliminazione", `Eliminato l’album «${slug}»`, "album");

  // Chi elimina sta guardando l'editor di quell'album, che adesso non esiste
  // più: restare lì mostrerebbe «quest'album non esiste», cioè un messaggio da
  // errore dopo un'operazione riuscita. Si torna all'elenco.
  const elenco = testo(formData, "da");
  if (elenco.startsWith("/area-riservata/") && !elenco.startsWith("//") && !elenco.includes(".."))
    redirect(elenco);

  return { stato: "fatto", messaggio: "Album eliminato, insieme alle sue fotografie." };
}

/**
 * Chiede ai gestori di ritirare un album pubblicato, dicendo perché.
 *
 * È del social media manager, che un album online non lo ritira da sé (audit
 * degli accessi, M-1b): la richiesta va in `proposte` e la decide un referente
 * gruppo dalla coda. Fino ad allora l'album resta online. Chi può ritirarlo
 * direttamente non passa di qui: lo ritira e basta.
 */
export async function chiediRitiroAlbum(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const slug = testo(formData, "slug");
  const p = await permesso(slug);
  if (!p.ok) return p.esito;

  if (!p.soloPropri) {
    return {
      stato: "errore",
      messaggio: "Potete ritirarlo voi: usate «Ritira dalla pubblicazione».",
    };
  }
  if ((await albumPerIndirizzo(slug))?.stato !== "pubblicato") {
    return { stato: "errore", messaggio: "Quest’album non è online: non c’è niente da ritirare." };
  }

  const motivo = testo(formData, "motivo");
  if (motivo === "") {
    return {
      stato: "errore",
      campo: "motivo",
      messaggio: "Scrivete perché va ritirato: è quello che i gestori leggono.",
    };
  }
  if (motivo.length > MOTIVO_RITIRO_MAX) {
    return {
      stato: "errore",
      campo: "motivo",
      messaggio: `Il motivo è troppo lungo: al massimo ${MOTIVO_RITIRO_MAX} caratteri.`,
    };
  }

  const richiesta: RichiestaRitiro = { azione: "ritira", motivo };
  await proponi("album", slug, JSON.stringify(richiesta), null, p.sessione.u);
  revalidatePath("/area-riservata/[ruolo]/[sezione]", "page");
  await registra(
    p.sessione,
    "contenuto",
    `Chiesto il ritiro dell’album «${slug}»: ${motivo.slice(0, 200)}`,
    "album",
  );
  return {
    stato: "fatto",
    messaggio:
      "Richiesta inviata ai gestori: l’album resta online finché non decidono. " +
      "Se una fotografia va tolta subito, nascondetela.",
  };
}
