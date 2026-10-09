# 09 — Build plan (phases with checkpoints)

Rule from Haibot: **don't start the next phase until the current one's checkpoint passes.** Bennett runs `git` from Windows PowerShell himself. Use `curl.exe`, not `curl`.

## Repo layout

```
data/samples/BANK/...  data/samples/DCS/...   untouched sample files
db/migrations/001…006.sql                      schema, views, functions, roles, seed
db/tests/known_answers.sql
lib/parse/  (tasks.ts, endpoints.ts, addons.ts, fileName.ts, index.ts) + tests/
api/        upload.ts, report.ts, customers.ts, contracts.ts, agent.ts
src/        React app (pages: Upload, Contracts, Report, Ask)
agent/system-prompt.md
docs/       this pack, plus agent_results.md and solution_design.png
README.md   checklist, run steps, DB justification, model choice, assumptions, AI tools used, next steps
vercel.json
```

## Phases

| # | Phase | Checkpoint (must pass) |
|---|---|---|
| 0 | Repo scaffold: Vite + React + TS, Vitest, Vercel project (Root = repo root), Supabase project | `npm run dev` shows a blank app, `npm test` runs |
| 1 | **Parser** (`lib/parse`) + 8 unit tests | All sample files parse. All tests green. |
| 2 | **Database**: migrations 001–006 in Supabase, `ctm_loader` / `ctm_reader` roles | Tables exist. The `ctm` schema isn't visible in the REST API. |
| 3 | **Upload API + Upload page** | All 5 sample environment pairs loaded through the UI. Re-upload shows `already_loaded`. A mismatch gets rejected. |
| 4 | **Known-answer SQL tests** | `known_answers.sql` passes (348 / 121,970 / 181 / 11,571) |
| 5 | **Contracts page** + API | Contracts saved and returned in `compliance_summary` |
| 6 | **Report page** (tiles, chart, top 10, add-ons, coverage) | Every tile matches `08_test_plan.md` |
| 7 | **Agent** (`/api/agent` + Ask panel) | All 12 eval questions recorded in `docs/agent_results.md` |
| 8 | **Hardening**: rate limit, timeouts, CSP, error states, empty states | Abuse tests from the eval pass |
| 9 | **Diagram + README + video**: Lucid (or Excalidraw) solution design PNG plus Mermaid source | README checklist accurate, secret scan clean |

## Environment variables (Vercel, server-only)

`DATABASE_URL_LOADER`, `DATABASE_URL_READER` (transaction pooler on port 6543, user `role.projectref`), `OPENROUTER_API_KEY`, `AGENT_MODEL`, `AGENT_FALLBACK_MODEL`. Never paste keys into chat.

## Demo (5 minutes or less)

1. The problem: 30 s.
2. Upload BANK Prod, then show a rejection (wrong environment): 60 s.
3. Report: tiles, chart, top 10 with rank 4 highlighted, and the "wrong method" story: 90 s.
4. Agent: 3 questions including a refusal: 60 s.
5. Under the hood (diagram, the LLM never calculates, built to grow): 45 s.
6. Testing and next steps: 15 s.

## Next steps to list (not built)

1. Sign-in (Supabase Auth or Vercel password protection).
2. Multi-file upload.
3. Folder auto-import (Vercel Cron + Storage).
4. Mainframe SCRT/MIPS.
5. Automated contract import.
6. PDF export of the compliance report.
7. Automated agent evals on every prompt or model change.
8. A shared rate limiter.
9. An alert when the renewal date approaches and no fresh upload exists.

## Before submitting

- Keep Supabase awake (free projects pause after inactivity).
- Merge into `main`.
- Check the live URL in a private window.
