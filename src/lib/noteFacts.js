// A lead's first note as a quick read before the call. Lead providers write it
// as "Credit: 660-699 / email: … / loan type: DSCR Purchase / …" (or one
// "key: value" per line); that becomes labelled facts. Contact details are
// dropped (they're on the lead already). Anything else becomes a short snippet.

const SNIPPET_MAX = 140
const LABELS = { 'loan amount': 'Amount' }
const SKIP = /email|e-mail|phone|mobile/

const label = (key) => {
  const k = key.trim().toLowerCase().replace(/\s+/g, ' ')
  return LABELS[k] || k.charAt(0).toUpperCase() + k.slice(1)
}

export function noteFacts(text) {
  const s = String(text ?? '').trim()
  if (!s) return { facts: [], snippet: '' }
  const parts = s.split(/\s+\/\s+|\n+/).map((p) => p.trim()).filter(Boolean)
  const pairs = parts.map((p) => p.match(/^([^:]{1,40}):\s*(.+)$/)).filter(Boolean)
  // Fact-shaped when most parts are "key: value".
  if (pairs.length >= 2 && pairs.length * 2 >= parts.length) {
    const facts = pairs
      .filter((m) => !SKIP.test(m[1].toLowerCase()))
      .map((m) => ({ k: label(m[1]), v: m[2].trim() }))
    return { facts, snippet: '' }
  }
  const flat = s.replace(/\s+/g, ' ')
  return { facts: [], snippet: flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1)}…` : flat }
}
