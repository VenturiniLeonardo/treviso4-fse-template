import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  codiceAlPasso,
  codiceOra,
  daBase32,
  inBase32,
  nuovoSegreto,
  passoDi,
  PASSO_S,
  uriOtpauth,
  verificaCodice,
} from "@/lib/auth/totp";

/**
 * TOTP — RFC 6238.
 *
 * La prova che conta è la prima: i vettori pubblicati nell'appendice B della
 * RFC. Un TOTP scritto in casa che passa i test scritti in casa non dimostra
 * niente — dimostra solo di essere coerente con sé stesso. Se questi sei numeri
 * escono giusti, allora l'app sul telefono di chi accede vedrà gli stessi.
 */

/** Il seme dell'appendice B: «12345678901234567890» in ASCII, in base32. */
const SEME = inBase32(Buffer.from("12345678901234567890", "ascii"));

describe("i vettori di prova di RFC 6238, appendice B", () => {
  // La RFC pubblica otto cifre; noi ne produciamo sei, che sono le ultime sei.
  const VETTORI = [
    { secondi: 59, otto: "94287082" },
    { secondi: 1111111109, otto: "07081804" },
    { secondi: 1111111111, otto: "14050471" },
    { secondi: 1234567890, otto: "89005924" },
    { secondi: 2000000000, otto: "69279037" },
    { secondi: 20000000000, otto: "65353130" },
  ];

  for (const { secondi, otto } of VETTORI) {
    it(`a T=${secondi} il codice è ${otto.slice(-6)}`, () => {
      assert.equal(codiceAlPasso(SEME, passoDi(secondi * 1000)), otto.slice(-6));
    });
  }
});

describe("base32", () => {
  // RFC 4648 §10, senza il riempimento che `otpauth://` non vuole
  const VETTORI = [
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];

  for (const [chiaro, cifrato] of VETTORI) {
    it(`«${chiaro}» si scrive ${cifrato}`, () => {
      assert.equal(inBase32(Buffer.from(chiaro, "ascii")), cifrato);
      assert.equal(daBase32(cifrato).toString("ascii"), chiaro);
    });
  }

  it("accetta il riempimento, gli spazi e le minuscole di chi ricopia a mano", () => {
    assert.equal(daBase32("mzxw 6ytb-oi======").toString("ascii"), "foobar");
  });

  it("rifiuta un carattere fuori dall'alfabeto invece di indovinare", () => {
    // 0, 1, 8 e 9 non ci sono, apposta: si confondono con O, I, B e g
    assert.equal(daBase32("MZXW6YT1"), null);
    assert.equal(daBase32(""), null);
  });

  it("un segreto nuovo è di 160 bit, come chiede RFC 4226 §4", () => {
    const s = nuovoSegreto();
    assert.equal(daBase32(s).length, 20);
    // due segreti di fila non sono lo stesso segreto
    assert.notEqual(s, nuovoSegreto());
  });
});

describe("la verifica", () => {
  const SEGRETO = nuovoSegreto();
  const ADESSO = 1_700_000_000_000;

  it("accetta il codice del momento e restituisce il passo consumato", () => {
    const esito = verificaCodice(SEGRETO, codiceOra(SEGRETO, ADESSO), null, ADESSO);
    assert.equal(esito.ok, true);
    assert.equal(esito.passo, passoDi(ADESSO));
  });

  it("accetta mezzo minuto avanti e mezzo indietro", () => {
    for (const scarto of [-PASSO_S * 1000, PASSO_S * 1000]) {
      const codice = codiceOra(SEGRETO, ADESSO + scarto);
      assert.equal(verificaCodice(SEGRETO, codice, null, ADESSO).ok, true, `scarto ${scarto}`);
    }
  });

  it("non accetta un minuto: la tolleranza è un passo, non una finestra larga", () => {
    const codice = codiceOra(SEGRETO, ADESSO + 2 * PASSO_S * 1000);
    assert.equal(verificaCodice(SEGRETO, codice, null, ADESSO).ok, false);
  });

  it("rifiuta il riuso dello stesso codice — RFC 6238 §5.2", () => {
    const codice = codiceOra(SEGRETO, ADESSO);
    const primo = verificaCodice(SEGRETO, codice, null, ADESSO);
    assert.equal(primo.ok, true);

    // la seconda volta chi chiama ripassa il passo consumato: qui casca
    assert.equal(verificaCodice(SEGRETO, codice, primo.passo, ADESSO).ok, false);
  });

  it("rifiuta anche il codice *precedente* a uno già usato", () => {
    // altrimenti bastava rigiocare quello di mezzo minuto prima, che la
    // tolleranza accetta ancora: il riuso si chiuderebbe da un lato solo
    const passoUsato = passoDi(ADESSO);
    const vecchio = codiceAlPasso(SEGRETO, passoUsato - 1);
    assert.equal(verificaCodice(SEGRETO, vecchio, passoUsato, ADESSO).ok, false);
  });

  it("rifiuta quello che non è sei cifre, senza calcolare niente", () => {
    for (const brutto of ["", "12345", "1234567", "abcdef", "12 34 56 78"]) {
      assert.equal(verificaCodice(SEGRETO, brutto, null, ADESSO).ok, false, brutto);
    }
  });

  it("accetta le cifre scritte a gruppi, come le mostrano le app", () => {
    const codice = codiceOra(SEGRETO, ADESSO);
    const spaziato = `${codice.slice(0, 3)} ${codice.slice(3)}`;
    assert.equal(verificaCodice(SEGRETO, spaziato, null, ADESSO).ok, true);
  });

  it("un segreto non valido è un rifiuto, non un'eccezione", () => {
    assert.equal(codiceAlPasso("non-base32!", 0), null);
    assert.equal(verificaCodice("non-base32!", "123456", null, ADESSO).ok, false);
  });
});

describe("l'indirizzo otpauth", () => {
  it("porta l'emittente nell'etichetta e nel parametro, e SHA-1", () => {
    const uri = uriOtpauth("MZXW6YTBOI", "ref1");
    assert.match(uri, /^otpauth:\/\/totp\/Label:ref1\?/);
    const q = new URL(uri).searchParams;
    assert.equal(q.get("secret"), "MZXW6YTBOI");
    assert.equal(q.get("issuer"), "Label");
    // SHA-1 apposta: le app ignorano questo parametro e assumono SHA-1
    assert.equal(q.get("algorithm"), "SHA1");
    assert.equal(q.get("digits"), "6");
    assert.equal(q.get("period"), "30");
  });

  it("un nome utente con caratteri strani non rompe l'indirizzo", () => {
    const uri = uriOtpauth("MZXW6YTBOI", "referente/gruppo?x=1");
    assert.equal(new URL(uri).searchParams.get("secret"), "MZXW6YTBOI");
  });
});
