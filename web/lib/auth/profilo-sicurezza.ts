import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { dbSeEsiste, transazione, type Handle } from "@/lib/db/db";
import { sessioni, utenti } from "@/lib/db/schema";
import { cifra, decifra } from "@/lib/auth/cifratura";
import { nuovoSegreto, verificaCodice } from "@/lib/auth/totp";
import { INATTIVITA_S } from "@/lib/auth/sessioni";

const adesso = sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')`;
const impronta = (codice: string) => createHash("sha256").update(codice).digest("hex");
const normalizza = (codice: string) => codice.replace(/[\s-]/g, "").toLowerCase();

function hashes(testo: string | null): string[] {
  if (!testo) return [];
  const valori: unknown = JSON.parse(testo);
  return Array.isArray(valori) && valori.every((v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)) ? valori : [];
}

/** Non basta un identificativo: serve la sessione attiva di questo account. */
function sessioneValida(d: Handle, utenteId: number, sessioneId: number): boolean {
  return !!d.select({ id: sessioni.id }).from(sessioni).innerJoin(utenti, eq(utenti.id, sessioni.utenteId)).where(and(
    eq(sessioni.id, sessioneId), eq(sessioni.utenteId, utenteId), eq(sessioni.stato, "attiva"),
    eq(utenti.stato, "attivo"), eq(utenti.passwordDaCambiare, 0),
    sql`${sessioni.scadeIl} > ${adesso}`,
    sql`${sessioni.ultimoUso} > strftime('%Y-%m-%dT%H:%M:%SZ','now',${`-${INATTIVITA_S} seconds`})`,
  )).get();
}

export function numeroCodiciRecupero(utenteId: number): number {
  const d = dbSeEsiste();
  const r = d?.select({ codici: utenti.codiciRecupero }).from(utenti).where(eq(utenti.id, utenteId)).get();
  return hashes(r?.codici ?? null).length;
}

/** Il codice sparisce nella stessa transazione in cui viene riconosciuto. */
export function consumaCodiceRecupero(utenteId: number, codice: string): boolean {
  const pulito = normalizza(codice);
  if (!/^[a-f0-9]{32}$/.test(pulito)) return false;
  return transazione((d) => {
    const r = d.select().from(utenti).where(eq(utenti.id, utenteId)).get();
    if (!r || r.stato !== "attivo" || !r.totpAttivatoIl) return false;
    const lista = hashes(r.codiciRecupero);
    const cercato = impronta(pulito);
    if (!lista.includes(cercato)) return false;
    d.update(utenti).set({ codiciRecupero: JSON.stringify(lista.filter((h) => h !== cercato)) }).where(eq(utenti.id, utenteId)).run();
    return true;
  });
}

function nuoviCodici(d: Handle, utenteId: number): string[] {
  const codici = Array.from({ length: 8 }, () => randomBytes(16).toString("hex"));
  d.update(utenti).set({ codiciRecupero: JSON.stringify(codici.map(impronta)) }).where(eq(utenti.id, utenteId)).run();
  return codici.map((c) => c.match(/.{8}/g)!.join("-"));
}

/** Chiamata solo dopo una nuova verifica del secondo fattore. */
export function generaCodiciRecupero(utenteId: number, sessioneId: number): string[] | null {
  return transazione((d) => sessioneValida(d, utenteId, sessioneId) ? nuoviCodici(d, utenteId) : null);
}

/** Il vecchio autenticatore resta valido fino alla conferma del nuovo. */
export function preparaAutenticatore(utenteId: number, sessioneId: number): string | null {
  return transazione((d) => {
    if (!sessioneValida(d, utenteId, sessioneId)) return null;
    const segreto = nuovoSegreto();
    d.update(utenti).set({
      totpInAttesa: cifra(JSON.stringify({ segreto, sessioneId })),
      totpInAttesaScadeIl: sql`strftime('%Y-%m-%dT%H:%M:%SZ','now','+5 minutes')`,
    }).where(eq(utenti.id, utenteId)).run();
    return segreto;
  });
}

export function confermaAutenticatore(utenteId: number, sessioneId: number, codice: string, quandoMs = Date.now()): string[] | null {
  return transazione((d) => {
    if (!sessioneValida(d, utenteId, sessioneId)) return null;
    const r = d.select().from(utenti).where(and(eq(utenti.id, utenteId), sql`${utenti.totpInAttesaScadeIl} > ${adesso}`)).get();
    if (!r?.totpInAttesa) return null;
    const dati = JSON.parse(decifra(r.totpInAttesa)) as { segreto: string; sessioneId: number };
    if (dati.sessioneId !== sessioneId) return null;
    const esito = verificaCodice(dati.segreto, codice, null, quandoMs);
    if (!esito.ok) return null;
    d.update(utenti).set({
      totpSecret: cifra(dati.segreto), totpAttivatoIl: adesso, totpUltimoPasso: esito.passo,
      totpInAttesa: null, totpInAttesaScadeIl: null,
    }).where(eq(utenti.id, utenteId)).run();
    // I vecchi codici e le altre sessioni non sopravvivono al cambio di telefono.
    d.delete(sessioni).where(and(eq(sessioni.utenteId, utenteId), sql`${sessioni.id} <> ${sessioneId}`)).run();
    return nuoviCodici(d, utenteId);
  });
}
