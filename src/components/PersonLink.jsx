// A contact's name that opens their contact card (PersonSheet: details, notes,
// Quick Actions, Schedule, Open in CRM). Without our contact id it falls back
// to the CRM deep link, so names never become dead text.
//
// Touch screens show a faint dotted underline: they have no hover, so a name
// has to look tappable before you touch it. With a mouse the underline shows
// on hover only, so tables of names don't read as a wall of links.
import CrmLink from './CrmLink'
import { openPerson } from './PersonSheet'

export const PERSON_LINK_CLS =
  'text-left underline decoration-dotted decoration-[color:var(--dim)] underline-offset-[3px] hover:decoration-solid hover:decoration-current [@media(hover:hover)]:no-underline [@media(hover:hover)]:hover:underline'

export default function PersonLink({ id, url, className = '', children, ...rest }) {
  if (!id) return <CrmLink url={url} className={className}>{children}</CrmLink>
  return (
    <button
      type="button"
      data-person-link
      {...rest}
      title="Open contact card"
      onClick={(e) => {
        e.stopPropagation()
        openPerson(id)
      }}
      className={`${className} ${PERSON_LINK_CLS}`}
    >
      {children}
    </button>
  )
}
