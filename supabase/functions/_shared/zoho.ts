// Zoho CRM (MPG) OAuth2 client + field mapping for the scheduled MPG sync.
//
// Field mappings verified against the live Media Payments Group Zoho account
// (US data center; pipeline currently on Leads). The syncs only GET; zohoSend
// is the crm-action write path (see docs/phase-writeback-setup.md).
// See docs/phase5-zoho-setup.md.

import { withRetry429 } from './retry.ts'

const DEFAULT_ACCOUNTS_HOST = 'https://accounts.zoho.com'
const DEFAULT_API_HOST = 'https://www.zohoapis.com'

// get: (key) => string | undefined  (e.g. Deno.env.get). Pure + unit-testable.
export function getCredentials(get) {
  const required = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']
  const missing = required.filter((k) => !get(k))
  if (missing.length) {
    throw new Error(`Zoho credentials not set as function secrets: ${missing.join(', ')}`)
  }
  return {
    clientId: get('ZOHO_CLIENT_ID'),
    clientSecret: get('ZOHO_CLIENT_SECRET'),
    refreshToken: get('ZOHO_REFRESH_TOKEN'),
    accountsHost: get('ZOHO_ACCOUNTS_HOST') || DEFAULT_ACCOUNTS_HOST,
    apiHost: get('ZOHO_API_HOST') || DEFAULT_API_HOST,
  }
}

// Refresh this long before a cached token expires.
const TOKEN_MARGIN_MS = 5 * 60_000

