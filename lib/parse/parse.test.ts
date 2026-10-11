import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeUtf8, detectKind, envFromFileName, parseEndpointsFile, parseFileSet, parseTasksFile, type FileSetInput } from './index.js'
import { parseCount, parseUsageDate } from './values.js'

const DATA = join(process.cwd(), 'data')
const read = (...p: string[]) => readFileSync(join(DATA, ...p), 'utf8')
const file = (name: string, text: string) => ({ name, text, size: new TextEncoder().encode(text).length })
const sample = (customer: string, env: string, extra: Partial<FileSetInput> = {}): FileSetInput => ({
  uploaderId: 'bdyani',
  customer,
  environment: env,
  file1: file(`ALL_per_task_${env}.csv`, read('samples', customer, `ALL_per_task_${env}.csv`)),
  file2: file(`ALL${env}.csv`, read('samples', customer, `ALL${env}.csv`)),
  ...extra,
})
const codes = (r: { issues: { code: string; severity: string }[] }, severity = 'error') =>
  r.issues.filter((i) => i.severity === severity).map((i) => i.code)

const TASK_HEADER = 'Total Tasks By Date (All Control-Ms)\n\nDate,Total Task Count,File Transfer Tasks,MFT File Count\n'

// ---------------------------------------------------------------------------------------------
// The 8 tests from docs/03_import_rules.md
// ---------------------------------------------------------------------------------------------
describe('docs/03 required tests', () => {
  it.each([['BANK', 'Dev'], ['BANK', 'Prod'], ['BANK', 'UAT'], ['DCS', 'PROD'], ['DCS', 'QA']])(
    '1. %s %s sample pair parses with 0 errors (365 task rows, 730 endpoint rows)',
    (customer, env) => {
      const r = parseFileSet(sample(customer, env))
      expect(codes(r)).toEqual([])
      expect(r.ok).toBe(true)
      expect(r.summary).toMatchObject({ taskRows: 365, endpointRows: 730, days: 365 })
    },
  )

  it('2. ALL_per_task_QA.csv with ALLPROD.csv is rejected as env_mismatch', () => {
    const r = parseFileSet({ ...sample('DCS', 'QA'), file2: file('ALLPROD.csv', read('samples', 'DCS', 'ALLPROD.csv')) })
    expect(r.ok).toBe(false)
    expect(codes(r)).toContain('env_mismatch')
  })

  it('3. "Prod" typed for PROD files is accepted (case-insensitive), env kept as in file name', () => {
    const r = parseFileSet({ ...sample('DCS', 'PROD'), environment: 'prod' })
    expect(r.ok).toBe(true)
    expect(r.environment).toBe('PROD')
  })

  it('4. 12.5 is refused, never rounded', () => {
    const r = parseTasksFile(`${TASK_HEADER}2026/06/17,12.5,0,0\n`)
    expect(r.rows).toHaveLength(0)
    expect(r.issues[0]).toMatchObject({ code: 'invalid_number', line: 4 })
  })

  it('5. a truncated last line is refused with its line number', () => {
    const r = parseTasksFile(`${TASK_HEADER}2026/06/17,5138,1242,1958\n2026/06/16,4929\n`)
    expect(r.issues.find((i) => i.code === 'wrong_column_count')).toMatchObject({ line: 5 })
  })

  it('6. reordered columns are still read correctly (by header name, not position)', () => {
    const r = parseTasksFile('Total Tasks By Date (All Control-Ms)\n\nMFT File Count,Date,File Transfer Tasks,Total Task Count\n1958,2026/06/17,1242,5138\n')
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.rows[0]).toEqual({ lineNo: 4, usageDate: '2026-06-17', totalTaskCount: 5138, fileTransferTasks: 1242, mftFileCount: 1958 })
  })

  it('7. a repeated header row mid-file is refused with its line number', () => {
    const r = parseTasksFile(`${TASK_HEADER}2026/06/17,5138,1242,1958\nDate,Total Task Count,File Transfer Tasks,MFT File Count\n2026/06/16,4929,1137,4421\n`)
    expect(r.issues.find((i) => i.code === 'repeated_header_row')).toMatchObject({ line: 5 })
    expect(r.rows).toHaveLength(2)
  })

  it('8. file-name rules', () => {
    expect(envFromFileName('ALL_per_task_QA.csv', 'dist_tasks')).toBe('QA')
    expect(envFromFileName('ALLQA.csv', 'dist_endpoints')).toBe('QA')
    expect(envFromFileName('ALL_per_task_QA.csv', 'dist_endpoints')).toBeNull() // File 1 can't sit in File 2's slot
    expect(envFromFileName('ALL_QA.csv', 'dist_endpoints')).toBeNull()
    expect(envFromFileName('ALL_per_task_.csv', 'dist_tasks')).toBeNull()
    expect(envFromFileName('ALLQA.txt', 'dist_endpoints')).toBeNull()
    expect(envFromFileName('C:\\exports\\ALLPROD.csv', 'dist_endpoints')).toBe('PROD')
    expect(envFromFileName('addons_UAT.csv', 'addons')).toBe('UAT')
    expect(['ALL_per_task_Dev.csv', 'ALLDev.csv', 'addons_Dev.csv', 'report.csv'].map(detectKind))
      .toEqual(['dist_tasks', 'dist_endpoints', 'addons', null])
  })
})

