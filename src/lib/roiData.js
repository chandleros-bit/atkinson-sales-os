// Supabase glue for the ROI card: source aliases and marketing spend (0059).
// Reads return { data, error } like a bare query. Before 0059 is applied the
// missing tables read as empty.
import { supabase } from './supabase'
import { isMissingTable } from './loansData'

const empty = (res) => (isMissingTable(res.error) ? { data: [], error: null } : res)

// -> { data: { aliases, spend }, error }
export async function fetchRoiInputs() {
  const [aliases, spend] = (
    await Promise.all([
      supabase.from('source_aliases').select('id, book, raw, label, is_free').order('id').limit(500),
      supabase.from('marketing_spend').select('id, book, source, month, amount').order('month', { ascending: false }).limit(2000),
    ])
  ).map(empty)
  const error = aliases.error || spend.error
  if (error) return { data: null, error }
  return { data: { aliases: aliases.data || [], spend: spend.data || [] }, error: null }
}

// { upserts, deletes } from spendChanges -> { error }
export async function saveSpend({ upserts, deletes }) {
  const now = new Date().toISOString()
  if (upserts.length) {
    const { error } = await supabase.from('marketing_spend').upsert(upserts.map((u) => ({ ...u, updated_at: now })), { onConflict: 'book,source,month' })
    if (error) return { error }
  }
  if (deletes.length) {
    const { error } = await supabase.from('marketing_spend').delete().in('id', deletes)
    if (error) return { error }
  }
  return { error: null }
}

export async function saveAliases(rows) {
  const now = new Date().toISOString()
  const { error } = await supabase.from('source_aliases').upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: 'book,raw' })
  return { error: error || null }
}

export async function removeAliases(ids) {
  const { error } = await supabase.from('source_aliases').delete().in('id', ids)
  return { error: error || null }
}
