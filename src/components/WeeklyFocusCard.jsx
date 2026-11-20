// This week's focus (Bayway Bot Engine doc, Sales OS item 5). The Growth bot
// sets it Monday morning: one focus and 3 tasks, saved as work items. Check a
// task off here; Friday's check-in counts what's done.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadWeeklyFocus, setFocusTaskDone } from '../lib/weeklyFocus'
import { showToast } from './Toaster'
import { friendlyError } from '../lib/friendlyError'

const BOOK = { bay: 'Bayway', mpg: 'MPG' }

export default function WeeklyFocusCard() {
  const [m, setM] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    let live = true
    loadWeeklyFocus()
      .then((x) => live && setM(x))
      .catch(() => live && setM({ focus: null, tasks: [], done: 0, total: 0, checkin: null }))
    return () => { live = false }
  }, [])

  if (!m) return null

  const toggle = async (t) => {
    setBusy(t.id)
    try {
      const body = await setFocusTaskDone(t.id, t.status !== 'done')
      setM((x) => {
        const tasks = x.tasks.map((r) => (r.id === t.id ? { ...r, ...body } : r))
        return { ...x, tasks, done: tasks.filter((r) => r.status === 'done').length }
      })
    } catch (e) {
      showToast({ tone: 'error', text: friendlyError(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="This week's focus" className="cc-card mt-4 flex min-w-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-lead font-semibold tracking-[-0.2px]">This week's focus</h3>
          <div className="mt-0.5 text-body text-muted">
            {m.focus ? `${m.done} of ${m.total} done${m.focus.business_id ? ` · ${BOOK[m.focus.business_id] || ''}` : ''}` : 'Set by the Growth bot Monday morning.'}
          </div>
        </div>
        <Link to="/workbench" className="-my-2 -mr-2 inline-flex min-h-[36px] flex-none items-center rounded-lg px-2 text-body font-semibold text-[color:var(--chrome)] hover:bg-hoverbg">
          Workbench →
        </Link>
      </div>
      {m.focus ? (
        <div className="px-5 py-4">
          <div data-focus className="text-body font-semibold">{m.focus.title}</div>
          {m.focus.notes && <p className="mt-1 text-body text-muted">{m.focus.notes}</p>}
          <ul className="mt-3 flex flex-col gap-2">
            {m.tasks.map((t) => (
              <li key={t.id} data-focus-task={t.id} className="flex items-start gap-2 text-body">
                <input type="checkbox" aria-label={t.title} checked={t.status === 'done'} disabled={busy === t.id}
                  onChange={() => toggle(t)} className="mt-1" />
                <span className={t.status === 'done' ? 'text-muted line-through' : ''}>
                  {t.title}
                  {t.due_on && <span className="ml-2 text-xs text-dim">due {t.due_on}</span>}
                </span>
              </li>
            ))}
          </ul>
          {m.checkin && (
            <p data-checkin className="mt-3 rounded-lg bg-hoverbg px-3 py-2 text-body">
              Friday check-in: {m.checkin.done} of {m.checkin.total} done. {m.checkin.note || ''}
            </p>
          )}
        </div>
      ) : (
        <p className="px-5 py-4 text-body text-muted">No focus set for this week yet.</p>
      )}
    </section>
  )
}
