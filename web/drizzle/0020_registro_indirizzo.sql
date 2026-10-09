-- L'indirizzo IP da cui è partita ogni operazione del registro: chi, quando,
-- che cosa e da dove. Lo legge solo lo sviluppatore, non il gestore.
-- Nullo per le voci scritte prima (l'indirizzo non si è mai saputo) e per
-- quelle senza una richiesta dietro. Ottobre 2026.

ALTER TABLE `registro` ADD `indirizzo` text;
