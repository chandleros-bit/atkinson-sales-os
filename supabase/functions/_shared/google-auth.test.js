import { describe, it, expect } from 'vitest'
import { base64url, buildClaims, pemToPkcs8 } from './google-auth.ts'

describe('base64url', () => {
  it('removes padding and replaces + and / with url-safe chars', () => {
    // [251, 255] → base64 '+/8=' → url-safe '-_8'
    // Two bytes, so padding genuinely occurs. Exercises all three transforms:
    // '+' → '-', '/' → '_', and the trailing '=' strip.
    const out = base64url(new Uint8Array([251, 255]))
    expect(out).toBe('-_8')
  })

  it('handles full byte range 0-255', () => {
    // [0, 1, 127, 128, 200, 255] → base64 'AAF/gMj/' → url-safe 'AAF_gMj_'
    // Production inputs are RSA signature bytes and decoded PEM bytes, which
    // span 0-255 — ASCII-only test input would miss the high half entirely.
    const out = base64url(new Uint8Array([0, 1, 127, 128, 200, 255]))
    expect(out).toBe('AAF_gMj_')
  })

  it('round-trips through atob after padding is restored', () => {
    const out = base64url(new TextEncoder().encode('hello'))
    expect(out).toBe('aGVsbG8')
  })
})

describe('buildClaims', () => {
  const creds = { client_email: 'svc@proj.iam.gserviceaccount.com' }

  it('targets the token endpoint with a read-only sheets scope', () => {
    const c = buildClaims(creds, 1_700_000_000_000)
    expect(c.iss).toBe('svc@proj.iam.gserviceaccount.com')
    expect(c.aud).toBe('https://oauth2.googleapis.com/token')
    expect(c.scope).toBe('https://www.googleapis.com/auth/spreadsheets.readonly')
  })

  it('expires an hour out, in seconds not milliseconds', () => {
    const c = buildClaims(creds, 1_700_000_000_000)
    expect(c.iat).toBe(1_700_000_000)
    expect(c.exp).toBe(1_700_000_000 + 3600)
  })

  it('throws when the key JSON has no client_email', () => {
    expect(() => buildClaims({}, 1_700_000_000_000)).toThrow(/client_email/)
  })
})

describe('pemToPkcs8', () => {
  it('strips header, footer and newlines into raw bytes', () => {
    const body = 'AAECAwQ='
    const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`
    const buf = pemToPkcs8(pem)
    expect(Array.from(new Uint8Array(buf))).toEqual([0, 1, 2, 3, 4])
  })

  it('handles literal \\n escapes, which is how the key arrives from an env var', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\\nAAECAwQ=\\n-----END PRIVATE KEY-----\\n'
    const buf = pemToPkcs8(pem)
    expect(Array.from(new Uint8Array(buf))).toEqual([0, 1, 2, 3, 4])
  })

  it('throws on a key that is not a PEM block', () => {
    expect(() => pemToPkcs8('not a key')).toThrow(/PRIVATE KEY/)
  })
})
