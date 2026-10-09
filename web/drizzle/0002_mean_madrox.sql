-- CORRETTA A MANO. Non rigenerare senza rileggere questa nota.
--
-- drizzle-kit ricostruisce `sessioni` per aggiungere `stato` con il suo CHECK,
-- e nel travaso scriveva  SELECT …, "stato" FROM `sessioni`  — cioè leggeva la
-- colonna nuova dalla tabella **vecchia**, che non ce l'ha. SQLite convalida le
-- istruzioni quando le prepara, non quando trovano righe: la migrazione
-- sarebbe fallita anche su un database vuoto, e siccome il migratore di Drizzle
-- racchiude tutte le migrazioni in **una** transazione, si sarebbe portata
-- dietro anche le precedenti. Un `db:applica` apparentemente riuscito lascia un
-- database vuoto. È già successo con 0001.
--
-- La correzione è la costante `'attiva'` al posto del nome della colonna: le
-- sessioni che esistevano prima di questa migrazione erano già autenticate del
-- tutto, quindi «attiva» è il valore giusto, non un ripiego.
--
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tentativi_accesso` (
	`id` integer PRIMARY KEY NOT NULL,
	`tipo` text NOT NULL,
	`chiave` text NOT NULL,
	`quando` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	CONSTRAINT "tentativi_tipo" CHECK("__new_tentativi_accesso"."tipo" IN ('utente','ip'))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_tentativi_accesso`("id", "tipo", "chiave", "quando") SELECT "id", "tipo", "chiave", "quando" FROM `tentativi_accesso`;--> statement-breakpoint
DROP TABLE `tentativi_accesso`;--> statement-breakpoint
ALTER TABLE `__new_tentativi_accesso` RENAME TO `tentativi_accesso`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tentativi_tipo_chiave_quando` ON `tentativi_accesso` (`tipo`,`chiave`,`quando`);--> statement-breakpoint
CREATE TABLE `__new_sessioni` (
	`id` integer PRIMARY KEY NOT NULL,
	`utente_id` integer NOT NULL,
	`impronta` text NOT NULL,
	`creata_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`ultimo_uso` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`scade_il` text NOT NULL,
	`ip` text,
	`stato` text DEFAULT 'attiva' NOT NULL,
	FOREIGN KEY (`utente_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessioni_stato" CHECK("__new_sessioni"."stato" IN ('attesa_totp','attiva'))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_sessioni`("id", "utente_id", "impronta", "creata_il", "ultimo_uso", "scade_il", "ip", "stato") SELECT "id", "utente_id", "impronta", "creata_il", "ultimo_uso", "scade_il", "ip", 'attiva' FROM `sessioni`;--> statement-breakpoint
DROP TABLE `sessioni`;--> statement-breakpoint
ALTER TABLE `__new_sessioni` RENAME TO `sessioni`;--> statement-breakpoint
CREATE UNIQUE INDEX `sessioni_impronta_unique` ON `sessioni` (`impronta`);--> statement-breakpoint
CREATE INDEX `sessioni_scade` ON `sessioni` (`scade_il`);--> statement-breakpoint
ALTER TABLE `utenti` ADD `totp_attivato_il` text;--> statement-breakpoint
ALTER TABLE `utenti` ADD `totp_ultimo_passo` integer;