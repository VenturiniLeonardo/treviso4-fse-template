import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminBar } from "@/components/area/AdminBar";
import { AdminSection } from "@/components/area/AdminSection";
import { AdminSide } from "@/components/area/AdminSide";
import { type Consensi, ElencoAlbum, ModificaAlbum } from "@/components/area/Album";
import { albumConPassword, passwordDellAlbum } from "@/lib/album-accesso";
import { proponiPasswordAlbum } from "@/lib/album-password";
import { ModificaDocumento, VistaCartella } from "@/components/area/GestioneDocumenti";
import { ArchivioDocumenti } from "@/components/area/ArchivioDocumenti";
import { ArchivioDocumentiReferenti } from "@/components/area/DocumentiReferenti";
import { Identita } from "@/components/area/Identita";
import { Immagini, PostoFoto } from "@/components/area/Immagini";
import { slotVivi, tutteLeImmagini } from "@/lib/immagini-store";
import { chiedeDiMostrare, motivoDelRitiro, type PropostaInAttesa } from "@/lib/proposte";
import { conAlbum } from "@/lib/slot-immagini";
import { albumAttivi } from "@/lib/funzioni";
import { Coda, IndicatoriCoda } from "@/components/area/Coda";
import { Matrice } from "@/components/area/Matrice";
import {
  IndicatoriRegistro,
  RegistroPieno,
} from "@/components/area/Registro";
import { Dashboard } from "@/components/area/Dashboard";
import {
  ElencoAttivita,
  ModificaAttivita,
  type UnitaSceglibile,
  type VoceAttivita,
} from "@/components/area/Attivita";
import { Iscritti, type VoceIscritto } from "@/components/area/Iscritti";
import { Messaggi, type VoceMessaggio } from "@/components/area/Messaggi";
import {
  type NonConforme,
  Privacy,
  type VoceRichiesta,
} from "@/components/area/Privacy";
import { CopertinaUnita } from "@/components/area/AnagraficaUnita";
import { CopertinaScheda, IdentitaUnita, IndiceUnita, RiquadroCampi, TestataUnita } from "@/components/area/PaginaUnita";
import { DomandeFrequenti } from "@/components/area/DomandeFrequenti";
import type { VoceFaq } from "@/lib/faq-contenuti";
import { StatoSistema } from "@/components/area/StatoSistema";
import { TestiPagine } from "@/components/area/TestiPagine";
import { Utenti, type VoceUtente } from "@/components/area/Utenti";
import { ElencoReferenti, type UnitaReferenti } from "@/components/area/ElencoReferenti";
import { PersoneUnita } from "@/components/area/PersoneUnita";
import { SchedaUnita } from "@/components/area/SchedaUnita";
import { SectionPicker } from "@/components/area/SectionPicker";
import { albumPerIndirizzo, creatoreAlbum, fotoNelCestino, leggiAlbum } from "@/lib/album";
import { AZIONE_DI_SEZIONE, ruoloVisibile, SEZIONI_CON_SCHERMATA } from "@/lib/data-area";
import { concesso, livelloPer, vaInCoda } from "@/lib/auth/contesto";
import { nascondeSoltanto, soloIPropri } from "@/lib/auth/decisione";
import { eSuo, puoSuAlbum } from "@/lib/auth/propri";
import { fuPubblicato } from "@/lib/registro-store";
import { vociDellaCoda } from "@/lib/coda";
import { leggiProposteInAttesa } from "@/lib/proposte-store";
import type { Azione } from "@/lib/permessi";
import { postaConfigurata } from "@/lib/posta";
import { unitaPerChiave } from "@/lib/data";
import { fascia, FILTRI_UNITA, labelDiUnita, TUTTE_LE_UNITA, type UnitaKey } from "@/lib/data";
import { leggiDocumenti } from "@/lib/documenti-store";
import { leggiCartelle } from "@/lib/cartelle-store";
import { CARTELLA_CIRCOLARI } from "@/lib/contenuti";
import { leggiMatrice } from "@/lib/permessi-store";
import {
  applicaFiltri,
  leggiRegistro,
  utentiNelRegistro,
} from "@/lib/registro-store";
import { leggiIdentita } from "@/lib/gruppo";
import Link from "next/link";
import { puoVedere, type Sessione } from "@/lib/sessione";
import { sessioneCorrente } from "@/lib/sessione-server";
import { AccessoEccezionale } from "@/components/area/AccessoEccezionale";
import { VerificaConsensi } from "@/components/area/VerificaConsensi";
import { COSE_ECCEZIONALI, eccezioneAperta } from "@/lib/eccezioni";

type Params = Promise<{ ruolo: string; sezione: string }>;
type Query = Promise<{
  q?: string;
  album?: string;
  doc?: string;
  /** identificativo dell'attività da modificare */
  att?: string;
  /** quale cartella dei documenti aprire, nella sezione del gestore */
  cartella?: string;
  /** quale unità mostrare, nelle sezioni del gestore; nel calendario, un elenco separato da virgole */
  u?: string;
  /** nel calendario: «1» per vedere anche le attività già passate */
  passate?: string;
  /** filtri del registro: chi, che tipo, quanti giorni indietro */
  chi?: string;
  che?: string;
  quando?: string;
  /** il periodo dei grafici della dashboard di sistema: 7, 30 o 90 giorni */
  periodo?: string;
}>;

