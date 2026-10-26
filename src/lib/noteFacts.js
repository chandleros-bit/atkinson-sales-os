// A lead's first note as a quick read before the call. Lead providers write it
// as "Credit: 660-699 / email: … / loan type: DSCR Purchase / …" (or one
// "key: value" per line); that becomes labelled facts. Contact details are
// dropped (they're on the lead already). Anything else becomes a short snippet.
//
// Each provider's template reads the same: Credit, Loan type, State, Amount.
//   LendingFlow           "Credit: 660-699 / email: … / loan type: DSCR Purchase / state: North Carolina / loan amount: $200K - $500K"
//   PrivateMortgageLeads  "Loan Amount: $150K - $300K Credit Score: (800-850) Excellent State: FL Specific Property?: Purchase"
// PrivateMortgageLeads runs its fields together on one line, so its known
// keys are split out first, and its two-letter states are spelled out.

const SNIPPET_MAX = 140
const LABELS = {
  'loan amount': 'Amount',
  'credit score': 'Credit',
  'specific property?': 'Loan type',
}
const ORDER = ['Credit', 'Loan type', 'State', 'Amount']
const SKIP = /email|e-mail|phone|mobile/
// Keys PrivateMortgageLeads writes inline, without a separator before them.
const INLINE_KEYS = /\s+(?=(?:Loan Amount|Credit Score|State|Specific Property\?)\s*:)/g

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

const label = (key) => {
  const k = key.trim().toLowerCase().replace(/\s+/g, ' ')
  return LABELS[k] || k.charAt(0).toUpperCase() + k.slice(1)
}

// Same value, same look across providers.
function tidy(k, v) {
  if (k === 'State') return STATES[v.toUpperCase()] || v
  if (k === 'Credit') return v.replace(/^\(([^)]+)\)\s*/, '$1 ')
  if (k === 'Amount') return v.replace(/\s*-\s*/g, ' - ')
  return v
}

const rank = (k) => {
  const i = ORDER.indexOf(k)
  return i === -1 ? ORDER.length : i
}

export function noteFacts(text) {
  const s = String(text ?? '').trim()
  if (!s) return { facts: [], snippet: '' }
  const parts = s
    .replace(INLINE_KEYS, ' / ')
    .split(/\s+\/\s+|\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const pairs = parts.map((p) => p.match(/^([^:]{1,40}):\s*(.+)$/)).filter(Boolean)
  // Fact-shaped when most parts are "key: value".
  if (pairs.length >= 2 && pairs.length * 2 >= parts.length) {
    const facts = pairs
      .filter((m) => !SKIP.test(m[1].toLowerCase()))
      .map((m) => {
        const k = label(m[1])
        return { k, v: tidy(k, m[2].trim()).trim() }
      })
      // Stable: known facts in ORDER, the rest after in note order.
      .sort((a, b) => rank(a.k) - rank(b.k))
    return { facts, snippet: '' }
  }
  const flat = s.replace(/\s+/g, ' ')
  return { facts: [], snippet: flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1)}…` : flat }
}
