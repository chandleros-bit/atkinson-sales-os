// Lead temperature as one FUB tag (spec 2026-11-03, section 1). PUT /people
// replaces the whole tag list, so callers read the person first and send the
// list this returns. Pure (no Deno imports) so Vitest can run it.
export const TEMPERATURE_TAGS = { hot: 'Hot', warm: 'Warm', cold: 'Cold' }
const TEMP_NAMES = new Set(Object.keys(TEMPERATURE_TAGS))

export function retagTemperature(tags, temperature) {
  if (!TEMPERATURE_TAGS[temperature]) throw new Error(`Unknown temperature: ${temperature}`)
  const kept = (Array.isArray(tags) ? tags : []).filter((t) => !TEMP_NAMES.has(String(t).trim().toLowerCase()))
  return [...kept, TEMPERATURE_TAGS[temperature]]
}
