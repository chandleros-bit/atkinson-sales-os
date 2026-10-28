// Client-side paging for long lists (the Pipeline's List and By stage views):
// 25 rows a page. The page is clamped, so a list that shrinks under you (a
// search, a lead moving on) never lands on an empty page.
export const PAGE_SIZE = 25

export function pageSlice(rows, page, size = PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(rows.length / size))
  const p = Math.min(Math.max(1, page), pageCount)
  const start = (p - 1) * size
  return { rows: rows.slice(start, start + size), page: p, pageCount, from: rows.length ? start + 1 : 0, to: Math.min(start + size, rows.length) }
}
