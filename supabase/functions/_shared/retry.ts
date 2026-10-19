// One retry on HTTP 429 for the CRM write path (fubSend / zohoSend). FUB and
// Zoho both throttle; a write that hits the limit waits Retry-After (seconds,
// capped so a tap in the UI never hangs) and tries once more. The caller
// decides what a second non-2xx means.
//
// doFetch: () => Promise<Response>. sleep is injectable so tests don't wait.
export const MAX_RETRY_WAIT_MS = 5000

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function withRetry429(doFetch, { sleep = realSleep } = {}) {
  const res = await doFetch()
  if (res.status !== 429) return res
  const after = Number(res.headers?.get?.('Retry-After'))
  const waitMs = Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 1000, MAX_RETRY_WAIT_MS)
  await sleep(waitMs)
  return doFetch()
}
