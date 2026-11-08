// Where the top-bar business switch applies, so there is only ever one
// business control on screen and it never sits on a page it can't change.
//   'all'  - the page follows All / MPG / Bayway
//   'book' - the page shows one book at a time: the switch offers MPG | Bayway
//   'none' - the page is fixed to a book or has no book (Loans, Reference,
//            Settings...): the switch is hidden
const ALL = [/^\/$/, /^\/(priority|workbench)/, /^\/calendar/, /^\/tasks/, /^\/activity/, /^\/reports/, /^\/analytics/]
const BOOK = [/^\/pipeline/, /^\/contacts/]

export function filterScope(pathname) {
  if (BOOK.some((re) => re.test(pathname))) return 'book'
  if (ALL.some((re) => re.test(pathname))) return 'all'
  return 'none'
}
