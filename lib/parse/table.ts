// Shared reader for the two distributed usage files. Both have the same shape:
//   line 1  title, e.g. "Total Tasks By Date (All Control-Ms)"
//   line 2  blank
//   line 3  header with a "Date" column (normally first)
//   then    one row per day (File 2 has two rows per day, quirk Q1)
// Columns are found by NAME, never by position.
import { readLines } from './csv'
import { err, warn, MAX_ISSUES_PER_FILE, type FileRole, type Issue } from './issues'
import { parseCount, parseUsageDate } from './values'

export interface ColumnSpec<K extends string> { header: string; key: K }

export interface TableSpec<K extends string> {
  file: FileRole
  expectedTitle: string
  columns: ColumnSpec<K>[]
}

export type DatedRow<K extends string> = { lineNo: number; usageDate: string } & Record<K, number>

export interface TableResult<K extends string> {
  title: string // line 1, exactly as written
  rows: DatedRow<K>[]
  issues: Issue[]
}

export function parseDatedTable<K extends string>(text: string, spec: TableSpec<K>): TableResult<K> {
  const issues: Issue[] = []
  const add = (i: Issue) => { if (issues.length < MAX_ISSUES_PER_FILE) issues.push(i) }
  const lines = readLines(text)
  const title = lines[0]?.raw.trim() ?? ''

  if (title !== spec.expectedTitle) {
    add(warn('unexpected_title', `Line 1 should be "${spec.expectedTitle}" but is "${title}". Stored as written.`, spec.file, 1))
  }

  const isHeader = (cells: string[]) => cells.some((c) => c.trim() === 'Date')
  const headerLine = lines.find((l) => isHeader(l.cells))
  if (!headerLine) {
    add(err('header_not_found', 'No header row with a "Date" column was found.', spec.file))
    return { title, rows: [], issues }
  }

  const header = headerLine.cells.map((c) => c.trim())
  const dateAt = header.indexOf('Date')
  const index = new Map<K, number>()
  for (const col of spec.columns) {
    const i = header.indexOf(col.header)
    if (i < 0) add(err('missing_column', `Missing column "${col.header}".`, spec.file, headerLine.lineNo))
    else index.set(col.key, i)
  }
  if (index.size < spec.columns.length) return { title, rows: [], issues }

  const rows: DatedRow<K>[] = []
  for (const line of lines.filter((l) => l.lineNo > headerLine.lineNo && l.cells.length > 0)) {
    const at = line.lineNo
    if (isHeader(line.cells)) {
      add(err('repeated_header_row', 'The header row appears again in the middle of the file.', spec.file, at))
      continue
    }
    if (line.cells.length !== header.length) {
      add(err('wrong_column_count', `Expected ${header.length} values but found ${line.cells.length}.`, spec.file, at))
      continue
    }
    const usageDate = parseUsageDate(line.cells[dateAt])
    if (!usageDate) {
      add(err('invalid_date', `"${line.cells[dateAt]}" is not a real date in the format YYYY/MM/DD.`, spec.file, at))
      continue
    }
    const row = { lineNo: at, usageDate } as DatedRow<K>
    let rowOk = true
    for (const col of spec.columns) {
      const cell = line.cells[index.get(col.key)!]
      const n = parseCount(cell)
      if (!n.ok) {
        rowOk = false
        add(err(n.reason, n.reason === 'number_too_large'
          ? `${col.header} "${cell}" is too large to store exactly.`
          : `${col.header} "${cell}" must be a whole number with no decimals, signs or separators.`, spec.file, at))
      } else {
        (row as Record<string, number>)[col.key] = n.value
      }
    }
    if (rowOk) rows.push(row)
  }

  if (rows.length === 0 && !issues.some((i) => i.severity === 'error')) {
    add(err('no_data_rows', 'There are no data rows after the header.', spec.file))
  }
  return { title, rows, issues }
}

/** Number of rows whose date already appeared earlier in the same file. */
export function countDuplicateDateRows(rows: { usageDate: string }[]): number {
  const seen = new Set<string>()
  let dup = 0
  for (const r of rows) {
    if (seen.has(r.usageDate)) dup++
    else seen.add(r.usageDate)
  }
  return dup
}