/**
 * L'area riservata è sempre dinamica, per progetto: la Fig. 3 del piano la mette
 * fra le cose che non devono mai essere servite da un file salvato. Elenchi,
 * consensi e code di approvazione cambiano, e ora la pagina dipende anche da chi
 * è entrato. Per questo qui non c'è `generateStaticParams`.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { ruolo: slug, sezione } = await params;
  const ruolo = ruoloVisibile(slug, await albumAttivi());
  const s = ruolo?.sezioni[sezione];
  if (!ruolo || !s) return {};
  return { title: `${s.titolo} — ${ruolo.titoloPagina}` };
}

export default async function PaginaSezione({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Query;
}) {
  const { ruolo: slug, sezione: chiave } = await params;
  const {
    q,
    album: albumScelto,
    doc: docScelto,
    att: attScelta,
    cartella: cartellaScelta,
    u: unitaScelta,
    passate,
    chi,
    che,
    quando,
    periodo,
  } = await searchParams;

  // Il middleware ha già fermato chi non deve entrare. Il controllo si rifà qui
  // perché una pagina non deve dipendere dal fatto che qualcuno a monte se ne sia
  // ricordato: se un domani il matcher cambia, questa resta chiusa.
  const sessione = await sessioneCorrente();
  if (!sessione) redirect("/area-riservata/accedi");

  const ruolo = ruoloVisibile(slug, await albumAttivi());
  if (!ruolo) notFound();

  if (!puoVedere(sessione, ruolo.slug))
    redirect(`/area-riservata/${sessione.r}`);

  // `Object.hasOwn`: una chiave dall'indirizzo come «constructor» non deve
  // risolvere a una proprietà del prototipo (INFO-09)
  const sezione = Object.hasOwn(ruolo.sezioni, chiave) ? ruolo.sezioni[chiave] : undefined;
  if (!sezione) notFound();

  const percorso = `/area-riservata/${ruolo.slug}/${chiave}`;
  // Blocca anche gli indirizzi diretti, prima di leggere dati o costruire il corpo.
  const azioneSezione = AZIONE_DI_SEZIONE[chiave];
  if (azioneSezione && !(await concesso(azioneSezione as Azione))) notFound();
  const identita = await leggiIdentita();

  /*
   * Le sezioni che la matrice non concede: non compaiono nel menu — né nella
   * colonna laterale né nella tendina dei telefoni, che ricevono lo stesso
   * insieme.
   *
   * §8 del mandato lo chiede — «il frontend deve nascondere le sezioni non
   * disponibili» — e fino alla fase 14.9 la colonna mostrava tutte le voci del
   * ruolo, comprese quelle che poi rispondevano «la matrice non concede questa
   * funzione». Una voce che porta a un rifiuto fa cercare un guasto, e insegna
   * che il menu non dice la verità.
   *
   * Si interroga `livelloPer`, che è la stessa `decidi()` del cancello: menu e
   * server leggono la stessa riga, quindi una funzione chiusa dalla schermata
   * dei permessi sparisce anche dal menu senza che nessuno debba ricordarsene.
   *
   * `AZIONE_DI_SEZIONE` è parziale di proposito: una sezione che non ha una riga
   * di matrice resta visibile. Vedi il commento su quella mappa.
   */
  const nascoste = new Set<string>();
  for (const [sezione, azione] of Object.entries(AZIONE_DI_SEZIONE)) {
    if (!(sezione in ruolo.sezioni)) continue;
    if (!(await concesso(azione as Azione))) nascoste.add(sezione);
  }


  // La vista del referente di unità nomina la propria unità in tre punti: la pastiglia
  // in barra, il riquadro dell'ambito e il segnaposto della ricerca. In
  // `data-area.ts` sono scritti a mano — «Label 1» con il logo
  // dell'unità 1 — perché il mockup aveva un solo referente di unità. Chi guida un'altra
  // unità vedeva quindi il nome e il logo di qualcun altro, mentre i dati
  // erano già i propri: il difetto non si vedeva finché nessuno poteva entrare
  // con un'unità diversa da `u1`.
  const unitaMia =
    ruolo.slug === "referente" && sessione.un ? unitaPerChiave(sessione.un) : undefined;
  /*
   * I posti fotografici che questo utente può riempire.
   *
   * Un referente di unità vede quelli della sua pagina — la foto d'archivio e i
   * ritratti dei suoi referenti — e nient'altro. Un gestore li vede tutti.
   *
   * Il filtro non è la protezione: l'azione ricontrolla il cancello del
   * singolo posto, e un referente di unità che spedisse a mano la chiave di un posto
   * altrui riceverebbe un rifiuto. Serve a non mostrare a qualcuno un modulo
   * che sa già di non poter usare.
   */
  // anche le nascoste: chi gestisce il posto deve poterle rimettere o eliminare
  const immaginiPerPosto = await tutteLeImmagini();
  // i posti di adesso: i riquadri fissi e i ritratti dei referenti che ci sono davvero
  const posti = await slotVivi();
  const postiImmagini = (
    unitaMia
      ? posti.filter((slot) => slot.unita === unitaMia.chiave)
      : // la fotografia d'archivio di un'unità sta in «Unità», insieme alla
        // copertina: qui restano i riquadri del sito e i ritratti dei referenti
        posti.filter((slot) => !(slot.unita && !slot.persona))
  )
    // i ritratti sono persone: il social media manager non li tocca (righe
    // `referenti` e `identita`), e un posto che gli darebbe solo rifiuti non si mostra
    .filter((slot) => ruolo.slug !== "social" || !slot.persona)
    .filter(conAlbum(await albumAttivi()))
    .map((slot) => ({ slot, immagine: immaginiPerPosto.get(slot.chiave) ?? null }));

  const vista = unitaMia
    ? {
        ...ruolo,
        barraBadge: { ...ruolo.barraBadge, logo: unitaMia.logo, testo: unitaMia.nome },
        ambitoTitolo: unitaMia.nome,
      }
    : ruolo;

  /*
   * La briciola nomina l'unità, e va corretta come le altre due.
   *
   * Le sette sezioni del referente di unità hanno in `data-area.ts` un `crumb` che
   * comincia con «Label 1», il nome del mockup. La correzione del
   * badge e del titolo d'ambito, fatta in una fase precedente, non l'aveva
   * toccato: quindi la riga in cima alla sezione mostrava il nome del mockup
   * invece di quello che l'unità ha in `lib/data.ts` o nel database, e per un
   * referente di un'altra unità mostrava il nome di qualcun altro. Si sostituisce solo la prima parte, prima della barra: la
   * seconda è il nome della sezione e va lasciata com'è.
   */
  const sezioneVista =
    unitaMia && sezione.crumb.includes(" / ")
      ? { ...sezione, crumb: `${unitaMia.nome} / ${sezione.crumb.split(" / ").slice(1).join(" / ")}` }
      : sezione;

  return (
    <>
      <AdminBar
        ruolo={vista}
        sessione={sessione}
        identita={identita}
        percorso={percorso}
        q={q}
      />
      <SectionPicker
        ruolo={vista}
        attiva={chiave}
        nascoste={nascoste}
      />
      <div className="adm-shell">
        <AdminSide ruolo={vista} attiva={chiave} nascoste={nascoste} />
        <main className="adm-main" id="contenuto">
          <AdminSection
            sezione={sezioneVista}
            chiave={chiave}
            ruolo={ruolo.slug}
            percorso={percorso}
            q={q}
            conSchermata={SEZIONI_CON_SCHERMATA.has(chiave)}
          >
            {chiave === "identita" ? <Identita identita={identita} /> : null}
            {chiave === "immagini" ? (
              <Immagini
                posti={postiImmagini}
                caricaRitratti={(await livelloPer("referenti")) === "completo"}
                // i nomi delle unità come in «Referenti» e «Unità», non quelli di fascia: è lo stesso elenco di persone
                etichetteUnita={Object.fromEntries(
                  (await (await import("@/lib/unita-store")).leggiUnita()).map((u) => [u.chiave, u.nome]),
                )}
                // chi ha «limitato» su un riquadro propone la fotografia: il social
                // ovunque, il referente di unità sui riquadri della sua pagina (audit, M-3)
                inCoda={
                  (await livelloPer("pagine")) === "limitato" ||
                  (await livelloPer("unita-scheda")) === "limitato"
                }
                // le fotografie si nascondono soltanto: il social media manager
                soloNascondere={await nasconde(sessione, "pagine")}
                inAttesa={Object.fromEntries(
                  (await leggiProposteInAttesa("immagine")).map((p) => [p.chiave, inAttesaFoto(p)!]),
                )}
              />
            ) : null}
            {chiave === "album" ? (
              <GestioneAlbum
                sessione={sessione}
                percorso={percorso}
                scelto={albumScelto}
              />
            ) : null}
            {chiave === "circolari" ? (
              <CircolariDellaMiaUnita
                sessione={sessione}
                percorso={percorso}
                scelto={docScelto}
              />
            ) : null}
            {chiave === "documenti" && ruolo.slug !== "referente" ? (
              <GestioneDocumenti
                percorso={percorso}
                scelto={docScelto}
                cartella={cartellaScelta}
              />
            ) : null}
            {chiave === "documenti-referenti" ? (
              <DocumentiPerICapi
                percorso={percorso}
                scelto={docScelto}
                cartella={cartellaScelta}
              />
            ) : null}
            {chiave === "permessi" ? (
              <Matrice
                funzioni={await leggiMatrice()}
                modificabile={(await livelloPer("permessi")) === "completo"}
              />
            ) : null}
            {chiave === "approvazioni" ? <CodaApprovazioni /> : null}
            {chiave === "in-attesa" ? <InAttesa /> : null}
            {chiave === "messaggi" ? <PostaDalSito sessione={sessione} /> : null}
            {chiave === "privacy" ? <PrivacyEConsensi sessione={sessione} /> : null}
            {chiave === "iscritti" ? <ElencoIscritti sessione={sessione} /> : null}
            {chiave === "attivita" || chiave === "calendario" ? (
              <Calendario
                sessione={sessione}
                percorso={percorso}
                scelta={attScelta}
                unitaScelte={unitaScelta}
                passate={passate === "1"}
              />
            ) : null}
            {chiave === "presentazione" ? (
              <SchedaDellaMiaUnita sessione={sessione} />
            ) : null}
            {chiave === "referenti" ? (
              <ReferentiDelleUnita percorso={percorso} scelta={unitaScelta} />
            ) : null}
            {chiave === "testi-unita" ? (
              <TestiDelleUnita sessione={sessione} percorso={percorso} scelta={unitaScelta} />
            ) : null}
            {chiave === "unita" ? (
              <AnagraficaDelleUnita percorso={percorso} scelta={unitaScelta} />
            ) : null}
            {chiave === "utenti" ? <GestioneUtenti sessione={sessione} /> : null}
            {chiave === "pagine" ? <TestiDelleDuePagine sessione={sessione} /> : null}
            {chiave === "sistema" ? <Sistema /> : null}
            {chiave === "backup" ? <Backup /> : null}
            {chiave === "riepilogo" ? (
              <Dashboard sessione={sessione} ruolo={ruolo.slug} percorso={percorso} periodo={periodo} />
            ) : null}
            {chiave === "log" ? (
              <Log
                percorso={percorso}
                chi={chi}
                che={che}
                quando={quando}
                sviluppatore={sessione.r === "sviluppatore"}
              />
            ) : null}
          </AdminSection>
        </main>
      </div>
    </>
  );
}

/**
 * Corpo della sezione «Album e foto».
 *
 * Un referente di unità vede e tocca soltanto i propri; un gestore li vede tutti e
 * può pubblicare. Il filtro qui non è la protezione — quella è nelle azioni —
 * ma evita di mostrare a un referente di unità righe su cui otterrebbe un rifiuto.
 */
