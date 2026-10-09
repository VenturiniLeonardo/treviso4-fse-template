-- SCRITTA A MANO, partendo da quella di drizzle-kit. Le cartelle dei documenti,
-- e i documenti «sempre validi».
--
-- La generata era giusta nella forma e sbagliata in un punto, lo stesso che
-- 0007 aveva già dovuto correggere: ricostruiva `documenti` dietro un
-- `PRAGMA foreign_keys=OFF` che dentro la transazione del migratore non fa
-- niente, e **non scriveva nessuna cartella**. Con la nuova chiave esterna su
-- `categoria`, la copia delle righe esistenti sarebbe fallita alla prima riga:
-- ogni documento punta a una cartella che non c'era ancora.
--
-- Quindi, nell'ordine:
--
--   1. `cartelle`, e le sei di partenza — le categorie che `documenti_categoria`
--      ammetteva fino a qui, con le etichette di `CATEGORIE_DOC`;
--   2. `documenti` ricostruita: `anno_id` perde il NOT NULL (NULL = sempre
--      valido), `categoria` diventa una chiave esterna su `cartelle(chiave)` e
--      il CHECK con l'elenco chiuso se ne va. Gli altri tre CHECK restano
--      com'erano, `documenti_circolari_hanno_unita` compreso.
--
-- La ricostruzione è sicura per la ragione di 0007: nessuna tabella referenzia
-- `documenti`, quindi non c'è niente da spegnere — e spegnerlo dentro una
-- transazione non farebbe niente comunque.

-- ==========================================================================
-- cartelle
-- ==========================================================================
CREATE TABLE `cartelle` (
	`id` integer PRIMARY KEY NOT NULL,
	`chiave` text NOT NULL,
	`titolo` text NOT NULL,
	`descrizione` text DEFAULT '' NOT NULL,
	`ordine` integer NOT NULL,
	`aggiornato_il` text,
	`autore_id` integer,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "cartelle_chiave_forma" CHECK("cartelle"."chiave" GLOB '[a-z0-9]*' AND "cartelle"."chiave" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "cartelle_ordine" CHECK("cartelle"."ordine" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `cartelle_chiave_unique` ON `cartelle` (`chiave`);--> statement-breakpoint
-- Le sei di partenza, nell'ordine dei filtri della vecchia pagina. Da qui in
-- avanti i nomi li cambiano i gestori: correggere `CATEGORIE_DOC` in
-- lib/data.ts non cambia queste righe.
INSERT INTO `cartelle` (`chiave`, `titolo`, `ordine`) VALUES
	('iscrizioni', 'Label 1', 1),
	('autorizzazioni', 'Label 2', 2),
	('campi', 'Label 3', 3),
	('quote', 'Label 4', 4),
	('statuti', 'Label 5', 5),
	('circolari', 'Label 6', 6);
--> statement-breakpoint

-- ==========================================================================
-- documenti: anno facoltativo, categoria come chiave esterna
-- ==========================================================================
CREATE TABLE `__new_documenti` (
	`id` integer PRIMARY KEY NOT NULL,
	`chiave` text NOT NULL,
	`anno_id` integer,
	`unita_id` integer,
	`categoria` text NOT NULL,
	`titolo` text NOT NULL,
	`nota` text DEFAULT '' NOT NULL,
	`formato` text DEFAULT 'PDF' NOT NULL,
	`peso` text DEFAULT '—' NOT NULL,
	`aggiornamento` text DEFAULT '' NOT NULL,
	`stato` text DEFAULT 'bozza' NOT NULL,
	`file` text,
	`aggiornato_il` text,
	`autore_id` integer,
	FOREIGN KEY (`anno_id`) REFERENCES `anni_sociali`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unita_id`) REFERENCES `unita`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`categoria`) REFERENCES `cartelle`(`chiave`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "documenti_formato" CHECK(`formato` IN ('PDF','DOCX')),
	CONSTRAINT "documenti_stato" CHECK(`stato` IN ('bozza','in_revisione','pubblicato')),
	CONSTRAINT "documenti_circolari_hanno_unita" CHECK((`categoria` = 'circolari') = (`unita_id` IS NOT NULL))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_documenti`("id", "chiave", "anno_id", "unita_id", "categoria", "titolo", "nota", "formato", "peso", "aggiornamento", "stato", "file", "aggiornato_il", "autore_id") SELECT "id", "chiave", "anno_id", "unita_id", "categoria", "titolo", "nota", "formato", "peso", "aggiornamento", "stato", "file", "aggiornato_il", "autore_id" FROM `documenti`;--> statement-breakpoint
DROP TABLE `documenti`;--> statement-breakpoint
ALTER TABLE `__new_documenti` RENAME TO `documenti`;--> statement-breakpoint
CREATE UNIQUE INDEX `documenti_chiave_unique` ON `documenti` (`chiave`);--> statement-breakpoint
CREATE UNIQUE INDEX `documenti_file` ON `documenti` (`file`);--> statement-breakpoint
CREATE INDEX `documenti_anno_categoria` ON `documenti` (`anno_id`,`categoria`);--> statement-breakpoint
CREATE INDEX `documenti_unita` ON `documenti` (`unita_id`);
