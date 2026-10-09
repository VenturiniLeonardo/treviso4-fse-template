import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import sharp from "sharp";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * `lib/album.ts` su SQLite — passo 2B.5, l'ultimo store e il più intrecciato:
 * tre chiavi esterne e una tabella figlia.
 *
 * Le tre proprietà da non perdere, e sono tutte visibili a un visitatore:
 *
 *  - `anno` resta la forma **visualizzata** `2026 – 2027` (i documenti usano
 *    quella canonica: sono le due rappresentazioni del repository);
 *  - `unita` resta una `UnitaKey`, e `gruppo` significa `unita_id IS NULL`;
 *  - l'**ordine dentro l'anno**: i nuovi in testa. `Galleria.tsx` raggruppa
 *    per anno e conserva l'ordine che lo store gli dà.
 *
 * Il seme (`ALBUM` in `lib/data.ts`) è vuoto dal passaggio in produzione:
 * ogni prova crea da sé gli album che le servono.
 */

let cartella;
let cartellaDati;
let percorso;
let store;
let ALBUM;
let ErroreDatabase;
let chiudiPerTest;
let raw;

/**
 * Un PNG **vero**, non una firma con dentro il nulla.
 *
 * Fino alla fase 7 qui bastavano ventiquattro byte di intestazione fabbricati a
 * mano, perché `aggiungiFoto` leggeva le misure dall'intestazione e non apriva
 * l'immagine. Adesso la apre con `sharp`, e un'intestazione senza dati dentro
 * viene rifiutata — giustamente: era esattamente il file che passava il
 * controllo e poi non si vedeva nel browser.
 */
function png(larghezza, altezza) {
  return sharp({
    create: { width: larghezza, height: altezza, channels: 3, background: "#4a7d55" },
  })
    .png()
    .toBuffer();
}
const NON_IMMAGINE = Buffer.from("non sono un'immagine");

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-album-"));
  cartellaDati = join(cartella, "dati");
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = cartellaDati;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/album");
  ({ ALBUM } = await import("@/lib/data"));
  ({ ErroreDatabase } = await import("@/lib/db/errori"));
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

beforeEach(async () => {
  // Le derivate di una fotografia si scrivono in coda, dopo che `aggiungiFoto`
  // ha risposto: se una prova ne fotografa il disco mentre quelle della
  // precedente stanno ancora arrivando, trova file che non sono suoi.
  let ultimo = "";
  for (let giri = 0; giri < 40; giri++) {
    const adesso = fotoSuDisco().join("|");
    if (adesso === ultimo) break;
    ultimo = adesso;
    await new Promise((r) => setTimeout(r, 100));
  }
  raw.prepare("DELETE FROM foto").run();
  raw.prepare("DELETE FROM album").run();
  raw.prepare("DELETE FROM anni_sociali").run();
  raw.prepare("DELETE FROM unita").run();
});

const conteggio = () => raw.prepare("SELECT count(*) n FROM album").get().n;
const fotoSuDisco = () => {
  try {
    return readdirSync(cartellaDati).filter((f) => f.startsWith("foto-")).sort();
  } catch {
    return [];
  }
};
/**
 * Crea un album e ne restituisce lo slug. Il seme di `ALBUM` è vuoto: ogni
 * prova si costruisce i suoi album, e di solito le basta uno di gruppo.
 */
let progressivo = 0;
const nuovoAlbum = (campi = {}) =>
  store.creaAlbum(
    {
      titolo: `Album di prova ${++progressivo}`,
      anno: "2026 – 2027",
      unita: "gruppo",
      data: "Ottobre 2026",
      sottotitolo: "",
      tag: "",
      ...campi,
    },
    0,
    "",
  );

// --------------------------------------------------------------------------