async function GestioneAlbum({
  sessione,
  percorso,
  scelto,
}: {
  sessione: Sessione;
  percorso: string;
  scelto?: string;
}) {
  const suo = sessione.r === "referente";
  const mia = sessione.un ?? "";

  /*
   * Gli album che questa sessione può toccare: il cancello di `album-carica`
   * sull'unità (`puoSuAlbum`).
   *
   * Era `puoScrivereSu`, un predicato scritto sul ruolo che non leggeva la
   * matrice (audit degli accessi, M-2). Dal 4 al 6 ottobre 2026 chiedeva anche
   * «è suo?» per il social media manager; adesso lui lavora su tutti gli album,
   * con la password riservata e ogni modifica in revisione. Una riga per album,
   * ed è il prezzo giusto: gli album di un gruppo sono decine, non migliaia.
   */
  const tutti = await leggiAlbum();
  const visibili: typeof tutti = [];
  for (const a of tutti) if (await puoSuAlbum(a.slug, a.unita)) visibili.push(a);
  const pubblica = (await livelloPer("album-pubblica")) !== "nessuno";

  if (suo && mia === "") {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Ambito</span>
        <p>
          Questo utente non ha un’unità assegnata, quindi non può gestire album.
          I gestori la assegnano dalla sezione «Utenti».
        </p>
      </div>
    );
  }

  const conPassword = albumConPassword();

  if (scelto) {
    const a = await albumPerIndirizzo(scelto);
    if (a && (await puoSuAlbum(a.slug, a.unita))) {
      /*
       * La password, per chi agisce solo sui propri album, finché l'album non è
       * mai stato online: la sceglie quando lo crea. Da quando le famiglie lo
       * aprono è la loro chiave, e la custodisce chi pubblica (audit, A-2).
       */
      const c = await concesso("album-carica", { unita: a.unita });
      const riservata =
        sessione.r === "social" ||
        !!c &&
        soloIPropri(c.sessione.r, c.livello) &&
        (a.stato === "pubblicato" ||
          fuPubblicato([`Album «${a.slug}» →`, `(${a.slug})`, `l’album «${a.titolo}»`]));
      // le fotografie si nascondono soltanto, e un album suo e vuoto è l'unico
      // che elimina da sé: il social media manager (6 ottobre 2026)
      const soloNascondere = !!c && nascondeSoltanto(c.sessione.r, c.livello);
      const statoOnline =
        a.stato === "pubblicato" ||
        fuPubblicato([`Album «${a.slug}» →`, `(${a.slug})`, `l’album «${a.titolo}»`]);
      const puoEliminare =
        !soloNascondere ||
        (!!c && eSuo(c.sessione, c.livello, creatoreAlbum(a.slug)) && a.foto.length === 0 && !statoOnline);
      // il cestino è di chi pubblica quest'album (A-1); la richiesta di ritiro
      // in attesa, di chi l'ha chiesta (M-1b)
      const cestino = (await concesso("album-pubblica", { unita: a.unita }))
        ? await fotoNelCestino(a.slug)
        : null;
      const ritiro = (await leggiProposteInAttesa("album")).find((p) => p.chiave === a.slug);
      return (
        <ModificaAlbum
          album={a}
          percorso={percorso}
          puoPubblicare={pubblica}
          // i nomi dei ragazzi senza consenso li legge chi consulta l'elenco
          // iscritti: il social media manager carica le fotografie, non lo tiene
          consensi={
            (await livelloPer("iscritti-elenco")) === "nessuno"
              ? null
              : await consensiDellAlbum(scelto, a.anno, a.unita)
          }
          // in chiaro solo qui, dopo il controllo di ambito della riga sopra
          password={riservata ? null : passwordDellAlbum(scelto)}
          passwordRiservata={riservata}
          passwordProposta={sessione.r === "social" ? "" : proponiPasswordAlbum()}
          soloNascondere={soloNascondere}
          puoEliminare={puoEliminare}
          cestino={cestino}
          ritiroChiesto={ritiro ? motivoDelRitiro(ritiro.valore) : null}
        />
      );
    }
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Non trovato</span>
        <p>Quest’album non esiste, oppure è di un’unità che non gestite.</p>
        <Link href={percorso}>Torna all’elenco</Link>
      </div>
    );
  }

  return (
    <ElencoAlbum
      album={visibili}
      percorso={percorso}
      puoPubblicare={pubblica}
      unitaAmmesse={suo ? [mia] : TUTTE_LE_UNITA}
      senzaPassword={visibili
        .map((a) => a.slug)
        .filter((slug) => !conPassword.has(slug))}
      passwordProposta={sessione.r === "social" ? "" : proponiPasswordAlbum()}
      passwordAutomatica={sessione.r === "social"}
    />
  );
}

/**
 * Corpo della sezione «Documenti e archivio».
 *
 * Una pagina sola (`ArchivioDocumenti`): l'elenco dei gruppi — le «cartelle» del
 * codice — e dentro ciascuno i suoi documenti. `?cartella=` e `?doc=` restano
 * come modo di arrivarci già aperti: la coda di approvazione e i collegamenti
 * che i referenti si sono mandati continuano a funzionare.
 *
 * La modulistica non è di un'unità — moduli di iscrizione, quote e statuti
 * valgono per tutto il gruppo — quindi qui non c'è un filtro di ambito: la
 * sezione sta nel menu dei soli gestori e dello sviluppatore, e le azioni
 * ricontrollano il ruolo.
 */
async function GestioneDocumenti({
  percorso,
  scelto,
  cartella,
}: {
  percorso: string;
  scelto?: string;
  cartella?: string;
}) {
  const [documenti, cartelle] = await Promise.all([leggiDocumenti(), leggiCartelle()]);
  const { eDiPartenza } = await import("@/lib/cartelle-store");

  const dellaScelta = scelto ? documenti.find((d) => d.id === scelto) : undefined;
  const iniziale = dellaScelta?.categoria ?? cartella;

  // Perché un gruppo non si elimina, detto a chi preme il cestino. I gruppi con
  // dentro dei documenti lo scopre la schermata, che li conta.
  const motivi: Record<string, string> = {};
  for (const c of cartelle) {
    if (eDiPartenza(c.chiave)) {
      motivi[c.chiave] =
        "È uno dei gruppi con cui il sito è nato: il sito vi rimanda, quindi si rinomina ma " +
        "non si elimina. Finché è vuoto, in pagina non compare.";
    }
  }

  return (
    <ArchivioDocumenti
      // `key`: cambiando gruppo aperto dall'indirizzo la schermata riparte da lì
      key={`${iniziale ?? ""}|${scelto ?? ""}`}
      cartelle={cartelle}
      documenti={documenti}
      percorso={percorso}
      apriCartella={iniziale}
      apriDocumento={dellaScelta?.id}
      motiviNonEliminabili={motivi}
    />
  );
}

/**
 * Corpo della sezione «Documenti per i referenti», uguale per i tre ruoli.
 *
 * Una pagina sola, con la grafica di «Documenti e archivio» (`ArchivioDocumentiReferenti`):
 * le cartelle che si aprono e dentro i documenti. Chi può leggere scarica; chi
 * può caricare ha anche i comandi. Le due domande sono due righe della matrice,
 * e la seconda decide soltanto che cosa si **mostra**: ogni azione ricontrolla
 * da sé. `?cartella=` e `?doc=` aprono la pagina già su quella cartella o su
 * quel documento.
 */
async function DocumentiPerICapi({
  percorso,
  scelto,
  cartella,
}: {
  percorso: string;
  scelto?: string;
  cartella?: string;
}) {
  if ((await livelloPer("documenti-referenti-leggi")) === "nessuno") {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Permessi</span>
        <p>La matrice non concede a questo ruolo i documenti per i referenti.</p>
      </div>
    );
  }
  const puoCaricare = (await livelloPer("documenti-referenti-carica")) !== "nessuno";
  const store = await import("@/lib/documenti-referenti-store");
  const [cartelle, documenti] = await Promise.all([
    store.leggiCartelleReferenti(),
    store.tuttiDocumentiReferenti(),
  ]);
  const numero = (v?: string) => (v && /^\d{1,12}$/.test(v) ? Number(v) : undefined);

  const dellaScelta = documenti.find((d) => d.id === numero(scelto));
  const iniziale = dellaScelta?.cartellaId ?? numero(cartella);

  return (
    <ArchivioDocumentiReferenti
      // `key`: cambiando cartella aperta dall'indirizzo la schermata riparte da lì
      key={`${iniziale ?? ""}|${dellaScelta?.id ?? ""}`}
      cartelle={cartelle}
      documenti={documenti}
      percorso={percorso}
      puoCaricare={puoCaricare}
      apriCartella={iniziale}
      apriDocumento={dellaScelta?.id}
    />
  );
}

/**
 * Corpo della sezione «Testo di presentazione» del referente di unità.
 *
 * Un referente di unità governa **la propria** unità e nessun'altra: l'unità non si
 * scegli e non si passa nell'indirizzo, la porta la sessione. È lo stesso
 * disegno di «Album e foto», dove l'elenco è già filtrato — il filtro non è la
 * protezione, quella sta nelle azioni, ma mostrare sei unità di cui cinque
 * darebbero un rifiuto è un modo di far perdere tempo alle persone.
 */
async function SchedaDellaMiaUnita({ sessione }: { sessione: Sessione }) {
  const { unitaSalvataPerChiave, leggiProposte, personeInRevisione } = await import(
    "@/lib/unita-store"
  );
  const { livelloPer } = await import("@/lib/auth/contesto");
  const { righeDaUnita } = await import("@/lib/unita-contenuti");

  const mia = sessione.un as UnitaKey | undefined;
  if (!mia) {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Ambito</span>
        <p>
          Questo utente non ha un’unità assegnata, quindi non c’è una scheda da
          modificare. I gestori la impostano fra gli utenti.
        </p>
      </div>
    );
  }

  const unita = await unitaSalvataPerChiave(mia);
  if (!unita) {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Non trovata</span>
        <p>Quest’unità non è nell’anagrafica del sito.</p>
      </div>
    );
  }

  /*
   * Il livello arriva dalla matrice, non dal ruolo.
   *
   * `livelloPer` è la stessa `decidi()` che il cancello interroga, senza ambito:
   * qui serve a sapere se questa persona **pubblica o propone**, che è
   * l'informazione che il modulo dichiara. Prenderlo da `sessione.r` avrebbe
   * significato una seconda copia della regola, ed è esattamente il difetto che
   * la fase 5 del progetto è servita a togliere.
   */
  const livelloScheda = await livelloPer("unita-scheda");
  const livelloReferenti = await livelloPer("referenti");
  if (livelloScheda === "nessuno") {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Permessi</span>
        <p>La matrice non concede a questo ruolo la scheda dell’unità.</p>
      </div>
    );
  }

  const proposte = (await leggiProposte()).filter((p) => p.unita === mia);
  const inRevisione = (await personeInRevisione()).filter((p) => p.unita === mia);

  return (
    <>
      <SchedaUnita unita={unita} livello={livelloScheda} proposte={proposte} />
      {livelloReferenti !== "nessuno"
        ? (["responsabile", "staff", "storico"] as const).map((tipo) => (
            <PersoneUnita
              key={tipo}
              unita={mia}
              tipo={tipo}
              persone={righeDaUnita(unita, tipo)}
              livello={livelloReferenti}
              inRevisione={inRevisione.find((p) => p.tipo === tipo)?.proposte.length}
            />
          ))
        : null}
    </>
  );
}