// ---------------------------------------------------------------------------------------------
// Exactness: values stored exactly as they appear (R7)
// ---------------------------------------------------------------------------------------------
describe('exact data', () => {
  it('keeps every row, in file order, with true line numbers', () => {
    const r = parseFileSet(sample('DCS', 'QA'))
    expect(r.file1!.rows.slice(0, 2)).toEqual([
      { lineNo: 4, usageDate: '2026-06-18', totalTaskCount: 0, fileTransferTasks: 0, mftFileCount: 0 },
      { lineNo: 5, usageDate: '2026-06-17', totalTaskCount: 5138, fileTransferTasks: 1242, mftFileCount: 1958 },
    ])
    // File 2 keeps BOTH rows for each date (quirk Q1)
    expect(r.file2!.rows.slice(2, 4)).toEqual([
      { lineNo: 6, usageDate: '2026-06-17', endpointCount: 59 },
      { lineNo: 7, usageDate: '2026-06-17', endpointCount: 0 },
    ])
    expect(r.file1!.title).toBe('Total Tasks By Date (All Control-Ms)')
  })

  it('every parsed value equals the raw text of its cell', () => {
    const text = read('samples', 'BANK', 'ALL_per_task_Prod.csv')
    const raw = text.split(/\r?\n/)
    for (const row of parseTasksFile(text).rows) {
      const cells = raw[row.lineNo - 1].split(',')
      expect([row.totalTaskCount, row.fileTransferTasks, row.mftFileCount].map(String)).toEqual(cells.slice(1, 4))
      expect(row.usageDate.replaceAll('-', '/')).toBe(cells[0])
    }
  })

  it('handles a BOM and Windows line endings without shifting line numbers', () => {
    const r = parseTasksFile(`\uFEFF${TASK_HEADER.replaceAll('\n', '\r\n')}2026/06/17,5138,1242,1958\r\n`)
    expect(r.issues).toEqual([])
    expect(r.rows[0].lineNo).toBe(4)
  })
})

// ---------------------------------------------------------------------------------------------
// The calculation input is right: parsed BANK files, added per day, equal BMC's own _total files
// ---------------------------------------------------------------------------------------------
describe('ground truth against BMC reference totals', () => {
  const totals = (text: string) => {
    const m = new Map<string, number[]>()
    for (const l of text.split(/\r?\n/)) {
      const c = l.split(',')
      if (/^\d{4}\/\d{2}\/\d{2}$/.test(c[0])) m.set(c[0].replaceAll('/', '-'), c.slice(1).map(Number))
    }
    return m
  }

  it('BANK Dev + Prod + UAT tasks per day = ALL_per_task__total.csv on all 365 days', () => {
    const sum = new Map<string, number[]>()
    for (const env of ['Dev', 'Prod', 'UAT']) {
      for (const r of parseFileSet(sample('BANK', env)).file1!.rows) {
        const s = sum.get(r.usageDate) ?? [0, 0, 0]
        sum.set(r.usageDate, [s[0] + r.totalTaskCount, s[1] + r.fileTransferTasks, s[2] + r.mftFileCount])
      }
    }
    const ref = totals(read('reference', 'BANK', 'ALL_per_task__total.csv'))
    expect(ref.size).toBe(365)
    for (const [date, v] of ref) expect(sum.get(date), date).toEqual(v)
  })

  it('BANK endpoints (both rows per day, all envs) = ALL_per_endpoint __total.csv on all 365 days', () => {
    const sum = new Map<string, number>()
    for (const env of ['Dev', 'Prod', 'UAT']) {
      for (const r of parseFileSet(sample('BANK', env)).file2!.rows) sum.set(r.usageDate, (sum.get(r.usageDate) ?? 0) + r.endpointCount)
    }
    const ref = totals(read('reference', 'BANK', 'ALL_per_endpoint __total.csv'))
    expect(ref.size).toBe(365)
    for (const [date, v] of ref) expect(sum.get(date), date).toBe(v[0])
  })
})

