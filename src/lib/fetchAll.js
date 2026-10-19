// PostgREST caps a single response at 1,000 rows and does not error when it
// truncates: a read past the cap just comes back short. This is the browser
// copy of fetchAll in supabase/functions/_shared/db.ts (that file imports
// supabase-js from esm.sh for Deno, so the app cannot import it).
//
// makeQuery: () => a fresh query builder with no .range() applied. It has to
// be a factory because a builder can only be awaited once. It must also end
// with .order() on a unique column (usually 'id'), or Postgres can return rows
// in a different order on each page and the pages overlap or skip rows.
// src/lib/rowCap.audit.test.js enforces both.
export const PAGE_SIZE = 1000

export async function fetchAll(makeQuery, { pageSize = PAGE_SIZE } = {}) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

// Same { data, error } shape a bare `await query` gives, so call sites that
// destructure the result or check res.error keep working unchanged.
export function fetchAllSettled(makeQuery, opts) {
  return fetchAll(makeQuery, opts).then(
    (data) => ({ data, error: null }),
    (error) => ({ data: null, error }),
  )
}