/**
 * Corpo della sezione «Referenti» del gestore e dello sviluppatore.
 *
 * Tutti i referenti di tutte le unità in una pagina: un riquadro per persona, e in
 * cima a ogni unità il contatto che la pagina Contatti dà alle famiglie. I
 * testi dell'unità — motto, storia, ritrovo — non sono qui: stanno in «Unità».
 *
 * Il filtro per unità sta nell'indirizzo (`?u=u4,u5`): una vista filtrata
 * si condivide e si ritrova col tasto indietro. Una scelta vuota vale «tutte».
 */
async function ReferentiDelleUnita({
  percorso,
  scelta,
}: {
  percorso: string;
  scelta?: string;
}) {
  const { leggiUnita } = await import("@/lib/unita-store");
  const { livelloPer } = await import("@/lib/auth/contesto");

  const livelloReferenti = await livelloPer("referenti");
  if (livelloReferenti !== "completo") {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Permessi</span>
        <p>
          L’elenco dei referenti lo gestiscono i gestori. Un referente di unità propone il proprio
          elenco dalla sua scheda, «Testo di presentazione».
        </p>
      </div>
    );
  }

  const tutte = await leggiUnita();
  const inAttesaAltrove = await proposteAltrove("");
  const scelte = [...new Set((scelta ?? "").split(",").filter((k) => tutte.some((u) => u.chiave === k)))];

  const unita: UnitaReferenti[] = tutte.map((u) => {
    const b = fascia(u.fascia);
    return {
      chiave: u.chiave,
      nome: u.nome,
      colore: b.colore,
      sopra: b.inchiostro,
      contatto: { referente: u.referente, ruoloReferente: u.ruoloReferente, telefono: u.telefono },
      referenti: [
        ...u.responsabili.map(([nome, ruolo, periodo], indice) => ({
          tipo: "responsabile" as const,
          indice,
          nome,
          ruolo,
          periodo,
        })),
        ...u.staff.map(([nome, ruolo], indice) => ({
          tipo: "staff" as const,
          indice,
          nome,
          ruolo,
          periodo: "",
        })),
      ],
      inAttesa: inAttesaAltrove.has(u.chiave),
    };
  });

  return <ElencoReferenti unita={unita} scelte={scelte} percorso={percorso} />;
}

/**
 * Corpo della sezione «Circolari e liste materiale» del referente di unità.
 *
 * La stessa schermata di «Documenti e archivio», con l'elenco filtrato sulla
 * propria unità e l'unità fissa nel modulo. Il filtro **non** è la protezione —
 * quella è nelle azioni, che confrontano l'unità inviata con quella della
 * sessione — ma mostrare le circolari di un'altra unità, o i venticinque moduli
 * del gruppo, sarebbe un elenco di righe su cui si otterrebbe un rifiuto.
 *
 * Le circolari le pubblica il referente di unità, senza passare dalla coda: è la
 * decisione del 31 agosto 2026, e la ragione è che una lista materiale che
 * aspetta un'approvazione arriva dopo l'uscita.
 */
async function CircolariDellaMiaUnita({
  sessione,
  percorso,
  scelto,
}: {
  sessione: Sessione;
  percorso: string;
  scelto?: string;
}) {
  const { livelloPer } = await import("@/lib/auth/contesto");

  const mia = sessione.un as UnitaKey | undefined;
  if (!mia) {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Ambito</span>
        <p>
          Questo utente non ha un’unità assegnata, quindi non può avere circolari. I referenti
          gruppo la impostano fra gli utenti.
        </p>
      </div>
    );
  }

  /*
   * Se la matrice non concede `documenti`, la sezione lo dice invece di
   * mostrare un elenco vuoto.
   *
   * Il caso è reale e capiterà: su un'installazione già in esercizio la riga
   * `documenti` resta a «nessuno» finché un amministratore non la mette a
   * «limitato» dalla schermata «Permessi» — `allineaSeme` non tocca i livelli
   * esistenti, per non riaprire da sé permessi chiusi apposta. Un elenco vuoto
   * senza spiegazione manderebbe a cercare un guasto che non c'è.
   */
  if ((await livelloPer("documenti")) === "nessuno") {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Permessi</span>
        <p>
          La matrice non concede a questo ruolo i documenti. Le circolari d’unità si
          aprono mettendo la riga «Documenti e modulistica» su <strong>limitato</strong>
          {" "}per il referente di unità, nella schermata «Permessi» dello sviluppatore.
        </p>
      </div>
    );
  }

  const { documentiDiUnita } = await import("@/lib/documenti-store");
  const [mie, cartelle] = await Promise.all([documentiDiUnita(mia), leggiCartelle()]);

  if (scelto) {
    const d = mie.find((x) => x.id === scelto);
    if (d) {
      return (
        <ModificaDocumento
          documento={d}
          cartelle={cartelle}
          indietro={{ href: percorso, label: "Tutte le circolari" }}
        />
      );
    }
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Non trovato</span>
        <p>Questa circolare non esiste, oppure è di un’unità che non gestite.</p>
        <Link href={percorso}>Torna all’elenco</Link>
      </div>
    );
  }

  /*
   * La cartella delle circolari come la vede chi la usa: con il suo nome di
   * adesso, che il gestore può aver cambiato. Il ripiego c'è per un
   * database in cui la riga manchi, che la chiave esterna rende impossibile ma
   * che non deve diventare una schermata rotta.
   */
  const circolari = cartelle.find((c) => c.chiave === CARTELLA_CIRCOLARI) ?? {
    chiave: CARTELLA_CIRCOLARI,
    titolo: "Circolari e liste materiale",
    descrizione: "",
  };
  return (
    <VistaCartella
      cartella={circolari}
      documenti={mie}
      percorso={percorso}
      unitaFissa={{ chiave: mia, label: labelDiUnita(mia) }}
    />
  );
}

/**
 * Corpo della sezione «Unità» del gestore e dello sviluppatore.
 *
 * Una unità alla volta, scelta con le pastiglie in cima (`?u=u4`) — come in
 * «Referenti» — e la sua pagina divisa in riquadri con un nome ciascuno: identità,
 * ritrovo, presentazione, fotografie, responsabili precedenti. Vedi
 * `components/area/PaginaUnita.tsx` per il perché.
 *
 * I referenti in carica e il contatto per le famiglie non sono qui: stanno in «Referenti».
 */
async function AnagraficaDelleUnita({
  percorso,
  scelta,
}: {
  percorso: string;
  scelta?: string;
}) {
  const { leggiUnita, leggiProposte, personeInRevisione } = await import("@/lib/unita-store");
  const { livelloPer } = await import("@/lib/auth/contesto");
  const { righeDaUnita } = await import("@/lib/unita-contenuti");
  const { slotDi } = await import("@/lib/slot-immagini");

  if ((await livelloPer("unita-anagrafica")) === "nessuno") {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Permessi</span>
        <p>
          Nome, logo e copertina di un’unità li cambia un gestore. La matrice
          non concede questa funzione a questo ruolo.
        </p>
      </div>
    );
  }

  const tutte = await leggiUnita();
  const scelto = tutte.find((u) => u.chiave === scelta) ?? tutte[0];
  const livelloScheda = await livelloPer("unita-scheda");
  const livelloReferenti = await livelloPer("referenti");
  const [proposte, inRevisione, copertine, immaginiProposte, caricate] = await Promise.all([
    leggiProposte(),
    personeInRevisione(),
    leggiProposteInAttesa("copertina"),
    leggiProposteInAttesa("immagine"),
    tutteLeImmagini(),
  ]);
  const conQualcosa = new Set([
    ...proposte.map((p) => p.unita as string),
    ...inRevisione.map((p) => p.unita as string),
    ...copertine.map((p) => p.chiave),
  ]);

  const posto = slotDi(`unita.${scelto.chiave}.archivio`);
  const archivio = posto ? (caricate.get(posto.chiave) ?? null) : null;
  const b = fascia(scelto.fascia);

  return (
    <>
      <div className="adm-filtri">
        <div className="adm-filtri__riga">
          <span className="adm-filtri__etichetta">Unità</span>
          {tutte.map((u) => (
            <Link
              key={u.chiave}
              className={
                u.chiave === scelto.chiave ? "adm-pillfiltro is-attivo" : "adm-pillfiltro"
              }
              href={`${percorso}?u=${u.chiave}`}
              aria-current={u.chiave === scelto.chiave ? "page" : undefined}
            >
              {u.nome}
              {conQualcosa.has(u.chiave) ? " ●" : ""}
            </Link>
          ))}
        </div>
      </div>

      <TestataUnita unita={scelto} colore={b.colore} />
      <IndiceUnita />

      {/* `key` su ogni riquadro: i campi usano `defaultValue`, che React legge solo
          al montaggio. Senza, passando da un'unità all'altra restano quelli di prima. */}
      <IdentitaUnita key={`${scelto.chiave}-identita`} unita={scelto} />

      {livelloScheda !== "nessuno" ? (
        <>
          <RiquadroCampi
            key={`${scelto.chiave}-ritrovo`}
            id="ritrovo"
            titolo="Ritrovo"
            nota="Dove e quando si trova l’unità, in una riga: compare nella sua scheda. È l’indirizzo a cui le famiglie portano i figli, quindi controllatelo a ogni cambio di sede o di orario."
            unita={scelto}
            campi={["ritrovo"]}
            etichettaSalva="Salva il ritrovo"
          />
          <RiquadroCampi
            key={`${scelto.chiave}-presentazione`}
            id="presentazione"
            titolo="Presentazione"
            nota="Quello che la pagina pubblica racconta dell’unità: la riga colorata in cima, il motto, l’anno di fondazione, il testo di presentazione e la storia. Niente nomi di ragazzi."
            unita={scelto}
            campi={["occhiello", "motto", "fondazione", "presentazione", "storiaTitolo", "storia"]}
            etichettaSalva="Salva la presentazione"
          />
        </>
      ) : null}

      <section id="fotografie" className="adm-unita__sezione">
        <h3>Fotografie</h3>
        <p className="adm-note">
          La <strong>copertina</strong> sta in cima alla pagina dell’unità; la{" "}
          <strong>fotografia d’archivio</strong> accanto alla sua storia. Le fotografie dei
          referenti sono in «Foto del sito».
        </p>
        <div className="adm-foto__griglia">
          <CopertinaScheda
            key={`${scelto.chiave}-copertina`}
            unita={scelto}
            proposta={inAttesaFoto(copertine.find((p) => p.chiave === scelto.chiave))}
          />
          {posto ? (
            <PostoFoto
              key={`${scelto.chiave}-archivio`}
              slot={posto}
              immagine={archivio}
              puoCaricare
              inCoda={false}
              proposta={inAttesaFoto(immaginiProposte.find((p) => p.chiave === posto.chiave))}
            />
          ) : null}
        </div>
      </section>

      <section id="precedenti" className="adm-unita__sezione">
        {livelloScheda !== "nessuno" ? (
          <RiquadroCampi
            key={`${scelto.chiave}-nota-storico`}
            id="nota-storico"
            titolo="Nota sotto lo storico"
            nota="Serve a spiegare i trattini: gli anni che l’archivio non registra non vanno dedotti."
            unita={scelto}
            campi={["notaStorico"]}
            etichettaSalva="Salva la nota"
          />
        ) : null}
        {livelloReferenti !== "nessuno" ? (
          <PersoneUnita
            key={`${scelto.chiave}-storico`}
            unita={scelto.chiave}
            tipo="storico"
            persone={righeDaUnita(scelto, "storico")}
            livello={livelloReferenti}
            inRevisione={inRevisione.find((p) => p.unita === scelto.chiave && p.tipo === "storico")?.proposte.length}
          />
        ) : null}
      </section>
    </>
  );
}