describe("lettura", () => {
  it("il seme è vuoto: a tabella vuota non restituisce nessun album", async () => {
    assert.deepEqual(ALBUM, [], "nessun album dimostrativo va in produzione");
    assert.deepEqual(await store.leggiAlbum(), []);
  });

  it("leggere non scrive", async () => {
    await store.leggiAlbum();
    assert.equal(conteggio(), 0);
    assert.equal(raw.prepare("SELECT count(*) n FROM anni_sociali").get().n, 0);
  });

  it("un album creato si rilegge con i campi che ha ricevuto", async () => {
    const slug = await nuovoAlbum({
      titolo: "Uscita al Montello",
      anno: "2025 – 2026",
      unita: "u3",
      data: "Aprile 2026",
      sottotitolo: "Due giorni in tenda",
      tag: "uscita",
    });
    assert.equal(conteggio(), 1);

    const [t, ...altri] = await store.leggiAlbum();
    assert.deepEqual(altri, []);
    assert.equal(t.slug, slug);
    assert.equal(t.anno, "2025 – 2026", "anno in forma visualizzata");
    assert.equal(t.unita, "u3");
    assert.equal(t.titolo, "Uscita al Montello");
    assert.equal(t.data, "Aprile 2026");
    assert.equal(t.sottotitolo, "Due giorni in tenda");
    assert.equal(t.tag, "uscita");
    assert.equal(t.stato, "bozza");
    assert.equal(t.escluse, 0);
    assert.deepEqual(t.foto, []);
  });

  it("l'anno è nella forma visualizzata «2026 – 2027», con il trattino lungo", async () => {
    await nuovoAlbum({ anno: "2026 – 2027" });
    await nuovoAlbum({ anno: "2024 – 2025" });
    const anni = (await store.leggiAlbum()).map((a) => a.anno);
    assert.equal(anni.length, 2);
    for (const anno of anni) assert.match(anno, /^\d{4} – \d{4}$/, `anno inatteso: ${anno}`);
  });

  it("nel database l'anno è invece canonico", async () => {
    const slug = await nuovoAlbum({ anno: "2024 – 2025" });
    const etichette = raw.prepare("SELECT DISTINCT etichetta FROM anni_sociali").all();
    assert.ok(etichette.length > 0);
    for (const e of etichette) assert.match(e.etichetta, /^\d{4}-\d{4}$/);
    const suo = raw
      .prepare("SELECT s.etichetta FROM album a JOIN anni_sociali s ON s.id = a.anno_id WHERE a.slug=?")
      .get(slug);
    assert.equal(suo.etichetta, "2024-2025");
  });

  it("«gruppo» è unita_id NULL, non una settima unità", async () => {
    await nuovoAlbum({ unita: "gruppo" });
    await nuovoAlbum({ unita: "u1" });
    assert.equal(raw.prepare("SELECT count(*) n FROM unita").get().n, 6);
    assert.equal(raw.prepare("SELECT count(*) n FROM unita WHERE chiave='gruppo'").get().n, 0);

    const diGruppo = (await store.leggiAlbum()).filter((a) => a.unita === "gruppo");
    assert.equal(diGruppo.length, 1);
    const conNull = raw.prepare("SELECT count(*) n FROM album WHERE unita_id IS NULL").get().n;
    assert.equal(conNull, diGruppo.length);
  });

  it("gli anni vanno dal più recente, e dentro l'anno i più nuovi in testa: è ciò che il visitatore vede", async () => {
    const a = await nuovoAlbum({ anno: "2025 – 2026" });
    const b = await nuovoAlbum({ anno: "2026 – 2027" });
    const c = await nuovoAlbum({ anno: "2026 – 2027" });
    const d = await nuovoAlbum({ anno: "2025 – 2026" });
    assert.deepEqual((await store.leggiAlbum()).map((x) => x.slug), [c, b, d, a]);
  });

  it("un album creato dopo compare in testa al suo anno", async () => {
    await nuovoAlbum({ anno: "2026 – 2027" });
    await nuovoAlbum({ anno: "2026 – 2027" });
    const slug = await store.creaAlbum(
      { titolo: "Uscita di prova", anno: "2026 – 2027", unita: "u1", data: "Marzo 2027", sottotitolo: "", tag: "" },
      0,
      "",
    );
    const del2027 = (await store.leggiAlbum()).filter((a) => a.anno === "2026 – 2027");
    assert.equal(del2027.length, 3);
    assert.equal(del2027[0].slug, slug, "come faceva l'unshift del JSON");
  });

  it("l'ordine è stabile fra due letture", async () => {
    for (const anno of ["2026 – 2027", "2025 – 2026", "2026 – 2027"]) await nuovoAlbum({ anno });
    const a = (await store.leggiAlbum()).map((x) => x.slug);
    const b = (await store.leggiAlbum()).map((x) => x.slug);
    assert.equal(a.length, 3);
    assert.deepEqual(a, b);
  });

  it("albumPubblicati, albumPerIndirizzo e albumDiUnita", async () => {
    const pubblico = await nuovoAlbum({ unita: "gruppo" });
    const inBozza = await nuovoAlbum({ unita: "u1" });
    await store.cambiaStatoAlbum(pubblico, "pubblicato", 0, "");

    const pubblicati = await store.albumPubblicati();
    assert.deepEqual(pubblicati.map((a) => a.slug), [pubblico]);
    assert.ok(!pubblicati.some((a) => a.slug === inBozza), "una bozza non è pubblicata");

    assert.ok(await store.albumPerIndirizzo(pubblico));
    assert.ok(await store.albumPerIndirizzo(inBozza), "per indirizzo si trovano anche le bozze");
    assert.equal(await store.albumPerIndirizzo("mai-esistito"), undefined);

    assert.deepEqual((await store.albumDiUnita("gruppo")).map((a) => a.slug), [pubblico]);
    assert.deepEqual((await store.albumDiUnita("u1")).map((a) => a.slug), [inBozza]);
    assert.deepEqual(await store.albumDiUnita("u6"), []);
  });
});

