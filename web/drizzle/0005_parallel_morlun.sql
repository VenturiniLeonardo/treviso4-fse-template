PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_registro` (
	`id` integer PRIMARY KEY NOT NULL,
	`quando` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`utente_id` integer,
	`utente` text NOT NULL,
	`nome` text NOT NULL,
	`ruolo` text NOT NULL,
	`tipo` text NOT NULL,
	`operazione` text NOT NULL,
	`origine` text NOT NULL,
	`esito` text DEFAULT 'ok' NOT NULL,
	FOREIGN KEY (`utente_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "registro_tipo" CHECK("__new_registro"."tipo" IN ('accesso','uscita','contenuto','pubblicazione','eliminazione','configurazione','permessi','consenso','iscritti')),
	CONSTRAINT "registro_esito" CHECK("__new_registro"."esito" IN ('ok','rifiutato'))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_registro`("id", "quando", "utente_id", "utente", "nome", "ruolo", "tipo", "operazione", "origine", "esito") SELECT "id", "quando", "utente_id", "utente", "nome", "ruolo", "tipo", "operazione", "origine", "esito" FROM `registro`;--> statement-breakpoint
DROP TABLE `registro`;--> statement-breakpoint
ALTER TABLE `__new_registro` RENAME TO `registro`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `registro_quando` ON `registro` (`quando`);--> statement-breakpoint
CREATE INDEX `registro_utente_quando` ON `registro` (`utente`,`quando`);