// Google service-account auth (Google Calendar push; also the retired
// sheets-docs-sync, which is unscheduled since migration 0057). The ONLY asymmetric-signing
// code in this repo, kept in its own module (with its own tests) so a malformed
// key never has to be debugged through a sync function.
//
// Scope is per caller. The default is read-only Sheets, and the sheet is shared
// with the service account as Viewer, so the docs sync can never write to the
// assistant's sheet. gcal-push asks for CALENDAR_EVENTS_SCOPE instead.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
export const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const TTL_SECONDS = 3600

export interface ServiceAccountCreds {
  client_email?: string
  private_key?: string
}

export function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function buildClaims(
  creds: ServiceAccountCreds,
  nowMs: number,
  scope: string = SHEETS_READONLY_SCOPE,
) {
  if (!creds?.client_email) {
    throw new Error('service account JSON has no client_email')
  }
  const iat = Math.floor(nowMs / 1000)
  return {
    iss: creds.client_email,
    scope,
    aud: TOKEN_URL,
    iat,
    exp: iat + TTL_SECONDS,
  }
}

// A service-account private_key is a PKCS#8 PEM. When it arrives via an env var
// the newlines are usually escaped as literal backslash-n, which importKey
// rejects with an unhelpful error — restore them before stripping.
export function pemToPkcs8(pem: string): ArrayBuffer {
  const normalized = String(pem || '').replace(/\\n/g, '\n')
  const match = normalized.match(
    /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/,
  )
  if (!match) throw new Error('private_key is not a PKCS#8 PRIVATE KEY PEM block')
  const b64 = match[1].replace(/\s+/g, '')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

async function signJwt(creds: ServiceAccountCreds, nowMs: number, scope: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const enc = new TextEncoder()
  const unsigned =
    `${base64url(enc.encode(JSON.stringify(header)))}.` +
    `${base64url(enc.encode(JSON.stringify(buildClaims(creds, nowMs, scope))))}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(creds.private_key || ''),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned))
  return `${unsigned}.${base64url(new Uint8Array(sig))}`
}

// Exchanges a signed JWT for a short-lived access token. Throws on any non-2xx
// so an auth failure aborts BEFORE the sync diffs anything — a partial write on
// a bad token would be far worse than a failed run.
export async function getAccessToken(
  creds: ServiceAccountCreds,
  nowMs: number = Date.now(),
  scope: string = SHEETS_READONLY_SCOPE,
): Promise<string> {
  const jwt = await signJwt(creds, nowMs, scope)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) {
    throw new Error(`google token exchange failed: ${res.status} ${await res.text()}`)
  }
  let json
  try {
    json = await res.json()
  } catch (e) {
    throw new Error(`google token exchange failed: ${res.status} malformed JSON response`)
  }
  if (!json.access_token) throw new Error('google token response had no access_token')
  return json.access_token
}
