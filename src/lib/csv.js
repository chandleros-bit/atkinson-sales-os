// RFC 4180 CSV for the Arive export: quoted fields may hold commas, newlines
// and doubled quotes. Returns the trimmed header and one object per non-blank
// row, keyed by header; short rows are padded with ''.
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '')
  const records = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); records.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); records.push(row) }
  const nonBlank = records.filter((r) => r.some((v) => v.trim() !== ''))
  if (!nonBlank.length) return { header: [], rows: [] }
  const header = nonBlank[0].map((h) => h.trim())
  const rows = nonBlank.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
  return { header, rows }
}
