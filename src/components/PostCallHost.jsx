// After a call placed from a contact's tel: link (callAttrs), the OS asks for
// notes and offers a text through Messages (iMessage when the other person has
// it). Mounted once in Layout, like ReminderHost.
//
// A web page can't see the call end. Tapping the link saves the call
// (pendingCall.js); the tab going hidden marks it under way; the tab coming
// back, or the page reloading, opens this sheet. Save adds a note in the CRM
// through crm-action's add_note (with "Texted: ..." when a text was opened).
// Skip drops it. iOS never lets a page send a text on its own: the Text
// button opens Messages filled in, and Chandler taps Send.
import { useCallback, useEffect, useState } from 'react'
import { Sheet, quickActionTone, inputCls } from './QuickActions'
import { showToast } from './Toaster'
import { invokeCrmAction } from '../lib/writeback'
import { buildActionRequest, summarizeResult } from '../lib/crmActions'
import { formatPhone } from '../lib/phone'
import { textFor, smsHref } from '../lib/dialTexts'
import { callFromTarget, savePendingCall, readPendingCall, markCallLeft, clearPendingCall, postCallNote } from '../lib/pendingCall'

const quiet = 'min-h-[40px] rounded-lg border border-line2 px-3 text-body font-semibold text-ink2'
const TEMPLATES = [
  { key: 'after_missed', label: 'No answer' },
  { key: 'after_talked', label: 'Talked' },
]

export default function PostCallHost() {
  const [call, setCall] = useState(null)

  // A reload (iOS often reloads a backgrounded tab) reopens a fresh call.
  const check = useCallback((reloaded) => {
    const pending = readPendingCall()
    if (pending && (pending.left || reloaded)) setCall((c) => (c?.id === pending.id && c?.at === pending.at ? c : pending))
  }, [])

  useEffect(() => {
    check(true)
    const onClick = (e) => {
      const c = callFromTarget(e.target)
      if (c) savePendingCall(c)
    }
    const onVisibility = () => (document.visibilityState === 'hidden' ? markCallLeft() : check(false))
    const onShow = (e) => e.persisted && check(false)
    document.addEventListener('click', onClick, true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onShow)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onShow)
    }
  }, [check])

  const close = useCallback(() => {
    clearPendingCall()
    setCall(null)
  }, [])

  if (!call) return null
  return <PostCallSheet key={`${call.id}-${call.at}`} call={call} onClose={close} />
}

function PostCallSheet({ call, onClose }) {
  const [note, setNote] = useState('')
  const [texted, setTexted] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const t = quickActionTone(call.book)
  const body = postCallNote(note, texted)

  const save = async () => {
    setBusy(true)
    setError(null)
    const res = await invokeCrmAction(buildActionRequest({ action: 'add_note', contactId: call.id, body }))
    const summary = summarizeResult(res, call.book)
    setBusy(false)
    if (summary.tone === 'error') return setError(summary.text)
    showToast(summary)
    onClose()
  }

  return (
    <Sheet title={`After the call with ${call.name || 'contact'}`} subtitle={formatPhone(call.phone) || call.phone} t={t} onClose={onClose}>
      <label className="text-caption font-semibold text-dim" htmlFor="post-call-note">Notes</label>
      <textarea
        id="post-call-note"
        rows={4}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What happened on the call?"
        className={`${inputCls} mt-1.5`}
      />

      <div className="mt-4 text-caption font-semibold text-dim">Send a text</div>
      <div className="mt-1.5 flex flex-col gap-2">
        {TEMPLATES.map(({ key, label }) => {
          const text = textFor(call.book, key, call.name)
          const href = text && smsHref(call.phone, text)
          if (!href) return null
          return (
            <div key={key} data-post-call-text={key} className="rounded-lg bg-panel2 px-3 py-2">
              <div className="text-caption font-semibold text-muted">{label}</div>
              <div className="mt-0.5 text-body">{text}</div>
              <a href={href} onClick={() => setTexted(text)} className={`${quiet} mt-2 grid place-items-center bg-panel`}>
                {texted === text ? 'Opened in Messages' : 'Text in Messages'}
              </a>
            </div>
          )
        })}
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-lg border px-3 py-2 text-body" style={{ borderColor: '#f2b8b4', background: 'var(--neg-bg)', color: 'var(--neg-ink)' }}>
          {error}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className={quiet} onClick={onClose}>Skip</button>
        <button
          type="button"
          disabled={busy || !body}
          onClick={save}
          className="min-h-[40px] rounded-lg text-body font-bold text-white disabled:opacity-50"
          style={{ background: t.accent }}
        >
          {busy ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </Sheet>
  )
}
