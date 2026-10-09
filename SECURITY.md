# Security

This application handles data about minors (members, consents, photographs).
Security reports are welcome and taken seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private reporting instead:
the repository's *Security* tab → *Report a vulnerability*.

If you can, include:

- what an attacker can do, and with which role (visitor, unit lead, …);
- the steps to reproduce it;
- the version or commit you tested.

You will get an answer as soon as possible. Please do not disclose the issue
until it has been fixed.

## What is not in this repository

No secrets, no data and no configuration of a real server. Keys belong in the
environment (see `web/.env.esempio`), and the database, uploaded files and
backups are kept out of git.
