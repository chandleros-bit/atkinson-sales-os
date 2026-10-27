import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import BusinessFilter from './BusinessFilter'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import NewTaskDialog from './NewTaskDialog'
import NewLeadDialog from './NewLeadDialog'
import PersonSheet from './PersonSheet'
import { useWritebackFlags, useSettingFlags } from '../lib/writeback'
import { openSearch } from './SearchPalette'
import QuickAddMenu from './QuickAddMenu'
import { usePriorityQueue } from '../lib/usePriorityQueue'
import { urgentCount } from '../lib/priorityQueue'

function Item({ to, icon, children, badge, badgeBiz, onNavigate }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] leading-none ${
          isActive ? 'grad-dual-soft text-[color:var(--text)]' : 'text-muted hover:bg-hoverbg hover:text-[color:var(--text)]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="grad-dual absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-sm" />
          )}
          <span className="w-4 text-center text-[13px] opacity-80">{icon}</span>
          <span>{children}</span>
          {badge != null && (
            <span
              className={`ml-auto rounded-full px-1.5 py-px text-[10px] font-bold ${badgeBiz === 'all' ? 'grad-dual text-[#07120b]' : ''}`}
              style={
                badgeBiz === 'all'
                  ? undefined
                  : {
                      background: badgeBiz === 'mpg' ? 'var(--mpg-soft)' : 'var(--bay-soft)',
                      color: badgeBiz === 'mpg' ? 'var(--mpg-ink)' : 'var(--bay-ink)',
                    }
              }
            >
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

function GroupLabel({ children, color }) {
  return (
    <div
      className="px-2 pb-1.5 text-[10px] font-semibold tracking-[1px]"
      style={{ color: color || 'var(--dim)' }}
    >
      {children}
    </div>
  )
}

export default function Sidebar({ onNavigate }) {
  const { signOut, isDemoMode } = useAuth()
  const { biz } = useBusiness()
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  // The lead just created (or an existing match) opens in a person sheet.
  const [personId, setPersonId] = useState(null)
  // New lead needs both switches on for a book.
  const writeback = useWritebackFlags()
  const createLead = useSettingFlags('create_lead_enabled')
  const leadBooks = ['bay', 'mpg'].filter((b) => writeback[b] === true && createLead[b] === true)
  // "Act now" count (buckets 1-3) for the current filter; same data as /priority.
  const { queue } = usePriorityQueue(biz)
  const urgent = urgentCount(queue)

  const newTaskStyle =
    biz === 'mpg'
      ? { background: 'var(--mpg)', color: '#07120b' }
      : biz === 'bay'
        ? { background: 'var(--bay)', color: '#07120b' }
        : undefined

  return (
    <aside className="flex h-full w-[200px] flex-none flex-col overflow-y-auto border-r border-line bg-panel2 p-3">
      {/* Org block. The BETA chip sits on the sub-line, not beside the title —
          at 200px the two do not share a row. */}
      <div className="flex items-center gap-2 px-1.5 pb-3.5 pt-1">
        <div className="grad-dual flex h-[32px] w-[32px] flex-none items-center justify-center rounded-[9px] text-[14px] font-bold text-[#08110c]">
          A
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[13px] font-semibold leading-tight">Atkinson Sales OS</h1>
          <p className="mt-px flex items-center gap-1.5 text-[11px] text-muted">
            Dual Pipeline
            <span
              className="rounded border px-1 text-[8.5px] font-bold tracking-wide"
              style={{ color: 'var(--mpg-ink)', borderColor: 'var(--mpg-line)' }}
            >
              BETA
            </span>
          </p>
        </div>
      </div>

      {/* + New (quick add) + search */}
      <div className="mb-3.5 flex gap-2">
        <QuickAddMenu
          className={biz === 'all' ? 'grad-dual' : ''}
          style={newTaskStyle}
          showLead={leadBooks.length > 0}
          onPick={(kind) => {
            if (kind === 'task') {
              setNewTaskOpen(true)
              return
            }
            if (kind === 'lead') {
              setNewLeadOpen(true)
              return
            }
            // Close the phone menu first, then ask who.
            onNavigate?.()
            openSearch({ pick: kind })
          }}
        />
        <button
          className="h-[38px] w-[38px] rounded-[10px] border border-line2 text-[15px] text-muted"
          aria-label="Search"
          title="Search (Ctrl+K)"
          onClick={() => {
            onNavigate?.()
            openSearch()
          }}
        >
          ⌕
        </button>
      </div>

      {/* Global business filter */}
      <div className="mb-4">
        <BusinessFilter />
      </div>

      {/* Nav groups */}
      <nav className="flex flex-col gap-4">
        <div>
          <GroupLabel>OVERVIEW</GroupLabel>
          <Item to="/priority" icon="◎" badge={urgent || null} badgeBiz={biz} onNavigate={onNavigate}>
            Workbench
          </Item>
          <Item onNavigate={onNavigate} to="/" icon="▤">Overview</Item>
          <Item onNavigate={onNavigate} to="/calendar" icon="▦">Calendar</Item>
          <Item onNavigate={onNavigate} to="/tasks" icon="✓">Tasks</Item>
          <Item onNavigate={onNavigate} to="/activity" icon="◷">Activity</Item>
          <Item onNavigate={onNavigate} to="/reports" icon="▢">Reports</Item>
        </div>

        <div>
          <GroupLabel color="var(--mpg-ink)">MPG</GroupLabel>
          <Item onNavigate={onNavigate} to="/mpg/pipeline" icon="▤" badge="—" badgeBiz="mpg">Pipeline</Item>
          <Item onNavigate={onNavigate} to="/mpg/activity" icon="◷">Activity</Item>
          <Item onNavigate={onNavigate} to="/mpg/contacts" icon="◵">Contacts · Zoho</Item>
        </div>

        <div>
          <GroupLabel color="var(--bay-ink)">BAYWAY</GroupLabel>
          <Item onNavigate={onNavigate} to="/bayway/pipeline" icon="▤" badge="—" badgeBiz="bay">Pipeline</Item>
          <Item onNavigate={onNavigate} to="/bayway/priority-leads" icon="◆">Priority Leads</Item>
          <Item onNavigate={onNavigate} to="/bayway/activity" icon="◷">Activity</Item>
          <Item onNavigate={onNavigate} to="/bayway/contacts" icon="◵">Contacts · FUB</Item>
        </div>

        <div>
          <GroupLabel>MANAGE</GroupLabel>
          <Item onNavigate={onNavigate} to="/sync" icon="⟳">Sync Status</Item>
          <Item onNavigate={onNavigate} to="/settings" icon="⚙">Settings</Item>
        </div>
      </nav>

      {/* Profile. Sign-out is an icon button here — the text button plus the
          name does not fit the narrower rail. */}
      <div className="mt-auto flex items-center gap-2 border-t border-line px-1.5 pb-0.5 pt-2.5">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-hoverbg text-[11px] font-semibold">
          CA
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold">Chandler Atkinson</div>
          {/* Sign-out rides the sub-line: on the 200px rail it would otherwise
              steal enough width to truncate the name above it. */}
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
            <span className="truncate">Super Admin</span>
            {!isDemoMode && (
              <button
                onClick={signOut}
                className="flex-none rounded px-1 text-[10.5px] text-dim hover:text-[color:var(--text)]"
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </div>
      {newTaskOpen && <NewTaskDialog onClose={() => setNewTaskOpen(false)} />}
      {newLeadOpen && (
        <NewLeadDialog
          books={leadBooks}
          defaultBook={biz}
          onClose={() => setNewLeadOpen(false)}
          onOpen={(id) => {
            setNewLeadOpen(false)
            setPersonId(id)
          }}
          onCreated={(id) => {
            setNewLeadOpen(false)
            if (id) setPersonId(id)
          }}
        />
      )}
      {personId && <PersonSheet id={personId} onClose={() => setPersonId(null)} />}
    </aside>
  )
}
