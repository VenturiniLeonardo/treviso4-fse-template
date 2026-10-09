import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import sharp from "sharp";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * I tre punti che le correzioni dell'audit degli accessi del 4 ottobre 2026
 * avevano lasciato fuori, fatti il 7 ottobre (migrazione 0022):
 *
 *  - **A-1, la cancellazione logica**: una fotografia eliminata da un album
 *    resta trenta giorni nel cestino, invisibile a tutti tranne a chi pubblica,
 *    e poi la porta via il lavoro notturno;
 *  - **M-1b, il ritiro come proposta**: il social media manager chiede di
 *    ritirare un album o un'attività online, con il motivo, e decide un referente
 *    gruppo;
 *  - **I-1, l'evidenza dei consensi**: nessuna scansione, ma una verifica a
 *    campione del modulo di carta, fatta da chi non ha registrato il consenso.
 *
 * Le regole negli store si provano sul database; quelle nelle Server Action,
 * che fuori da Next non girano, sul sorgente, come in `accessi-ruoli`.
 */

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const leggi = (...p) => readFileSync(join(radice, ...p), "utf8");
const area = (...p) => leggi("app", "(area)", "area-riservata", ...p);

/** Il corpo di una funzione, fino alla successiva esportata. */
function corpo(sorgente, nome) {
  const i = sorgente.search(new RegExp(`(export )?(async )?function ${nome}\\(`));
  assert.ok(i >= 0, `manca ${nome}`);
  const j = sorgente.indexOf("\nexport ", i + 1);
  return sorgente.slice(i, j < 0 ? undefined : j);
}

let cartella, dati, raw, chiudiPerTest;
let album, iscritti, proposte, propLib, permessi, decisione;

const png = (l, a) =>
  sharp({ create: { width: l, height: a, channels: 3, background: "#4a7d55" } }).png().toBuffer();
const suDisco = () => {
  try {
    return readdirSync(dati).filter((f) => f.startsWith("foto-"));
  } catch {
    return [];
  }
};
/** Aspetta che la coda delle derivate abbia finito di scrivere. */
async function quiete() {
  let ultimo = "";
  for (let giri = 0; giri < 40; giri++) {
    const adesso = suDisco().sort().join("|");
    if (adesso === ultimo) return;
    ultimo = adesso;
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-residui-accessi-"));
  dati = join(cartella, "dati");
  mkdirSync(dati, { recursive: true });
  process.env.SITO_DB = join(cartella, "prova.db");
  process.env.SITO_DATI_DIR = dati;

  const iniziale = new Database(process.env.SITO_DB);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  album = await import("@/lib/album");
  iscritti = await import("@/lib/iscritti-store");
  proposte = await import("@/lib/proposte-store");
  propLib = await import("@/lib/proposte");
  permessi = await import("@/lib/permessi");
  decisione = await import("@/lib/auth/decisione");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  (await import("@/lib/db/riferimenti")).assicuraRiferimenti();

  raw = new Database(process.env.SITO_DB);
  raw
    .prepare(
      "INSERT INTO utenti (id, utente, nome, iniziali, ruolo, unita_id) VALUES " +
        "(1,'cu','Referente Unità','CU','referente',(SELECT id FROM unita WHERE chiave = 'u1'))," +
        "(2,'cg','Referente Gruppo','CG','gestore',NULL),(3,'sv','Sviluppatore','SV','sviluppatore',NULL)",
    )
    .run();
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  rmSync(cartella, { recursive: true, force: true });
});

// =========================================================================

