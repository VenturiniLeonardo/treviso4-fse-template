-- AGGIUNTA A MANO: il trigger. Non rigenerare senza rileggere questa nota.
--
-- Drizzle non modella i trigger, e §9 del piano prevede il caso: «rinominare o
-- restringere… si fa, ma con una migrazione scritta a mano». Le istruzioni
-- `CREATE TABLE` e `CREATE INDEX` qui sopra le ha generate drizzle-kit; il
-- `CREATE TRIGGER` in fondo è scritto a mano ed è copiato da §5 del piano, dove
-- è dichiarato «eseguito su SQLite e provato».
--
CREATE TABLE `album_assenze` (
	`album_id` integer NOT NULL,
	`iscrizione_id` integer NOT NULL,
	`dichiarata_da` integer NOT NULL,
	`dichiarata_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	PRIMARY KEY(`album_id`, `iscrizione_id`),
	FOREIGN KEY (`album_id`) REFERENCES `album`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`iscrizione_id`) REFERENCES `iscrizioni`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dichiarata_da`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `assenze_album` ON `album_assenze` (`album_id`);
--> statement-breakpoint
-- ==========================================================================
-- Il cancello dei consensi. §5 del piano.
--
-- Un album non diventa `pubblicato` se in quell'anno, e in quell'unità, esiste
-- un iscritto senza consenso alle immagini che **non** sia stato dichiarato
-- assente da quell'album.
--
-- Tre dettagli che meritano di essere letti:
--
--   `NEW.unita_id IS NULL OR i.unita_id = NEW.unita_id`
--       un album di gruppo guarda **tutte** le unità. È la stessa lettura che
--       ne dà `statoConsensi()` quando l'unità è assente.
--
--   una sola istruzione, `SELECT RAISE(...) WHERE EXISTS (...)`
--       `RAISE` scatta solo se la `EXISTS` trova qualcuno. Scritto con un `IF`
--       non si potrebbe: SQLite non ne ha, nei trigger.
--
--   `BEFORE UPDATE OF stato`, non `AFTER`
--       la riga non deve cambiare affatto. Con `AFTER` l'`ABORT` annullerebbe
--       comunque la transazione, ma il trigger girerebbe su ogni `UPDATE` della
--       tabella invece che sui soli cambi di stato.
--
-- LIMITE DICHIARATO: il trigger è su UPDATE e non su INSERT. Una riga inserita
-- già `pubblicato` non passa da qui — ed è ciò che fa il seme dei tredici album
-- dimostrativi. L'applicazione arriva a `pubblicato` **soltanto** con un
-- `UPDATE` (`cambiaStatoAlbum`), quindi la strada vera è coperta; aggiungere il
-- trigger su INSERT bloccherebbe la materializzazione del seme in modo
-- imprevedibile, a seconda che gli iscritti siano già stati registrati o no.
-- Vedi docs/implementation/consensi.md §5.
-- ==========================================================================
CREATE TRIGGER album_niente_pubblicazione_senza_consensi
BEFORE UPDATE OF stato ON album
WHEN NEW.stato = 'pubblicato'
BEGIN
  SELECT RAISE(ABORT, 'consensi immagini mancanti')
  WHERE EXISTS (
    SELECT 1 FROM iscrizioni i
    WHERE i.anno_id = NEW.anno_id
      AND i.consenso_immagini = 0
      AND (NEW.unita_id IS NULL OR i.unita_id = NEW.unita_id)
      AND i.id NOT IN (SELECT iscrizione_id FROM album_assenze
                       WHERE album_id = NEW.id)
  );
END;
