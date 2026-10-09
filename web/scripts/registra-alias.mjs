/**
 * Registra il risolutore dell'alias `@/` prima che i test vengano caricati.
 *
 *   node --import ./test/registra-alias.mjs --test …
 *
 * Va in un file separato da `alias.mjs` perché `register()` deve girare nel
 * thread principale mentre l'hook gira nel thread dei loader: sono due contesti,
 * e mescolarli non funziona.
 */
import { register } from "node:module";
register("./alias.mjs", import.meta.url);
