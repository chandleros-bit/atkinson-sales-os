// Voice quick-add: tap the mic, say "MPG send Vinay the shipping receipt,
// today", check what was heard in the confirm sheet (AddWorkItem), Add.
// Hidden where the browser has no speech recognition.
import { useState } from 'react'
import { speechSupported, useSpeech } from '../lib/useSpeech'
import { parseVoiceTask } from '../lib/voiceTask'
import AddWorkItem from './AddWorkItem'
import { Sheet, quickActionTone } from './QuickActions'

export default function VoiceTask({ defaultBook = 'bay', onAdded }) {
  const [open, setOpen] = useState(false)
  const [heard, setHeard] = useState(null)
  const speech = useSpeech({
    onFinal: (text) => {
      setOpen(false)
      setHeard({ heard: text, ...parseVoiceTask(text) })
    },
  })
  if (!speechSupported()) return null

  const begin = () => {
    setOpen(true)
    speech.start()
  }
  const close = () => {
    speech.stop()
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={begin}
        aria-label="Say a task"
        title='Say a task, e.g. "MPG send Vinay the receipt, today"'
        className="flex min-h-[40px] items-center gap-1.5 rounded-[10px] border border-line2 px-3 text-[13px] font-semibold"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
        </svg>
        Say a task
      </button>
      {open && (
        <Sheet title={speech.listening ? 'Listening…' : 'Say a task'} subtitle='Book first, then the task and when: "MPG send Vinay the receipt, today"' t={quickActionTone(defaultBook)} onClose={close}>
          <div className="flex flex-col gap-3">
            <div aria-live="polite" className="min-h-[56px] rounded-[10px] bg-panel2 px-3 py-2 text-[14px]">
              {speech.interim || <span className="text-muted">{speech.listening ? 'Go ahead…' : ' '}</span>}
            </div>
            {speech.error && <div className="text-[12px] text-[color:var(--neg-ink)]">{speech.error}</div>}
            {speech.listening ? (
              <button type="button" onClick={speech.stop} className="min-h-[44px] rounded-[10px] text-[13.5px] font-semibold text-white" style={{ background: 'var(--text)' }}>
                Done talking
              </button>
            ) : (
              <button type="button" onClick={speech.start} className="min-h-[44px] rounded-[10px] border border-line2 text-[13.5px] font-semibold">
                Try again
              </button>
            )}
          </div>
        </Sheet>
      )}
      {heard && (
        <AddWorkItem
          defaultBook={defaultBook}
          initial={heard}
          onClose={() => setHeard(null)}
          onAdded={() => {
            setHeard(null)
            onAdded?.()
          }}
        />
      )}
    </>
  )
}
