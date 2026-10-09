import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ipDaCatena, IP_SCONOSCIUTO, proxyFidati } from "@/lib/auth/indirizzo";

/**
 * L'IP del client contro lo spoofing di X-Forwarded-For — audit di sicurezza.
 *
 * La catena è `client, proxy1, …`: ogni proxy accoda a **destra**. Il valore
 * fidato è a destra; il primo a sinistra lo sceglie il client. Prima l'app
 * prendeva il primo, e a difenderla era solo la sovrascrittura di Caddy — una
 * proprietà che viveva nel file del proxy. Qui la difesa è nell'applicazione: si
 * prende l'elemento a `proxyFidati()` posizioni dall'estremo destro.
 */

describe("ipDaCatena — un solo proxy fidato (predefinito)", () => {
  it("con Caddy che sovrascrive, la catena ha un solo IP: è quello", () => {
    assert.equal(ipDaCatena("203.0.113.7", 1), "203.0.113.7");
  });

  it("se il client antepone un IP, si prende comunque l'ultimo (quello del proxy)", () => {
    // "1.2.3.4" è messo dall'attaccante; "203.0.113.7" lo accoda il proxy fidato
    assert.equal(ipDaCatena("1.2.3.4, 203.0.113.7", 1), "203.0.113.7");
  });

  it("più IP falsi anteposti non spostano il valore fidato", () => {
    assert.equal(ipDaCatena("9.9.9.9, 8.8.8.8, 7.7.7.7, 203.0.113.7", 1), "203.0.113.7");
  });

  it("il primo elemento — quello vecchio, spoofabile — non viene mai scelto", () => {
    const scelto = ipDaCatena("evil, evil, 203.0.113.7", 1);
    assert.notEqual(scelto, "evil");
  });
});

describe("ipDaCatena — due proxy fidati (per esempio una CDN davanti a Caddy)", () => {
  it("con due hop, il client è il terzultimo… cioè il secondo da destra", () => {
    // catena: realclient, ipDellaCDN  (Caddy vede la CDN, la CDN vede il client)
    assert.equal(ipDaCatena("203.0.113.7, 198.51.100.9", 2), "203.0.113.7");
  });
});

describe("ipDaCatena — casi limite", () => {
  it("senza XFF restituisce «sconosciuto»: la richiesta non è passata dal proxy", () => {
    assert.equal(ipDaCatena(null, 1), IP_SCONOSCIUTO);
    assert.equal(ipDaCatena("", 1), IP_SCONOSCIUTO);
    assert.equal(ipDaCatena(" , ", 1), IP_SCONOSCIUTO);
  });

  it("gli spazi e le voci vuote nella catena non contano", () => {
    assert.equal(ipDaCatena("  , 203.0.113.7 ", 1), "203.0.113.7");
  });

  it("una catena più corta degli hop attesi non esce dai bordi", () => {
    assert.equal(ipDaCatena("203.0.113.7", 3), "203.0.113.7");
  });
});

describe("ipDaCatena — nessun proxy (SITO_PROXY_FIDATI=0, SEC-AUTH-002)", () => {
  it("la catena la scrive il client: non si legge, e tutti contano su un secchio solo", () => {
    for (const scritto of ["198.51.100.201", "198.51.100.202", "1.2.3.4, 203.0.113.7"]) {
      assert.equal(ipDaCatena(scritto, 0), IP_SCONOSCIUTO);
    }
  });
});

describe("proxyFidati — lettura della variabile d'ambiente", () => {
  afterEach(() => {
    delete process.env.SITO_PROXY_FIDATI;
  });

  it("predefinito 1 quando manca o è vuota", () => {
    delete process.env.SITO_PROXY_FIDATI;
    assert.equal(proxyFidati(), 1);
    process.env.SITO_PROXY_FIDATI = "";
    assert.equal(proxyFidati(), 1);
  });

  it("un intero valido viene usato", () => {
    process.env.SITO_PROXY_FIDATI = "2";
    assert.equal(proxyFidati(), 2);
  });

  it("0 dice che davanti non c'è nessun proxy", () => {
    process.env.SITO_PROXY_FIDATI = "0";
    assert.equal(proxyFidati(), 0);
  });

  it("un valore scritto male non apre la catena: torna a 1", () => {
    for (const cattivo of ["abc", "-1", "1.5"]) {
      process.env.SITO_PROXY_FIDATI = cattivo;
      assert.equal(proxyFidati(), 1, `«${cattivo}» deve ricadere su 1`);
    }
  });
});
