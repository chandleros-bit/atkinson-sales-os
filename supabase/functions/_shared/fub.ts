// FollowUpBoss API client + field mapping.
//
// VERIFY BEFORE FIRST REAL RUN: this file is written from FUB's documented
// API shape (api.followupboss.com/v1, HTTP Basic auth with the API key as
// username and a blank password). Field names below - especially custom
// fields for loan amount, referral partner, and deal stage keys - should be
// checked against a live response from your FUB account and adjusted here.
// The sync function logs raw payload shape to sync_log.message on error to
// make that first-pass adjustment fast.

const FUB_BASE = 'https://api.followupboss.com/v1'

function authHeader() {
  const key = Deno.env.get('FUB_API_KEY')
  if (!key) throw new Error('FUB_API_KEY not set as a function secret')
  return 'Basic ' + btoa(`${key}:`)
}

async function fubGet(path, params = {}) {
  const url = new URL(FUB_BASE + path)
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)))
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      'X-System': 'AtkinsonSalesOS',
      'X-System-Key': Deno.env.get('FUB_SYSTEM_KEY') || '',
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`FUB GET ${path} -> ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

// Paginate through a FUB list endpoint. FUB uses offset/limit with a
// top-level "_metadata" block reporting total / next; adjust if your
// account's response shape differs.
async function fubList(path, params, take = (json) => json) {
  const limit = 100
  let offset = 0
  const items = []
  while (true) {
    const json = await fubGet(path, { ...params, limit, offset })
    const page = take(json)
    if (!page || page.length === 0) break
    items.push(...page)
    if (page.length < limit) break
    offset += limit
  }
  return items
}

export async function fetchPipelinesAndStages() {
  // GET /pipelines -> [{ id, name, stages: [{ id, name, order }] }]
  const json = await fubGet('/pipelines')
  return json.pipelines || json._embedded?.pipelines || []
}

export async function fetchPeople(sinceIso) {
  return fubList(
    '/people',
    sinceIso ? { sort: 'updated', updatedAfter: sinceIso } : { sort: 'updated' },
    (json) => json.people || json._embedded?.people || [],
  )
}

export async function fetchDeals(sinceIso) {
  return fubList(
    '/deals',
    sinceIso ? { sort: 'updated', updatedAfter: sinceIso } : { sort: 'updated' },
    (json) => json.deals || json._embedded?.deals || [],
  )
}

export async function fetchDealById(id) {
  return fubGet(`/deals/${id}`)
}

export async function fetchPersonById(id) {
  return fubGet(`/people/${id}`)
}

// --- Mapping helpers: FUB shape -> our normalized tables -------------------

export function mapStage(fubStage, sortOrder) {
  const name = (fubStage.name || '').toLowerCase()
  return {
    business_id: 'bay',
    name: fubStage.name,
    sort_order: sortOrder,
    is_won: name.includes('funded') || name.includes('closed won') || name.includes('won'),
    is_lost: name.includes('lost') || name.includes('dead') || name.includes('nurture') === false && name.includes('lost'),
    external_id: String(fubStage.id),
  }
}

export function mapContact(person) {
  const primaryEmail = person.emails?.find((e) => e.isPrimary)?.value || person.emails?.[0]?.value
  const primaryPhone = person.phones?.find((p) => p.isPrimary)?.value || person.phones?.[0]?.value
  return {
    business_id: 'bay',
    source_crm: 'fub',
    external_id: String(person.id),
    name: [person.firstName, person.lastName].filter(Boolean).join(' ') || person.name,
    company: person.company || null,
    email: primaryEmail || null,
    phone: primaryPhone || null,
    owner: person.assignedTo || person.assignedUserName || null,
    person_stage: person.stage || null,
    last_touch_at: person.lastActivity || person.updated || null,
    raw: person,
    updated_at: new Date().toISOString(),
  }
}

// contactIdByExternal: Map of fub person id (string) -> our contacts.id (uuid)
// stageIdByExternal:   Map of fub stage id (string)  -> our stages.id (uuid)
export function mapDeal(deal, contactIdByExternal, stageIdByExternal) {
  return {
    business_id: 'bay',
    source_crm: 'fub',
    external_id: String(deal.id),
    contact_id: contactIdByExternal.get(String(deal.personId)) || null,
    stage_id: stageIdByExternal.get(String(deal.stageId)) || null,
    name: deal.name || null,
    // TODO verify: confirm "price" is the loan amount field on your account;
    // some FUB setups store this in a custom field instead.
    value: deal.price ?? deal.dealValue ?? null,
    secondary_value: null, // TODO: map commission if tracked as a custom field
    expected_close: deal.closeDate || null,
    segment_tag: null,
    // TODO: map referral partner if stored as a custom field or tag
    referral_partner: null,
    next_action_at: deal.nextTaskDue || null,
    stage_entered_at: deal.stageUpdated || null,
    status: deal.isClosed ? (deal.isWon ? 'won' : 'lost') : 'open',
    raw: deal,
    updated_at: new Date().toISOString(),
  }
}
