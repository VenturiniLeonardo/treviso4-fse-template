# Fotografie originali

Gli scatti come arrivano dai referenti, **prima** del taglio e della compressione.
Da qui si generano le versioni pubblicate: il taglio è una scelta, e tenere
l'originale permette di cambiarla senza richiedere la fotografia a chi l'aveva
mandata.

In questo repository la cartella è vuota: le immagini del sito sono segnaposto.
Ciascun gruppo ci mette le sue. Le immagini qui dentro sono **ignorate da git**
(`web/.gitignore`): per versionarne una bisogna forzarla con `git add -f`, e
farlo solo dopo i controlli qui sotto.

| File | Dove si vede | Come si rigenera |
| --- | --- | --- |
| `sito/home.jpg` | fotografia a tutta pagina dell'hero della home | `cd web && node scripts/foto-home.mjs` |
| `sito/*.jpg` | le schede di fascia della home e le copertine delle unità | `cd web && npm run db:foto-sito` (vedi `POSTI` in `scripts/foto-sito.mjs`) |

## Prima di aggiungere una fotografia

- **Guardatela a piena risoluzione.** Niente volti riconoscibili senza il
  consenso scritto delle famiglie — anche fuori dal ritaglio, perché
  l'originale resta nel repository e nella sua cronologia. Una faccia piccola
  nel riquadro è comunque una faccia.
- **Togliete i metadati.** Una fotografia scattata con il telefono porta
  nell'EXIF le coordinate del posto in cui è stata fatta. Gli script di
  `scripts/` pubblicano senza metadati, ma l'originale qui dentro li ha ancora
  se non li togliete prima.
- **Riducetela** a 2400 px di lato: di più non serve a nessun riquadro.
