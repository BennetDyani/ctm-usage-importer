# 00 — Brief and scope

## The case in one paragraph

Before each renewal, every Control-M (CTM) customer must give BMC a usage report covering 12 months of daily usage. Today that report is put together by hand. We are building a small web app that does five things:

1. Imports the customer's usage export files.
2. Stores them exactly as they arrive.
3. Captures the contracted values.
4. Produces the compliance report on demand.
5. Offers an **analysis agent** that answers questions from the stored data.

## Source documents

- `Control-M Usage Data Importer.docx` (project brief)
- `Control-M Usage Importer Intern-Case.pptx` (7 slides: context, rules, data, roadmap, design decisions, assessment)

## Business rules (from the brief, not our interpretation)

| # | Rule |
|---|---|
| R1 | Usage is measured **per day** over a **12-month** period. |
| R2 | A customer can have several environments. **Add the environments together per day first**, before any totals or ranking. |
| R3 | If the customer is licensed for add-ons, add-on usage is shown and reported. |
| R4 | BMC uses the **4th highest daily value** for compliance evaluation. |
| R5 | The report covers **MIPS, SEP and Tasks**. |
| R6 | Contracted values are entered manually for now (automated in a later release). |
| R7 | Imported data is stored **exactly**, with no rounding or reshaping. Usage components, MFT jobs and the number of files transferred must all be kept. |
| R8 | Before upload, the user is prompted for **Uploader ID, Customer name and Environment**. The environment must agree with the file name. |
| R9 | Phase 1 is single upload. Later phases add multi-file upload and automatic import from an input directory, **without a rewrite**. |
| R10 | Mainframe (SCRT) produces the same report from different source files. Plan for it in the model and build it after distributed works. |
| R11 | The analysis agent must use **the stored data, not re-read the files**. |

## Assessment focus (slide 7), and where each item is handled

| Assessor looks for | Where we address it |
|---|---|
| Correct combine-then-rank logic (4th highest) | `04_data_model.md` (SQL), `08_test_plan.md` (known answers, including the "wrong method" trap) |
| Exact data preserved on import | `03_import_rules.md`, `04_data_model.md` (raw rows kept, including duplicate-date rows) |
| Clear, simple web interface | `07_frontend.md` |
| Sensible data model and database justification | `04_data_model.md` |
| Missing information handled, assumptions stated | `02_assumptions.md` |

## Stack (decided)

| Layer | Choice |
|---|---|
| Front end | React (Vite + TypeScript), hosted on **Vercel** |
| Server | **Vercel serverless functions** (`/api/*`) replace n8n for upload, reports and the agent |
| Database | **Supabase Postgres** (dedicated `ctm` schema), with Supabase Storage for the original files |
| LLM | Called **only** from a Vercel function, never from the browser. Model choice is in `06_agent_design.md`. |

## In scope for the first delivery

- Distributed usage: the task file (File 1) and the endpoint file (File 2), uploaded as one environment pair.
- Customers, environments, contracts and licensed add-ons.
- Compliance report: daily combined usage, 4th highest compared with the contract, add-on usage, coverage gaps.
- The analysis agent, with fixed SQL tools.

## Planned but not built first

Multi-file upload, automatic folder import, mainframe SCRT/MIPS, automated contract values, sign-in, and PDF export. The design leaves room for each of these (`05_solution_design.md`).
