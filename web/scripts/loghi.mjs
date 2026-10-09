/**
 * I loghi delle sei unità: segnaposto, generati da qui.
 *
 * Una sola cornice — tondo pieno nel colore della fascia, ghiera sottile — e
 * dentro lo stesso simbolo neutro per tutte e sei: un riquadro con una
 * montagna e un sole, il segno universale di «qui va un'immagine». Chi usa il
 * sito sostituisce `simbolo` con i propri disegni, oppure mette i propri PNG
 * in `public/assets/` con gli stessi nomi.
 *
 * - **Tela 240×240**, centro (120,120): la misura con cui i loghi stanno
 *   nell'HTML (`width={240}`).
 * - **PNG a 480 px**, il doppio della misura dichiarata, per gli schermi densi.
 * - I colori sono quelli delle fasce di `lib/data.ts`.
 *
 *   node scripts/loghi.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const QUI = dirname(fileURLToPath(import.meta.url));
const WEB = join(QUI, "..");

/** La tela, il tondo e la ghiera: le tre misure che non cambiano mai. */
const TELA = 240;
const RAGGIO_TONDO = 115;
const RAGGIO_GHIERA = 102;
const GHIERA = 5;

/** Il rendering finale, al doppio della misura dichiarata nell'HTML. */
const LATO_PNG = 480;

const FASCIA = {
  gialla: { tondo: "#ffcc00", ink: "#002144" },
  verde: { tondo: "#006633", ink: "#ffcc00" },
  rossa: { tondo: "#a5342c", ink: "#ffcc00" },
};

/** Il simbolo segnaposto: un riquadro con una montagna e un sole. */
function segnaposto(tondo, ink) {
  return `<g>
    <rect x="62" y="74" width="116" height="92" rx="10" fill="${ink}"/>
    <circle cx="146" cy="100" r="11" fill="${tondo}"/>
    <path d="M74,154 L106,112 L126,138 L138,124 L166,154 Z" fill="${tondo}"/>
  </g>`;
}

const LOGHI = [
  { nome: "logo-u1", fascia: "gialla" },
  { nome: "logo-u2", fascia: "gialla" },
  { nome: "logo-u3", fascia: "verde" },
  { nome: "logo-u4", fascia: "verde" },
  { nome: "logo-u5", fascia: "rossa" },
  { nome: "logo-u6", fascia: "rossa" },
].map((d) => ({ ...d, scala: 1, dy: 0, simbolo: (b) => segnaposto(b.tondo, b.ink) }));

/** La cornice comune, con dentro il simbolo messo in registro. */
function svg(d) {
  const b = d.colori ?? FASCIA[d.fascia];
  const registro = `translate(120,${120 + d.dy}) scale(${d.scala}) translate(-120,-120)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TELA} ${TELA}" width="${TELA}" height="${TELA}">
  <circle cx="120" cy="120" r="${RAGGIO_TONDO}" fill="${b.tondo}"/>
  <circle cx="120" cy="120" r="${RAGGIO_GHIERA}" fill="none" stroke="${b.ink}" stroke-width="${GHIERA}"/>
  <g transform="${registro}">
    ${d.simbolo(b)}
  </g>
</svg>
`;
}

const SORGENTI = join(WEB, "loghi");
const USCITE = [join(WEB, "public", "assets")];

await mkdir(SORGENTI, { recursive: true });

for (const d of LOGHI) {
  const testo = svg(d);
  await writeFile(join(SORGENTI, `${d.nome}.svg`), testo, "utf8");
  const png = await sharp(Buffer.from(testo), { density: 600 })
    .resize(LATO_PNG, LATO_PNG)
    .png({ compressionLevel: 9 })
    .toBuffer();
  for (const cartella of USCITE) await writeFile(join(cartella, `${d.nome}.png`), png);
  console.log(`  · ${d.nome}  (${(png.length / 1024).toFixed(1)} KB)`);
}

console.log(`\n${LOGHI.length} loghi: sorgenti in web/loghi/, PNG a ${LATO_PNG} px.`);
