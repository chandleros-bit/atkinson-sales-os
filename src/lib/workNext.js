// Workbench v2 Next up (spec 2026-11-23, §5): which item is next, and what the
// card says about it. Pure: Workbench passes today's lists (workLists.js) and
// the open loan for the person, if any.
import { noteFacts } from './noteFacts'
import { reasonText } from './priorityQueue'

export const LIST_ORDER = ['calls', 'files', 'partners']

// The first item of the list being worked, skipping items passed over with J
// this session. With that list empty, the next list in Calls, Files, Partners
// order that has an item. -> { listKey, label, item, index, left } or null.
export function pickNext(lists, activeKey = 'calls', passed = new Set()) {
  const byKey = new Map((lists || []).map((l) => [l.key, l]))
  const order = [activeKey, ...LIST_ORDER.filter((k) => k !== activeKey)]
  for (const key of order) {
    const list = byKey.get(key)
    if (!list) continue
    const open = list.items.filter((i) => !passed.has(itemKey(i)))
    if (open.length) return { listKey: key, label: list.label, item: open[0], index: list.items.indexOf(open[0]), left: open.length }
  }
  return null
}

// A stable key per item across lists: file items have one; call rows are a contact.
export const itemKey = (item) => item?.key || `contact:${item?.id}`

const isFile = (item) => !!item?.key

// -> { key, kind: 'call' | 'file', contactId, book, name, phone, why, chips,
//      agent: { name, phone } | null, tasks, docs, est }
// loan: the person's open Arive loan (loans table row) or null.
export function nextUpModel(item, { loan = null } = {}) {
  if (!item) return null
  const row = item.row || item
  const file = isFile(item)
  const contactId = file ? item.contactId || null : item.id
  const book = item.book || row.business_id || null
  const name = (file ? item.name || item.title : row.name) || '(no name)'
  const why = file
    ? item.why || ''
    : item.bucket
      ? reasonText(item)
      : [item.label, item.hint].filter(Boolean).join(' · ')

  const facts = noteFacts(row.first_note || '').facts
  const fact = (k) => facts.find((f) => f.k === k)?.v
  const amount = loan?.amount ? `$${Math.round(Number(loan.amount)).toLocaleString('en-US')}` : fact('Amount')
  const chips = [
    row.lead_source && `Source: ${row.lead_source}`,
    fact('Credit') && `Credit ${fact('Credit')}`,
    loan?.loan_type || fact('Loan type'),
    amount,
    loan?.property_state || fact('State'),
    loan?.stage && `${loan.stage}${loan.lender ? ` · ${loan.lender}` : ''}`,
  ].filter(Boolean)

  const agent = loan?.buyer_agent_name ? { name: loan.buyer_agent_name, phone: loan.buyer_agent_phone || null, company: loan.buyer_agent_company || null } : null
  return {
    key: itemKey(item),
    kind: file ? 'file' : 'call',
    contactId,
    book,
    name,
    phone: file ? null : row.phone || null,
    stage: row.stage || null,
    cadence: item.kind === 'attempt',
    why,
    chips,
    agent,
    tasks: row.open_task_count ?? null,
    docs: row.docs_outstanding_count ?? null,
    est: item.minutes ? `~${item.minutes} min` : file ? null : '~10 min',
    task: file ? item.title || null : null,
  }
}
