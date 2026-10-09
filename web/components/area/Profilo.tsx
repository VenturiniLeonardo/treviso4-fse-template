"use client";

import { useActionState } from "react";
import {
  cambiaAutenticatore,
  chiudiAccesso,
  confermaNuovoAutenticatore,
  creaCodiciRecupero,
  esciDagliAltriDispositivi,
  azzeraPreferenze,
  salvaPreferenze,
} from "@/app/(area)/area-riservata/profilo/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";
import { type Preferenze, SCELTE } from "@/lib/preferenze";

import type { StatoSicurezzaProfilo } from "@/lib/profilo";

export function PannelloPreferenze({ preferenze }: { preferenze: Preferenze }) {
  const [stato, salva, salvando] = useActionState(salvaPreferenze, AZIONE_INIZIALE);
  const [statoAzzera, azzera, azzerando] = useActionState(azzeraPreferenze, AZIONE_INIZIALE);

  return (
    <form className="adm-form" action={salva} id="preferenze">
      <h2>Preferenze di visualizzazione</h2>
      <span className="adm-note">
        Valgono per questo browser: se entrate dal computer della sede e dal vostro,
        ognuno tiene le proprie. Cambiano solo come si vede, mai quello che si vede.
      </span>

      <fieldset className="adm-scelte">
        <legend className="adm-field__label">Tema</legend>
        {SCELTE.tema.map((s) => (
          <label className="adm-scelta" key={s.valore}>
            <input
              type="radio"
              name="tema"
              value={s.valore}
              defaultChecked={preferenze.tema === s.valore}
            />
            <span>
              <strong>{s.label}</strong>
              <em>{s.nota}</em>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="adm-scelte">
        <legend className="adm-field__label">Densità delle tabelle</legend>
        {SCELTE.densita.map((s) => (
          <label className="adm-scelta" key={s.valore}>
            <input
              type="radio"
              name="densita"
              value={s.valore}
              defaultChecked={preferenze.densita === s.valore}
            />
            <span>
              <strong>{s.label}</strong>
              <em>{s.nota}</em>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="adm-scelte">
        <legend className="adm-field__label">Dimensione del testo</legend>
        {SCELTE.testo.map((s) => (
          <label className="adm-scelta" key={s.valore}>
            <input
              type="radio"
              name="testo"
              value={s.valore}
              defaultChecked={preferenze.testo === s.valore}
            />
            <span>
              <strong>{s.label}</strong>
              <em>{s.nota}</em>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="adm-scelte">
        <legend className="adm-field__label">Movimento</legend>
        <label className="adm-scelta">
          <input type="checkbox" name="fermo" defaultChecked={preferenze.fermo} />
          <span>
            <strong>Ferma le animazioni</strong>
            <em>
              Utile se le transizioni disturbano. Se il sistema operativo lo chiede già,
              il sito le ferma comunque, anche senza questa casella.
            </em>
          </span>
        </label>
      </fieldset>

      <Esito stato={stato} />
      <Esito stato={statoAzzera} />

      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" type="submit" disabled={salvando}>
          {salvando ? "Salvataggio…" : "Salva le preferenze"}
        </button>
        <button
          className="adm-btn"
          type="submit"
          formAction={azzera}
          disabled={azzerando}
          formNoValidate
        >
          {azzerando ? "Ripristino…" : "Rimetti i valori predefiniti"}
        </button>
      </div>
    </form>
  );
}


const SICUREZZA_INIZIALE: StatoSicurezzaProfilo = { stato: "vuoto" };

function CampoCodice({ nuovo = false }: { nuovo?: boolean }) {
  return <label className="adm-field"><span className="adm-field__label">{nuovo ? "Codice del nuovo autenticatore" : "Codice dell’autenticatore o di recupero"}</span>
    <input name="codice" required autoComplete="one-time-code" maxLength={40} spellCheck={false} autoCapitalize="none" />
    <span className="adm-field__hint">{nuovo ? "Le sei cifre mostrate sul nuovo telefono." : "Per confermare la vostra identità. Ogni codice si usa una sola volta."}</span>
  </label>;
}

function Codici({ codici }: { codici?: string[] }) {
  if (!codici) return null;
  return <div className="adm-notice"><span className="adm-notice__tag">Codici di recupero · da conservare</span><ul>{codici.map((c) => <li key={c}><code>{c}</code></li>)}</ul><p>Ogni codice permette un accesso insieme alla password, se perdete il telefono. Copiateli ora e conservateli separatamente dal telefono.</p></div>;
}

export function PannelloSecondoFattore({ attivo, richiesto = true, rimanenti }: { attivo: boolean; /** falso se chi amministra ha tolto il secondo fattore a quest’account */ richiesto?: boolean; rimanenti: number }) {
  const [statoCodici, crea, creando] = useActionState(creaCodiciRecupero, SICUREZZA_INIZIALE);
  const [statoCambio, cambia, cambiando] = useActionState(cambiaAutenticatore, SICUREZZA_INIZIALE);
  if (!richiesto && !attivo) {
    return <section className="adm-form" id="sicurezza" aria-label="Verifica con codice">
      <h2>Verifica con codice</h2>
      <p className="adm-note">Per questo account non è richiesto: all’accesso bastano nome utente e password. Se serve attivarlo, chiedete a chi amministra il sito.</p>
    </section>;
  }
  return <section className="adm-form" id="sicurezza" aria-label="Verifica con codice e recupero accesso">
    <h2>Verifica con codice e recupero accesso</h2>
    <p className="adm-note">{attivo ? "Autenticatore attivo." : "Autenticatore non attivo."} {rimanenti} codici di recupero disponibili.</p>
      <form action={crea}>
        <h3>Codici di recupero</h3><p className="adm-note">Generateli prima di perdere il telefono. Una nuova serie annulla la precedente.</p>
        <CampoCodice /><Esito stato={statoCodici} /><Codici codici={statoCodici.codici} />
        <button className="adm-btn" disabled={creando}>{creando ? "Generazione…" : "Genera nuovi codici"}</button>
      </form>
      <form action={cambia}>
        <h3>Cambia telefono o applicazione</h3><CampoCodice /><Esito stato={statoCambio} />
        <button className="adm-btn" disabled={cambiando}>{cambiando ? "Preparazione…" : "Configura un nuovo autenticatore"}</button>
      </form>
      {statoCambio.segreto ? <ConfermaAutenticatore key={statoCambio.segreto} segreto={statoCambio.segreto} qr={statoCambio.qr ?? ""} /> : null}
      <p className="adm-note">Se avete perso sia il telefono sia i codici, contattate chi amministra il sito per verificare la vostra identità e ripristinare l’accesso.</p>
  </section>;
}

function ConfermaAutenticatore({ segreto, qr }: { segreto: string; qr: string }) {
  const [stato, conferma, inCorso] = useActionState(confermaNuovoAutenticatore, SICUREZZA_INIZIALE);
  if (stato.codici) return <><Esito stato={stato} /><Codici codici={stato.codici} /></>;
  return <form action={conferma}>
    <div className="adm-totp-qr" dangerouslySetInnerHTML={{ __html: qr }} />
    <p className="adm-note">Se non potete inquadrare il codice QR, inserite questa chiave nell’app di autenticazione: <code>{segreto}</code></p>
    <CampoCodice nuovo /><Esito stato={stato} />
    <button className="adm-btn adm-btn--primary" disabled={inCorso}>{inCorso ? "Verifica…" : "Conferma il nuovo autenticatore"}</button>
  </form>;
}

function ChiudiSessione({ id }: { id: number }) {
  const [stato, chiudi, inCorso] = useActionState(chiudiAccesso, AZIONE_INIZIALE);
  return <form action={chiudi}><input type="hidden" name="id" value={id} /><button className="adm-btn" disabled={inCorso}>{inCorso ? "Chiusura…" : "Chiudi accesso"}</button><Esito stato={stato} /></form>;
}

export function PannelloSessioni({ sessioni }: { sessioni: { id: number; creataIl: string; ultimoUso: string; ip: string | null; corrente: boolean }[] }) {
  const [stato, chiudi, inCorso] = useActionState(esciDagliAltriDispositivi, AZIONE_INIZIALE);
  const data = (iso: string) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  return <section className="adm-form" id="accessi" aria-label="Accessi aperti"><h2>Accessi aperti</h2><p className="adm-note">Potete chiudere gli accessi che non riconoscete. Questo browser rimane collegato.</p>
    <ul>{sessioni.map((s) => <li key={s.id}><strong>{s.corrente ? "Questo browser" : "Altro accesso"}</strong><p className="adm-note">Aperto il {data(s.creataIl)} · ultima attività {data(s.ultimoUso)}{s.ip ? ` · indirizzo ${s.ip}` : ""}</p>{!s.corrente ? <ChiudiSessione id={s.id} /> : null}</li>)}</ul>
    <form action={chiudi}><button className="adm-btn" disabled={inCorso || !sessioni.some((s) => !s.corrente)}>{inCorso ? "Chiusura…" : "Esci dagli altri dispositivi"}</button><Esito stato={stato} /></form>
  </section>;
}
