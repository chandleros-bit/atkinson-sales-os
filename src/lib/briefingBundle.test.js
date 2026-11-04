// The committed edge-function bundle must match a fresh bundle of src/lib.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { bundleBriefing } from '../../scripts/build-briefing.mjs'

describe('daily-briefing bundle', () => {
  it('is up to date with src/lib (run `npm run build:briefing`)', async () => {
    const fresh = await bundleBriefing()
    const committed = readFileSync('supabase/functions/daily-briefing/briefing.bundle.js', 'utf8').replace(/\r\n/g, '\n')
    expect(committed).toBe(fresh.replace(/\r\n/g, '\n'))
  })
  it('contains no Supabase client or React', async () => {
    const fresh = await bundleBriefing()
    expect(fresh).not.toMatch(/@supabase\/supabase-js|from "react"/)
  })
})