describe("creaAlbum e indirizzoLibero", () => {
  it("nasce in bozza, con lo slug dal titolo", async () => {
    const slug = await store.creaAlbum(
      { titolo: "Campo estivo 2027", anno: "2026 – 2027", unita: "u3", data: "Luglio 2027", sottotitolo: "s", tag: "t" },
      0,
      "gestori",
    );
    assert.equal(slug, "campo-estivo-2027");
    const a = await store.albumPerIndirizzo(slug);
    assert.equal(a.stato, "bozza");
    assert.equal(a.unita, "u3");
    assert.ok(a.aggiornato > 0);
  });

  it("uno slug già preso riceve un numero", async () => {
    // La collisione si forza creando tre volte lo stesso titolo.
    const dati = { titolo: "Uscita ripetuta", anno: "2026 – 2027", unita: "u1", data: "x", sottotitolo: "", tag: "" };
    assert.equal(await store.creaAlbum(dati, 0, ""), "uscita-ripetuta");
    assert.equal(await store.creaAlbum(dati, 0, ""), "uscita-ripetuta-2");
    assert.equal(await store.creaAlbum(dati, 0, ""), "uscita-ripetuta-3");
  });

  it("un album di gruppo si crea con unita_id nullo", async () => {
    const slug = await store.creaAlbum(
      { titolo: "Festa di gruppo", anno: "2026 – 2027", unita: "gruppo", data: "x", sottotitolo: "", tag: "" },
      0,
      "",
    );
    assert.equal((await store.albumPerIndirizzo(slug)).unita, "gruppo");
    assert.equal(raw.prepare("SELECT unita_id FROM album WHERE slug=?").get(slug).unita_id, null);
  });
});

