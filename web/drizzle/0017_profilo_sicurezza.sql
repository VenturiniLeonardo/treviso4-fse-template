-- Profilo: autenticatore in attesa di conferma, codici di recupero, e la
-- matrice che separa consultare e modificare i permessi. Nata come 0016 il
-- 5 ottobre 2026, rigenerata come 0017 dopo la 0016 di master.

ALTER TABLE `utenti` ADD `totp_in_attesa` text;--> statement-breakpoint
ALTER TABLE `utenti` ADD `totp_in_attesa_scade_il` text;--> statement-breakpoint
ALTER TABLE `utenti` ADD `codici_recupero` text;
--> statement-breakpoint
INSERT OR IGNORE INTO permessi (funzione, nome, ruolo, livello, ordine)
SELECT 'permessi-leggi', 'Consultare la matrice dei permessi', 'sviluppatore', 'completo', (SELECT COALESCE(MAX(ordine), 0) + 1 FROM permessi)
WHERE EXISTS (SELECT 1 FROM permessi);
--> statement-breakpoint
INSERT OR IGNORE INTO permessi (funzione, nome, ruolo, livello, ordine)
SELECT 'permessi-leggi', 'Consultare la matrice dei permessi', 'gestore', 'completo', (SELECT COALESCE(MAX(ordine), 0) + 1 FROM permessi)
WHERE EXISTS (SELECT 1 FROM permessi);
--> statement-breakpoint
INSERT OR IGNORE INTO permessi (funzione, nome, ruolo, livello, ordine)
SELECT 'permessi-leggi', 'Consultare la matrice dei permessi', 'referente', 'nessuno', (SELECT COALESCE(MAX(ordine), 0) + 1 FROM permessi)
WHERE EXISTS (SELECT 1 FROM permessi);
--> statement-breakpoint
INSERT OR IGNORE INTO permessi (funzione, nome, ruolo, livello, ordine)
SELECT 'permessi-leggi', 'Consultare la matrice dei permessi', 'social', 'nessuno', (SELECT COALESCE(MAX(ordine), 0) + 1 FROM permessi)
WHERE EXISTS (SELECT 1 FROM permessi);
--> statement-breakpoint
INSERT OR IGNORE INTO permessi (funzione, nome, ruolo, livello, ordine)
SELECT 'permessi', 'Modificare la matrice dei permessi', 'sviluppatore', 'completo', (SELECT COALESCE(MAX(ordine), 0) + 1 FROM permessi)
WHERE EXISTS (SELECT 1 FROM permessi);
--> statement-breakpoint
INSERT OR IGNORE INTO permessi (funzione, nome, ruolo, livello, ordine)
SELECT 'permessi', 'Modificare la matrice dei permessi', 'gestore', 'nessuno', (SELECT COALESCE(MAX(ordine), 0) + 1 FROM permessi)
WHERE EXISTS (SELECT 1 FROM permessi);
--> statement-breakpoint
INSERT OR IGNORE INTO permessi (funzione, nome, ruolo, livello, ordine)
SELECT 'permessi', 'Modificare la matrice dei permessi', 'referente', 'nessuno', (SELECT COALESCE(MAX(ordine), 0) + 1 FROM permessi)
WHERE EXISTS (SELECT 1 FROM permessi);
--> statement-breakpoint
INSERT OR IGNORE INTO permessi (funzione, nome, ruolo, livello, ordine)
SELECT 'permessi', 'Modificare la matrice dei permessi', 'social', 'nessuno', (SELECT COALESCE(MAX(ordine), 0) + 1 FROM permessi)
WHERE EXISTS (SELECT 1 FROM permessi);