describe("la migrazione 0022", () => {
  it("aggiunge le colonne del cestino e della verifica", () => {
    const colonne = (t) => raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    for (const c of ["eliminata_il", "eliminata_da"]) assert.ok(colonne("foto").includes(c), c);
    for (const c of [
      "consenso_modulo",
      "consenso_da",
      "consenso_verifica",
      "consenso_verificato_il",
      "consenso_verificato_da",
    ]) {
      assert.ok(colonne("iscrizioni").includes(c), c);
    }
  });

  it("`proposte` accetta il tipo album, e solo per testi senza file", () => {
    raw.prepare("INSERT INTO proposte (tipo, chiave, valore) VALUES ('album', 'x', '{}')").run();
    raw.prepare("DELETE FROM proposte WHERE tipo = 'album'").run();
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO proposte (tipo, chiave, valore, file) VALUES ('album','x','{}','f')")
          .run(),
      /CHECK/,
    );
  });

  it("le chiavi esterne nuove si svuotano quando l'account se ne va", () => {
    const fk = raw.prepare("PRAGMA foreign_key_list(iscrizioni)").all();
    for (const c of ["consenso_da", "consenso_verificato_da"]) {
      assert.equal(fk.find((f) => f.from === c)?.on_delete, "SET NULL", c);
    }
    assert.equal(
      raw.prepare("PRAGMA foreign_key_list(foto)").all().find((f) => f.from === "eliminata_da")
        ?.on_delete,
      "SET NULL",
    );
  });

  it("su una matrice già seminata scrive la riga `consensi-verifica`", () => {
    const sql = leggi("drizzle", "0022_residui_accessi.sql");
    assert.match(sql, /'consensi-verifica'/);
    assert.match(sql, /NOT EXISTS \(SELECT 1 FROM `permessi` WHERE `funzione` = 'consensi-verifica'\)/);
  });
});

// =========================================================================

describe("la riga «Verificare a campione i consensi»", () => {
  it("è dello sviluppatore e del gestore, e un tetto la chiude agli altri due", () => {
    const riga = permessi.FUNZIONI_INIZIALI.find((f) => f.id === "consensi-verifica");
    assert.deepEqual(riga.livelli, {
      sviluppatore: "completo",
      "gestore": "completo",
      "referente": "nessuno",
      social: "nessuno",
    });
    // un clic sulla schermata non la riapre: chi registra non verifica
    assert.equal(permessi.tetto("consensi-verifica", "referente").livello, "nessuno");
    assert.equal(permessi.tetto("consensi-verifica", "social").livello, "nessuno");
    assert.equal(permessi.ammesso("consensi-verifica", "referente", "limitato"), false);
  });
});

// =========================================================================

