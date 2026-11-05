// The Application Sent email (spec 2026-11-05-application-sent-email-design.md).
//
// One source for the copy: the browser renders the preview from it, and
// crm-action publishes it to the three FUB email templates that FUB's Tag
// Added automations send. The OS never sends mail itself; it adds the
// version's tag to the lead (crm-action/app-email-step.ts).

export const APP_EMAIL_KEY = 'application_sent'
export const APP_EMAIL_SUBJECT = 'Your pre-approval: next steps'
export const APP_EMAIL_LINK = 'https://baywayhtx.my1003app.com/1851744/register'
// VERIFY on the test lead (docs/app-email-setup.md): FUB's first-name merge field.
export const FUB_FIRST_NAME = '%contact_first_name%'

export const APP_EMAIL_VARIANTS = [
  { key: 'first_home', label: 'First home', goal: 'buying your first home', tag: 'App Email - First Home', template: 'Sales OS - Application - First Home' },
  { key: 'next_home', label: 'Next home', goal: 'buying your next home', tag: 'App Email - Next Home', template: 'Sales OS - Application - Next Home' },
  { key: 'refinance', label: 'Refinance', goal: 'refinancing your home', tag: 'App Email - Refinance', template: 'Sales OS - Application - Refinance' },
]

export const variantFor = (key) => APP_EMAIL_VARIANTS.find((v) => v.key === key) || null

const norm = (t) => String(t ?? '').trim().toLowerCase()
const TAGS = new Set(APP_EMAIL_VARIANTS.map((v) => norm(v.tag)))

// Any App Email tag means the lead has had (or is getting) the email.
export const hasAppEmailTag = (tags) => (Array.isArray(tags) ? tags : []).some((t) => TAGS.has(norm(t)))

// The preview's starting version, from the lead's FUB tags.
export function defaultVariant(tags) {
  const list = (Array.isArray(tags) ? tags : []).map(norm)
  if (list.some((t) => t.includes('refi'))) return 'refinance'
  if (list.some((t) => /move.?up|repeat|second home/.test(t))) return 'next_home'
  return 'first_home'
}

// W2s for a year arrive by Jan 31 of the next, so the last two tax years are
// the two before this calendar year (Chicago time).
export function w2Years(now = new Date()) {
  const y = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(now))
  return `${y - 2} & ${y - 1}`
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c])

// mode 'preview': the lead's real first name (escaped). mode 'fub': FUB's
// merge field, for the template FUB sends. The signature is FUB's own email
// signature, which FUB adds after "Thank you,".
export function renderAppEmail({ variant, firstName = '', now = new Date(), mode = 'preview' }) {
  const v = variantFor(variant)
  if (!v) throw new Error(`Unknown email version: ${variant}`)
  const name = mode === 'fub' ? FUB_FIRST_NAME : esc(String(firstName ?? '').trim())
  const html = [
    `<p>Hey ${name},</p>`,
    `<p>It was nice speaking with you about ${v.goal}!</p>`,
    `<p>To get started, please click this link to create an account and complete the questions for your pre-approval: <a href="${APP_EMAIL_LINK}">Click Here to Start Application</a></p>`,
    '<p>Please upload the following supporting documents:</p>',
    `<ol><li>Last 30 Day Paystubs</li><li>Most Recent 2 Months&#39; Bank Statements</li><li>${esc(w2Years(now))} W2s</li></ol>`,
    '<p>Once I receive your application and supporting documents, I will review within 48 hours. I&#39;ll determine the best programs that fit your situation then we&#39;ll schedule a call to talk through your options.</p>',
    '<p>Feel free to reach out with any questions. I look forward to helping you!</p>',
    '<p>Thank you,</p>',
  ].join('\n')
  return { subject: APP_EMAIL_SUBJECT, html }
}
