import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Prove sul sorgente delle Server Action, dall'audit di sicurezza dell'ottobre
 * 2026.
 *
 * Le azioni importano `next/headers` e non si eseguono fuori da Next: qui si
 * controlla l'**ordine** dei passi che contano, cioè che un controllo stia
 * prima dell'operazione che deve proteggere. Le parti pure stanno nelle prove
 * dei rispettivi moduli.
 */

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const leggi = (...parti) => readFileSync(join(radice, ...parti), "utf8");
const area = (...parti) => leggi("app", "(area)", "area-riservata", ...parti);

/** Il corpo di una funzione esportata, dalla firma alla successiva. */
function corpo(sorgente, nome) {
  const inizio = sorgente.indexOf(`export async function ${nome}(`);
  assert.ok(inizio >= 0, `${nome} non trovata`);
  const fine = sorgente.indexOf("\nexport ", inizio + 1);
  return sorgente.slice(inizio, fine < 0 ? undefined : fine);
}

/** Afferma che `primo` compare prima di `secondo` in `testo`. */
function prima(testo, primo, secondo) {
  const a = testo.indexOf(primo);
  const b = testo.indexOf(secondo);
  assert.ok(a >= 0, `manca «${primo}»`);
  assert.ok(b >= 0, `manca «${secondo}»`);
  assert.ok(a < b, `«${primo}» deve venire prima di «${secondo}»`);
}

