// A lead's open tasks inside a pop-up (the Workbench quick look and the Work
// item sheet): each completable or pushable, plus Add a follow-up. The host
// owns useContactTasks so its tab bar can show the count.
import { refreshPriorityQueue } from '../lib/usePriorityQueue'
import { dueLabel, dueDayKey } from '../lib/tasks'
import { dayKey } from '../lib/calendar'
import QuickActions from './QuickActions'

// tabs: [id, label, count|null]
export function PopupTabs({ label, tabs, tab, onTab }) {
  return (
    <div role="tablist" aria-label={label} className="mt-3 flex gap-1 border-b border-line">
      {tabs.map(([id, text, n]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onTab(id)}
          className={`-mb-px min-h-[36px] border-b-2 px-3 text-[13px] ${
            tab === id ? 'border-[color:var(--text)] font-semibold' : 'border-transparent text-muted hover:text-[color:var(--text)]'
          }`}
        >
          {text}
          {n != null && <span className="num ml-1 text-dim">{n}</span>}
        </button>
      ))}
    </div>
  )
}

export const taskCount = (tasks) => (tasks.loading ? null : tasks.tasks.length)

export default function ContactTasks({ businessId, contactId, contactName, tasks }) {
  const today = dayKey(new Date().toISOString())
  const changed = () => {
    tasks.reload()
    refreshPriorityQueue()
  }
  return (
    <div role="tabpanel" aria-label="Tasks" className="pt-1">
      {tasks.loading && <div className="py-3 text-[13px] text-muted">Loading…</div>}
      {!tasks.loading && tasks.tasks.length === 0 && <div className="py-3 text-[13px] text-muted">No open tasks.</div>}
      {tasks.tasks.map((t) => {
        const late = t.due_at && dueDayKey(t.due_at) < today
        return (
          <div key={t.id} data-peek-task className="flex items-center gap-2 border-b border-hoverbg py-2 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold">{t.title || 'Task'}</div>
              <div className="text-[12px]" style={{ color: late ? 'var(--neg-ink)' : 'var(--muted)' }}>
                {dueLabel(t.due_at)}
                {late ? ' · overdue' : ''}
              </div>
            </div>
            <QuickActions
              businessId={businessId}
              contactId={contactId}
              contactName={contactName}
              task={{ id: t.id, title: t.title }}
              only={['done', 'push']}
              onDone={changed}
            />
          </div>
        )
      })}
      <div className="mt-1 flex items-center gap-1 text-[12.5px] font-semibold text-muted">
        <QuickActions businessId={businessId} contactId={contactId} contactName={contactName} only={['followup']} onDone={changed} />
        Add a follow-up
      </div>
    </div>
  )
}
