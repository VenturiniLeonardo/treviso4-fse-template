# Sicurezza

Il sito gestisce dati di minori (iscritti, consensi, fotografie): le
segnalazioni di sicurezza sono benvenute e vengono prese sul serio.

## Come segnalare una vulnerabilità

**Non aprite una issue pubblica.** Usate la segnalazione privata di GitHub:
scheda *Security* del repository → *Report a vulnerability*.

Indicate, se potete:

- che cosa si può fare e con quale ruolo (visitatore, referente di unità, …);
- i passi per riprodurla;
- la versione o il commit.

Riceverete una risposta il prima possibile. Vi chiediamo di non divulgare il
problema finché non è stato corretto.

## Che cosa non è nel repository

Nessun segreto, nessun dato e nessuna configurazione di un server reale: le
chiavi vanno nell'ambiente (vedi `web/.env.esempio`), e database, file caricati
e copie di sicurezza stanno fuori da git.
