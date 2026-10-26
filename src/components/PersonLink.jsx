// A contact's name that opens their contact card (PersonSheet: details, notes,
// Quick Actions, Open in CRM). Without our contact id it falls back to the CRM
// deep link, so names never become dead text.
import CrmLink from './CrmLink'
import { openPerson } from './PersonSheet'

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
      className={`${className} text-left hover:underline`}
    >
      {children}
    </button>
  )
}
