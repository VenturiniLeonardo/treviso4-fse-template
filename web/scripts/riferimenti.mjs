#!/usr/bin/env node
/**
 * Assicura le due anagrafiche di riferimento: gli anni sociali e le sei unità.
 *
 *   npm run db:applica        prima: crea le tabelle
 *   npm run db:riferimenti    poi:   ci mette il reticolo
 *
 * Idempotente. Non è l'importatore della fase 10 e non lo sostituisce: quello
 * legge i JSON, produce un rapporto e rifiuta i dati incompleti. Questo riempie
 * due tabelle che non hanno uno store e senza le quali album e documenti non
 * possono esistere, perché `anno_id` è NOT NULL.
 */
import { assicuraRiferimenti } from "@/lib/db/riferimenti";
import { percorsoDb } from "@/lib/db/percorso";

console.log(`database: ${percorsoDb()}`);
const e = assicuraRiferimenti();
console.log(`  unità:  ${e.unitaCreate} create, ${e.unitaPresenti} presenti`);
console.log(`  anni:   ${e.anniCreati} creati, ${e.anniPresenti} presenti`);
