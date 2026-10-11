import { warn, type Issue } from './issues'
import { countDuplicateDateRows, parseDatedTable, type DatedRow } from './table'

/** File 1: ALL_per_task_<ENV>.csv */
export type TaskRow = DatedRow<'totalTaskCount' | 'fileTransferTasks' | 'mftFileCount'>
/** File 2: ALL<ENV>.csv */
export type EndpointRow = DatedRow<'endpointCount'>

export interface ParsedFile<R> { title: string; rows: R[]; issues: Issue[] }

export function parseTasksFile(text: string): ParsedFile<TaskRow> {
  const r = parseDatedTable(text, {
    file: 'file1',
    expectedTitle: 'Total Tasks By Date (All Control-Ms)',
    columns: [
      { header: 'Total Task Count', key: 'totalTaskCount' },
      { header: 'File Transfer Tasks', key: 'fileTransferTasks' },
      { header: 'MFT File Count', key: 'mftFileCount' },
    ],
  })
  const dup = countDuplicateDateRows(r.rows)
  if (dup > 0) r.issues.push(warn('duplicate_date_rows', `${dup} dates appear more than once. All rows are stored and added together per day.`, 'file1'))
  const zero = new Set(r.rows.filter((x) => x.totalTaskCount === 0).map((x) => x.usageDate)).size
  if (zero > 0) r.issues.push(warn('zero_usage_days', `${zero} day${zero === 1 ? ' has' : 's have'} 0 tasks (often the partial last day of the export).`, 'file1'))
  return r
}

export function parseEndpointsFile(text: string): ParsedFile<EndpointRow> {
  const r = parseDatedTable(text, {
    file: 'file2',
    expectedTitle: 'Total Server Endpoints Per Day (All Control-Ms)',
    columns: [{ header: 'Endpoint Count', key: 'endpointCount' }],
  })
  const dup = countDuplicateDateRows(r.rows)
  if (dup > 0) r.issues.push(warn('duplicate_date_rows', `${dup} dates appear more than once (one row per Control-M server). All rows are stored and added together per day.`, 'file2'))
  return r
}
