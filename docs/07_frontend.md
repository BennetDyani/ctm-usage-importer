# 07 — Front end (React + Vite + TypeScript)

The assessors want a "clear, simple web interface". Four pages, no clutter.

## Pages

### 1. Upload
- Step 1, **prompts first** (R8): Uploader ID, Customer (type-ahead from existing customers, or a new one) and Environment (free text, for example `PROD`).
- Step 2, **files**: two labelled drop zones. `File 1 – Tasks (ALL_per_task_<ENV>.csv)` and `File 2 – Endpoints (ALL<ENV>.csv)`, plus an optional add-ons file.
- Instant checks in the browser for file name pattern and environment match, so users get feedback quickly. **The server checks again.** Browser checks are for convenience only, not security.
- Result card:
  - ✅ loaded (365 task rows, 730 endpoint rows, date range);
  - ↺ already loaded;
  - ❌ rejected, with a list of reasons and line numbers.
- Recent uploads table below: when, who, customer, environment, files, status.

### 2. Contracts
- Per customer: contracted **Tasks, SEP, MIPS** (blank = not contracted) and a valid-from date.
- Licensed add-ons checklist (the 21 products from the add-ons file, seeded).

### 3. Report (the main page)
- Customer selector and period (default: the latest 365 days in the data).
- **Compliance tiles**, one each for Tasks, SEP and MIPS:
  - 4th highest combined value and its date;
  - contracted value;
  - headroom;
  - status badge (within / over / no contract / no data).
- **Chart:** daily combined usage over 12 months, with a stacked-by-environment option, a horizontal line for the contract, and the 4th highest day marked.
- **Top 10 days table**, with rank 4 highlighted (this shows the assessor the combine-then-rank logic).
- **Add-ons section:** licensed / installed / used, plus file transfer tasks and MFT file count (4th highest and total).
- **Data coverage:** environments included, date range per environment, missing days, zero days.
- Each chart has a "Table" toggle (accessibility, carried over from Haibot).

### 4. Ask (agent)
A side panel on the Report page (also available full screen). It has example questions as chips, and shows the "Based on…" source line under each answer.

## Technical notes
- Charts: Recharts, or Chart.js as in Haibot.
- Data fetching: TanStack Query against `/api/*`. No Supabase client in the browser, because all data goes through our API.
- **Number formatting:** `Intl.NumberFormat('en-GB')`. In Haibot, en-ZA showed decimal commas on Windows.
- Light and dark theme, with colours checked for colour-blind separation between environments.
