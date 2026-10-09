/**
 * Controlli di configurazione all'avvio del server, e avvio della coda.
 *
 * `register()` lo chiama Next una volta sola, quando il processo parte. Serve
 * perché un guasto che si manifesta solo dopo l'accesso è il peggiore da
 * diagnosticare in produzione: meglio non partire affatto, e dire perché.
 *
 * Si controlla solo all'esercizio: in sviluppo `.env.local` c'è, e in fase di
 * compilazione le variabili di runtime non servono — un `next build` su una
 * macchina di integrazione non deve conoscere la configurazione di produzione.
 *
 * ## Che cosa NON si controlla più
 *
 * Fino alla fase 6 qui si pretendeva `SESSIONE_SEGRETO`, e senza quella il
 * processo non partiva. Firmava il cookie di sessione, quando la sessione *era*
 * il cookie; adesso il cookie porta un numero casuale e la sessione sta nella
 * tabella `sessioni`, quindi non c'è più niente da firmare. Il controllo è stato
 * tolto: pretendere una variabile che non fa più niente è peggio che non
 * controllare nulla, perché manda a cercare un guasto dove non c'è.
 *
 * Al suo posto si controlla il database, che è la cosa senza la quale adesso
 * non entra nessuno.
 */
export async function register() {
  // il codice gira anche sul runtime Edge (middleware), dove questi controlli
  // non hanno senso e `process` è una scorza
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // durante `next build` Next importa comunque questo file
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  /*
   * La coda riparte **in ogni ambiente**, i controlli di configurazione solo in
   * esercizio.
   *
   * Sono due cose diverse messe nella stessa funzione perché Next offre un
   * gancio solo. I controlli hanno senso solo in produzione — in sviluppo
   * `.env.local` c'è, e un `next build` su una macchina di integrazione non
   * deve conoscere la configurazione del server. La coda invece serve sempre:
   * chi lavora in sviluppo su una copia dei dati veri vuole vedere le
   * fotografie, e i lavori interrotti da un riavvio del server di sviluppo sono
   * più frequenti, non meno.
   */
  await riprendiLaCodaDelleFoto();

  if (process.env.NODE_ENV !== "production") return;

  const mancanti: string[] = [];

  /*
   * Il database deve rispondere. Senza, l'area riservata non fa entrare
   * nessuno — le sessioni, gli account e i permessi stanno tutti lì — mentre le
   * pagine pubbliche continuano a rispondere 200 sui contenuti del seme. È
   * esattamente il guasto a metà che questo controllo esiste per non lasciar
   * passare in silenzio.
   */
  const { databaseRisponde } = await import("@/lib/db/db");
  const { percorsoDb } = await import("@/lib/db/percorso");
  if (!databaseRisponde()) {
    mancanti.push(
      `il database non risponde — atteso in ${percorsoDb()}. ` +
        "Avete eseguito «npm run db:applica»?",
    );
  }

  // Non è un motivo per non partire, ma va detto: senza questa variabile la
  // cartella dei dati sta dentro il rilascio, e il rilascio successivo la
  // porterebbe via con sé — foto, documenti e registro compresi.
  if (!process.env.SITO_DATI_DIR) {
    console.warn(
      "Attenzione: SITO_DATI_DIR non è impostata. I dati scritti dal sito " +
        "(album, fotografie, documenti, registro) finiranno dentro la cartella " +
        "di rilascio e andranno persi al prossimo aggiornamento. Vedi §08.",
    );
  }

  /*
   * L'indirizzo pubblico: senza, non si parte.
   *
   * Era un avviso, e non bastava. Le tre conseguenze non sono equivalenti:
   * la sitemap vuota e le anteprime mancanti sono difetti, il terzo è una
   * porta. Senza questa variabile i rimandi dell'area riservata si compongono
   * dall'intestazione della richiesta, e chi manda un `Host` suo si fa
   * rispondere «l'accesso è su attaccante.example» — verificato dal vivo. Il
   * Caddy di §06 normalmente non instrada un dominio che non conosce, quindi
   * serve un proxy configurato male o la porta esposta: è un rischio
   * condizionato, non una vulnerabilità aperta. Ma il rimedio è **una riga
   * nell'unità systemd**, e un avviso in un registro che nessuno rilegge non
   * è un rimedio.
   *
   * Vale la stessa regola del database: meglio non partire affatto, e dire
   * perché, che partire in un modo che sembra funzionare. L'unico momento in
   * cui qualcuno guarda è il rilascio, ed è questo.
   */
  if (!process.env.SITO_BASE_URL) {
    mancanti.push(
      "SITO_BASE_URL non è impostata. Senza, i rimandi dell'area riservata " +
        "seguono l'intestazione della richiesta (chi manda un «Host» suo si fa " +
        "rimandare lì), la sitemap esce vuota e i collegamenti condivisi non " +
        "hanno anteprima.\n    Esempio:  SITO_BASE_URL=https://example.org\n" +
        "    Serve ANCHE all'ambiente di «next build»: i metadati di condivisione " +
        "entrano nelle pagine prerenderizzate lì, e un riavvio non li aggiunge.",
    );
  }

  /*
   * Account attivi senza password: in produzione hanno una sola origine.
   *
   * Non aprono niente — nessuna password li fa passare — ma la loro presenza
   * in un database di produzione vuol dire che qualcuno ci ha copiato dentro
   * un database di sviluppo, e quello è un fatto
   * da scoprire adesso e non fra sei mesi: insieme agli account può essere
   * arrivato dell'altro.
   *
   * Gli **invitati** non contano: sono senza password per costruzione, in
   * attesa che qualcuno consumi il collegamento.
   */
  const { contiInutilizzabili } = await import("@/lib/utenti");
  const inutili = contiInutilizzabili();
  if (inutili.length > 0) {
    mancanti.push(
      `${inutili.length} account risultano attivi ma non possono entrare ` +
        `(${inutili.map((u) => u.utente).join(", ")}): vengono ` +
        "da un database di sviluppo, e in produzione non devono esserci.\n" +
        "    Guardateli e toglieteli:  npm run db:conti",
    );
  }

  /*
   * La chiave dei segreti TOTP: senza, non si parte.
   *
   * Era facoltativa, per non bloccare un aggiornamento su chi non l'aveva
   * ancora impostata; ma senza di lei i secondi fattori stanno in chiaro nel
   * database, e una copia trafugata — anche solo un backup — se li porta via
   * funzionanti (audit di sicurezza, INFO-03). Impostarla non chiude fuori
   * nessuno: i segreti già in chiaro continuano a funzionare, e si cifrano la
   * prima volta che vengono rigenerati (`lib/auth/cifratura.ts`).
   */
  if (!process.env.SITO_TOTP_SEGRETO) {
    mancanti.push(
      "SITO_TOTP_SEGRETO non è impostata: i segreti del secondo fattore " +
        "resterebbero in chiaro nel database e nelle copie di sicurezza.\n" +
        "    Generatela una volta:  openssl rand -base64 48\n" +
        "    e mettetela in /etc/sito/ambiente. NON cambiatela dopo: i segreti " +
        "già cifrati non si aprirebbero più.",
    );
  }

  if (mancanti.length === 0) {
    await preparaCachePagine();
    dichiaraScaduteLePagine();
    return;
  }

  // Non `throw`: un'eccezione qui Next la trasforma in un errore di richiesta,
  // ed è di nuovo un 500 opaco. Si esce, con il motivo scritto per esteso nel
  // registro del servizio — è la prima cosa che si legge con `journalctl`.
  console.error(
    [
      "",
      "Configurazione incompleta: il server non parte.",
      ...mancanti.map((m) => `  · ${m}`),
      "",
      "Le variabili vanno nell'unità systemd (§06 del piano), oppure in",
      "web/.env.local per una prova locale. La forma è in web/.env.esempio.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/**
 * Rimette in moto la coda delle derivate, all'avvio del processo.
 *
 * Tre cose, in quest'ordine:
 *
 *  1. i lavori rimasti `in_corso` da un processo morto tornano in attesa —
 *     senza azzerare i tentativi, se no una fotografia che fa cadere il server
 *     lo farebbe cadere per sempre;
 *  2. le fotografie senza derivate entrano in coda. Sono quelle caricate prima
 *     della fase 7, che sul disco hanno ancora i loro metadati e che finché non
 *     vengono convertite escono così come sono (vedi `app/foto-file`);
 *  3. si parte.
 *
 * Nessuna delle tre deve poter impedire l'avvio: un guasto qui rende il sito
 * un po' più lento a mostrare le foto vecchie, non inutilizzabile. Per questo
 * l'intero blocco sta in un `try` che si limita a scrivere nel registro.
 */
async function riprendiLaCodaDelleFoto(): Promise<void> {
  try {
    const { accodaMancanti, avvia, riprendiInterrotti } = await import("@/lib/foto/coda");

    const ripresi = riprendiInterrotti();
    const nuovi = accodaMancanti();
    if (ripresi > 0) console.log(`coda foto: ${ripresi} lavori interrotti rimessi in attesa.`);
    if (nuovi > 0) {
      console.log(`coda foto: ${nuovi} fotografie senza derivate messe in coda.`);
    }
    avvia();
  } catch (e) {
    console.error("coda foto: non sono riuscito a farla ripartire all'avvio:", e);
  }
}

/**
 * Fa dichiarare scadute tutte le pagine pubbliche, appena il server risponde.
 *
 * Il perché sta in `lib/rigenera-avvio.ts`. `register()` gira prima che il
 * server ascolti, quindi si riprova ogni mezzo secondo per un minuto, senza
 * trattenere il processo (`unref`). Un fallimento non ferma niente: si scrive
 * nel registro, e le pagine restano quelle di prima finché non si risalva.
 */
function dichiaraScaduteLePagine(): void {
  void (async () => {
    const { INTESTAZIONE_GETTONE, nuovoGettone } = await import("@/lib/rigenera-avvio");
    const gettone = nuovoGettone();

    for (let tentativo = 0; tentativo < 120; tentativo++) {
      await new Promise((fatto) => setTimeout(fatto, 500).unref());
      // Next scrive l'indirizzo vero quando il server ascolta, porta compresa
      // se è stata scelta da riga di comando: prima, non c'è niente da chiamare
      const origine = process.env.__NEXT_PRIVATE_ORIGIN;
      if (!origine) continue;
      try {
        const r = await fetch(`${origine}/api/rigenera-avvio`, {
          method: "POST",
          headers: { [INTESTAZIONE_GETTONE]: gettone },
          cache: "no-store",
        });
        if (r.status !== 204) console.error(`rigenerazione all'avvio: risposta ${r.status}.`);
        return;
      } catch {
        // in ascolto da un istante: si riprova
      }
    }
    console.error("rigenerazione all'avvio: il server non ha risposto entro un minuto.");
  })();
}

/**
 * La cartella delle pagine rigenerate: c'è, e si può scrivere.
 *
 * `npm run cache-pagine` la collega ai dati (il perché sta lì). Qui si crea la
 * destinazione se manca — un ritorno a un rilascio precedente la ritroverebbe
 * tolta — e si tolgono quelle delle altre compilazioni: all'avvio le pagine si
 * dichiarano comunque tutte scadute, quindi non c'è niente da conservare.
 *
 * Se il collegamento non c'è e la cartella non si può scrivere, il sito
 * funziona lo stesso ma non tiene le pagine rigenerate: lo si dice nel
 * registro, perché è la cosa da cercare quando una pagina «torna indietro».
 */
async function preparaCachePagine(): Promise<void> {
  try {
    const { accessSync, constants, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync } =
      await import("node:fs");
    const { basename, dirname, join, resolve } = await import("node:path");

    const server = join(process.cwd(), process.env.SITO_DIST_DIR || ".next", "server");
    const collegamento = join(server, "route-cache");
    let collegato = false;
    try {
      collegato = lstatSync(collegamento).isSymbolicLink();
    } catch {
      // non c'è: Next la creerà, se può
    }

    if (collegato) {
      const destinazione = resolve(server, readlinkSync(collegamento));
      mkdirSync(destinazione, { recursive: true, mode: 0o700 });
      const madre = dirname(destinazione);
      for (const altra of readdirSync(madre)) {
        if (altra !== basename(destinazione)) {
          rmSync(join(madre, altra), { recursive: true, force: true });
        }
      }
      accessSync(destinazione, constants.W_OK);
      return;
    }
    accessSync(server, constants.W_OK);
  } catch (e) {
    console.warn(
      "Attenzione: le pagine rigenerate non si possono salvare su disco " +
        `(${e instanceof Error ? e.message : String(e)}). Al riavvio si rigenerano ` +
        "dal database, ma fino ad allora restano solo in memoria. Sul server: " +
        "«t4 npm run cache-pagine» dopo la compilazione.",
    );
  }
}