describe("aggiornaAlbum e cambiaStatoAlbum", () => {
  it("aggiorna i campi di testo e le foto escluse", async () => {
    const slug = await nuovoAlbum();
    assert.equal(
      await store.aggiornaAlbum(slug, { titolo: "Titolo nuovo", data: "Ottobre 2026", escluse: 3 }, 0, "gestori"),
      true,
    );
    const a = await store.albumPerIndirizzo(slug);
    assert.equal(a.titolo, "Titolo nuovo");
    assert.equal(a.data, "Ottobre 2026");
    assert.equal(a.escluse, 3);
    assert.equal(a.slug, slug, "lo slug non cambia con il titolo: è l'indirizzo pubblico");
  });

  it("cambiare unità sposta l'album, e «gruppo» azzera unita_id", async () => {
    const slug = await nuovoAlbum({ unita: "gruppo" });
    await store.aggiornaAlbum(slug, { unita: "u6" }, 0, "");
    assert.equal((await store.albumPerIndirizzo(slug)).unita, "u6");
    await store.aggiornaAlbum(slug, { unita: "gruppo" }, 0, "");
    assert.equal((await store.albumPerIndirizzo(slug)).unita, "gruppo");
    assert.equal(raw.prepare("SELECT unita_id FROM album WHERE slug=?").get(slug).unita_id, null);
  });

  it("i tre stati vanno e tornano, e in-revisione è in_revisione nel database", async () => {
    const slug = await nuovoAlbum();
    for (const stato of ["bozza", "in-revisione", "pubblicato"]) {
      assert.equal(await store.cambiaStatoAlbum(slug, stato, 0, "cg"), true);
      assert.equal((await store.albumPerIndirizzo(slug)).stato, stato);
    }
    await store.cambiaStatoAlbum(slug, "in-revisione", 0, "cg");
    assert.equal(raw.prepare("SELECT stato FROM album WHERE slug=?").get(slug).stato, "in_revisione");
  });

  it("su un album inesistente restituiscono false", async () => {
    await nuovoAlbum();
    assert.equal(await store.aggiornaAlbum("no", { titolo: "x" }, 0, ""), false);
    assert.equal(await store.cambiaStatoAlbum("no", "bozza", 0, ""), false);
  });

  it("`seUguale` vede l'album com'è nella transazione, e può fermare il cambio (BUG-011)", async () => {
    const { improntaDiRevisione } = await import("@/lib/impronta-revisione");
    const slug = await nuovoAlbum();
    await store.cambiaStatoAlbum(slug, "in-revisione", 0, "cg");
    const vista = improntaDiRevisione(await store.albumPerIndirizzo(slug));

    // modificato dopo che chi approva l'ha guardato: il cambio non avviene
    await store.aggiornaAlbum(slug, { titolo: "Cambiato nel frattempo" }, 0, "cu");
    const fermato = await store.cambiaStatoAlbum(slug, "pubblicato", 0, "cg", (a) =>
      improntaDiRevisione(a) === vista,
    );
    assert.equal(fermato, false);
    assert.equal((await store.albumPerIndirizzo(slug)).stato, "in-revisione");

    // la stessa lettura dentro e fuori dà la stessa impronta: senza modifiche passa
    const ora = improntaDiRevisione(await store.albumPerIndirizzo(slug));
    assert.equal(
      await store.cambiaStatoAlbum(slug, "pubblicato", 0, "cg", (a) => improntaDiRevisione(a) === ora),
      true,
    );
    assert.equal((await store.albumPerIndirizzo(slug)).stato, "pubblicato");
  });
});