/**
 * Corpo della sezione «Backup e ripristino».
 *
 * Fra tutte le tabelle del prototipo, «Copie recenti» era la più pericolosa: un
 * modulo per **dichiarare** un backup che non è stato fatto, e un elenco di
 * copie inventate è esattamente ciò che si guarda il giorno in cui il disco si
 * rompe.
 */
function Backup() {
  return (
    <div className="adm-notice">
      <span className="adm-notice__tag">Da configurare</span>
      <p>
        <strong>Non c’è nessun backup automatico.</strong> Finché non c’è, un guasto del
        disco perde tutto: le fotografie, i consensi, il registro. È la prima delle cose
        aperte nell’audit del progetto, e non dipende dal codice.
      </p>
      <p>
        Serve un archivio fuori da questa macchina — nel piano sono <code>restic</code>{" "}
        per i file e Litestream per il database, verso un bucket — cioè credenziali che
        il repository non deve contenere. Le imposta chi amministra il server, una volta.
      </p>
      <p>
        Quello che va salvato è in due posti: il file del database e la cartella dei
        file caricati. La dimensione del primo si legge in{" "}
        <Link href="/area-riservata/sviluppatore/sistema">Stato del sistema</Link>.
      </p>
    </div>
  );
}

/**
 * Corpo della sezione «Stato del sistema»: tutti i controlli, l'ambiente e
 * l'inventario del database (§ components/area/StatoSistema.tsx).
 */
function Sistema() {
  return <StatoSistema />;
}

/**
 * Corpo della sezione «Testi delle pagine».
 *
 * Home e Chi siamo. La stessa schermata per il gestore e per lo
 * sviluppatore, che sulla riga `pagine` hanno lo stesso livello: non c'è
 * niente da differenziare, e due varianti della stessa cosa sono due posti in
 * cui divergere.
 */
async function TestiDelleDuePagine({ sessione }: { sessione: Sessione }) {
  const { livelloPer } = await import("@/lib/auth/contesto");
  const { leggiTestiPagine, campiPersonalizzati } = await import("@/lib/pagine-store");

  if ((await livelloPer("pagine")) === "nessuno") {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Permessi</span>
        <p>
          I testi delle pagine del sito li gestiscono i gestori. La matrice non
          concede questa funzione a questo ruolo.
        </p>
      </div>
    );
  }

  const { leggiFaq, faqDalCodice } = await import("@/lib/faq-store");
  const [valori, personalizzati, domande, dalCodice] = await Promise.all([
    leggiTestiPagine(),
    campiPersonalizzati(),
    leggiFaq(),
    faqDalCodice(),
  ]);

  // il social media manager propone: le caselle mostrano quello che è online, e
  // accanto quello che aspetta
  const inCoda = await propone(sessione, "pagine");
  const [testiInAttesa, faqInAttesa] = await Promise.all([
    leggiProposteInAttesa("pagina"),
    leggiProposteInAttesa("faq"),
  ]);

  return (
    <TestiPagine
      valori={valori}
      personalizzati={[...personalizzati]}
      inCoda={inCoda}
      inAttesa={Object.fromEntries(testiInAttesa.map((p) => [p.chiave, p.valore]))}
      /*
        Le FAQ stanno nella stessa sezione dei testi, e non in una sua: sono il
        testo della pagina Contatti, hanno la stessa riga di matrice e le
        modifica la stessa persona. Dentro la sezione sono una scheda a parte,
        con il suo modulo: una voce di menù in più per due schermate che si
        aprono sempre insieme è una voce di menù che si impara a saltare.
      */
      domande={
        <DomandeFrequenti
          // chi propone ritrova il suo elenco, non quello online: rimandare
          // quello online ritirerebbe la proposta (vedi il `Campo` di SchedaUnita)
          voci={(inCoda && faqProposte(faqInAttesa[0]?.valore)) || domande}
          dalCodice={dalCodice}
          inCoda={inCoda}
          inAttesa={faqInAttesa.length > 0}
        />
      }
    />
  );
}

/** Le domande frequenti di una proposta, o `null` se non c'è o non si legge. */
function faqProposte(valore: string | undefined): VoceFaq[] | null {
  if (!valore) return null;
  try {
    const voci = JSON.parse(valore) as unknown;
    return Array.isArray(voci) ? (voci as VoceFaq[]) : null;
  } catch {
    return null;
  }
}

/**
 * Corpo della sezione «Utenti».
 *
 * Una schermata per due ruoli, con due perimetri: lo sviluppatore tocca
 * qualunque account, il gestore i soli referenti di unità. La differenza non è
 * scritta qui — arriva da `livelloPer("utenti")`, che è la stessa `decidi()` che
 * l'azione interroga.
 *
 * `gestibile` per riga è **soltanto interfaccia**: serve a non mostrare un
 * pulsante che darebbe un rifiuto. Chi decide è `autorizzaSuUtente` in
 * `utenti/actions.ts`, che confronta il ruolo dell'account bersaglio con il
 * livello — e una richiesta costruita a mano trova quella, non questa riga.
 */
async function GestioneUtenti({ sessione }: { sessione: Sessione }) {
  const { livelloPer } = await import("@/lib/auth/contesto");
  const { elencoUtenti } = await import("@/lib/utenti");
  const { RUOLI_MATRICE } = await import("@/lib/permessi");

  const livello = await livelloPer("utenti");
  if (livello === "nessuno") {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Permessi</span>
        <p>
          Gli account li gestiscono i gestori e lo sviluppatore. La matrice non
          concede questa funzione a questo ruolo.
        </p>
      </div>
    );
  }

  const etichettaRuolo = (r: string) =>
    RUOLI_MATRICE.find((x) => x.chiave === r)?.label ?? r;

  const io = sessione.u.trim().toLowerCase();
  /*
   * Con «limitato» si vedono gli account che si gestiscono — referenti di unità e
   * social — più il proprio. Email e secondo fattore di gestori e
   * sviluppatori non servono a fare il ricambio di settembre (audit, M-7).
   */
  const visibili = elencoUtenti().filter(
    (u) =>
      livello === "completo" ||
      u.ruolo === "referente" ||
      u.ruolo === "social" ||
      u.utente === io,
  );
  const voci: VoceUtente[] = visibili.map((u): VoceUtente => ({
    id: u.id,
    utente: u.utente,
    nome: u.nome,
    iniziali: u.iniziali,
    ruolo: u.ruolo,
    ruoloLabel: etichettaRuolo(u.ruolo),
    ...(u.unita ? { unita: u.unita, unitaLabel: labelDiUnita(u.unita as UnitaKey) } : {}),
    ...(u.email ? { email: u.email } : {}),
    stato: u.stato,
    haPassword: u.haPassword,
    totpAttivo: u.totpAttivo,
    mfaRichiesto: u.mfaRichiesto,
    // con `limitato` si toccano i soli referenti di unità: è la stessa regola che
    // `autorizzaSuUtente` applica sul server
    // la stessa regola di `puoAgireSuRuolo`: con `limitato`, referenti di unità e
    // social media manager
    gestibile: livello === "completo" || u.ruolo === "referente" || u.ruolo === "social",
    sonoIo: u.utente === io,
  }));

  /*
   * I ruoli assegnabili, calcolati sul server.
   *
   * Con `limitato` la tendina ha una voce sola. Non è la protezione — quella è
   * nell'azione — ma tre voci di cui due producono un rifiuto sono un modo di
   * far sbagliare chi compila un modulo una volta all'anno.
   */
  const ruoliAmmessi =
    livello === "completo"
      ? // dal ruolo che si invita più spesso a quello che si invita una volta
        (["referente", "social", "gestore", "sviluppatore"] as const).map((chiave) => ({
          chiave,
          label:
            chiave === "social"
              ? "Social media manager"
              : (RUOLI_MATRICE.find((r) => r.chiave === chiave)?.label ?? chiave),
        }))
      : [
          { chiave: "referente", label: "Referente di unità" },
          { chiave: "social", label: "Social media manager" },
        ];

  return (
    <Utenti
      voci={voci}
      unita={TUTTE_LE_UNITA.filter((k) => k !== "gruppo").map((k) => ({
        chiave: k,
        label: labelDiUnita(k),
      }))}
      ruoliAmmessi={ruoliAmmessi}
      livello={livello}
    />
  );
}

