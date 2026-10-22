// Phone numbers for display and dialing. CRMs store them every which way
// ("8325555555", "832-555-5555", "+1 832.555.5555"); the dashboard shows a US
// number as (832) 555-5555 and leaves anything else as it was.

export function formatPhone(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  // Only plain US numbers: punctuation, an optional +1, and 10 digits.
  if (/[^\d\s().+-]/.test(s)) return s
  let digits = s.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length !== 10) return s
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

// tel: link for a stored number: its digits, keeping a leading +.
export const telHref = (phone) => (phone ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null)