describe("fotografie", () => {
  it("aggiungiFoto legge le misure, scrive il file e restituisce la Fotografia", async () => {
    const slug = await nuovoAlbum();
    const esito = await store.aggiungiFoto(slug, await png(800, 600), "  una didascalia  ", 1000, "gestori");

    assert.equal(esito.ok, true);
    assert.equal(esito.foto.tipo, "image/png");
    assert.equal(esito.foto.larghezza, 800);
    assert.equal(esito.foto.altezza, 600);
    assert.equal(esito.foto.didascalia, "una didascalia", "gli spazi si tolgono");
    assert.ok(fotoSuDisco().includes(esito.foto.file));

    const a = await store.albumPerIndirizzo(slug);
    assert.equal(a.foto.length, 1);
    assert.equal(a.foto[0].file, esito.foto.file);
  });

  it("rifiuta un file che non è un'immagine, senza scrivere sul disco", async () => {
    const prima = fotoSuDisco();
    const esito = await store.aggiungiFoto(await nuovoAlbum(), NON_IMMAGINE, "", 2000, "");
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /JPEG|PNG/);
    assert.deepEqual(fotoSuDisco(), prima);
  });

  it("un JPEG troncato viene rifiutato con un messaggio, non con un'eccezione", async () => {
    /*
     * Il caso trovato provando il caricamento vero dal browser.
     *
     * L'intestazione di un JPEG tagliato a metà è intatta: dichiara le sue
     * misure, e `misureVere` — che legge solo l'intestazione — lo lascia
     * passare. È la prima decodifica dei pixel a fallire, con «VipsJpeg:
     * premature end of JPEG image», e quell'eccezione usciva dalla Server
     * Action: il referente che aveva caricato una copia interrotta riceveva una
     * pagina «500: Internal Server Error» e nessuna indicazione su quale
     * fotografia rifare.
     *
     * La prova guarda le due cose che contano: che l'esito sia un rifiuto
     * ordinato, e che sul disco non resti niente.
     */
    const prima = fotoSuDisco();
    const intera = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#777" },
    })
      .jpeg()
      .toBuffer();
    const mozzata = intera.subarray(0, Math.floor(intera.length / 2));

    // il fixture deve essere davvero riconoscibile come JPEG, se no la prova
    // proverebbe soltanto che un file qualunque viene rifiutato
    assert.equal(mozzata[0], 0xff);
    assert.equal(mozzata[1], 0xd8);

    const esito = await store.aggiungiFoto(await nuovoAlbum(), mozzata, "", 2500, "");
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /incompleto|rovinat/i);
    assert.equal(
      /VipsJpeg|libvips|premature/.test(esito.errore),
      false,
      "il messaggio della libreria non va mostrato a chi carica",
    );
    assert.deepEqual(fotoSuDisco(), prima, "niente sul disco");
  });

  it("due caricamenti con lo stesso istante non si cancellano il file (report QA, BUG-006)", async () => {
    const slug = await nuovoAlbum();
    const esiti = await Promise.all([
      store.aggiungiFoto(slug, await png(20, 20), "", 7000, ""),
      store.aggiungiFoto(slug, await png(21, 20), "", 7000, ""),
    ]);
    assert.ok(esiti.every((e) => e.ok), "entrambi riescono: i nomi sono diversi");
    const file = esiti.map((e) => e.foto.file);
    assert.notEqual(file[0], file[1]);
    const ora = fotoSuDisco();
    for (const f of file) assert.ok(ora.includes(f), `${f} è sul disco`);
  });

  it("su un album inesistente non lascia il file orfano", async () => {
    await nuovoAlbum();
    const prima = fotoSuDisco();
    const esito = await store.aggiungiFoto("mai-esistito", await png(10, 10), "", 3000, "");
    assert.equal(esito.ok, false);
    assert.deepEqual(fotoSuDisco(), prima, "il file scritto prima della transazione è stato ripulito");
  });

  it("le fotografie restano nell'ordine di caricamento", async () => {
    const slug = await nuovoAlbum();
    for (let i = 0; i < 4; i++) {
      await store.aggiungiFoto(slug, await png(100 + i, 100), `foto ${i}`, 4000 + i, "");
    }
    const a = await store.albumPerIndirizzo(slug);
    assert.deepEqual(a.foto.map((f) => f.didascalia), ["foto 0", "foto 1", "foto 2", "foto 3"]);
  });

  /*
   * Dal 7 ottobre 2026 togliere è mettere nel cestino (audit degli accessi,
   * A-1): l'album non la mostra più, ma riga e file restano trenta giorni.
   * Cancellare davvero lo fanno `cancellaDalCestino` e il lavoro notturno.
   */
  it("togliFoto la mette nel cestino: sparisce dall'album, il file resta", async () => {
    const slug = await nuovoAlbum();
    const { foto } = await store.aggiungiFoto(slug, await png(50, 50), "", 5000, "");

    assert.equal(await store.togliFoto(slug, foto.file, 0, "cg"), true);
    assert.equal((await store.albumPerIndirizzo(slug)).foto.length, 0);
    assert.ok(fotoSuDisco().includes(foto.file), "il file resta, finché il cestino non scade");
    assert.deepEqual(
      (await store.fotoNelCestino(slug)).map((f) => f.file),
      [foto.file],
    );
    assert.equal(await store.togliFoto(slug, foto.file, 0, "cg"), false, "già nel cestino");

    assert.equal(await store.cancellaDalCestino(slug, foto.file), true);
    assert.ok(!fotoSuDisco().includes(foto.file));
    assert.deepEqual(await store.fotoNelCestino(slug), []);
  });

  it("togliFoto su una foto di un altro album restituisce false", async () => {
    const suo = await nuovoAlbum();
    const altro = await nuovoAlbum();
    const { foto } = await store.aggiungiFoto(suo, await png(50, 50), "", 6000, "");
    assert.equal(await store.togliFoto(altro, foto.file, 0, ""), false);
    assert.ok(fotoSuDisco().includes(foto.file), "il file non va toccato");
  });
});

