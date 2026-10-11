// Optional add-ons file: addons_<ENV>.csv
//   Product,Installed,Details
//   Control-M for Databases,Installed,Last job execution 20260617)
// "Details" is free text and may itself contain commas, so everything after the
// second comma is kept together, exactly as written (quirk Q5).
import { readLines } from './csv'
import { err, MAX_ISSUES_PER_FILE, type Issue } from './issues'

export interface AddonRow { lineNo: number; product: string; installed: boolean; installedRaw: string; details: string }

export function parseAddonsFile(text: string): { rows: AddonRow[]; issues: Issue[] } {
  const issues: Issue[] = []
  const add = (i: Issue) => { if (issues.length < MAX_ISSUES_PER_FILE) issues.push(i) }
  const lines = readLines(text)
  const header = lines.find((l) => l.cells[0]?.trim() === 'Product')
  if (!header) {
    add(err('header_not_found', 'No header row starting with "Product" was found.', 'addons'))
    return { rows: [], issues }
  }
  const rows: AddonRow[] = []
  for (const line of lines.filter((l) => l.lineNo > header.lineNo && l.cells.length > 0)) {
    const [product, installedRaw = '', ...rest] = line.cells
    const installed = installedRaw.trim()
    if (installed !== 'Installed' && installed !== 'NA') {
      add(err('invalid_installed_value', `Installed must be "Installed" or "NA", not "${installedRaw}".`, 'addons', line.lineNo))
      continue
    }
    rows.push({ lineNo: line.lineNo, product: product.trim(), installed: installed === 'Installed', installedRaw, details: rest.join(',') })
  }
  if (rows.length === 0 && issues.length === 0) add(err('no_data_rows', 'There are no add-on rows after the header.', 'addons'))
  return { rows, issues }
}
