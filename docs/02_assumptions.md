# 02 — Assumptions and open questions

Where the brief is silent or contradicts itself, we make a decision, write it down here, and keep going. Items marked **Ask** are worth raising with the assessor, because asking good questions is part of the job.

| # | Topic | Assumption | Why | Ask? |
|---|---|---|---|---|
| A1 | "Single-file upload" vs "two files always uploaded together" | Phase 1 = **one environment's file set per submission**: File 1 and File 2 in two labelled slots, loaded in one transaction. "Multi-file" (later) = several environments in one go. | It is the only reading where both statements hold. Loading the pair atomically means an environment can never be half-loaded. | **Ask** |
| A2 | SEP | SEP = **server endpoints**, from `Endpoint Count` in `ALL<ENV>.csv`. | It is the only endpoint measure in the distributed files. | Ask (confirm the term) |
| A3 | Tasks | Tasks = `Total Task Count`. `File Transfer Tasks` and `MFT File Count` are reported separately as add-on usage, not added to Tasks. | The brief lists "MFT jobs" and "number of files transferred" as separate items to store. | **Ask** |
| A4 | MIPS | Mainframe only (SCRT). No sample was provided, so we model it and do not build it. | Slide 6: build after distributed works. | — |
| A5 | Duplicate date rows (quirk Q1) | Daily value = **sum** of every row for that date in the file. Both rows are stored. | Title says "All Control-Ms". The second row is always 0 in the samples, so the sum loses nothing and stays correct if it is ever non-zero. | **Ask** |
| A6 | 4th highest with ties | Rank days by `ROW_NUMBER()` (ties count as separate days). Example: BANK SEP 351, 349, 348, 348 → 4th = 348. | It matches "4th highest daily value". With `DENSE_RANK` the 4th value would be a lower number, which understates usage. | Ask |
| A7 | Fewer than 4 days of data | Return "not enough data" instead of a number. | Never present a compliance figure we cannot justify. | — |
| A8 | Days missing in one environment | Combined value = sum of the environments that have data for that day. The report lists **coverage gaps** (days where an expected environment is missing). | We never invent zeros silently. The gap is shown. | — |
| A9 | 12-month window | Default = the 365 days ending on the **latest date in the customer's data**. The user can override the period. | The exports cover exactly 365 days. "Today" is not meaningful for a renewal report. | — |
| A10 | Re-uploads | Same file content again (same SHA-256) = no-op ("already loaded"). A **different** file for the same customer, environment and file type **supersedes** the previous one. Old uploads are kept for audit but excluded from reports. | Idempotent, safe to rerun, traceable. | — |
| A11 | Environment must agree with the file name | Compare case-insensitively (`Prod` = `PROD`). If they differ, **reject** before anything is stored. | Slide 6 requires it. Q6 shows the case varies. | — |
| A12 | Customer names | Matched case- and space-insensitively (`" bank "` = `"BANK"`). Shown as first entered. | Prevents the same customer appearing twice. | — |
| A13 | Contract values | Entered per customer for Tasks, SEP and MIPS, with a valid-from date. Blank means "not contracted". Add-on licences are a checklist on the same screen. | Slide 5 step 4. | — |
| A14 | Add-ons file | Optional third upload slot. Stored as raw text and used to show "installed" status. Licensing comes from the contract screen, not the file. | "Installed" does not mean "licensed". | Ask |
| A15 | Authentication | Phase 1 has no sign-in. The Uploader ID is free text and is recorded on every upload. | Not in the brief. Sign-in is the first item under next steps, because this is commercially sensitive data. | — |
| A16 | Derived files (`_total`, `most_active_dates`, PDFs, `reports.zip`) | Not uploaded. Used only to check our calculations. | We recalculate them. Storing BMC's derived numbers would create two sources of truth. | — |
| A17 | Time zone | Dates are calendar dates with no time, stored as `date`. | No times in the source. | — |
| A18 | A metric that is 0 every day (e.g. BANK file transfers) | Report "no usage", not "4th highest 0 on <date>". The date is meaningless when every day ties at 0. | Seen when the SQL ran on the BANK data. | — |
| A19 | Model provider keys | The demo runs on free-tier Groq and Gemini keys with BMC's sample files only. Production uses the organisation's own paid keys (paid data terms); switching provider is a settings change. | Free tiers may keep or review prompts; acceptable for sample data, not for real customer data. | Ask (which provider the organisation already approves) |

> **Verified:** the SQL in `04_data_model.md` was run as written in PostgreSQL 16 against all 10 sample files. Its results matched every reference value in `01_data_profile.md`.