// ---------------------------------------------------------------------------------------------
// Everything else the rules promise
// ---------------------------------------------------------------------------------------------
describe('other rules', () => {
  it('missing prompts and missing files are reported together', () => {
    const r = parseFileSet({ uploaderId: ' ', customer: '', environment: '' })
    expect(codes(r)).toEqual(['missing_prompt_field', 'missing_prompt_field', 'missing_prompt_field', 'missing_file', 'missing_file'])
  })

  it('environment typed differently from the file names is refused', () => {
    const r = parseFileSet({ ...sample('DCS', 'QA'), environment: 'PROD' })
    expect(codes(r).filter((c) => c === 'env_mismatch')).toHaveLength(2)
  })

  it('files swapped between slots are refused by name', () => {
    const s = sample('DCS', 'QA')
    const r = parseFileSet({ ...s, file1: s.file2, file2: s.file1 })
    expect(codes(r)).toEqual(['bad_file1_name', 'bad_file2_name'])
  })

  it('a file over 2 MB is refused', () => {
    const r = parseFileSet({ ...sample('DCS', 'QA'), file1: { ...sample('DCS', 'QA').file1!, size: 3 * 1024 * 1024 } })
    expect(codes(r)).toContain('file_too_large')
  })

  it('impossible dates are refused', () => {
    expect(parseUsageDate('2026/02/30')).toBeNull()
    expect(parseUsageDate('2024/02/29')).toBe('2024-02-29')
    expect(parseUsageDate('17/06/2026')).toBeNull()
  })

  it('numbers must be exact non-negative integers', () => {
    expect(['0', '5138', '-1', '1,000', '1e3', '', ' 7 ', '9007199254740993'].map((s) => {
      const r = parseCount(s)
      return r.ok ? r.value : r.reason
    })).toEqual([0, 5138, 'invalid_number', 'invalid_number', 'invalid_number', 'invalid_number', 7, 'number_too_large'])
  })

  it('missing column, missing header and empty files are refused', () => {
    expect(parseEndpointsFile('Total Server Endpoints Per Day (All Control-Ms)\n\nDate,Endpoints\n2026/06/17,59\n').issues[0].code).toBe('missing_column')
    expect(parseEndpointsFile('just some text\n').issues.map((i) => i.code)).toContain('header_not_found')
    expect(parseEndpointsFile('Total Server Endpoints Per Day (All Control-Ms)\n\nDate,Endpoint Count\n').issues.map((i) => i.code)).toContain('no_data_rows')
  })

  it('an unexpected title is a warning, not an error', () => {
    const r = parseTasksFile(TASK_HEADER.replace('Total Tasks', 'All Tasks') + '2026/06/17,1,0,0\n')
    expect(r.issues.map((i) => [i.code, i.severity])).toEqual([['unexpected_title', 'warning']])
  })

  it('flags duplicate date rows and zero-task days as warnings (DCS QA)', () => {
    const r = parseFileSet(sample('DCS', 'QA'))
    expect(codes(r, 'warning')).toEqual(['zero_usage_days', 'duplicate_date_rows'])
  })

  it('different date ranges between File 1 and File 2 is a warning', () => {
    const r = parseFileSet({ ...sample('DCS', 'QA'), file2: file('ALLQA.csv', 'Total Server Endpoints Per Day (All Control-Ms)\n\nDate,Endpoint Count\n2026/06/17,59\n') })
    expect(r.ok).toBe(true)
    expect(codes(r, 'warning')).toContain('date_mismatch_between_files')
  })

  it('add-ons: Details with commas kept exactly; bad Installed value refused', () => {
    const s = sample('BANK', 'Dev', {
      addons: file('addons_Dev.csv', 'Product,Installed,Details\nControl-M Forecast,Installed,Dev,UAT,Prod\nControl-M for SAP,Maybe,\n'),
    })
    const r = parseFileSet(s)
    expect(r.addons!.rows[0]).toMatchObject({ product: 'Control-M Forecast', installed: true, details: 'Dev,UAT,Prod' })
    expect(codes(r)).toEqual(['invalid_installed_value'])
  })

  it('real add-ons sample parses: 21 products', () => {
    const r = parseFileSet(sample('DCS', 'PROD', { addons: file('addons_PROD.csv', read('samples', 'DCS', 'addons_PROD.csv')) }))
    expect(r.ok).toBe(true)
    expect(r.addons!.rows).toHaveLength(21)
    expect(r.addons!.rows.find((a) => a.product === 'Control-M for Advanced File Transfer')).toMatchObject({ installed: true, details: 'Last job execution 20260617)' })
  })

  it('invalid UTF-8 bytes are detected', () => {
    expect(decodeUtf8(new Uint8Array([0x44, 0x61, 0x74, 0x65]))).toBe('Date')
    expect(decodeUtf8(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull()
  })
})
