// Pipeline and Contacts are one page per book. The nav's single link lands
// here and the page shows the book picked in the top-bar switch, which offers
// MPG | Bayway on these pages (see lib/filterScope). On All the last book
// picked on this device is shown. The old per-book routes (/bayway/pipeline,
// /mpg/contacts…) still render their book directly.
import { useBusiness } from '../context/BusinessContext'

export default function BookPage({ page: Page }) {
  const book = useBusiness()?.book || 'bay'
  return <Page key={book} biz={book} />
}
