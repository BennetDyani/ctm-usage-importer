# 03 — Import rules (validate, store, reject)

All parsing lives in **one tested module**, `lib/parse/` (TypeScript), used by the upload API now and by the folder importer later. This is the same single-source-of-truth idea as `clean.js` in Haibot.

## The difference from Haibot: no "fix" bucket

In Haibot we **fixed** dirty data (dates, names, branches). Here, rule R7 says to store data **exactly**, so the parser never changes a value. It does three things:

| Bucket | Meaning | Example |
|---|---|---|
| **Accept** | Row stored exactly as it appears, with its line number. | `2026/06/17,59` |
| **Flag** | Row stored, plus a flag for the report. | zero-usage day, duplicate date row |
| **Reject** | Whole file set refused, with the reason shown in the UI and logged. Nothing is partly loaded. | wrong file name, missing column |

Rejecting the whole file set (instead of individual rows) is deliberate. A compliance report built on a partly loaded file is worse than no report.

## Checks before parsing (file level)

| Code | Check |
|---|---|
| `missing_prompt_field` | Uploader ID, customer or environment is blank |
| `missing_file` | Either File 1 or File 2 is missing (A1) |
| `bad_file1_name` | Doesn't match `^ALL_per_task_(?<env>[A-Za-z0-9-]+)\.csv$` (case-insensitive on the extension) |
| `bad_file2_name` | Doesn't match `^ALL(?<env>[A-Za-z0-9-]+)\.csv$`, **and** isn't a File 1 name (File 1 names also start with `ALL`, so test File 1's pattern first) |
| `env_mismatch` | The environment in a file name ≠ the environment typed in (case-insensitive), or File 1's environment ≠ File 2's |
| `file_too_large` | Over 2 MB (samples are about 10 KB) |
| `not_utf8` | Can't be decoded as UTF-8 (a BOM is allowed and stripped) |

## Checks while parsing (content level)

| Code | Check |
|---|---|
| `unexpected_title` | Line 1 isn't the expected title (warning only, stored as-is) |
| `header_not_found` | No header row starting with `Date` |
| `missing_column` | A header lacks a required column, looked up **by name** (never by position) |
| `invalid_date` | A date isn't `YYYY/MM/DD`, or isn't a real calendar date |
| `invalid_number` | A value isn't a non-negative integer. Rejected, never rounded (R7). |
| `wrong_column_count` | A data row has a different number of columns from the header |
| `no_data_rows` | No rows after the header |
| `date_mismatch_between_files` | File 1 and File 2 cover different date ranges (warning only, stored and shown) |

## Flags (stored, shown in the report)

- `duplicate_date_row`: the second or later row for the same date in File 2 (quirk Q1). Expected, and summed.
- `zero_usage_day`: total tasks = 0 for the day (quirk Q2).

## Output of the parser

```ts
parseFileSet({ file1, file2, addons? , declaredEnv }) => {
  env, checksum1, checksum2,
  taskRows:     [{ lineNo, usageDate, totalTasks, fileTransferTasks, mftFileCount }],
  endpointRows: [{ lineNo, usageDate, endpointCount }],
  addonRows:    [{ lineNo, product, installed, details }],
  titleLine1, titleLine2,          // kept exactly
  warnings: [{ code, lineNo?, message }],
  errors:   [{ code, lineNo?, message }]     // any error => nothing loaded
}
```

## Unit tests (Vitest), written before the upload route

Built in Phase 1: `lib/parse/parse.test.ts` (41 tests). Beyond the 8 below, it covers exact values, BOM and CRLF, impossible dates, add-ons with commas, and a ground-truth check: parsed BANK Dev + Prod + UAT added per day equals BMC's own `_total` files on all 365 days. Header detection finds the `Date` column by name anywhere in the header row.

1. Both sample sets parse with 0 errors. Row counts: 365 task rows and 730 endpoint rows per environment.
2. `ALL_per_task_QA.csv` with `ALLPROD.csv` → `env_mismatch`.
3. `Prod` typed in, file says `PROD` → accepted.
4. A value of `12.5` → `invalid_number` (never rounded).
5. A truncated last line → `wrong_column_count`.
6. Columns reordered → still parsed correctly (looked up by header name).
7. A repeated header row mid-file → rejected with its line number.
8. The same file uploaded twice → second upload reports "already loaded" (tested at the database level).
