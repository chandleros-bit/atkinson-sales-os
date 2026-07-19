// One place that decides how a lead name renders as a CRM deep link, so the
// Pipeline board, Overview "Needs Attention", Activity feed and Contacts table
// all behave the same. Falls back to plain text when no URL exists (a row whose
// source CRM id is missing).
export default function CrmLink({ url, children, className = '', title = 'Open in CRM' }) {
  if (!url) return <span className={className}>{children}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={title}
      className={`${className} hover:underline`}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  )
}