/**
 * Quali unità hanno qualcosa in attesa: un puntino accanto al nome.
 *
 * Serve perché il selettore mostra sei nomi e la coda vive altrove: senza un
 * segno, un gestore che apre questa sezione non sa che l'unità 3 ha una
 * proposta pendente finché non ci clicca sopra.
 */
async function proposteAltrove(_scelta: string): Promise<Set<string>> {
  const { leggiProposte, personeInRevisione } = await import("@/lib/unita-store");
  const [campi, persone] = await Promise.all([leggiProposte(), personeInRevisione()]);
  return new Set([...campi.map((c) => c.unita), ...persone.map((p) => p.unita)]);
}

/**
 * Corpo della sezione «Log accessi e modifiche».
 *
 * I filtri stanno nell'indirizzo, non in uno stato del componente: un registro
 * filtrato è una cosa che si condivide («guarda che cosa ha fatto ieri») e che
 * si vuole ritrovare con il tasto indietro.
 */
async function Log({
  percorso,
  chi,
  che,
  quando,
  sviluppatore,
}: {
  percorso: string;
  chi?: string;
  che?: string;
  quando?: string;
  /** il ruolo vero di chi guarda: solo allo sviluppatore l'IP di ogni voce */
  sviluppatore: boolean;
}) {
  const tutte = await leggiRegistro({ conIndirizzi: sviluppatore });
  const adesso = Date.now();

  const giorni = [1, 7, 30].includes(Number(quando))
    ? Number(quando)
    : undefined;
  const filtri = { utente: chi, tipo: che, giorni };

  return (
    <>
      <IndicatoriRegistro voci={tutte} adesso={adesso} />
      <RegistroPieno
        voci={applicaFiltri(tutte, filtri, adesso)}
        totale={tutte.length}
        percorso={percorso}
        utenti={utentiNelRegistro(tutte)}
        filtri={filtri}
        conIndirizzi={sviluppatore}
      />
    </>
  );
}

/**
 * Corpo della coda di approvazione.
 *
 * Legge lo stato di album e documenti invece di tenere un elenco proprio: se la
 * coda avesse un archivio suo, prima o poi mostrerebbe cose già pubblicate.
 */
async function CodaApprovazioni() {
  const { voci, indicatori } = await vociDellaCoda({ vista: "chi-approva" });
  return (
    <>
      <IndicatoriCoda {...indicatori} />
      <Coda voci={voci} adesso={Date.now()} />
    </>
  );
}

/**
 * Corpo della sezione «In attesa di approvazione» del social media manager.
 *
 * La stessa coda del gestore, costruita dalla stessa funzione, **senza i
 * pulsanti** e senza i nomi dei consensi: chi propone vede che cosa aspetta, e
 * può ritirare una proposta delle sue prima che qualcuno debba rimandarla.
 */
async function InAttesa() {
  const { voci } = await vociDellaCoda({ vista: "chi-propone" });
  return <Coda voci={voci} adesso={Date.now()} soloLettura />;
}

/**
 * Se chi guarda, su questa riga, **propone** invece di pubblicare.
 *
 * È `vaInCoda` di `lib/auth/decisione.ts` con il livello letto dalla matrice:
 * la stessa domanda che si fanno le azioni, posta per dire al modulo che cosa
 * succederà al salvataggio. Chiederla al ruolo della sessione avrebbe fatto
 * mentire il modulo il giorno in cui la matrice cambia.
 */
async function propone(sessione: Sessione, azione: Azione): Promise<boolean> {
  const livello = await livelloPer(azione);
  return livello !== "nessuno" && vaInCoda(sessione.r, livello);
}

/**
 * Corpo della sezione «Testi delle unità» del social media manager.
 *
 * È «Referenti e recapiti» senza i referenti e senza i recapiti: la scheda dell'unità con
 * i soli testi, tutti in coda, e la fotografia di copertina, proposta anche lei.
 * L'unità si sceglie nell'indirizzo (`?u=u4`) come nelle schermate del referente
 * gruppo, per la stessa ragione: una scheda aperta si condivide e si ritrova
 * col tasto indietro.
 */
