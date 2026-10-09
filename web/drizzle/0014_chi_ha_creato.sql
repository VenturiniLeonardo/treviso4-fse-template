-- SCRITTA A MANO, partendo da quella di drizzle-kit. Audit degli accessi del
-- 4 ottobre 2026.
--
-- Tre cose:
--
--   1. `creato_da` su `album` e `attivita`: chi li ha creati. `autore_id` è
--      chi li ha toccati per ultimo, e non basta a dire «questo album è suo»,
--      che è la domanda che il social media manager ora deve passare: prepara
--      contenuti per tutte le unità, ma tocca, ritira ed elimina solo i propri.
--      drizzle-kit aveva scritto la chiave esterna senza `ON DELETE SET NULL`,
--      che è quello che lo schema dichiara: aggiunto qui. Le righe esistenti si
--      riempiono, dove si può, dalla riga di creazione nel registro; dove non si
--      può resta NULL, cioè «di nessuno» — non del social.
--
--   2. tre righe nuove in `permessi`, solo se la matrice è già stata seminata
--      (su un database vuoto le scrive il seme, e qui non si inventa niente):
--        - `iscritti-elenco`, CONSULTARE iscritti e consensi. Nasce con i livelli
--          che ogni ruolo ha oggi su `iscritti`, così nessuno perde né guadagna
--          la lettura; `iscritti` resta la riga di chi li REGISTRA;
--        - `registro`, leggere il registro delle operazioni: sviluppatore e referente
--          gruppo;
--        - `privacy`, le richieste degli interessati: sviluppatore e gestore.
--          La cancellazione dei dati resta `gdpr`, dello sviluppatore.
--      `npm run db:permessi` le aggiungerebbe comunque dal seme; farlo qui evita
--      che fra il riavvio e quel comando un referente di unità perda l'elenco iscritti.
--
--   3. `esporta` del gestore da «limitato» a «completo», solo se era
--      «limitato»: per lui i due valori facevano la stessa cosa (`copre()` gli
--      dà tutte le unità), e una cella che mostra una restrizione che non c'è è
--      una bugia della schermata. Non apre niente che non fosse già aperto.

ALTER TABLE `album` ADD `creato_da` integer REFERENCES utenti(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `attivita` ADD `creato_da` integer REFERENCES utenti(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `album` SET `creato_da` = (
	SELECT r.`utente_id` FROM `registro` r
	WHERE r.`origine` = 'album'
		AND r.`operazione` LIKE 'Creato l’album «' || `album`.`titolo` || '»%'
	ORDER BY r.`id` LIMIT 1
);--> statement-breakpoint
UPDATE `attivita` SET `creato_da` = (
	SELECT r.`utente_id` FROM `registro` r
	WHERE r.`origine` = 'attivita'
		AND r.`operazione` = 'Creata l’attività «' || `attivita`.`titolo` || '»'
	ORDER BY r.`id` LIMIT 1
);--> statement-breakpoint
UPDATE `permessi` SET `nome` = 'Registrare iscrizioni e consensi' WHERE `funzione` = 'iscritti';--> statement-breakpoint
INSERT INTO `permessi` (`funzione`, `nome`, `ruolo`, `livello`, `ordine`)
	SELECT 'iscritti-elenco', 'Consultare iscritti e consensi', `ruolo`, `livello`, `ordine`
	FROM `permessi` WHERE `funzione` = 'iscritti'
		AND NOT EXISTS (SELECT 1 FROM `permessi` WHERE `funzione` = 'iscritti-elenco');--> statement-breakpoint
INSERT INTO `permessi` (`funzione`, `nome`, `ruolo`, `livello`, `ordine`)
	SELECT 'registro', 'Leggere il registro delle operazioni', `ruolo`,
		CASE WHEN `ruolo` IN ('sviluppatore', 'gestore') THEN 'completo' ELSE 'nessuno' END,
		(SELECT max(`ordine`) + 1 FROM `permessi`)
	FROM `permessi` WHERE `funzione` = 'utenti'
		AND NOT EXISTS (SELECT 1 FROM `permessi` WHERE `funzione` = 'registro');--> statement-breakpoint
INSERT INTO `permessi` (`funzione`, `nome`, `ruolo`, `livello`, `ordine`)
	SELECT 'privacy', 'Richieste degli interessati (privacy)', `ruolo`,
		CASE WHEN `ruolo` IN ('sviluppatore', 'gestore') THEN 'completo' ELSE 'nessuno' END,
		(SELECT max(`ordine`) + 1 FROM `permessi`)
	FROM `permessi` WHERE `funzione` = 'utenti'
		AND NOT EXISTS (SELECT 1 FROM `permessi` WHERE `funzione` = 'privacy');--> statement-breakpoint
UPDATE `permessi` SET `livello` = 'completo'
	WHERE `funzione` = 'esporta' AND `ruolo` = 'gestore' AND `livello` = 'limitato';
