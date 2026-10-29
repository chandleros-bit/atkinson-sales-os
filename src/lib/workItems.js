// Writes to work_items (migration 0041): the Workbench's own state for an item,
// never sent to a CRM. Per user by RLS; user_id defaults to auth.uid().
//
// A generated item (estimate / application / MPG task) is upserted on its key,
// so its row is created the first time you change it. A custom item is a row
// already and is updated by id.
import { supabase } from './supabase'

const KIND = { estimate: 'estimate', application: 'application', disclosed: 'disclosed', mpg_task: 'statement', custom: 'custom' }

export const WAITING_ON = ['Borrower', 'Lender', 'Processor', 'Underwriter', 'Merchant']

// patch: any of { status, waiting_on, check_back_on, notes }. Marking an item
// done sends done_at so a second weekly review re-stamps it.
export async function saveWorkItem(item, patch) {
  const body = { ...patch }
  if (patch.status === 'done') body.done_at = new Date().toISOString()
  // A reviewed application comes back early when its missing docs change.
  if (patch.status === 'done' && item.kind === 'application') body.review_docs = item.docs ?? 0
  if (patch.status && patch.status !== 'waiting') {
    body.waiting_on = null
    body.check_back_on = null
  }
  if (item.kind === 'custom') {
    return supabase.from('work_items').update(body).eq('id', item.rowId)
  }
  return supabase.from('work_items').upsert(
    {
      source_key: item.key,
      kind: KIND[item.kind],
      business_id: item.book,
      contact_id: item.kind === 'mpg_task' ? null : item.contactId,
      ...body,
    },
    { onConflict: 'user_id,source_key' },
  )
}

// "+ Work item" and the voice quick-add: a custom row. contactId and dueOn
// ('YYYY-MM-DD', migration 0043) are optional.
export async function addWorkItem({ book, title, contactId = null, notes = null, dueOn = null }) {
  return supabase.from('work_items').insert({
    kind: 'custom',
    business_id: book,
    title: title.trim(),
    contact_id: contactId,
    notes: notes?.trim() || null,
    due_on: dueOn || null,
  })
}
