// Invite and password-reset links land on /accept-invite.
//
// The Supabase email templates link to
//   /accept-invite?token_hash={{ .TokenHash }}&type=invite   (or type=recovery)
// so the one-time token is only spent when the person presses the button.
// Work mail scanners open links before people do; with the default
// {{ .ConfirmationURL }} link that scan used the token up and the real click
// came back "access_denied". A failed or old-style link arrives with
// error / error_description in the query or the hash instead.

const TYPES = new Set(['invite', 'recovery'])

export function readAuthLink(search = '', hash = '') {
  const q = new URLSearchParams(search)
  const h = new URLSearchParams(String(hash).replace(/^#/, ''))
  const error = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error') || null
  const type = q.get('type')
  const tokenHash = q.get('token_hash')
  if (!tokenHash || !TYPES.has(type)) return { tokenHash: null, type: null, error }
  return { tokenHash, type, error }
}

export const MIN_PASSWORD = 8

export function passwordProblem(password, confirm) {
  if (!password || password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`
  if (password !== confirm) return 'The two passwords do not match.'
  return null
}
