# Control-M Usage Data Importer

Imports Control-M usage exports, stores them exactly, combines environments per day, and reports the **4th highest daily value** against contracted values for Tasks, SEP and MIPS. Includes an analysis agent that answers questions from the stored data.

**Stack:** React 19 + Vite + TypeScript on Vercel · Vercel serverless functions (`api/`) · Supabase Postgres 17 · Docker (local database for tests) · LLM via OpenRouter (server-side only)

## Run locally (Windows PowerShell)

```powershell
npm install          # run on Windows; never copy node_modules between machines
npm test             # unit tests (Vitest); database tests are skipped unless Docker is running
npm run dev          # front end AND the api/ functions -> http://localhost:5173
curl.exe http://localhost:5173/api/health
```

`npm run dev` serves the `api/` functions through a small dev-only Vite plugin (`vite.config.ts`), so no Vercel login is needed. The functions read their settings from `.env.local` (git-ignored). To run everything against the Docker database:

```powershell
npm run db:up
# one-time: give the local roles a password (local throwaway database only)
docker exec ctm-postgres psql -U postgres -c "alter role ctm_loader with login password 'local-dev'; alter role ctm_reader with login password 'local-dev';"
```

Then create `.env.local` containing:

```
DATABASE_URL_LOADER=postgres://ctm_loader:local-dev@localhost:54322/postgres
DATABASE_URL_READER=postgres://ctm_reader:local-dev@localhost:54322/postgres
```

Note: `npm run db:test` resets schema `ctm`, so run the migrations again (or `npm run db:test` once) after `db:up` before using the app locally.

## Verify the live database (known answers)

`db/tests/known_answers.sql` is read-only and safe on production. In Supabase, open the **SQL editor**, paste the whole file and click **Run**. You get a table of 20 checks (expected, actual, PASS/FAIL). If anything is wrong, the run stops with an error that names the failed checks.

It checks the four compliance answers (348, 121,970, 181, 11,571) and the add-on figures; that BANK matches BMC's own total files on all 365 days (day-by-day fingerprint); that every stored file still matches its SHA-256; and that the database roles are still locked down. `npm run db:test` runs the same script automatically, and also proves it fails when a single stored value changes by 1.

## API

| Route | Method | Role | What it does |
|---|---|---|---|
| `/api/health` | GET | none | Liveness check |
| `/api/upload` | POST multipart | `ctm_loader` | `uploaderId`, `customer`, `environment`, `file1`, `file2`, optional `addons`. Runs `lib/parse`, then `load_file_set` (200 `loaded` / `already_loaded`) or logs the refusal (422 with every reason and line number). 400 bad request, 413 over 4 MB, 500 misconfigured, 503 database unreachable, 504 timeout. |
| `/api/batches` | GET | `ctm_reader` | Recent upload attempts, newest first (`?limit=` 1–100) |
| `/api/customers` | GET | `ctm_reader` | Customers with data, their environments and date range |
| `/api/contracts?customerId=` | GET | `ctm_reader` | Saved contract, licensed and installed add-ons, and the current verdict per measure (from `compliance_summary`) |
| `/api/contracts` | POST JSON | `ctm_loader` | `{ customerId, enteredBy, validFrom?, values: { TASKS, SEP, MIPS }, licensed: [...] }`. `null` = not contracted. 422 with every reason for bad input, 404 unknown customer. |

Database errors are reported specifically: wrong database username or password (503 `database_login_failed`), roles swapped or missing a grant (500 `database_permission`), database unreachable (503 `database_unavailable`).

## Vercel environment variables (Production and Preview)

| Name | Value |
|---|---|
| `DATABASE_URL_LOADER` | Supabase **transaction pooler** string (port 6543) with user `ctm_loader.<project-ref>` and that role's password |
| `DATABASE_URL_READER` | Same, with user `ctm_reader.<project-ref>` and its password |

Copy the pooler string from Supabase (**Connect** button, Transaction pooler), then replace the user `postgres.<project-ref>` with `ctm_loader.<project-ref>` (or `ctm_reader.<project-ref>`) and put in that role's password. Redeploy after changing variables.

## Database (Supabase Postgres, schema `ctm`)

Migrations live in `db/migrations/` (001–007) and are applied in order. They are already applied to the Supabase project `ctm-usage-importer`.

**Test the database locally with Docker** (needs Docker Desktop running):

```powershell
npm run db:up      # Postgres 17 in Docker on localhost:54322 (in-memory, clean every start)
npm run db:test    # applies all migrations, loads every sample file, checks the known answers
npm run db:down    # stop and delete it
```