describe("eliminaAlbum", () => {
  it("porta via l'album, le sue foto in cascata e i file", async () => {
    const slug = await nuovoAlbum();
    const a = await store.aggiungiFoto(slug, await png(20, 20), "", 7000, "");
    const b = await store.aggiungiFoto(slug, await png(30, 30), "", 7001, "");

    assert.equal(await store.eliminaAlbum(slug), true);
    assert.equal(await store.albumPerIndirizzo(slug), undefined);
    assert.equal(raw.prepare("SELECT count(*) n FROM foto").get().n, 0, "ON DELETE CASCADE");
    for (const f of [a.foto.file, b.foto.file]) {
      assert.ok(!fotoSuDisco().includes(f), `il file ${f} è stato cancellato dopo il commit`);
    }
  });

  it("su un album inesistente restituisce false", async () => {
    await nuovoAlbum();
    assert.equal(await store.eliminaAlbum("mai-esistito"), false);
  });
});

describe("servire le fotografie: fotoPubblica e fotoInterna", () => {
  it("una foto di un album pubblicato esce con la serratura del suo album", async () => {
    const slug = await nuovoAlbum();
    await store.cambiaStatoAlbum(slug, "pubblicato", 0, "");
    const { foto } = await store.aggiungiFoto(slug, await png(90, 90), "", 8000, "");

    const p = await store.fotoPubblica(foto.file);
    assert.ok(p);
    assert.equal(p.tipo, "image/png");
    // pubblicata non vuol dire aperta: senza password la serratura non ha
    // versione, e la rotta `/foto-file` la tiene chiusa (album-accesso.test.mjs)
    assert.equal(p.serratura.versione, null);
  });

  it("una bozza NON è servibile al pubblico", async () => {
    const slug = await nuovoAlbum();
    const { foto } = await store.aggiungiFoto(slug, await png(90, 90), "", 9000, "");
    await store.cambiaStatoAlbum(slug, "bozza", 0, "");

    assert.equal(
      await store.fotoPubblica(foto.file),
      null,
      "un indirizzo indovinato non deve mostrare le foto di un album in preparazione",
    );
  });

  it("fotoInterna restituisce anche unita e stato, per il controllo di ambito", async () => {
    const slug = await nuovoAlbum({ unita: "gruppo" });
    const { foto } = await store.aggiungiFoto(slug, await png(70, 70), "", 10000, "");
    await store.cambiaStatoAlbum(slug, "in-revisione", 0, "");

    const i = await store.fotoInterna(foto.file);
    assert.ok(i);
    assert.equal(i.tipo, "image/png");
    assert.equal(i.unita, "gruppo", "è ciò che puoScrivereSu confronta");
    assert.equal(i.stato, "in-revisione", "lo stato dell'applicazione, con il trattino");
  });

  it("fotoInterna riporta l'unità vera per un album di unità", async () => {
    const slug = await store.creaAlbum(
      { titolo: "Solo u1", anno: "2026 – 2027", unita: "u1", data: "x", sottotitolo: "", tag: "" },
      0,
      "",
    );
    const { foto } = await store.aggiungiFoto(slug, await png(60, 60), "", 11000, "");
    assert.equal((await store.fotoInterna(foto.file)).unita, "u1");
  });

  it("un nome di file inventato non è servibile", async () => {
    await nuovoAlbum();
    assert.equal(await store.fotoPubblica("foto-inventata.jpg"), null);
    assert.equal(await store.fotoInterna("foto-inventata.jpg"), null);
  });
});

describe("gli errori non portano SQL fuori dallo store", () => {
  it("uno stato fuori elenco solleva invece di non fare niente in silenzio", async () => {
    const slug = await nuovoAlbum();
    await store.cambiaStatoAlbum(slug, "pubblicato", 0, "");
    // Prima questa chiamata restituiva `true` senza cambiare nulla: Drizzle
    // omette dall'UPDATE le colonne il cui valore è `undefined`, e la
    // conversione restituiva `undefined`. Un guasto che si presentava come
    // successo. Ora `statoInDb` solleva.
    const e = await store
      .cambiaStatoAlbum(slug, "stato-inventato", 0, "")
      .then(() => null, (err) => err);

    assert.ok(e instanceof ErroreDatabase, `atteso ErroreDatabase, ricevuto ${e}`);
    assert.equal(
      (await store.albumPerIndirizzo(slug)).stato,
      "pubblicato",
      "e lo stato non è cambiato",
    );
    const testo = `${e.message} ${e.codice}`;
    for (const proibito of ["update", "album", "SQLITE_", "constraint", "stato-inventato"]) {
      assert.ok(
        !testo.toLowerCase().includes(proibito.toLowerCase()),
        `«${proibito}» non deve uscire dallo store: ${testo}`,
      );
    }
  });
});