// An access token for every Zoho function. Returns { accessToken, apiHost }.
//
// Zoho caps refreshes at about 10 per 10 minutes (and limits live tokens per
// refresh token), so with a db the token is shared through oauth_tokens
// (migration 0039, service role only) and reused until TOKEN_MARGIN_MS before
// it expires: about one refresh an hour instead of one per run or action.
// `source` (the refresh token's last 6 characters) makes a re-authorization
// mint a fresh token at once instead of reusing one from the old grant.
export async function getAccessToken({ db = null, now = Date.now() } = {}) {
  const c = getCredentials((k) => Deno.env.get(k))
  const source = c.refreshToken.slice(-6)
  if (db) {
    const { data } = await db
      .from('oauth_tokens')
      .select('access_token, api_host, expires_at, source')
      .eq('provider', 'zoho')
      .maybeSingle()
    if (data?.access_token && data.source === source && Date.parse(data.expires_at) - now > TOKEN_MARGIN_MS) {
      return { accessToken: data.access_token, apiHost: data.api_host || c.apiHost }
    }
  }
  const url = new URL(`${c.accountsHost}/oauth/v2/token`)
  url.searchParams.set('grant_type', 'refresh_token')
  url.searchParams.set('client_id', c.clientId)
  url.searchParams.set('client_secret', c.clientSecret)
  url.searchParams.set('refresh_token', c.refreshToken)
  const res = await fetch(url, { method: 'POST' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) {
    throw new Error(`Zoho token refresh -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
  }
  if (db) {
    const expiresIn = Number(json.expires_in) || 3600
    // A failed cache write only costs an extra refresh next time.
    await db.from('oauth_tokens').upsert(
      {
        provider: 'zoho',
        access_token: json.access_token,
        api_host: c.apiHost,
        expires_at: new Date(now + expiresIn * 1000).toISOString(),
        source,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: 'provider' },
    )
  }
  return { accessToken: json.access_token, apiHost: c.apiHost }
}

export async function zohoGet(apiHost, accessToken, path, params = {}, sinceIso) {
  const url = new URL(`${apiHost}/crm/v2/${path}`)
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)))
  const headers = { Authorization: `Zoho-oauthtoken ${accessToken}` }
  if (sinceIso) headers['If-Modified-Since'] = sinceIso
  const res = await fetch(url, { headers })
  // Zoho returns 204 (no data) / 304 (not modified) for empty result sets.
  if (res.status === 204 || res.status === 304) return { data: [], info: { more_records: false } }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Zoho GET ${path} -> ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

// A record-level failure inside a 2xx Zoho write response, or null. Zoho wraps
// writes as { data: [{ code, status, message, details }] } and reports a bad
// record with status 'error' while the HTTP status is still 200/201.
export function zohoRecordError(json) {
  const r = json?.data?.[0]
  if (!r || String(r.status).toLowerCase() !== 'error') return null
  const details = r.details ? ` ${JSON.stringify(r.details).slice(0, 200)}` : ''
  return `${r.code || 'ERROR'}: ${r.message || 'record rejected'}${details}`
}

// Write to Zoho (crm-action only). One retry on 429; a record-level error in a
// 2xx body throws like an HTTP failure. Returns the parsed body.
export async function zohoSend(apiHost, accessToken, method, path, body, { sleep } = {}) {
  const res = await withRetry429(
    () =>
      fetch(`${apiHost}/crm/v2/${path}`, {
        method,
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
      }),
    { sleep },
  )
  const text = await res.text()
  if (!res.ok) throw new Error(`Zoho ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  let json = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Zoho ${method} ${path} -> ${res.status}: unparseable body ${text.slice(0, 200)}`)
  }
  const recordError = zohoRecordError(json)
  if (recordError) throw new Error(`Zoho ${method} ${path} -> ${recordError}`)
  return json
}

// Paginate a Zoho module list. Zoho uses page/per_page(<=200) + info.more_records.
// A response that keeps saying more_records: true without actually advancing —
// a malformed payload, or an API quirk — would spin this loop until the Edge
// Function's wall clock kills it, with nothing in sync_log to explain why.
// Cap the pages instead. At 200/page that's a 20,000-record ceiling per module
// per invocation, comfortably above this org's real volume.
const MAX_PAGES = 100

export async function zohoList(apiHost, accessToken, module, sinceIso) {
  const perPage = 200
  let page = 1
  let pages = 0
  const items = []
  while (true) {
    const json = await zohoGet(apiHost, accessToken, module, { page, per_page: perPage }, sinceIso)
    const rows = json.data || []
    items.push(...rows)
    if (!json.info || !json.info.more_records) break
    if (++pages >= MAX_PAGES) {
      throw new Error(`Zoho ${module} exceeded ${MAX_PAGES} pages — pagination may not be advancing`)
    }
    page += 1
  }
  return items
}

// Deal Stage picklist (with won/lost type) from module field metadata.
export async function fetchDealStages(apiHost, accessToken) {
  const json = await zohoGet(apiHost, accessToken, 'settings/fields', { module: 'Deals' })
  const fields = json.fields || []
  const stageField = fields.find((f) => f.api_name === 'Stage')
  return (stageField && stageField.pick_list_values) || []
}

export async function fetchLeads(apiHost, accessToken, sinceIso) {
  return zohoList(apiHost, accessToken, 'Leads', sinceIso)
}
export async function fetchContacts(apiHost, accessToken, sinceIso) {
  return zohoList(apiHost, accessToken, 'Contacts', sinceIso)
}
export async function fetchDeals(apiHost, accessToken, sinceIso) {
  return zohoList(apiHost, accessToken, 'Deals', sinceIso)
}

// --- Mapping: Zoho shape -> our normalized tables (business_id 'mpg') --------

export function mapStage(stage, sortOrder) {
  // Real MPG Zoho forecast_type values: 'Open' | 'Closed Won' | 'Closed Lost'
  // (title-case, space). Match on substring so casing/spacing variants are safe.
  const ft = (stage.forecast_type || '').toLowerCase()
  return {
    business_id: 'mpg',
    name: stage.display_value,
    sort_order: sortOrder,
    is_won: ft.includes('won'),
    is_lost: ft.includes('lost'),
    // Zoho deals reference a stage by its display value, so that is our join key.
    external_id: String(stage.display_value),
  }
}

// MPG's "Initial lead" leads are the untouched Web Research list (~600 rows),
// kept out of the OS. Exact match: "Initial lead follow up" is a worked lead
// and stays. A lead shows up once Zoho moves it to any other status.
const EXCLUDED_LEAD_STATUS = 'initial lead'

export function isExcludedLead(rec) {
  return String(rec?.Lead_Status || '').trim().toLowerCase() === EXCLUDED_LEAD_STATUS
}

// kind: 'Leads' | 'Contacts'
export function mapContact(rec, kind) {
  const owner = (rec.Owner && (rec.Owner.name || rec.Owner.full_name)) || null
  const company = rec.Company || (rec.Account_Name && rec.Account_Name.name) || null
  return {
    business_id: 'mpg',
    source_crm: 'zoho',
    external_id: String(rec.id),
    name: rec.Full_Name || [rec.First_Name, rec.Last_Name].filter(Boolean).join(' ') || null,
    company,
    email: rec.Email || null,
    phone: rec.Phone || rec.Mobile || null,
    owner,
    person_stage: kind === 'Leads' ? rec.Lead_Status || null : null,
    last_touch_at: rec.Last_Activity_Time || rec.Modified_Time || null,
    raw: rec,
    updated_at: new Date().toISOString(),
  }
}

// contactIdByExternal: Map<zoho contact id (string), our contacts.id (uuid)>
// stageIndex: Map<stage display value (string), { id: uuid, status: 'won'|'lost'|'open' }>
export function mapDeal(deal, contactIdByExternal, stageIndex) {
  const contactExt = deal.Contact_Name && String(deal.Contact_Name.id)
  const st = stageIndex.get(String(deal.Stage))
  return {
    business_id: 'mpg',
    source_crm: 'zoho',
    external_id: String(deal.id),
    contact_id: (contactExt && contactIdByExternal.get(contactExt)) || null,
    stage_id: st ? st.id : null,
    name: deal.Deal_Name || null,
    // MPG Deals have no dollar amount field today (they use Residual_Split %,
    // Proposed_Pricing text). Amount maps through if ever populated, else null.
    value: deal.Amount ?? null,
    secondary_value: null, // no processing-volume field in MPG Zoho
    expected_close: deal.Closing_Date || null,
    segment_tag: null, // MPG Zoho has no Displacement/Greenfield segment field
    referral_partner: deal.Software_Referral || null, // Zoho "Partner Name" field
    next_action_at: null,
    stage_entered_at: null,
    status: st ? st.status : 'open',
    raw: deal,
    updated_at: new Date().toISOString(),
  }
}
