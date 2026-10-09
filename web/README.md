# Sito di un gruppo organizzato in unità — `web/`

Il sito pubblico e l'area riservata, in un'unica applicazione **Next.js 16**
(React 19, webpack) con un database **SQLite** (better-sqlite3 + Drizzle).

I contenuti sono segnaposto («Label» e Lorem ipsum). Si sostituiscono
in `lib/data.ts` (il seme del database) e poi, a sito avviato, dall'area
riservata.

## Avvio

Serve **Node 22** (`engines` in `package.json`). Da `web/`:

```bash
npm ci
```

```bash
cp .env.esempio .env.local
```

```bash
npm run db:applica
```

```bash
npm run db:riferimenti
```

```bash
npm run dev
```

Poi si apre <http://localhost:3000>. `db:applica` crea il database in `dati/`
(fuori da git) e applica le migrazioni di `drizzle/`; `db:riferimenti` ci
semina le sei unità, gli anni sociali e le domande frequenti di `lib/data.ts`. Va
eseguito una volta sola.

Per entrare nell'area riservata serve un primo account: vedi
[più sotto](#laccesso-allarea-riservata).

### Gli altri comandi

Tutti da `web/`:

| | |
| --- | --- |
| `npm run dev` | sviluppo su :3000, ricarica a caldo |
| `npm run build` | compilazione + confezionamento standalone |
| `npm start` | esercizio, come in produzione (dopo `npm run build`) |
| `npm run lint` | eslint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | le prove, con il test runner di Node |
| `npm run verifica` | tipi, stile, prove e compilazione in fila, con un riepilogo |
| `npm run db:applica` | crea o aggiorna il database |
| `npm run db:invita` | crea un account e stampa il collegamento d'invito |
| `npm run db:copia` | copia di database e archivio, **verificata** |
| `npm run db:ripristina` | elenca le copie; con `--da … --conferma` ne rimette una |
| `npm run db:foto-sito` | mette le fotografie di `foto-originali/sito/` nei riquadri delle pagine |
| `npm run db:importa-attivita` | carica un calendario da JSON (esempio in `scripts/attivita/`) |
| `npm run loghi` | ridisegna i sei loghi delle unità: SVG in `loghi/`, PNG in `public/assets/` |

Per usare una porta diversa: `npm run dev -- -p 3005`.

`dev` e `build` compilano con webpack (`--webpack`), non con Turbopack che da
Next 16 è il predefinito: il perché sta in `next.config.ts`, sopra la funzione
`webpack`. `npm start` avvia l'output `standalone`; non usate `next start`.

La configurazione — cartella dei dati, chiave del secondo fattore, indirizzo
pubblico, posta in uscita — è tutta in `.env.esempio`, commentata riga per riga.
In produzione `SITO_TOTP_SEGRETO` è **obbligatoria**: senza, il server non
parte.

## Le rotte

| Rotta | Che cosa è |
| --- | --- |
| `/` | la home |
| `/chi-siamo` | il gruppo, il metodo, i gestori |
| `/unita` | le sei unità, per fascia |
| `/unita/[slug]` | la pagina di un'unità, un unico modello per tutte |
| `/attivita` | il calendario, filtrabile per unità |
| `/foto` · `/foto/[album]` | gli album, protetti da password (spenti di predefinito) |
| `/documenti` · `/documenti/[cartella]` | la modulistica, per cartelle |
| `/contatti` | sede, recapiti e modulo contatti |
| `/legale/[slug]` | le informative del piede |
| `/legale/preferenze-cookie` | pannello con dei comandi, non un testo |
| `/manutenzione` | approdo dei documenti non ancora caricati |
| `/marchio/[file]` | serve il marchio caricato dai referenti |
| `/foto-file/[file]` | serve le fotografie degli album |
| `/documento/[file]` | serve i moduli caricati (`?scarica=1` li fa scendere) |
| `/area-riservata/accedi` | l'accesso, con secondo fattore |
| `/area-riservata/[ruolo]/[sezione]` | le viste dei quattro ruoli |
| `/area-riservata/esporta/[sezione]` | esportazione in CSV delle tabelle |
| `/robots.txt` · `/sitemap.xml` | calcolate a ogni richiesta, vuote senza `SITO_BASE_URL` |

Non c'è più nessun collegamento a `#` nel sito: le sole ancore rimaste sono
`#contenuto` (il salto al contenuto) e `#modulo-contatti` (il modulo in fondo
alla pagina Contatti), che puntano a due elementi che esistono davvero.

Gli indirizzi che non corrispondono a niente finiscono sulla 404 del sito,
`app/(sito)/[...sconosciuto]`: con **due** radici Next non accetta una
`app/not-found.tsx` globale — non avrebbe un layout in cui stare — e questa rotta
è il modo previsto per dargliene uno.

Le **pagine pubbliche sono prerenderizzate** in fase di compilazione: una visita
non sveglia il database. L'**area riservata è dinamica**: elenchi, consensi e
code di approvazione non devono mai essere serviti da un file salvato, e la
pagina dipende anche da chi è entrato.

## Come è organizzato

```
app/
  (sito)/          radice del sito pubblico: site.css, barra, piede
  (area)/          radice dell'area riservata: body.admin, admin.css, Tailwind
components/
  site/            i componenti del sito pubblico
  area/            guscio dell'area riservata e le sue schermate
lib/
  data.ts          contenuti di PARTENZA del sito
  data-area.ts     il guscio dell'area: quali sezioni ha un ruolo, e come si chiamano
  legale.ts        testi delle cinque informative del piede
  fonts.ts         i due caratteri (Archivo, IBM Plex Mono), serviti dal nostro dominio
  nav.ts           voci di menu e piede, e i collegamenti fuori dal sito
  db/              schema Drizzle, connessione, mappature, migrazioni
  auth/            sessioni, inviti, password, TOTP, e il cancello autorizzativo
  archivio.ts      lettura e scrittura dei file caricati — atomica (solo server)
  gruppo.ts        identità e recapiti del gruppo
  unita-store.ts   contenuti delle sei unità
  pagine-store.ts  i testi di Home e Chi siamo
  album.ts         album e fotografie
  documenti-store.ts  modulistica e circolari
  attivita-store.ts   il calendario
  iscritti-store.ts   iscritti e consensi
  messaggi-store.ts · gdpr-store.ts · registro-store.ts · permessi-store.ts
  utenti.ts        account, password e secondo fattore
proxy.ts           la guardia: nessuna rotta riservata può essere dimenticata
dati/              il database e i file caricati (fuori da git)

I moduli di `lib/` si dividono in due, ed è una divisione che il compilatore fa
rispettare: quelli che toccano il database importano `better-sqlite3` e quindi
non possono finire in un componente client nemmeno per sbaglio. Accanto a
ciascuno c'è un modulo di soli tipi e costanti — `identita.ts`, `contenuti.ts`,
`unita-contenuti.ts`, `pagine-contenuti.ts` — che invece il client può
importare, e che è anche il posto dove vivono i **cataloghi dei campi**: quali
sono modificabili, con che limiti, e quali passano da un'approvazione.
styles/
  site.css         il foglio di stile del sito pubblico
  admin.css        il foglio di stile dell'area riservata
  fonts.css        sostituisce la sorgente dei caratteri (3 variabili)
  area-routes.css  poche righe: voci di sezione e uscita come collegamenti
  tailwind.css     tema e utilità, per la sola area riservata
```

### Due radici, non una

`(sito)` e `(area)` sono due *root layout* distinti: servono un `<body>` diverso
e fogli di stile diversi. Il passaggio fra i due mondi è un caricamento pieno di
pagina, che è il comportamento voluto — sono due applicazioni che condividono la
tavolozza, e in mezzo c'è l'autenticazione.

### Dove entra Tailwind, e dove no

Il sito pubblico resta su `site.css`, Tailwind serve all'area riservata. In pratica, oggi:

- le tre schermate esistenti sono portate 1:1 con `admin.css`, perché il loro
  disegno **è già approvato** e riscriverlo in classi di utilità
  significherebbe soltanto rischiare di spostarlo;
- il tema Tailwind (`styles/tailwind.css`) contiene la tavolozza condivisa —
  navy, verde, giallo, rosso e i grigi dell'area riservata, con gli stessi
  valori di `site.css` — pronto per l'interfaccia **nuova**
  (finestre di caricamento, avanzamento upload, conferme): quella sì in
  Tailwind e Shadcn, perché non esiste ancora nel mockup;
- la **schermata di accesso** è la prima interfaccia nuova, e infatti è scritta
  in Tailwind con quei token: nel mockup non esisteva, quindi non c'era nulla da
  rispettare;
- `lib/utils.ts` esporta `cn`, che è ciò che i componenti Shadcn si aspettano
  di trovare: `npx shadcn add …` funziona senza altra configurazione.

Tailwind è importato **senza preflight**: il suo reset azzererebbe margini,
titoli e liste su cui `site.css` e `admin.css` contano.

## L'accesso all'area riservata

C'è, e funziona: `/area-riservata/*` passa da `proxy.ts` (il «middleware» fino
a Next 15), che vuole una
sessione valida. Il cookie è firmato con HMAC-SHA256, `httpOnly`, `SameSite=Lax`,
`Secure` in produzione, e porta l'impronta di una **riga di sessione nel
database**: revocarla butta fuori chi era dentro, subito. Le password sono
derivate con **argon2id**, e il secondo fattore TOTP c'è.

