// Reference > Links helpers (spec section 7). Pure.
export const GROUP_ORDER = ['Property', 'Business checks', 'Licensing', 'Loan lookups']

export function lookupUrls(address) {
  const a = String(address || '').trim()
  const enc = encodeURIComponent(a)
  const slug = a.replace(/,/g, ' ').trim().split(/\s+/).join('-')
  return {
    har: `https://www.har.com/search/dosearch?quicksearch=${enc}`,
    maps: `https://www.google.com/maps/search/?api=1&query=${enc}`,
    zillow: `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`,
  }
}

// FUB raw.addresses -> "street, city, ST zip"; null without a street.
export function leadAddress(raw) {
  const list = Array.isArray(raw?.addresses) ? raw.addresses : []
  const a = list.find((x) => x && String(x.street || '').trim())
  if (!a) return null
  const stateZip = [a.state, a.code].filter(Boolean).join(' ')
  return [String(a.street).trim(), a.city, stateZip].filter(Boolean).join(', ')
}

export const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(String(u || '').trim())

export function groupLinks(rows) {
  const by = new Map()
  for (const r of rows) {
    if (!by.has(r.grp)) by.set(r.grp, [])
    by.get(r.grp).push(r)
  }
  const rank = (g) => {
    const i = GROUP_ORDER.indexOf(g)
    return i === -1 ? GROUP_ORDER.length : i
  }
  return [...by.keys()]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((grp) => ({ grp, links: by.get(grp).slice().sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title)) }))
}
