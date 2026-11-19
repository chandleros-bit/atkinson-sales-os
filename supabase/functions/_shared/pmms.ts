// Freddie Mac PMMS weekly rates, read from FRED's CSV export of the same
// series (MORTGAGE30US and MORTGAGE15US). Pure parser, no network.

export const FRED_PMMS_URL =
  'https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US,MORTGAGE15US'

export type PmmsRow = { week_date: string; rate_30_fixed: number; rate_15_fixed: number | null }

// Parses the FRED CSV. Skips missing values (".") and weeks before `since`.
export function parseFredPmms(csv: string, since = '2018-01-01'): PmmsRow[] {
  const lines = csv.trim().split(/\r?\n/)
  if (!lines.length) return []
  const head = lines[0].split(',').map((h) => h.trim().toUpperCase())
  const iDate = head.findIndex((h) => h === 'DATE' || h === 'OBSERVATION_DATE')
  const i30 = head.indexOf('MORTGAGE30US')
  const i15 = head.indexOf('MORTGAGE15US')
  if (iDate < 0 || i30 < 0) throw new Error(`unexpected PMMS header: ${lines[0]}`)
  const out: PmmsRow[] = []
  for (const line of lines.slice(1)) {
    const p = line.split(',')
    const d = (p[iDate] || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < since) continue
    const r30 = Number(p[i30])
    if (!Number.isFinite(r30) || (p[i30] || '').trim() === '.' || r30 <= 0) continue
    const r15raw = i15 >= 0 ? (p[i15] || '').trim() : ''
    const r15 = r15raw && r15raw !== '.' && Number.isFinite(Number(r15raw)) ? Number(r15raw) : null
    out.push({ week_date: d, rate_30_fixed: r30, rate_15_fixed: r15 })
  }
  return out
}
