// Every reason the importer can refuse or flag a file. Codes match docs/03_import_rules.md.
export type IssueCode =
  // file set
  | 'missing_prompt_field'
  | 'missing_file'
  | 'bad_file1_name'
  | 'bad_file2_name'
  | 'bad_addons_name'
  | 'env_mismatch'
  | 'file_too_large'
  | 'not_utf8'
  | 'date_mismatch_between_files'
  // content
  | 'unexpected_title'
  | 'header_not_found'
  | 'missing_column'
  | 'repeated_header_row'
  | 'wrong_column_count'
  | 'invalid_date'
  | 'invalid_number'
  | 'number_too_large'
  | 'invalid_installed_value'
  | 'duplicate_date_row'
  | 'no_data_rows'
  // flags (stored and shown, never block)
  | 'duplicate_date_rows'
  | 'zero_usage_days'

export type FileRole = 'file1' | 'file2' | 'addons'

export interface Issue {
  code: IssueCode
  severity: 'error' | 'warning'
  message: string
  file?: FileRole
  line?: number // 1-based line in the original file
}

export const MAX_ISSUES_PER_FILE = 25

export const err = (code: IssueCode, message: string, file?: FileRole, line?: number): Issue =>
  ({ code, severity: 'error', message, file, line })

export const warn = (code: IssueCode, message: string, file?: FileRole, line?: number): Issue =>
  ({ code, severity: 'warning', message, file, line })
