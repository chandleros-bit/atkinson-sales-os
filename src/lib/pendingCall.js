// The call Chandler just placed from a tel: link, so PostCallHost can ask for
// notes and offer a text once he's back in the OS. A web page can't see the
// call end; it sees the tab go hidden (the phone app takes over) and come back.
//
// A tel: link opts in with callAttrs({ id, book, name }): the contact's OS id,
// 'bay' | 'mpg', and name. Links without them (the dialer, agents, lenders)
// never prompt. The call lives in localStorage so it survives iOS reloading
// the page while the phone app was in front; it goes stale after two hours.
const KEY = 'os.pendingCall'
export const MAX_AGE_MS = 2 * 3_600_000

export function callAttrs({ id, book, name } = {}) {
  if (!id || !book) return {}
  return { 'data-call-id': id, 'data-call-book': book, 'data-call-name': name || '' }
}

// The contact behind a clicked element, or null when it isn't an opted-in tel: link.
export function callFromTarget(target) {
  const a = target?.closest?.('a[href^="tel:"][data-call-id]')
  if (!a) return null
  return {
    id: a.dataset.callId,
    book: a.dataset.callBook,
    name: a.dataset.callName || '',
    phone: a.getAttribute('href').slice(4),
  }
}

export function savePendingCall(call, now = Date.now()) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...call, at: now, left: false }))
  } catch {
    // Private window or blocked storage: no prompt for this call.
  }
}

export function readPendingCall(now = Date.now()) {
  try {
    const call = JSON.parse(window.localStorage.getItem(KEY) || 'null')
    if (!call?.id || !(now - call.at < MAX_AGE_MS) || call.at > now) return null
    return call
  } catch {
    return null
  }
}

// The tab went hidden after the tap: the call is (most likely) happening.
export function markCallLeft(now = Date.now()) {
  const call = readPendingCall(now)
  if (!call || call.left) return
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...call, left: true }))
  } catch {
    // ignore
  }
}

export function clearPendingCall() {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

// The note saved to the CRM: what he typed, then the text he opened, if any.
export function postCallNote(note, texted) {
  return [String(note || '').trim(), texted ? `Texted: ${texted}` : ''].filter(Boolean).join('\n\n')
}