describe("accesso (DOS-02, AUTH-01)", () => {
  const accedi = corpo(area("accedi", "actions.ts"), "accedi");

  it("il tetto su nome utente e password precede conteggio e registro", () => {
    prima(accedi, "UTENTE_MAX", "verificaCredenzialiLimitate(");
    prima(accedi, "UTENTE_MAX", "registraAccesso(utente, utente");
  });

  it("il primo passo non azzera il conteggio per utente: lo fa solo il secondo fattore", () => {
    assert.doesNotMatch(accedi, /\bazzera\(/);
    const utenti = leggi("lib", "utenti.ts");
    const secondo = utenti.slice(utenti.indexOf("export function verificaSecondoFattoreLimitato("));
    prima(secondo, "segnaFallimento(", "azzera(");
  });
});

describe("iscritti (AUTHZ-01)", () => {
  const nuovo = corpo(area("iscritti", "actions.ts"), "nuovoIscritto");

  it("un ragazzo già in anagrafica passa dal cancello con la sua unità, prima di iscriverlo", () => {
    prima(nuovo, "provenienzaDelRagazzo(", "registraIscrizione(");
    prima(nuovo, "unita: provenienza.unita", "registraIscrizione(");
  });
});

describe("album (BIZ-01)", () => {
  const carica = corpo(area("album", "actions.ts"), "caricaFoto");

  it("un album pubblicato torna in revisione prima che le fotografie entrino", () => {
    prima(carica, 'puo("album-pubblica"', "aggiungiFoto(");
    prima(carica, 'cambiaStatoAlbum(slug, "in-revisione"', "aggiungiFoto(");
  });
});

describe("album e iscritti (AUTHZ-02, AUTHZ-03)", () => {
  const sorgente = area("album", "actions.ts");

  it("dichiarare o ritirare un'assenza passa dall'ambito dell'iscritto", () => {
    prima(corpo(sorgente, "dichiaraAssente"), "ambitoDellIscritto(", "dichiaraAssenza(");
    prima(corpo(sorgente, "ritiraAssenza"), "ambitoDellIscritto(", "togliAssenza(");
  });

  it("riprovare una conversione la lega all'album su cui si ha il permesso", () => {
    assert.match(corpo(sorgente, "riprovaConversione"), /riprova\(id, albumId\)/);
  });
});

describe("esportazione (AUTHZ-04)", () => {
  const rotta = area("esporta", "[sezione]", "route.ts");

  it("ogni sezione esportabile passa anche dalla riga di matrice del suo dato", () => {
    prima(rotta, "AZIONE_DI_SEZIONE[chiave]", 'if (chiave === "log")');
    assert.match(rotta, /azioneDelDato && !\(await puo\(azioneDelDato\)\)/);
  });
});

describe("sessioni (AUTH-02)", () => {
  it("«dimentica la sessione» chiude la riga nel database, non solo il cookie", () => {
    const azione = leggi("app", "(sito)", "legale", "preferenze-cookie", "actions.ts");
    prima(corpo(azione, "dimenticaSessione"), "chiudi(await tokenCorrente())", "redirect(");
  });

  it("accettare un invito chiude le altre sessioni dell'utente", () => {
    const azione = area("invito", "[token]", "actions.ts");
    prima(azione, "chiudiAltrePerUtente(invito.utenteId, sessione)", "scriviCookieSessione(sessione");
  });
});

describe("attività (VAL-01)", () => {
  it("il modulo passa da dataValida e dai tetti di lunghezza", () => {
    const azione = area("attivita", "actions.ts");
    assert.match(azione, /if \(!dataValida\(data\)\)/);
    assert.match(azione, /LIMITI_ATTIVITA\[campo\]/);
  });
});

describe("approvazioni (BIZ-02)", () => {
  const decidi = corpo(area("approvazioni", "actions.ts"), "decidi");

  it("ogni ramo confronta l'impronta prima di cambiare lo stato", () => {
    prima(decidi, "if (cambiato(a)) return CAMBIATO;", "cambiaStatoAlbum(");
    prima(decidi, "if (cambiato(d)) return CAMBIATO;", "cambiaStatoDocumento(");
    const attivita = decidi.slice(decidi.indexOf('tipo === "attivita"'));
    prima(attivita, "if (cambiato(a)) return CAMBIATO;", "cambiaStatoAttivita(");
  });

  it("la coda mette l'impronta nel modulo", () => {
    assert.match(leggi("components", "area", "Coda.tsx"), /name="versione" value=\{voce\.versione/);
  });
});

describe("ritiro, cancellazione e modifiche di ciò che è stato pubblicato (BIZ-03)", () => {
  const album = area("album", "actions.ts");
  const attivita = area("attivita", "actions.ts");

  it("un album o un'attività che sono stati online li cancella chi pubblica", () => {
    prima(corpo(album, "rimuoviAlbum"), "fuPubblicato(", "eliminaAlbum(");
    prima(corpo(album, "rimuoviAlbum"), "permessoDiPubblicare(", "eliminaAlbum(");
    prima(corpo(attivita, "rimuoviAttivita"), "fuPubblicato(", "eliminaAttivita(");
  });

  it("le approvazioni scrivono nel registro l'identificativo, non solo il titolo", () => {
    const decidi = corpo(area("approvazioni", "actions.ts"), "decidi");
    assert.match(decidi, /l’album «\$\{a\.titolo\}» \(\$\{chiave\}\)/);
    assert.match(decidi, /l’attività «\$\{a\.titolo\}» \(attività \$\{id\}\)/);
  });

  it("modificare un contenuto pubblicato senza poter pubblicare lo rimanda in revisione", () => {
    prima(corpo(album, "modificaAlbum"), 'cambiaStatoAlbum(slug, "in-revisione"', "aggiornaAlbum(");
    prima(corpo(attivita, "modificaAttivita"), 'cambiaStatoAttivita(id, "in-revisione"', "aggiornaAttivita(");
  });
});

describe("ritratti (BIZ-04)", () => {
  it("il ritratto di una persona lo carica solo chi ha la riga referenti completa", () => {
    const carica = corpo(area("immagini", "actions.ts"), "caricaImmagine");
    prima(carica, 'p.slot.persona && p.ctx.livello !== "completo"', "Buffer.from(");
  });
});

describe("avvio in produzione (INFO-03)", () => {
  it("senza la chiave dei segreti TOTP il server non parte", () => {
    const avvio = leggi("instrumentation.ts");
    prima(avvio, "if (!process.env.SITO_TOTP_SEGRETO)", "process.exit(1)");
  });
});
