# treviso4-fse-template

Sito pubblico e area riservata per un'organizzazione divisa in unità: pagine
del gruppo e delle unità, calendario delle attività, modulistica, album
fotografici protetti e un'area riservata per i referenti con ruoli,
approvazioni, registro delle operazioni e secondo fattore.

È il modello da cui è nato il sito del Gruppo Treviso 4 FSE:
[treviso4fse.it](https://treviso4fse.it). Qui c'è solo il codice, ripulito da
contenuti, nomi e dati del gruppo.

Tutti i contenuti sono **segnaposto**: «Label» per i testi brevi, Lorem ipsum
per quelli lunghi, e immagini neutre. Il sito è uno scheletro da riempire.

## Che cosa c'è

- **Sito pubblico** — home, chi siamo, le sei unità divise in tre fasce d'età,
  attività, documenti, contatti con
  modulo, pagine legali e preferenze cookie. Le pagine sono prerenderizzate.
- **Area riservata** — quattro ruoli (sviluppatore, gestore, referente di unità,
  social media manager) con permessi per funzione; i referenti modificano testi,
  foto, attività e documenti, e le modifiche di chi non può pubblicare passano
  da un'approvazione.
- **Sicurezza** — sessioni nel database, password argon2id, TOTP con segreto
  cifrato a riposo, limiti ai tentativi, Content Security Policy, registro
  delle operazioni.
- **Dati di minori** — iscritti e consensi, foto pubblicate solo con il
  consenso, esportazione e cancellazione per le richieste GDPR.

## Tecnologia

Next.js 16 (webpack) · React 19 · SQLite con better-sqlite3 e Drizzle ·
Tailwind solo nell'area riservata · Node 22.

## Avvio

Il codice sta in [`web/`](web/): istruzioni, comandi e struttura sono in
[`web/README.md`](web/README.md).

```bash
cd web
```

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

## Adattarlo a un gruppo

1. I dati del gruppo, le unità, i testi di partenza: `web/lib/data.ts`.
2. I collegamenti esterni e i social: `web/lib/nav.ts`.
3. Le pagine legali: `web/lib/legale.ts`. Sono solo Lorem ipsum: i testi veri
   (privacy, cookie, immagini dei minori…) vanno scritti e approvati da chi
   gestisce il sito prima della pubblicazione.
4. Le fotografie: `web/foto-originali/README.md`. Niente volti riconoscibili
   senza il consenso scritto delle famiglie.
5. Il marchio, i loghi delle unità e le immagini di `web/public/assets/`
   sono segnaposto (i loghi si rigenerano con `node scripts/loghi.mjs`).

Una volta avviato, quasi tutto si cambia dall'area riservata, senza toccare il
codice.

## Licenza

Il codice è distribuito con licenza [MIT](LICENSE).

La licenza **non** copre i nomi e i marchi dell'Associazione Italiana Guide e
Scouts d'Europa Cattolici (FSE), che appartengono ai rispettivi titolari e non
sono inclusi nel codice.
