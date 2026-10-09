# Control-M Usage Data Importer

Imports Control-M usage exports, stores them exactly, combines environments per day, and reports the **4th highest daily value** against contracted values for Tasks, SEP and MIPS. Includes an analysis agent that answers questions from the stored data.

**Stack:** React 19 + Vite + TypeScript on Vercel · Vercel serverless functions (`api/`) · Supabase Postgres · LLM via OpenRouter (server-side only)

## Run locally (Windows PowerShell)

```powershell
npm install          # run on Windows; never copy node_modules between machines
npm test             # unit tests (Vitest)
npm run dev          # front end only -> http://localhost:5173 (API shows "offline", expected)
npx vercel dev       # front end + /api functions together (needs: npx vercel login, once)
curl.exe http://localhost:3000/api/health
```

## Folder layout

| Path | What lives there |
|---|---|
| `src/` | React app (pages: Upload, Contracts, Report, Ask) |
| `api/` | Vercel serverless functions — the only code that touches secrets |
| `lib/` | Shared server logic, starting with the parser (`lib/parse`, Phase 1) + tests |
| `db/migrations/`, `db/tests/` | SQL migrations and known-answer tests (Phase 2, 4) |
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
- [ ] Phase 1 — parser + unit tests
- [ ] Phase 2 — database (migrations, roles)
- [ ] Phase 3 — upload API + page
- [ ] Phase 4 — known-answer SQL tests
- [ ] Phase 5 — contracts
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
