import { describe, it, expect } from 'vitest'
import { noteRows } from './contactNotes'

describe('noteRows', () => {
  it('reads FUB and Zoho notes into one shape, newest first, with the author', () => {
    const rows = noteRows([
      { id: 'a', occurred_at: '2026-10-20T15:00:00Z', notes: 'x', raw: { body: '<p>Asked for <b>W-2s</b>&nbsp;today</p>', isHtml: true, createdBy: 'Chandler Atkinson', subject: null } },
      { id: 'b', occurred_at: '2026-10-22T15:00:00Z', notes: 'Sent statements', raw: { Note_Title: 'Statements', Note_Content: 'Sent statements', Created_By: { name: 'Chandler Atkinson' } } },
      { id: 'c', occurred_at: '2026-10-21T15:00:00Z', notes: 'Called, left VM', raw: {} },
    ])
    expect(rows).toEqual([
      { id: 'b', at: '2026-10-22T15:00:00Z', title: 'Statements', text: 'Sent statements', author: 'Chandler Atkinson' },
      { id: 'c', at: '2026-10-21T15:00:00Z', title: null, text: 'Called, left VM', author: null },
      { id: 'a', at: '2026-10-20T15:00:00Z', title: null, text: 'Asked for W-2s today', author: 'Chandler Atkinson' },
    ])
  })

  it('keeps line breaks from HTML notes and drops empty ones', () => {
    const rows = noteRows([
      { id: 'a', occurred_at: '2026-10-20T15:00:00Z', raw: { body: 'Line one<br>Line two<div>Line three</div>', isHtml: true } },
      { id: 'b', occurred_at: '2026-10-20T16:00:00Z', raw: { body: '  ' } },
    ])
    expect(rows.map((r) => r.text)).toEqual(['Line one\nLine two\nLine three'])
  })

  it("leaves out the lead form's first note, shown pinned above the list", () => {
    const first = 'Credit: 660-699 / loan type: DSCR Purchase'
    const rows = noteRows([
      { id: 'a', occurred_at: '2026-10-01T15:00:00Z', raw: { body: first } },
      { id: 'b', occurred_at: '2026-10-02T15:00:00Z', raw: { body: 'Called' } },
    ], first)
    expect(rows.map((r) => r.id)).toEqual(['b'])
  })
})
