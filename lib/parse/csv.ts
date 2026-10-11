// Minimal CSV reading that keeps line numbers. The Control-M exports are simple
// (no quoted fields), but quotes are handled anyway so a re-saved file can't break us.

export interface Line { lineNo: number; cells: string[]; raw: string }

/** Remove a UTF-8 byte-order mark if present. */
export const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

/** Split one CSV line into cells. Handles "quoted, fields" and "" escapes. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { cells.push(cur); cur = '' }
    else cur += ch
  }
  cells.push(cur)
  return cells
}

/** All lines with their 1-based numbers. Blank lines are kept (as empty cells) so numbering stays true. */
export function readLines(text: string): Line[] {
  return stripBom(text)
    .split(/\r\n|\n|\r/)
    .map((raw, i) => ({ lineNo: i + 1, raw, cells: raw.trim() === '' ? [] : splitCsvLine(raw) }))
}

/** Decode bytes as strict UTF-8; returns null if the bytes are not valid UTF-8 (rule not_utf8). */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