`db:test` refuses to run against anything except localhost, because it drops and recreates schema `ctm`.

**Give the two app roles passwords (once, in the Supabase SQL editor).** The migrations create them without passwords so no secret is ever in git. Generate two long random passwords (for example with a password manager), then run:

```sql
alter role ctm_loader with login password 'PASTE-GENERATED-PASSWORD-1';
alter role ctm_reader with login password 'PASTE-GENERATED-PASSWORD-2';
```

Never paste these passwords into chat or commit them. They go only into Vercel environment variables and your git-ignored `.env.local`.

| Role | Can do | Used by |
|---|---|---|
| `ctm_loader` | execute `load_file_set`, `log_rejected_batch`, `save_contract` only | `/api/upload`, `/api/contracts` |
| `ctm_reader` | execute the 10 read functions only; read-only; 10 s timeout | report APIs and the agent |
| `anon`, `authenticated` | nothing in `ctm`; the schema is not exposed by the REST API | — |

## Folder layout

| Path | What lives there |
|---|---|
| `src/` | React app (pages: Upload, Contracts, Report, Ask) |
| `api/` | Vercel serverless functions — the only code that touches secrets. Every file here is deployed as a function, so tests live in `tests/`. Server imports use `.js` extensions (Node ES modules). |
| `lib/` | Shared server logic, starting with the parser (`lib/parse`, Phase 1) + tests |
| `db/migrations/`, `db/tests/` | SQL migrations and database integration tests (run with Docker) |
| `docker-compose.yml` | Local Postgres 17 for `npm run db:test` (development only) |
| `agent/` | Agent system prompt (Phase 7) |
| `data/samples/` | Untouched sample uploads (BANK: Dev/Prod/UAT, DCS: PROD/QA) |
| `data/reference/` | BMC's own `_total` files — used only to check our numbers |
| `docs/` | Design pack |

## Design pack (read in order)

| Doc | What it covers |
|---|---|
| [00 Brief and scope](docs/00_brief_and_scope.md) | Rules R1–R11, assessment focus mapped to where we handle it |
| [01 Data profile](docs/01_data_profile.md) | File formats, quirks, **ground-truth numbers** |
| [02 Assumptions](docs/02_assumptions.md) | Every gap in the brief, with a decision and the questions to ask |
| [03 Import rules](docs/03_import_rules.md) | Validation, rejection codes, parser contract, unit tests |
| [04 Data model](docs/04_data_model.md) | Postgres vs MySQL justification, ERD, combine-then-rank SQL, roles |
| [05 Solution design](docs/05_solution_design.md) | Architecture, what replaced n8n, how it grows, security |
| [06 Agent design](docs/06_agent_design.md) | Tools, prompt rules, model choice |
| [07 Front end](docs/07_frontend.md) | The four pages |
| [08 Test plan](docs/08_test_plan.md) | Unit, SQL known-answer and agent evals |
| [09 Build plan](docs/09_build_plan.md) | Phases with checkpoints, environment variables, demo script |

## Progress

- [x] Phase 0 — scaffold (Vite + React + TS, Vitest, `/api/health`, security headers, sample data)
- [x] Phase 1 — parser + unit tests (`lib/parse`, 41 tests incl. match against BMC reference totals)
- [x] Phase 2 — database (migrations 001–007 applied to Supabase, roles, Docker + 16 integration tests)
- [x] Phase 3 — upload API + page (`/api/upload`, `/api/batches`, upload history, 10 end-to-end API tests)
- [x] Phase 4 — known-answer SQL tests (`db/tests/known_answers.sql`: 20 read-only checks, runnable on Supabase; a test proves it fails on a 1-unit change)
- [x] Phase 5 — contracts saved to the database (`/api/contracts`, `/api/customers`, verdict from the database, 8 integration tests + 4 validation tests)
- [ ] Phase 6 — report
- [ ] Phase 7 — analysis agent + evals
- [ ] Phase 8 — hardening
- [ ] Phase 9 — diagram, README, video

## Submission checklist

- [ ] Single upload with prompts (Uploader ID, Customer, Environment) and file name validation
- [ ] Exact data stored (raw rows + original file text)
- [ ] Contracted values screen
- [ ] Report: MIPS / SEP / Tasks, combine-then-rank 4th highest, add-ons, coverage
- [ ] Analysis agent on stored data
- [ ] Known-answer tests pass
- [ ] Database choice justified
- [ ] Assumptions stated
- [ ] Live URL · walkthrough video
