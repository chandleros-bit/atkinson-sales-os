// Turns a thrown error into words a rep can act on. Code-level failures
// ("Cannot read properties of null (reading 'rpc')") never reach the screen;
// the raw text still goes to the console for debugging.
const NETWORK = /failed to fetch|networkerror|load failed|network request failed|err_connection/i
const ACCESS = /jwt|not authori[sz]ed|permission denied|row-level security|\b40[13]\b/i
const CODE = /cannot read propert|is not a function|is not defined|is undefined|is null|unexpected token|typeerror|referenceerror|syntaxerror/i

export function friendlyError(e) {
  const raw = String(e?.message || e || '').trim()
  if (raw && typeof console !== 'undefined') console.warn('[error]', raw)
  if (!raw) return 'Something went wrong. Try again.'
  if (NETWORK.test(raw)) return "Can't reach the server. Check your connection and try again."
  if (ACCESS.test(raw)) return "This login doesn't have access to that. Try signing in again."
  if (CODE.test(raw)) return 'Something went wrong loading this. Try again.'
  return raw
}