describe("il cestino delle fotografie (A-1)", () => {
  let progressivo = 0;
  const nuovo = () =>
    album.creaAlbum(
      {
        titolo: `Cestino ${++progressivo}`,
        anno: "2026 – 2027",
        unita: "gruppo",
        data: "Ottobre 2026",
        sottotitolo: "",
        tag: "",
      },
      0,
      "cg",
    );

  beforeEach(async () => {
    await quiete();
    raw.prepare("DELETE FROM foto").run();
    raw.prepare("DELETE FROM album").run();
  });

  it("eliminata, sparisce dall'album e dalla copertina, ma riga e file restano", async () => {
    const slug = await nuovo();
    const a = (await album.aggiungiFoto(slug, await png(40, 40), "prima", 1, "cg")).foto;
    const b = (await album.aggiungiFoto(slug, await png(41, 41), "seconda", 2, "cg")).foto;

    assert.equal(await album.togliFoto(slug, a.file, Date.now(), "cu"), true);
    const letto = await album.albumPerIndirizzo(slug);
    assert.deepEqual(letto.foto.map((f) => f.file), [b.file]);
    assert.ok(suDisco().includes(a.file));

    const nel = await album.fotoNelCestino(slug);
    assert.equal(nel.length, 1);
    assert.equal(nel[0].eliminataDa, "cu", "il cestino dice chi l'ha eliminata");
  });

  it("la rotta dei file non la serve al pubblico, e dice a chi gestisce che è nel cestino", async () => {
    const slug = await nuovo();
    const f = (await album.aggiungiFoto(slug, await png(40, 40), "", 1, "cg")).foto;
    await album.togliFoto(slug, f.file, Date.now(), "cg");
    assert.equal(await album.fotoPubblica(f.file), null);
    assert.equal((await album.fotoInterna(f.file)).eliminata, true);

    const rotta = leggi("app", "foto-file", "[file]", "route.ts");
    assert.match(rotta, /interna\.eliminata && !\(await puo\("album-pubblica"/);
  });

  it("rimessa, torna al posto che aveva", async () => {
    const slug = await nuovo();
    const file = [];
    for (let i = 0; i < 3; i++) {
      file.push((await album.aggiungiFoto(slug, await png(40 + i, 40), `f${i}`, i, "cg")).foto.file);
    }
    await album.togliFoto(slug, file[0], Date.now(), "cg");
    assert.equal(await album.ripristinaFoto(slug, file[0], "cg"), true);
    assert.deepEqual((await album.albumPerIndirizzo(slug)).foto.map((f) => f.file), file);
    assert.equal(await album.ripristinaFoto(slug, file[0], "cg"), false, "non è più nel cestino");
  });

  it("non si nasconde né si rimette da «Nascondi» una fotografia del cestino", async () => {
    const slug = await nuovo();
    const f = (await album.aggiungiFoto(slug, await png(40, 40), "", 1, "cg")).foto;
    await album.togliFoto(slug, f.file, Date.now(), "cg");
    assert.equal(await album.nascondiFoto(slug, f.file, false, "cg"), false);
  });

  it("il lavoro notturno porta via solo quelle oltre i trenta giorni, file compresi", async () => {
    const slug = await nuovo();
    const vecchia = (await album.aggiungiFoto(slug, await png(40, 40), "", 1, "cg")).foto.file;
    const recente = (await album.aggiungiFoto(slug, await png(41, 41), "", 2, "cg")).foto.file;
    await quiete();
    const adesso = Date.UTC(2026, 9, 7);
    const giorno = 86_400_000;
    await album.togliFoto(slug, vecchia, adesso - (album.GIORNI_CESTINO + 1) * giorno, "cg");
    await album.togliFoto(slug, recente, adesso - (album.GIORNI_CESTINO - 1) * giorno, "cg");

    assert.deepEqual(await album.svuotaCestino(adesso), [vecchia]);
    assert.ok(!suDisco().some((f) => f.startsWith(vecchia.replace(/\.[a-z]+$/, ""))), "con le derivate");
    assert.ok(suDisco().includes(recente));
    assert.deepEqual((await album.fotoNelCestino(slug)).map((f) => f.file), [recente]);
  });

  it("lo script notturno ha il passo, e la prova a vuoto non cancella", () => {
    const s = leggi("scripts", "notturno.mjs");
    assert.match(s, /await svuotaCestino\(\)/);
    const i = s.indexOf("cestino delle fotografie: non eseguito (secca)");
    assert.ok(i > 0 && s.lastIndexOf("if (secco)", i) > 0);
  });

  it("le azioni: eliminare non è più cancellare, e il cestino è di chi pubblica", () => {
    const a = area("album", "actions.ts");
    assert.doesNotMatch(corpo(a, "rimuoviFoto"), /rimossa dall’album e cancellata dal server/);
    assert.match(corpo(a, "rimuoviFoto"), /nel cestino per \$\{GIORNI_CESTINO\} giorni/);
    for (const nome of ["ripristinaFotoCestino", "cancellaFotoCestino"]) {
      assert.match(corpo(a, nome), /permessoSulCestino\(slug\)/, nome);
    }
    assert.match(corpo(a, "permessoSulCestino"), /permessoDiPubblicare\(p\.unita, slug\)/);
    // e chi ha dichiarato delle assenze non rimette fotografie in un album online
    assert.match(corpo(a, "ripristinaFotoCestino"), /HA_DICHIARATO_CHI_PUBBLICA/);
  });
});

// =========================================================================

describe("il ritiro come proposta (M-1b)", () => {
  beforeEach(() => raw.prepare("DELETE FROM proposte").run());

  it("`motivoDelRitiro` riconosce solo le richieste di ritiro", () => {
    assert.equal(propLib.motivoDelRitiro(JSON.stringify({ azione: "ritira", motivo: "x" })), "x");
    assert.equal(propLib.motivoDelRitiro(JSON.stringify({ azione: "elimina" })), null);
    assert.equal(propLib.motivoDelRitiro("non è JSON"), null);
  });

  it("`togliRitiro` toglie il ritiro, non una modifica in attesa", async () => {
    const ritiro = JSON.stringify({ azione: "ritira", motivo: "foto sbagliata" });
    const modifica = JSON.stringify({ azione: "modifica", campi: {} });
    await proposte.proponi("album", "uscita", ritiro, null, "cu");
    await proposte.proponi("attivita", "7", modifica, null, "cu");

    await proposte.togliRitiro("album", "uscita");
    await proposte.togliRitiro("attivita", "7");
    const restano = await proposte.leggiProposteInAttesa();
    assert.deepEqual(restano.map((p) => `${p.tipo}:${p.chiave}`), ["attivita:7"]);
  });

  it("il social chiede il ritiro, con il motivo; chi può ritirare ritira e basta", () => {
    for (const [file, nome] of [
      [["album", "actions.ts"], "chiediRitiroAlbum"],
      [["attivita", "actions.ts"], "chiediRitiroAttivita"],
    ]) {
      const c = corpo(area(...file), nome);
      assert.match(c, /motivo === ""/, `${nome}: il motivo è obbligatorio`);
      assert.match(c, /MOTIVO_RITIRO_MAX/, `${nome}: e ha un limite`);
      assert.match(c, /azione: "ritira"/, nome);
      assert.match(c, /"pubblicato"/, `${nome}: solo su ciò che è online`);
    }
    assert.match(corpo(area("album", "actions.ts"), "chiediRitiroAlbum"), /if \(!p\.soloPropri\)/);
    assert.match(
      corpo(area("attivita", "actions.ts"), "chiediRitiroAttivita"),
      /if \(!vaInCoda\(ctx\.sessione\.r, ctx\.livello\)\)/,
    );
    // e il social media manager non ha comunque la strada diretta
    assert.equal(decisione.vaInCoda("social", "limitato"), true);
  });

  it("approvare un ritiro lo chiede a chi pubblica, e riporta in bozza solo ciò che è online", () => {
    const a = area("proposte", "actions.ts");
    assert.match(a, /approva && \(tipo === "attivita" \|\| tipo === "album"\)/);
    const applica = corpo(a, "applica");
    assert.match(applica, /if \(a\.stato === "pubblicato"\) await cambiaStatoAlbum\(chiave, "bozza"/);
    assert.match(applica, /if \(a\.stato === "pubblicato"\) await cambiaStatoAttivita\(id, "bozza"/);
  });

  it("il ritiro diretto toglie la richiesta che aspettava", () => {
    assert.match(corpo(area("album", "actions.ts"), "cambiaStato"), /togliRitiro\("album", slug\)/);
    assert.match(corpo(area("album", "actions.ts"), "rimuoviAlbum"), /togliRitiro\("album", slug\)/);
    assert.match(
      corpo(area("attivita", "actions.ts"), "inviaAttivita"),
      /togliRitiro\("attivita", String\(id\)\)/,
    );
  });
});

// =========================================================================

describe("la verifica a campione dei consensi (I-1)", () => {
  const ANNO = "2026-2027";
  const conConsenso = (nome, chi = "cu") => {
    const id = iscritti.registraIscrizione({ nome, cognome: "Prova", unita: "u1", anno: ANNO });
    iscritti.registraConsenso(id, true, "2026-09-15", chi);
    return id;
  };

  beforeEach(() => {
    raw.prepare("DELETE FROM iscrizioni").run();
    raw.prepare("DELETE FROM ragazzi").run();
  });

  it("chi registra il consenso non lo verifica", () => {
    const id = conConsenso("Anna", "cg");
    assert.deepEqual(iscritti.verificaConsenso(id, "conforme", "cg"), { ok: false, perche: "sua" });
    assert.deepEqual(iscritti.verificaConsenso(id, "conforme", "sv"), { ok: true });
    assert.equal(iscritti.iscrittoPerId(id).verifica, "conforme");
  });

  it("non si verifica un consenso che non c'è", () => {
    const id = iscritti.registraIscrizione({ nome: "Bea", cognome: "Prova", unita: "u1", anno: ANNO });
    assert.deepEqual(iscritti.verificaConsenso(id, "conforme", "cg"), {
      ok: false,
      perche: "senza-consenso",
    });
  });

  it("registrato di nuovo, o revocato, il consenso perde la verifica", () => {
    const id = conConsenso("Carla");
    iscritti.verificaConsenso(id, "mancante", "cg");
    iscritti.registraConsenso(id, true, "2026-10-01", "cu");
    assert.equal(iscritti.iscrittoPerId(id).verifica, null, "è un altro modulo");

    iscritti.verificaConsenso(id, "conforme", "cg");
    iscritti.segnaModulo(id, "raccoglitore in sede");
    iscritti.revocaConsenso(id);
    const i = iscritti.iscrittoPerId(id);
    assert.equal(i.verifica, null);
    assert.equal(i.consensoModulo, "", "revocato, il modulo non vale più");
  });

  it("dove sta il modulo si scrive solo su un consenso, e resta corto", () => {
    const senza = iscritti.registraIscrizione({ nome: "Dora", cognome: "Prova", unita: "u1", anno: ANNO });
    assert.equal(iscritti.segnaModulo(senza, "in sede"), false);
    const id = conConsenso("Elsa");
    assert.equal(iscritti.segnaModulo(id, "x".repeat(200)), true);
    assert.equal(iscritti.iscrittoPerId(id).consensoModulo.length, iscritti.MODULO_MAX);
  });

  it("il campione: niente di già verificato, niente di proprio, e fermo per la settimana", () => {
    const miei = [conConsenso("Mio", "cg")];
    const altri = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => conConsenso(n, "cu"));
    iscritti.verificaConsenso(altri[0], "conforme", "sv");

    const lunedi = Date.UTC(2026, 9, 5, 9);
    const c1 = iscritti.campioneDaVerificare(ANNO, "cg", lunedi).map((v) => v.id);
    assert.equal(c1.length, iscritti.CAMPIONE);
    assert.ok(!c1.includes(miei[0]), "non i consensi registrati da chi verifica");
    assert.ok(!c1.includes(altri[0]), "non quelli già verificati");

    const domenica = Date.UTC(2026, 9, 11, 20);
    assert.deepEqual(iscritti.campioneDaVerificare(ANNO, "cg", domenica).map((v) => v.id), c1);

    // in qualche settimana dell'anno il campione deve cambiare: non sono
    // sempre i primi cinque
    const altre = Array.from({ length: 10 }, (_, k) =>
      iscritti.campioneDaVerificare(ANNO, "cg", lunedi + (k + 1) * 7 * 86_400_000).map((v) => v.id),
    );
    assert.ok(altre.some((c) => c.join() !== c1.join()), "il campione non cambia mai");
  });

  it("lo stato dell'anno conta i verificati ed elenca i moduli non trovati", () => {
    const a = conConsenso("Uno");
    const b = conConsenso("Due");
    conConsenso("Tre");
    iscritti.verificaConsenso(a, "conforme", "cg");
    iscritti.verificaConsenso(b, "mancante", "cg");

    const s = iscritti.statoVerifiche(ANNO);
    assert.equal(s.consensi, 3);
    assert.equal(s.verificati, 2);
    assert.deepEqual(s.mancanti.map((m) => [m.nome, m.verificatoDa]), [["Due", "Referente Gruppo"]]);
  });

  it("l'azione passa da `consensi-verifica`, non da `iscritti`", () => {
    const c = corpo(area("iscritti", "actions.ts"), "verificaModulo");
    assert.match(c, /contesto\("consensi-verifica"/);
    assert.doesNotMatch(c, /conPermesso\(/);
  });
});