Passa da qui anche `/anteprima/*`, che sta fuori da
`/area-riservata` perché deve avere il layout del sito pubblico — ma è riservata
quanto una sezione dell'area, e la ragione per cui questa guardia esiste è che
nessuna rotta riservata si dimentichi.

Il **ruolo decide la vista**: un referente di unità non apre quella del gestore, e il
tentativo finisce con un rinvio alla propria. Solo lo
sviluppatore vede tutte e quattro, e quando guarda una vista non sua la barra lo
dichiara. I collegamenti alle altre viste compaiono solo a chi può usarli.

### Credenziali vere

Gli account stanno nel database, e si creano **dalla schermata**: «Utenti»
per lo sviluppatore e per il gestore — che invita e
revoca i soli referenti di unità e il social media manager. Lo sviluppatore decide anche, per ogni
account, se serve il secondo fattore (predefinito: sì). L'account nasce senza password; si entra la prima volta
dal collegamento d'invito, che vale settantadue ore e compare **una volta sola**.

Nel database c'è l'impronta del token, non il token: se il collegamento si perde,
si rifà — e quello di prima si annulla da sé.

Il collegamento si compone da `SITO_BASE_URL`. Senza quella variabile si
stampa il solo percorso, e chi amministra ci mette davanti il dominio a mano: è
voluto, perché comporre l'indirizzo dall'intestazione `Host` significa che chi
manda una richiesta con un dominio suo si fa stampare un invito che punta a lui.

Il primo account, quando il database è vuoto, si crea da riga di comando (in
sviluppo, con `SITO_BASE_URL=http://localhost:3000` in `.env.local` il
collegamento stampato si apre così com'è):

```bash
npm run db:invita -- ref1 referente "Ref1 — Nome Cognome" NC u1
```

Lo stesso comando rifà l'invito a chi c'è già.
