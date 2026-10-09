-- SCRITTA A MANO, partendo da quella di drizzle-kit. Il social media manager:
-- il quarto ruolo, e la tabella `proposte` dove aspetta quello che prepara.
--
-- Tre cose, nell'ordine:
--
--   1. `proposte`, nuova. Nessuno la referenzia;
--   2. `permessi` ricostruita, per allargare il CHECK `permessi_ruolo` a
--      `social`. Nessuno la referenzia, quindi è la ricostruzione di 0007 e 0012;
--   3. `utenti` ricostruita, per lo stesso CHECK su `utenti_ruolo`. E qui no.
--
-- ## Perché `utenti` non si ricostruisce come le altre
--
-- Ventuno chiavi esterne puntano a `utenti`, diciassette con ON DELETE SET
-- NULL e tre con CASCADE. Con le chiavi esterne accese, `DROP TABLE utenti`
-- fa prima un DELETE implicito di tutte le righe, e quel DELETE **esegue le
-- azioni**: ogni `autore_id` del sito diventerebbe NULL e le sessioni
-- sparirebbero, senza un errore. SQLite non sa cambiare un CHECK in altro modo
-- (`writable_schema` è chiuso dalla modalità difensiva di better-sqlite3, e
-- per fortuna), e `PRAGMA foreign_keys=OFF` dentro una transazione non fa
-- niente — drizzle-kit l'aveva scritto qui sotto, ed era una riga che non
-- avrebbe fatto quello che diceva.
--
-- È la procedura in dodici passi di https://sqlite.org/lang_altertable.html
-- §7, e il suo primo passo — spegnere le chiavi esterne — va fatto **fuori**
-- dalla transazione del migratore. Lo fa `scripts/applica.mjs`, che da questa
-- migrazione in poi è `npm run db:applica`, e che dopo controlla con
-- `PRAGMA foreign_key_check` che nessun riferimento sia rimasto appeso.
--
-- ## La guardia
--
-- `drizzle-kit migrate` lanciato a mano accende le chiavi esterne, e su un
-- database con degli account farebbe esattamente il danno descritto sopra. Le
-- tre righe qui sotto lo fermano prima di toccare qualsiasi cosa: se le chiavi
-- esterne sono accese e `utenti` ha righe, il CHECK della tabella temporanea
-- fallisce con il proprio nome come messaggio, e la transazione si annulla
-- intera. Su un database nuovo — CI, prove — `utenti` è vuota e il DELETE
-- implicito non ha niente da propagare: la guardia lascia passare.

CREATE TEMP TABLE `__guardia_0013` (
	`ok` integer NOT NULL,
	CONSTRAINT "0013_va_applicata_con_npm_run_db_applica" CHECK(`ok` = 1)
);
--> statement-breakpoint
INSERT INTO `__guardia_0013` SELECT CASE
	WHEN (SELECT foreign_keys FROM pragma_foreign_keys) = 1 AND EXISTS (SELECT 1 FROM `utenti`) THEN 0
	ELSE 1
END;
--> statement-breakpoint
DROP TABLE `__guardia_0013`;
--> statement-breakpoint

