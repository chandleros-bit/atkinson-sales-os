// CRM deep-link helpers. The SQL views (0013/0015/0016) build these URLs
// server-side wherever they can; this mirrors the same patterns for rows read
// straight off the `contacts` table (the Overview HOT-tag query), so both paths
// produce identical links. Pure — unit-tested.

export const FUB_PERSON_BASE = 'https://baywayhtx.followupboss.com/2/people/view/'
// MPG's pipeline lives on the Zoho Leads module (US data center).
export const ZOHO_LEAD_BASE = 'https://crm.zoho.com/crm/tab/Leads/'

export function crmProfileUrl(businessId, externalId) {
  if (externalId === null || externalId === undefined || externalId === '') return null
  if (businessId === 'bay') return FUB_PERSON_BASE + externalId
  if (businessId === 'mpg') return ZOHO_LEAD_BASE + externalId
  return null
}