async function TestiDelleUnita({
  sessione,
  percorso,
  scelta,
}: {
  sessione: Sessione;
  percorso: string;
  scelta?: string;
}) {
  const { leggiUnita, leggiProposte } = await import("@/lib/unita-store");

  const livelloScheda = await livelloPer("unita-scheda");
  if (livelloScheda === "nessuno") {
    return (
      <div className="adm-notice">
        <span className="adm-notice__tag">Permessi</span>
        <p>La matrice non concede a questo ruolo i testi delle unità.</p>
      </div>
    );
  }

  const tutte = await leggiUnita();
  const scelto = tutte.find((u) => u.chiave === scelta) ?? tutte[0];
  const [tutteLeProposte, copertine] = await Promise.all([
    leggiProposte(),
    leggiProposteInAttesa("copertina"),
  ]);
  // Il filtro sta qui, sul server, e non solo nella scheda: quello che passa a
  // un componente client finisce nel payload RSC anche se non si disegna. Le
  // proposte di telefono e nomi dei referenti non sono del social (QA VULN-001).
  const { CAMPI_DEI_CONTENUTI } = await import("@/lib/unita-contenuti");
  const campiVisibili = new Set<string>(CAMPI_DEI_CONTENUTI);
  const proposte =
    livelloScheda === "completo"
      ? tutteLeProposte
      : tutteLeProposte.filter((p) => campiVisibili.has(p.campo));
  const conQualcosa = new Set([
    ...proposte.map((p) => p.unita as string),
    ...copertine.map((p) => p.chiave),
  ]);
  const livelloCopertina = await livelloPer("unita-anagrafica");
  const { slotDi } = await import("@/lib/slot-immagini");
  const postoArchivio = slotDi(`unita.${scelto.chiave}.archivio`);

  return (
    <>
      {/* le pastiglie dei filtri, come in «Referenti e recapiti» */}
      <div className="adm-filtri">
        <div className="adm-filtri__riga">
          <span className="adm-filtri__etichetta">Unità</span>
          {tutte.map((u) => (
            <Link
              key={u.chiave}
              className={
                u.chiave === scelto.chiave ? "adm-pillfiltro is-attivo" : "adm-pillfiltro"
              }
              href={`${percorso}?u=${u.chiave}`}
              aria-current={u.chiave === scelto.chiave ? "page" : undefined}
            >
              {u.nome}
              {conQualcosa.has(u.chiave) ? " ●" : ""}
            </Link>
          ))}
        </div>
      </div>

      {/* `key`: vedi la scheda in `ReferentiDelleUnita` */}
      <SchedaUnita
        key={scelto.chiave}
        unita={scelto}
        livello={livelloScheda}
        proposte={proposte.filter((p) => p.unita === scelto.chiave)}
        inCoda={vaInCoda(sessione.r, livelloScheda)}
      />
      {livelloCopertina !== "nessuno" ? (
        <CopertinaUnita
          key={`${scelto.chiave}-copertina`}
          unita={scelto}
          inCoda={vaInCoda(sessione.r, livelloCopertina)}
          soloNascondere={nascondeSoltanto(sessione.r, livelloCopertina)}
          proposta={inAttesaFoto(copertine.find((p) => p.chiave === scelto.chiave))}
        />
      ) : null}
      {/* la fotografia d'archivio dell'unità: sta qui, con la copertina, e non più
          fra le foto del sito */}
      {postoArchivio ? (
        <div className="adm-foto__griglia">
          <PostoFoto
            key={`${scelto.chiave}-archivio`}
            slot={postoArchivio}
            immagine={(await tutteLeImmagini()).get(postoArchivio.chiave) ?? null}
            puoCaricare
            inCoda={vaInCoda(sessione.r, livelloScheda)}
            soloNascondere={nascondeSoltanto(sessione.r, livelloScheda)}
            proposta={inAttesaFoto(
              (await leggiProposteInAttesa("immagine")).find((p) => p.chiave === postoArchivio.chiave),
            )}
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * Corpo della sezione «Messaggi dal sito».
 *
 * Legge e basta: chi può aprire questa pagina lo decidono il middleware e la
 * matrice, e le due azioni che scrivono ripassano comunque dal cancello.
 *
 * L'etichetta del motivo si traduce qui e non nel componente: `MOTIVI_CONTATTO`
 * è la stessa tabella che il modulo pubblico usa per costruire il menù a
 * tendina, e tenerla da un lato solo evita che le due schermate chiamino la
 * stessa cosa in due modi.
 */
async function PostaDalSito({ sessione }: { sessione: Sessione }) {
  // per l'amministratore è una lettura eccezionale: prima il motivo (audit, M-8)
  if (!(await eccezioneAperta(sessione, "messaggi"))) {
    return <AccessoEccezionale cosa="messaggi" descrizione={COSE_ECCEZIONALI.messaggi} />;
  }
  const { elenco } = await import("@/lib/messaggi-store");
  const { MOTIVI_CONTATTO } = await import("@/lib/data");

  const voci: VoceMessaggio[] = elenco().map((m) => ({
    id: m.id,
    quando: m.quando,
    nome: m.nome,
    email: m.email,
    telefono: m.telefono,
    motivo: m.motivo,
    motivoLabel: MOTIVI_CONTATTO.find((x) => x.chiave === m.motivo)?.label ?? m.motivo,
    messaggio: m.messaggio,
    stato: m.stato,
  }));

  return <Messaggi voci={voci} adesso={Date.now()} avvisiAttivi={postaConfigurata()} />;
}

/**
 * Corpo delle sezioni «Attività» (referente di unità) e «Calendario attività» (referente
 * gruppo).
 *
 * Sono la stessa schermata con due nomi, perché sono la stessa cosa vista da due
 * ambiti diversi: un referente di unità governa le proprie attività, un gestore
 * tutte. Il filtro qui **non** è la protezione — quella sta nelle azioni, che
 * ripassano dal cancello — ma evita di mostrare a un referente di unità righe su cui
 * otterrebbe un rifiuto.
 */
async function Calendario({
  sessione,
  percorso,
  scelta,
  unitaScelte,
  passate,
}: {
  sessione: Sessione;
  percorso: string;
  scelta?: string;
  /** il filtro per unità, dall'indirizzo: «u1,u4» */
  unitaScelte?: string;
  passate: boolean;
}) {
  const { attivitaDiUnita, leggiAttivita } = await import("@/lib/attivita-store");
  const { isoDaEvento } = await import("@/lib/attivita-store");
  const { campiAttivitaDa } = await import("@/lib/attivita");

  const ctx = await concesso("attivita");
  if (!ctx) notFound();
  /*
   * Tutte quelle dell'ambito. Il social media manager, dal 4 al 6 ottobre 2026,
   * vedeva solo quelle che aveva creato; adesso tiene aggiornato il calendario
   * per tutti, e le sue modifiche alle attività pubblicate aspettano i referenti
   * gruppo (`propone`, e le proposte in `inAttesa`).
   */
  const mie =
    sessione.r === "referente" && sessione.un
      ? await attivitaDiUnita(sessione.un as UnitaKey)
      : await leggiAttivita();
  const propone = vaInCoda(ctx.sessione.r, ctx.livello);
  const proposte = new Map(
    (await leggiProposteInAttesa("attivita")).map((p) => {
      const r = JSON.parse(p.valore) as { azione?: string; campi?: unknown };
      return [Number(p.chiave), r] as const;
    }),
  );
  const inAttesa: Record<number, "modifica" | "elimina" | "ritira"> = {};
  for (const [id, r] of proposte) {
    if (r.azione === "modifica" || r.azione === "elimina" || r.azione === "ritira") {
      inAttesa[id] = r.azione;
    }
  }

  const unita: UnitaSceglibile[] = TUTTE_LE_UNITA.map((k) => ({
    chiave: k,
    label: labelDiUnita(k),
    colore: fascia(FILTRI_UNITA.find((f) => f.chiave === k)?.fascia ?? "gruppo").colore,
  }));
  // Il filtro dall'indirizzo si ripulisce: solo chiavi d'unità vere, senza doppioni.
  const scelte = [...new Set((unitaScelte ?? "").split(",").filter((k) => TUTTE_LE_UNITA.includes(k as UnitaKey)))];

  /*
   * Un referente di unità non sceglie l'ambito: è sempre la sua.
   *
   * Le azioni lo rifiuterebbero comunque — `ambitoDi` in `attivita/actions.ts`
   * spiega perché un'attività di due unità non è di nessuna delle due — ma
   * mostrare sei caselle di cui cinque producono un rifiuto è un modo di far
   * perdere tempo alle persone.
   */
  const soloLaMia =
    sessione.r === "referente" && sessione.un
      ? unita.find((u) => u.chiave === sessione.un)
      : undefined;

  const inVoce = (a: Awaited<ReturnType<typeof leggiAttivita>>[number]): VoceAttivita => ({
    id: a.id,
    titolo: a.titolo,
    data: isoDaEvento(a.giorno, a.mese, a.anno) ?? "",
    dataTesto: `${a.giorno} ${a.mese.slice(0, 3).toLowerCase()} ${a.anno}`,
    dow: a.dow,
    tipo: a.tipoChiave,
    unita: a.unita,
    nota: a.nota,
    luogo: a.luogo,
    durata: a.durata,
    stato: a.stato,
    annoSociale: a.anno_sociale,
  });

  const scelto = scelta ? mie.find((a) => String(a.id) === scelta) : undefined;
  if (scelto) {
    const voce = inVoce(scelto);
    /*
     * Chi propone riprende dalla sua proposta, non dalla versione online:
     * salvando di nuovo la sostituisce, e ripartire da quella pubblicata gli
     * farebbe perdere le modifiche che aspettano.
     */
    const proposta = proposte.get(scelto.id);
    const campi =
      propone && proposta?.azione === "modifica"
        ? campiAttivitaDa(proposta.campi, TUTTE_LE_UNITA)
        : null;
    return (
      <ModificaAttivita
        voce={campi ? { ...voce, ...campi, unita: campi.unita } : voce}
        percorso={percorso}
        unita={unita}
        soloLaMia={soloLaMia}
        propone={propone}
        inAttesa={inAttesa[scelto.id]}
      />
    );
  }

  return (
    <ElencoAttivita
      voci={mie.map(inVoce)}
      inAttesa={inAttesa}
      percorso={percorso}
      unita={unita}
      soloLaMia={soloLaMia}
      scelte={scelte}
      passate={passate}
      oggi={new Date().toISOString().slice(0, 10)}
    />
  );
}

/**
 * Corpo della sezione «Elenco iscritti».
 *
 * ## Perché aprire questa pagina lascia una riga nel registro
 *
 * La schermata lo dichiara alle famiglie e ai referenti: «ogni accesso a questo
 * elenco è registrato nel log». È l'unico posto del sito dove **leggere** è
 * un'operazione da tracciare, perché quello che si legge sono nomi e date di
 * nascita di minori, e §14 del piano vuole poter rispondere alla domanda «chi
 * ha visto questo elenco, e quando».
 *
 * È una scrittura dentro una richiesta di lettura, che di regola qui si evita.
 * Due limiti da conoscere, invece di lasciarli scoprire:
 *
 *  - Next **precarica** i collegamenti, quindi passare col mouse sopra la voce
 *    di menù può produrre una riga di accesso che nessuno ha voluto. Meglio un
 *    accesso in più che uno mancante, ma chi legge il registro deve saperlo;
 *  - se la scrittura fallisce, la pagina si mostra lo stesso. Un elenco che non
 *    si apre perché il registro non risponde sarebbe un guasto peggiore del
 *    problema che risolve — e l'errore finisce nel registro del server.
 */
async function ElencoIscritti({ sessione }: { sessione: Sessione }) {
  const store = await import("@/lib/iscritti-store");
  const { ANNI_DOC } = await import("@/lib/data");
  const { registra } = await import("@/lib/registro-store");

  /*
   * L'ambito viene dalla matrice: con `limitato` sulla riga di consultazione si
   * vede la propria unità. Era `sessione.r === "referente"`, scritto sul ruolo
   * — e una matrice che dice una cosa mentre la pagina ne fa un'altra è il
   * difetto che la fase 5 aveva tolto dalle scritture (audit, M-2).
   */
  const livelloElenco = await livelloPer("iscritti-elenco");
  const suaUnita =
    livelloElenco === "limitato" ? ((sessione.un ?? "") as UnitaKey) : undefined;
  const annoCorrente = ANNI_DOC.find((a) => a.corrente)?.chiave ?? ANNI_DOC[0].chiave;

  // per l'amministratore è una lettura eccezionale: prima il motivo, poi i nomi
  if (!(await eccezioneAperta(sessione, "iscritti"))) {
    return <AccessoEccezionale cosa="iscritti" descrizione={COSE_ECCEZIONALI.iscritti} />;
  }

  const voci: VoceIscritto[] = store
    .elencoIscritti({ unita: suaUnita, anno: annoCorrente })
    .map((i) => ({
      id: i.id,
      ragazzoId: i.ragazzoId,
      nome: i.nome,
      cognome: i.cognome,
      eta: i.eta,
      unita: i.unita,
      unitaLabel: labelDiUnita(i.unita),
      anno: i.anno,
      gruppoInterno: i.gruppoInterno,
      quota: i.quota,
      quotaLabel: store.ETICHETTA_QUOTA[i.quota],
      consenso: i.consenso,
      consensoData: i.consensoData,
      consensoModulo: i.consensoModulo,
      verifica: i.verifica,
      verificatoIl: i.verificatoIl,
    }));

  await registra(
    sessione,
    "iscritti",
    `Aperto l’elenco iscritti${suaUnita ? ` di ${labelDiUnita(suaUnita)}` : ""} ` +
      `(${voci.length} ${voci.length === 1 ? "nome" : "nomi"})`,
    "iscritti",
  );

  // Le richieste GDPR si leggono solo se si può eseguire la cancellazione: una
  // prop di un componente client finisce nel payload RSC anche quando il JSX
  // non la mostra (report QA, BUG-005).
  const puoCancellare = (await livelloPer("gdpr")) === "completo";
  const richiesteCancellazione = puoCancellare ? await richiesteDiCancellazione(sessione) : [];

  return (
    <Iscritti
      voci={voci}
      unita={TUTTE_LE_UNITA.map((k) => ({ chiave: k, label: labelDiUnita(k) }))}
      anni={ANNI_DOC.map((a) => a.chiave)}
      quote={store.QUOTE.map((q) => ({ valore: q, label: store.ETICHETTA_QUOTA[q] }))}
      annoCorrente={annoCorrente}
      unitaFissa={
        suaUnita ? { chiave: suaUnita, label: labelDiUnita(suaUnita) } : undefined
      }
      // consultare non è registrare: il gestore legge l'elenco, i consensi li
      // attesta il referente di unità (riga `iscritti`, audit SoD-1)
      soloLettura={(await livelloPer("iscritti")) === "nessuno"}
      puoCancellare={puoCancellare}
      richiesteCancellazione={richiesteCancellazione}
    />
  );
}

/**
 * Le richieste di cancellazione che questa persona può eseguire: aperte, e
 * aperte da **qualcun altro**. È la doppia firma della riga `gdpr` (audit degli
 * accessi, SoD-3): chi registra la richiesta della famiglia non è chi cancella.
 */
async function richiesteDiCancellazione(
  sessione: Sessione,
): Promise<{ id: number; etichetta: string }[]> {
  const gdpr = await import("@/lib/gdpr-store");
  return gdpr
    .elenco(true)
    .filter((r) => r.diritto === "cancellazione" && r.apertaDa !== sessione.u)
    .map((r) => ({
      id: r.id,
      etichetta: `#${r.id} del ${r.arrivataIl.slice(0, 10)}, aperta da ${r.apertaDa ?? "?"}: ${
        r.descrizione.length > 60 ? `${r.descrizione.slice(0, 59)}…` : r.descrizione
      }`,
    }));
}

/**
 * I consensi che riguardano un album: chi blocca, e chi è già dichiarato assente.
 *
 * `verificabile: false` quando per quell'unità e quell'anno non c'è nessun
 * iscritto registrato. Non è «tutti a posto»: è che il sito non ha niente su cui
 * basarsi, e in quel caso il trigger lascia passare tutto. La schermata lo dice.
 */
async function consensiDellAlbum(slug: string, anno: string, unita: string): Promise<Consensi> {
  const { assenzeDi, bloccantiPer } = await import("@/lib/iscritti-store");
  const { displayInEtichetta } = await import("@/lib/db/mappa");
  const { idAlbumPerIndirizzo } = await import("@/lib/album");

  const etichetta = displayInEtichetta(anno);
  const id = await idAlbumPerIndirizzo(slug);
  if (!etichetta || id === null) return { bloccanti: [], assenze: [], verificabile: false };

  const chiave = unita === "gruppo" ? undefined : (unita as UnitaKey);
  const bloccanti = bloccantiPer(id, etichetta, chiave);

  return {
    verificabile: bloccanti !== null,
    bloccanti: (bloccanti ?? []).map((i) => ({
      iscrizioneId: i.id,
      nome: `${i.cognome} ${i.nome}`,
    })),
    assenze: assenzeDi(id).map((a) => ({
      iscrizioneId: a.iscrizioneId,
      nome: `${a.cognome} ${a.nome}`,
      da: a.dichiarataDa,
      il: a.dichiarataIl,
    })),
  };
}

/**
 * Corpo della sezione «Privacy e consensi» — §15 del piano.
 *
 * Legge e basta: le tre azioni che scrivono passano da `contesto("gdpr")`, che è
 * del solo sviluppatore. Il controllo di conformità è la parte che vale la pena
 * guardare anche quando dice zero.
 */
async function PrivacyEConsensi({ sessione }: { sessione: Sessione }) {
  const gdpr = await import("@/lib/gdpr-store");
  const { albumNonConformi } = await import("@/lib/iscritti-store");
  const { leggiAlbum } = await import("@/lib/album");

  const richieste: VoceRichiesta[] = gdpr.elenco().map((r) => ({
    id: r.id,
    arrivataIl: r.arrivataIl.slice(0, 10),
    diritto: r.diritto,
    dirittoLabel: gdpr.ETICHETTA_DIRITTO[r.diritto] ?? r.diritto,
    descrizione: r.descrizione,
    stato: r.stato,
    statoLabel: gdpr.ETICHETTA_STATO[r.stato] ?? r.stato,
    chiusaIl: r.chiusaIl,
    apertaDa: r.apertaDa,
    giorni: r.giorni,
  }));

  /*
   * Il titolo dell'album, non solo l'indirizzo.
   *
   * `albumNonConformi` restituisce già il titolo dalla tabella, ma il seme —
   * quello che il sito usa quando la tabella è vuota — non passa da lì. Si
   * incrocia con l'elenco vero per non mostrare uno slug a chi deve capire di
   * quale album si parla.
   */
  const album = await leggiAlbum();
  const nonConformi: NonConforme[] = albumNonConformi().map((a) => ({
    slug: a.slug,
    titolo: album.find((x) => x.slug === a.slug)?.titolo ?? a.titolo,
    nomi: a.nomi,
  }));

  return (
    <>
      <Privacy
        richieste={richieste}
        diritti={gdpr.DIRITTI.map((d) => ({ chiave: d, label: gdpr.ETICHETTA_DIRITTO[d] }))}
        nonConformi={nonConformi}
        giorniLimite={gdpr.GIORNI_LIMITE}
        // togliere una riga dal registro delle richieste cancella una prova: resta
        // a chi ha la riga `gdpr`, non a chi le richieste le segue
        puoEliminare={(await livelloPer("gdpr")) === "completo"}
      />
      {(await livelloPer("consensi-verifica")) === "completo" ? (
        <VerificaACampione sessione={sessione} />
      ) : null}
    </>
  );
}

/**
 * Il riquadro della verifica a campione dei consensi (audit degli accessi,
 * I-1), sotto le richieste. Mostra nomi di minori, quindi: per lo sviluppatore
 * dopo l'accesso eccezionale, come l'elenco iscritti; per tutti, una riga di
 * registro quando il campione ha dei nomi.
 */
async function VerificaACampione({ sessione }: { sessione: Sessione }) {
  const { ANNI_DOC } = await import("@/lib/data");
  const { campioneDaVerificare, statoVerifiche } = await import("@/lib/iscritti-store");
  const { registra } = await import("@/lib/registro-store");

  if (!(await eccezioneAperta(sessione, "iscritti"))) {
    return <AccessoEccezionale cosa="iscritti" descrizione={COSE_ECCEZIONALI.iscritti} />;
  }

  const anno = ANNI_DOC.find((a) => a.corrente)?.chiave ?? ANNI_DOC[0].chiave;
  const campione = campioneDaVerificare(anno, sessione.u);
  const stato = statoVerifiche(anno);
  const giorno = (iso: string) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

  if (campione.length > 0 || stato.mancanti.length > 0) {
    await registra(
      sessione,
      "iscritti",
      `Aperta la verifica a campione dei consensi (${campione.length} da verificare, ` +
        `${stato.mancanti.length} ${stato.mancanti.length === 1 ? "modulo non trovato" : "moduli non trovati"})`,
      "privacy",
    );
  }

  return (
    <VerificaConsensi
      anno={anno.replace("-", " – ")}
      consensi={stato.consensi}
      verificati={stato.verificati}
      campione={campione.map((c) => ({
        id: c.id,
        nome: `${c.cognome} ${c.nome}`,
        unita: labelDiUnita(c.unita),
        firmatoIl: giorno(c.consensoData),
        modulo: c.consensoModulo,
      }))}
      mancanti={stato.mancanti.map((m) => ({
        id: m.id,
        nome: `${m.cognome} ${m.nome}`,
        unita: labelDiUnita(m.unita),
        quando: giorno(m.verificatoIl),
        da: m.verificatoDa,
      }))}
    />
  );
}

/**
 * Una proposta di fotografia come la leggono i riquadri: il file, o `null` per
 * togliere — e `mostra` se chiede di rimettere una fotografia nascosta.
 */
function inAttesaFoto(
  p: PropostaInAttesa | undefined,
): { file: string | null; mostra?: boolean } | undefined {
  return p ? { file: p.file, ...(chiedeDiMostrare(p) ? { mostra: true } : {}) } : undefined;
}

/** Le fotografie, su questa riga, questa sessione le nasconde soltanto? */
async function nasconde(sessione: Sessione, azione: Azione): Promise<boolean> {
  const livello = await livelloPer(azione);
  return livello !== "nessuno" && nascondeSoltanto(sessione.r, livello);
}