-- ==========================================================================
-- proposte
-- ==========================================================================
CREATE TABLE `proposte` (
	`id` integer PRIMARY KEY NOT NULL,
	`tipo` text NOT NULL,
	`chiave` text NOT NULL,
	`valore` text NOT NULL,
	`file` text,
	`autore_id` integer,
	`creato_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "proposte_tipo" CHECK("proposte"."tipo" IN ('pagina','faq','immagine','copertina')),
	CONSTRAINT "proposte_chiave" CHECK(length("proposte"."chiave") > 0),
	CONSTRAINT "proposte_file_solo_immagini" CHECK("proposte"."file" IS NULL OR "proposte"."tipo" IN ('immagine','copertina'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `proposte_tipo_chiave` ON `proposte` (`tipo`,`chiave`);--> statement-breakpoint

-- ==========================================================================
-- permessi: il CHECK sui ruoli
-- ==========================================================================
CREATE TABLE `__new_permessi` (
	`id` integer PRIMARY KEY NOT NULL,
	`funzione` text NOT NULL,
	`nome` text NOT NULL,
	`ruolo` text NOT NULL,
	`livello` text NOT NULL,
	`ordine` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "permessi_ruolo" CHECK("__new_permessi"."ruolo" IN ('sviluppatore','gestore','referente','social')),
	CONSTRAINT "permessi_livello" CHECK("__new_permessi"."livello" IN ('completo','limitato','nessuno')),
	CONSTRAINT "permessi_ordine" CHECK("__new_permessi"."ordine" >= 0)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_permessi`("id", "funzione", "nome", "ruolo", "livello", "ordine") SELECT "id", "funzione", "nome", "ruolo", "livello", "ordine" FROM `permessi`;--> statement-breakpoint
DROP TABLE `permessi`;--> statement-breakpoint
ALTER TABLE `__new_permessi` RENAME TO `permessi`;--> statement-breakpoint
CREATE UNIQUE INDEX `permessi_funzione_ruolo` ON `permessi` (`funzione`,`ruolo`);--> statement-breakpoint
CREATE INDEX `permessi_ordine_idx` ON `permessi` (`ordine`,`funzione`);--> statement-breakpoint

-- ==========================================================================
-- utenti: lo stesso CHECK. Le colonne si copiano per nome: nel database in
-- esercizio le due del secondo fattore stanno in fondo, aggiunte con ADD
-- COLUMN, e un SELECT * le avrebbe scambiate con `stato` e `creato_il`.
-- ==========================================================================
CREATE TABLE `__new_utenti` (
	`id` integer PRIMARY KEY NOT NULL,
	`utente` text NOT NULL,
	`email` text,
	`nome` text NOT NULL,
	`iniziali` text NOT NULL,
	`ruolo` text NOT NULL,
	`unita_id` integer,
	`password_hash` text,
	`totp_secret` text,
	`totp_attivato_il` text,
	`totp_ultimo_passo` integer,
	`stato` text DEFAULT 'invitato' NOT NULL,
	`creato_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`ultimo_accesso` text,
	FOREIGN KEY (`unita_id`) REFERENCES `unita`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "utenti_ruolo" CHECK("__new_utenti"."ruolo" IN ('sviluppatore','gestore','referente','social')),
	CONSTRAINT "utenti_stato" CHECK("__new_utenti"."stato" IN ('invitato','attivo','revocato')),
	CONSTRAINT "utenti_unita_solo_referente" CHECK(("__new_utenti"."ruolo" = 'referente') = ("__new_utenti"."unita_id" IS NOT NULL))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_utenti`("id", "utente", "email", "nome", "iniziali", "ruolo", "unita_id", "password_hash", "totp_secret", "totp_attivato_il", "totp_ultimo_passo", "stato", "creato_il", "ultimo_accesso") SELECT "id", "utente", "email", "nome", "iniziali", "ruolo", "unita_id", "password_hash", "totp_secret", "totp_attivato_il", "totp_ultimo_passo", "stato", "creato_il", "ultimo_accesso" FROM `utenti`;--> statement-breakpoint
DROP TABLE `utenti`;--> statement-breakpoint
ALTER TABLE `__new_utenti` RENAME TO `utenti`;--> statement-breakpoint
-- I due indici come li scrisse 0000: drizzle-kit li rigenera con l'espressione
-- fra apici inversi, cioè come il nome di una colonna `lower("utente")` che
-- non esiste, e la migrazione si fermava qui.
CREATE UNIQUE INDEX `utenti_utente` ON `utenti` (lower("utente"));--> statement-breakpoint
CREATE UNIQUE INDEX `utenti_email` ON `utenti` (lower("email"));