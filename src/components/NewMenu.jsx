// The "+ New" button and what it opens: the New Task and New Lead dialogs, a
// person pick for Log call / Note / Follow-up, and the new lead's card.
// Lives in the desktop top bar and the phone menu.
import { useState } from 'react'
import { useBusiness } from '../context/BusinessContext'
import NewTaskDialog from './NewTaskDialog'
import NewLeadDialog from './NewLeadDialog'
import PersonSheet from './PersonSheet'
import LogVisitDialog from './LogVisitDialog'
import QuickAddMenu from './QuickAddMenu'
import { openSearch } from './SearchPalette'
import { useWritebackFlags, useSettingFlags } from '../lib/writeback'
import { useAuth } from '../context/AuthContext'

// onBeforePick: close the phone menu before the person pick opens.
export default function NewMenu({ onBeforePick }) {
  const { biz } = useBusiness()
  const { role } = useAuth() || {}
  const assistant = role === 'assistant'
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [visitOpen, setVisitOpen] = useState(false)
  // The lead just created (or an existing match) opens in a person sheet.
  const [personId, setPersonId] = useState(null)
  // New lead needs both switches on for a book.
  const writeback = useWritebackFlags()
  const createLead = useSettingFlags('create_lead_enabled')
  const leadBooks = assistant ? [] : ['bay', 'mpg'].filter((b) => writeback[b] === true && createLead[b] === true)

  return (
    <>
      <QuickAddMenu
        showLead={leadBooks.length > 0}
        hide={assistant ? ['call'] : []}
        showVisit={!assistant && biz !== 'bay'}
        onPick={(kind) => {
          if (kind === 'task') return setNewTaskOpen(true)
          if (kind === 'lead') return setNewLeadOpen(true)
          if (kind === 'visit') {
            onBeforePick?.()
            return setVisitOpen(true)
          }
          onBeforePick?.()
          openSearch({ pick: kind })
        }}
      />
      {visitOpen && <LogVisitDialog onClose={() => setVisitOpen(false)} />}
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
    </>
  )
}
