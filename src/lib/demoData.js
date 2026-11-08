// One set of sample records for demo mode. Overview, Pipeline, Contacts,
// Calendar and Today's Events all read from here, so a tile and the page
// behind it always tell the same story (3 MPG leads on Overview = 3 cards on
// the MPG pipeline).

const DAY = 86_400_000
const ago = (days) => new Date(Date.now() - days * DAY).toISOString()

// An all-day event is stored anchored at midnight UTC on its own date — NOT
// local midnight — so demo data uses that shape to exercise the production path.
function allDayIn(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString()
}

// A timed event later today (clamped so it never rolls past midnight).
function laterToday(hours) {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30)
  return new Date(Math.min(now.getTime() + hours * 3_600_000, end.getTime())).toISOString()
}

// Bayway: the active loan pipeline (v_active_pipeline shape).
export function demoBayPipeline() {
  return [
    {
      id: 'd1', business_id: 'bay', stage: 'Application Received', name: 'Ramirez · Purchase', phone: '(713) 555-0142',
      email: null, stage_since: ago(4), last_touch_at: null, crm_profile_url: '#',
      docs_tracked: true, docs_outstanding: ['Paystubs', 'W2', 'Bank Statements'],
      docs_outstanding_count: 3, docs_oldest_requested_at: ago(12),
      doc_notes: 'Employer reissuing the W2 — chasing weekly',
      last_note_snippet: 'Sending W2 tomorrow, has to dig up the 2024 one', last_note_at: ago(2),
    },
    {
      id: 'd2', business_id: 'bay', stage: 'Application/Estimate Sent', name: 'Nguyen · Refi', phone: '(281) 555-0195',
      email: 'nguyen@example.com', stage_since: ago(9), last_touch_at: ago(1), crm_profile_url: '#',
      docs_tracked: true, docs_outstanding: [], docs_outstanding_count: 0, docs_oldest_requested_at: null,
      last_note_snippet: 'Locked rate, clear to close', last_note_at: ago(1),
    },
    {
      id: 'd3', business_id: 'bay', stage: 'Contacted/Working', name: 'Okafor · Purchase', phone: '(832) 555-0110',
      email: null, stage_since: ago(12), last_touch_at: ago(2), crm_profile_url: '#',
      docs_tracked: false, docs_outstanding: [], docs_outstanding_count: 0, docs_oldest_requested_at: null,
      last_note_snippet: null, last_note_at: null,
    },
    {
      id: 'd4', business_id: 'bay', stage: 'New Lead', name: 'Lee · Purchase', phone: '(346) 555-0177',
      email: null, stage_since: ago(1), last_touch_at: null, crm_profile_url: '#',
      docs_tracked: false, docs_outstanding: [], docs_outstanding_count: 0, docs_oldest_requested_at: null,
      last_note_snippet: null, last_note_at: null,
    },
  ]
}

// MPG: open Zoho leads (v_mpg_contacts shape).
export function demoMpgLeads() {
  return [
    { id: 'm1', business_id: 'mpg', name: 'Chef Rasi', company: 'Craft Pita', email: null, phone: '(832) 804-9056', stage: 'Open', last_touch_at: null, crm_profile_url: '#' },
    { id: 'm2', business_id: 'mpg', name: 'Chris Lee', company: 'Heights Auto', email: 'chris@example.com', phone: '(832) 555-0133', stage: 'Contacted', last_touch_at: ago(1), crm_profile_url: '#' },
    { id: 'm3', business_id: 'mpg', name: 'Owner ?', company: 'Barnaby’s Cafe', email: 'x@example.com', phone: '(832) 831-8296', stage: 'Qualified', last_touch_at: ago(1), crm_profile_url: '#' },
  ]
}

// Everyone above as v_people rows: the contact card and search in demo mode.
export function demoPeople() {
  return [...demoBayPipeline(), ...demoMpgLeads()].map((r) => ({ ...r, on_board: true }))
}

export function demoPerson(id) {
  return demoPeople().find((p) => p.id === id) || null
}

// Both Outlook calendars (calendar_events shape).
export function demoCalendarEvents() {
  return [
    { id: 'e1', source_account: 'outlook-bayway', title: 'Docs review — Ramirez', starts_at: laterToday(3), location: 'Title Co.', is_all_day: false },
    { id: 'e2', source_account: 'outlook-bayway', title: 'Quarterly planning', starts_at: allDayIn(0), location: null, is_all_day: true },
    { id: 'e3', source_account: 'outlook-bayway', title: 'Rate lock — Nguyen', starts_at: laterToday(5), location: 'Phone', is_all_day: false },
    { id: 'e4', source_account: 'outlook-mpg', title: 'Merchant demo — Craft Pita', starts_at: new Date(Date.now() + 26 * 3_600_000).toISOString(), location: null, is_all_day: false },
    { id: 'e5', source_account: 'outlook-mpg', title: 'Underwriting call — Heights Auto', starts_at: allDayIn(4), location: null, is_all_day: false },
  ]
}
