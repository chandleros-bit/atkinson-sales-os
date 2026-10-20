// Global search (Ctrl+K / ⌘K, "/" outside a text field, the sidebar ⌕ and
// the phone top bar). People across both books, open tasks, and pages. Picking
// a person or a task opens PersonSheet. Mounted once in Layout.
// Spec: docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md (5)
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBusiness } from '../context/BusinessContext'
import { useSearch } from '../lib/useSearch'
import { cleanQuery, matchPages, MIN_QUERY } from '../lib/search'
import { dueLabel } from '../lib/tasks'
import BizBadge from './BizBadge'
import PersonSheet from './PersonSheet'

const OPEN_EVENT = 'search:open'
export function openSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

const isTyping = (el) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

function Heading({ children }) {
  return <div className="px-2 pb-1 pt-2 text-[10.5px] font-bold tracking-[1px] text-dim">{children}</div>
}

function Row({ item, active, onPick, onHover, children }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-result={item.key}
      onClick={onPick}
      onMouseEnter={onHover}
      className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${active ? 'bg-hoverbg' : ''}`}
    >
      {children}
    </button>
  )
}

export default function SearchPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [person, setPerson] = useState(null)
  const inputRef = useRef(null)
  const returnTo = useRef(null)
  const navigate = useNavigate()
  const { biz } = useBusiness() || { biz: 'all' }
  const { people, tasks, loading, error } = useSearch(open ? query : '', biz)

  const pages = matchPages(query)
  const items = [
    ...people.map((p) => ({ kind: 'person', key: `p:${p.id}`, p })),
    ...tasks.map((t) => ({ kind: 'task', key: `t:${t.id}`, t })),
    ...pages.map((g) => ({ kind: 'page', key: `g:${g.to}`, g })),
  ]

  const restoreFocus = () => {
    const el = returnTo.current
    if (el && document.contains(el)) el.focus()
  }
  const show = () => {
    returnTo.current = document.activeElement
    setQuery('')
    setActive(0)
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    restoreFocus()
  }

  useEffect(() => {
    const onOpen = () => show()
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault()
        show()
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault()
        show()
      }
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query, people.length, tasks.length])

  const choose = (it) => {
    if (!it) return
    setOpen(false)
    if (it.kind === 'page') {
      navigate(it.g.to)
      return
    }
    if (it.kind === 'task' && !it.t.contact_id) {
      navigate('/tasks')
      return
    }
    setPerson(it.kind === 'person' ? { id: it.p.id, initial: it.p } : { id: it.t.contact_id, initial: null })
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(items[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const short = cleanQuery(query).length < MIN_QUERY
  let index = -1
  const row = (it, body) => {
    index += 1
    const i = index
    return (
      <Row key={it.key} item={it} active={i === active} onPick={() => choose(it)} onHover={() => setActive(i)}>
        {body}
      </Row>
    )
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 sm:p-4 sm:pt-[12vh]" onClick={close}>
          <div
            role="dialog"
            aria-label="Search"
            className="flex h-full w-full flex-col bg-panel sm:h-auto sm:max-h-[70vh] sm:max-w-xl sm:rounded-card sm:border sm:border-line"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span aria-hidden="true" className="text-[16px] text-muted">⌕</span>
              <input
                ref={inputRef}
                aria-label="Search people, tasks and pages"
                placeholder="Search people, tasks, pages…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
              <button type="button" onClick={close} className="min-h-[36px] rounded-md px-2 text-[12px] text-muted">
                Esc
              </button>
            </div>
            <div role="listbox" aria-label="Results" className="flex-1 overflow-y-auto p-2">
              {short && <div className="px-2 py-3 text-[12.5px] text-muted">Type a name, phone, company or email.</div>}
              {!short && error && <div className="px-2 py-3 text-[12.5px]" style={{ color: 'var(--neg-ink)' }}>{error}</div>}
              {people.length > 0 && <Heading>People</Heading>}
              {people.map((p) =>
                row(
                  { kind: 'person', key: `p:${p.id}`, p },
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold">
                        {p.business_id === 'mpg' && p.company ? `${p.company} · ${p.name}` : p.name}
                      </div>
                      <div className="truncate text-[12px] text-muted">
                        {[p.stage, p.phone || p.email].filter(Boolean).join(' · ')}
                        {p.on_board ? '' : ' · not on the board'}
                      </div>
                    </div>
                    <BizBadge biz={p.business_id} />
                  </>,
                ),
              )}
              {tasks.length > 0 && <Heading>Open tasks</Heading>}
              {tasks.map((t) =>
                row(
                  { kind: 'task', key: `t:${t.id}`, t },
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold">{t.title || 'Task'}</div>
                      <div className="truncate text-[12px] text-muted">
                        {[t.contact_name, dueLabel(t.due_at)].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <BizBadge biz={t.business_id} />
                  </>,
                ),
              )}
              {pages.length > 0 && <Heading>Go to</Heading>}
              {pages.map((g) =>
                row({ kind: 'page', key: `g:${g.to}`, g }, <span className="text-[13.5px] font-semibold">{g.label}</span>),
              )}
              {!short && !loading && !error && items.length === 0 && (
                <div className="px-2 py-3 text-[12.5px] text-muted">No matches.</div>
              )}
              {!short && loading && items.length === 0 && <div className="px-2 py-3 text-[12.5px] text-muted">Searching…</div>}
            </div>
          </div>
        </div>
      )}
      {person && (
        <PersonSheet
          id={person.id}
          initial={person.initial}
          onClose={() => {
            setPerson(null)
            restoreFocus()
          }}
        />
      )}
    </>
  )
}
