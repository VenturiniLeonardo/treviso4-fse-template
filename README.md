# treviso4-fse-template

A public website and a members-only area for an organization made of **units**:
a youth group, an association, a club with sections. One Next.js application
serves both, backed by a single SQLite file.

This is the template behind the website of the **Gruppo Treviso 4 FSE**,
[treviso4fse.it](https://treviso4fse.it). This repository contains only the
code: every name, text, photo and record of the real group has been removed.

> **Everything you see is a placeholder.** Short texts read «Label», long ones
> are Lorem ipsum, and images are neutral shapes. The site is a skeleton to
> fill in.

> **Language note.** The user interface, code identifiers, comments and the
> detailed developer guide in [`web/README.md`](web/README.md) are in
> **Italian**. This page is the English overview, and the
> [glossary](#glossary) maps the Italian terms you will meet.

---

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Signing in to the reserved area](#signing-in-to-the-reserved-area)
- [Roles](#roles)
- [Configuration](#configuration)
- [Commands](#commands)
- [Project structure](#project-structure)
- [Routes](#routes)
- [Making it yours](#making-it-yours)
- [Deployment notes](#deployment-notes)
- [Security](#security)
- [Glossary](#glossary)
- [License](#license)

---

## Features

### Public website

- **Pages:** home, about us, the six units (grouped into three age bands, each
  with its own page), activity calendar with a filter by unit, documents and
  forms organized in folders, contacts with a contact form, legal pages and a
  cookie-preferences panel.
- **Search** across units, activities, documents and pages.
- **Photo albums** protected by a password, one per album. They are **off by
  default** and can be switched on from the reserved area.
- **Fast and static where it can be:** public pages are prerendered at build
  time, so a visit does not touch the database. When an editor saves a change,
  only the affected pages are regenerated.

### Reserved area

- **Invitation-only accounts:** there is no public sign-up. Every account is
  created by someone above it and activated through a single-use link.
- **Two-factor authentication (TOTP)**, required by default, with a per-account
  switch.
- **Four roles with per-feature permissions**, editable from a permission
  matrix. See [Roles](#roles).
- **Editorial workflow:** people who are not allowed to publish make
  *proposals*, and a manager approves or rejects them from a single queue.
- **Content editing without code:**
  - the texts of the home and «about us» pages, and the FAQ;
  - each unit's profile, history, past leaders and cover photo;
  - the photos on the site's pages;
  - the calendar;
  - documents and per-unit circulars;
  - a private document area for unit leads;
  - the group's identity: name, logo, address, contact details.
- **Members and consents:** member lists per unit, image-consent tracking and
  CSV export. An album cannot be published while a consent is missing.
- **Privacy requests (GDPR):** export and erase a person's data, with a log of
  every request.
- **Audit log** of logins and changes. Only the developer role sees the client
  IP.
- **Operations dashboard** for the developer: database, backups, disk space,
  scheduled jobs, mail.

### Under the hood

- **Photo pipeline:** uploads are resized into responsive variants and
  stripped of metadata (EXIF/GPS) with `sharp`, through a background job
  queue.
- **Backups:** a verified copy of the database and the uploaded files, with a
  restore command.
- **Outgoing mail (optional):** messages from the contact form are sent by
  SMTP, using a password or OAuth 2.0 for Microsoft 365. Without mail
  configured, messages are still saved and readable in the reserved area.
- **1,200+ automated tests**, run with Node's built-in test runner.
- **One-command check:** `npm run verifica` runs types, lint, tests and a
  production build in sequence.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | **Next.js 16** (App Router, built with webpack), **React 19** |
| Language | TypeScript |
| Database | **SQLite** via `better-sqlite3`; schema and migrations with **Drizzle ORM** |
| Styling | Hand-written CSS for the public site; **Tailwind CSS 4** (no preflight) in the reserved area only |
| Auth | Database sessions, **argon2id** passwords, **TOTP** second factor with the secret encrypted at rest (AES-256-GCM) |
| Images | `sharp` |
| Mail | `nodemailer` |
| Runtime | **Node.js 22** (`"engines": ">=22 <23"`), `output: "standalone"` |

There is no external database server, cache or queue. Everything lives in one
Node process and one data folder.

---

## Quick start

Requirements: **Node.js 22** and npm.

```bash
cd web
```

```bash
npm ci
```

```bash
cp .env.esempio .env.local
```

```bash
npm run db:applica
```

```bash
npm run db:riferimenti
```

```bash
npm run dev
```

Then open <http://localhost:3000>.

What each step does:

- `npm ci` installs the dependencies.
- `cp .env.esempio .env.local` creates your local configuration. Every variable
  is optional in development.
- `npm run db:applica` creates the SQLite database in `web/dati/` (ignored by
  git) and applies the migrations in `web/drizzle/`.
- `npm run db:riferimenti` seeds the six units, the association years and the
  default texts from `web/lib/data.ts`. Run it once.
- `npm run dev` starts the development server.

To use another port: `npm run dev -- -p 3005`.

---

## Signing in to the reserved area

The first account is created from the command line. Set
`SITO_BASE_URL=http://localhost:3000` in `.env.local` so the printed link is
ready to open, then run:

```bash
npm run db:invita -- admin1 sviluppatore "Your Name" YN
```

The arguments are `<username> <role> "<display name>" <initials> [unit]`:

- the roles are `sviluppatore`, `gestore`, `referente` and `social`;
- `[unit]` is only for a `referente`: one of `u1` … `u6`.

The command prints an invitation link **once**. The database stores only its
hash. The link is valid for 72 hours. To get a new one, run the command again
with just the username; the old link stops working.

Open the link and:

1. choose a password (at least 12 characters);
2. scan the QR code with an authenticator app (Aegis, Google Authenticator, a
   password manager…) and type the six-digit code.

From then on, sign in at `/area-riservata/accedi`. Further accounts are created
from the **Utenti** (Users) screen.

---

## Roles

| Role (key) | In short | Can… |
| --- | --- | --- |
| **Sviluppatore** (`sviluppatore`) | Developer / technical admin | See every view, manage all accounts, decide who needs 2FA, switch albums on and off, see the operations dashboard and the IP addresses in the log. |
| **Gestore** (`gestore`) | Group manager | Edit the group's pages, approve proposals, manage the calendar, documents, units and members, and read the contact messages. Can invite and revoke unit leads and the social media manager. |
| **Referente di unità** (`referente`) | Unit lead | Work on **their own unit**: texts, photos, activities, circulars, members and consents. Changes that need approval become proposals. |
| **Social** (`social`) | Social media manager | Draft content and propose photos and texts across units. Everything goes through approval, and personal data stays hidden. |

The fine-grained permissions (full, limited or none, for each feature and role)
are stored in the database and shown in the **Permessi** (Permissions) screen.

---

## Configuration

All configuration is through environment variables. The annotated reference,
in Italian, is [`web/.env.esempio`](web/.env.esempio). In development, put them
in `web/.env.local`. In production, set them in the service manager (for
example a systemd unit), not in a file inside the release folder.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SITO_BASE_URL` | **production** | Public URL of the site, e.g. `https://example.org`. It is used for invitation links, redirects, `robots.txt`, `sitemap.xml` and Open Graph previews. It must also be set **at build time**, because public pages are prerendered. |
| `SITO_TOTP_SEGRETO` | **production** | Key that encrypts the 2FA secrets at rest. Generate it once with `openssl rand -base64 48`. **Never change it afterwards**: if you do, every user has to set up 2FA again. Without it, the server refuses to start in production. |
| `SITO_DATI_DIR` | recommended | Folder for the database and uploaded files. Default: `web/dati/`. In production, keep it **outside** the release folder. |
| `SITO_DB` | no | Path of the SQLite file. Default: `<SITO_DATI_DIR>/sito.db`. |
| `SITO_COPIE_DIR` | no | Where backups go. Default: a `copie/` folder next to the data folder. |
| `SITO_PROXY_FIDATI` | no | Number of trusted reverse proxies in front of Node. It is used to read the real client IP from `X-Forwarded-For`. Default `1`. |
| `SITO_MODULO_CONTATTI` | no | Set it to `0` to build the site without the contact form, for a static-only host. |
| `POSTA_*` | no | Outgoing mail: `POSTA_HOST`, `POSTA_PORTA`, `POSTA_UTENTE`, `POSTA_PASSWORD`, or `POSTA_TENANT_ID` / `POSTA_CLIENT_ID` / `POSTA_CLIENT_SECRET` for Microsoft 365 OAuth, plus `POSTA_DA` and `POSTA_A`. Test it with `npm run posta:prova`. |
| `SITO_OVH_*`, `SITO_CLOUDFLARE_TOKEN`, `SITO_CADDYFILE` | no | Optional read-only integrations shown in the developer's operations dashboard. |

---

## Commands

Run them from `web/`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build, packaged as `standalone` |
| `npm start` | Run the production build (do **not** use `next start`) |
| `npm run lint` · `npm run typecheck` · `npm test` | ESLint · `tsc --noEmit` · the test suite |
| `npm run test:sicurezza` | Only the security-related tests |
| `npm run verifica` | Types, lint, tests and build in sequence, with a summary |
| `npm run db:applica` | Create or migrate the database |
| `npm run db:riferimenti` | Seed units, association years and default texts |
| `npm run db:invita` | Create an account, or re-issue an invitation |
| `npm run db:copia` | Make a **verified** backup of the database and files |
| `npm run db:ripristina` | List backups. With `--da <name> --conferma`, restore one |
| `npm run db:notturno` | Nightly maintenance (cleanup, photo variants) |
| `npm run db:importa-attivita` | Import a calendar from JSON (example in `scripts/attivita/`) |
| `npm run db:foto-sito` | Place the photos from `foto-originali/sito/` on the site's pages |
| `npm run db:genera` | Generate a new migration after changing `lib/db/schema.ts` |
| `npm run db:ispeziona` | Open Drizzle Studio on the database |
| `npm run loghi` | Redraw the six unit logos (SVG in `loghi/`, PNG in `public/assets/`) |

---

## Project structure

```
.
├── README.md            this file
├── SECURITY.md          how to report a vulnerability
├── LICENSE              MIT
└── web/                 the application
    ├── app/
    │   ├── (sito)/      public website (own root layout, site.css)
    │   ├── (area)/      reserved area (own root layout, admin.css + Tailwind)
    │   ├── api/         health check, search, cache regeneration
    │   └── …            routes that serve uploaded files (photos, documents, logo)
    ├── components/
    │   ├── site/        public-site components
    │   └── area/        reserved-area screens
    ├── lib/
    │   ├── data.ts      seed content (the placeholders)
    │   ├── legale.ts    legal pages (placeholders)
    │   ├── nav.ts       menus, footer and external links
    │   ├── db/          Drizzle schema, connection, migration runner, backups
    │   ├── auth/        sessions, invitations, passwords, TOTP, encryption
    │   ├── *-store.ts   data access for each area (units, albums, documents…)
    │   └── permessi.ts  the permission matrix and the authorization gate
    ├── drizzle/         SQL migrations
    ├── proxy.ts         request guard (formerly "middleware"): no reserved route can be forgotten
    ├── scripts/         CLI tasks (db:*, backups, imports, checks)
    ├── test/            the test suite (node --test)
    ├── styles/          site.css, admin.css, tailwind.css
    ├── public/assets/   static images (placeholders)
    ├── loghi/           SVG sources of the unit logos
    └── foto-originali/  where to put original photos (ignored by git)
```

Modules in `lib/` come in two kinds:

- **Stores** import `better-sqlite3` and are server-only; the compiler keeps
  them out of client components.
- **Catalogs** contain only types and constants and are safe on the client.
  They describe which fields can be edited, with what limits, and which ones
  need approval.

---

## Routes

| Route | Page |
| --- | --- |
| `/` | Home |
| `/chi-siamo` | About us |
| `/unita` · `/unita/[slug]` | Units overview · a unit's page |
| `/attivita` | Activity calendar |
| `/foto` · `/foto/[album]` | Photo albums (password-protected; off by default) |
| `/documenti` · `/documenti/[cartella]` | Documents and forms, by folder |
| `/contatti` | Contacts and contact form |
| `/legale/[slug]` · `/legale/preferenze-cookie` | Legal pages · cookie preferences |
| `/area-riservata/accedi` | Sign in |
| `/area-riservata/[ruolo]/[sezione]` | The reserved area, one view per role |
| `/area-riservata/esporta/[sezione]` | CSV exports |
| `/robots.txt` · `/sitemap.xml` | Generated from `SITO_BASE_URL` |

---

## Making it yours

1. **Seed content:** edit `web/lib/data.ts` (group details, units, starting
   texts, FAQ) **before** running `db:riferimenti`. After that, the database is
   the source of truth, and texts are changed from the reserved area.
2. **Links and social profiles:** `web/lib/nav.ts`.
3. **Legal pages:** `web/lib/legale.ts`. They are **only Lorem ipsum**. Before
   going live, write the real privacy, cookie and image-consent texts, and have
   them approved by whoever is legally responsible for the site.
4. **Images:** the logo, the unit logos and the photos in `web/public/assets/`
   are placeholders.
   - You can replace the logo from the reserved area.
   - To add photos, follow `web/foto-originali/README.md`: no recognisable
     faces without written consent. Metadata is stripped on upload.
5. **Colours:** the three age-band colours (yellow, green, red) and the group's
   navy are defined in `web/lib/data.ts` and `web/styles/`.

Almost everything else is editable from the reserved area once the site is
running.

---

## Deployment notes

The application builds to a self-contained `standalone` server. A typical
setup:

- a small Linux VPS running Node 22;
- the app under systemd, listening on `127.0.0.1` only;
- a reverse proxy in front (for example Caddy) handling HTTPS;
- the data folder outside the release folder (`SITO_DATI_DIR`);
- `npm run db:copia` and `npm run db:notturno` scheduled with systemd timers or
  cron.

In production, set `SITO_BASE_URL` and `SITO_TOTP_SEGRETO` in the service
environment **and** in the build environment. The deployment scripts of the
original site are not part of this repository.

---

## Security

The application holds data about minors, so security was treated as a feature:

- database-backed sessions: an opaque random token in an `httpOnly`,
  `SameSite=Lax`, `Secure` cookie, which can be revoked instantly;
- argon2id password hashing and a TOTP second factor, with the secret
  encrypted at rest;
- rate limiting on login and on the contact form, by account and by IP;
- a strict Content Security Policy;
- a request guard (`proxy.ts`), plus a server-side permission check on every
  action;
- an audit log of logins and changes.

Please report vulnerabilities **privately**, as described in
[SECURITY.md](SECURITY.md): use GitHub's *Report a vulnerability* button, not a
public issue.

---

## Glossary

The code and the interface are in Italian. These are the words you will meet
most often:

| Italian | English |
| --- | --- |
| area riservata | reserved (members-only) area |
| gestore | group manager |
| referente (di unità) | unit lead |
| sviluppatore | developer |
| unità | unit |
| fascia (gialla / verde / rossa) | age band (yellow / green / red) |
| anno sociale | association year |
| attività · calendario | activities · calendar |
| documenti · cartelle · circolari | documents · folders · circulars |
| iscritti · consensi · tesseramento | members · consents · yearly membership |
| proposta · approvazioni | proposal · approval queue |
| registro | audit log |
| copia · ripristina | backup · restore |
| accedi · invito | sign in · invitation |

---

## License

The code is released under the [MIT License](LICENSE).

The license does **not** cover the names and trademarks of the Associazione
Italiana Guide e Scouts d'Europa Cattolici (FSE). They belong to their
respective owners and are not part of this code.
