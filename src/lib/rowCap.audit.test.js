// Guard against PostgREST's silent 1,000-row cap (see src/lib/fetchAll.js).
// Scans every browser source file for a Supabase .from( read that is neither
// bounded nor paged. Crude by design: it reads text, not an AST.
//
// A chain passes when it is a write, carries a bound (.range / .limit /
// .maybeSingle / .single / head: true / .gte / .lte), or sits inside
// fetchAll / fetchAllSettled within the three lines above it. A fetchAll
// chain must also .order(): paging an unordered query can skip or repeat
// rows. For a genuinely small table (businesses, stages, settings), put
// `// rowcap-ok: <reason>` within the three lines above the .from(.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const BOUNDS = ['.range(', '.limit(', '.maybeSingle(', '.single(', 'head: true', '.gte(', '.lte(']
const WRITES = ['.insert(', '.upsert(', '.update(', '.delete(']
const LOOKBACK_LINES = 3
const UNBOUNDED = 'unbounded read: wrap in fetchAllSettled or add a bound'
const NO_ORDER = 'fetchAll query has no .order(): pages can skip or repeat rows'

// The builder text from `start` (the index of ".from(") to where the
// expression ends: a , or ; or an unmatched closer at depth 0, or a newline
// whose next line does not continue the chain with ".".
function chainAt(src, start) {
  let depth = 0
  let quote = null
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) {
      if (depth === 0) return src.slice(start, i)
      depth--
    } else if (depth === 0) {
      if (c === ',' || c === ';') return src.slice(start, i)
      if (c === '\n' && !src.slice(i + 1).trimStart().startsWith('.')) return src.slice(start, i)
    }
  }
  return src.slice(start)
}

// A Supabase .from( follows `supabase` or starts its own line (a chain
// continuation). This skips Array.from( and friends.
function isQueryFrom(src, idx) {
  const lineStart = src.lastIndexOf('\n', idx - 1) + 1
  return /supabase\s*$/.test(src.slice(Math.max(0, idx - 40), idx)) || src.slice(lineStart, idx).trim() === ''
}

// The text before `idx`: the rest of its own line plus LOOKBACK_LINES lines
// above, cut after any earlier .from( so a neighbouring query's fetchAll or
// comment doesn't count for this one.
function lookback(src, idx) {
  let cut = idx
  for (let n = 0; n <= LOOKBACK_LINES && cut > 0; n++) cut = src.lastIndexOf('\n', cut - 1)
  const ctx = src.slice(cut + 1, idx)
  const prev = ctx.lastIndexOf('.from(')
  return prev === -1 ? ctx : ctx.slice(prev + 1)
}

function findUnboundedReads(src) {
  const problems = []
  const re = /\.from\(/g
  let m
  while ((m = re.exec(src))) {
    if (!isQueryFrom(src, m.index)) continue
    const chain = chainAt(src, m.index)
    const ctx = lookback(src, m.index)
    const line = src.slice(0, m.index).split('\n').length
    if (ctx.includes('rowcap-ok:')) continue
    if (WRITES.some((w) => chain.includes(w))) continue
    if (ctx.includes('fetchAll')) {
      if (!chain.includes('.order(')) problems.push({ line, reason: NO_ORDER })
      continue
    }
    if (BOUNDS.some((b) => chain.includes(b))) continue
    problems.push({ line, reason: UNBOUNDED })
  }
  return problems
}

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name) ? [p] : []
  })
}

describe('findUnboundedReads', () => {
  it('flags a bare select on contacts', () => {
    const src = "const { data } = await supabase.from('contacts').select('*')\n"
    expect(findUnboundedReads(src)).toEqual([{ line: 1, reason: UNBOUNDED }])
  })

  it('flags a bare multi-line chain on the .from( line', () => {
    const src = [
      'const { data } = await supabase',
      "  .from('v_tasks')",
      "  .select('id')",
      "  .order('due_at')",
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([{ line: 2, reason: UNBOUNDED }])
  })

  it('passes bounded reads', () => {
    const src = [
      "supabase.from('a').select('*').range(0, 49)",
      "supabase.from('b').select('*').limit(1)",
      "supabase.from('c').select('*').eq('key', 'x').maybeSingle()",
      "supabase.from('d').select('id', { count: 'exact', head: true })",
      "supabase.from('e').select('*').gte('date', from)",
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([])
  })

  it('passes writes', () => {
    const src = [
      'await supabase',
      "  .from('metrics_daily')",
      "  .upsert(rows, { onConflict: 'business_id,date,metric_key' })",
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([])
  })

  it('passes an ordered fetchAll chain', () => {
    const src = [
      'const { data } = await fetchAllSettled(() =>',
      '  supabase',
      "    .from('contacts')",
      "    .select('*')",
      "    .order('id'),",
      ')',
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([])
  })

  it('flags a fetchAll chain with no order', () => {
    const src = "const r = await fetchAllSettled(() => supabase.from('contacts').select('*'))\n"
    expect(findUnboundedReads(src)).toEqual([{ line: 1, reason: NO_ORDER }])
  })

  it('does not let a fetchAll on the line above cover the next query', () => {
    const src = [
      'await Promise.all([',
      "  fetchAllSettled(() => supabase.from('deals').select('*').order('id')),",
      "  supabase.from('contacts').select('*'),",
      '])',
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([{ line: 3, reason: UNBOUNDED }])
  })

  it('checks each branch of a ternary separately', () => {
    const src = [
      'const q = all',
      "  ? supabase.from('v_tasks').select('id').limit(5)",
      "  : supabase.from('v_tasks').select('id')",
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([{ line: 3, reason: UNBOUNDED }])
  })

  it('honors a rowcap-ok comment', () => {
    const src = [
      '// rowcap-ok: two rows, one per book',
      "const { data } = await supabase.from('businesses').select('*')",
      '',
    ].join('\n')
    expect(findUnboundedReads(src)).toEqual([])
  })

  it('ignores Array.from and other non-Supabase .from( calls', () => {
    const src = 'const xs = Array.from({ length: 8 }, (_, i) => i)\n'
    expect(findUnboundedReads(src)).toEqual([])
  })

  it('handles CRLF line endings', () => {
    const src = "const a = 1\r\nconst { data } = await supabase.from('contacts').select('*')\r\n"
    expect(findUnboundedReads(src)).toEqual([{ line: 2, reason: UNBOUNDED }])
  })
})

describe('row-cap audit: src/', () => {
  it('has no unbounded Supabase reads', () => {
    const found = sourceFiles(SRC_DIR).flatMap((file) =>
      findUnboundedReads(readFileSync(file, 'utf8')).map(
        (p) => `${relative(SRC_DIR, file)}:${p.line} ${p.reason}`,
      ),
    )
    expect(found).toEqual([])
  })
})
