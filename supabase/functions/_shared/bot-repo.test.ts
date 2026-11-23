import { describe, it, expect } from 'vitest'
import { applyChange, checkPath, commitMessage } from './bot-repo.ts'

const lesson = { kind: 'lesson' as const, bot: 'cold_email', file_path: 'lessons/cold-email.md', summary: 'Shorter subject lines', lesson: 'Keep subject lines under 6 words.' }

describe('bot-repo changes', () => {
  it('appends a dated lesson line, creating the file when missing', () => {
    const r = applyChange(null, lesson, '2026-11-27') as { content: string }
    expect(r.content).toContain('# Lessons: cold_email')
    expect(r.content.endsWith('- Keep subject lines under 6 words. (2026-11-27)\n')).toBe(true)
    const again = applyChange(r.content, { ...lesson, lesson: 'Name the class date.' }, '2026-12-04') as { content: string }
    expect(again.content.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(2)
  })

  it('replaces one exact passage in the instructions, or refuses', () => {
    const file = '## Instructions\n\nWrite under 90 words.\n'
    const edit = { kind: 'instruction' as const, bot: 'cold_email', file_path: 'bots/07-cold-email.md', summary: 'x', old_text: 'under 90 words', new_text: 'under 70 words' }
    expect(applyChange(file, edit, '2026-11-27')).toEqual({ content: '## Instructions\n\nWrite under 70 words.\n' })
    expect(applyChange(file, { ...edit, old_text: 'under 50 words' }, 'x')).toEqual({ error: 'The text to replace is no longer in the file' })
    expect(applyChange('a b a', { ...edit, old_text: 'a' }, 'x')).toEqual({ error: 'The text to replace appears more than once' })
    expect(applyChange(null, edit, 'x')).toEqual({ error: "bots/07-cold-email.md doesn't exist in the repo" })
  })

  it('never touches compliance.md or anything outside bots/ and lessons/', () => {
    expect(checkPath('bots/compliance.md')).toContain('never changed')
    expect(checkPath('README.md')).toContain('Not a bot file')
    expect(checkPath('../etc/passwd')).toContain('Not a bot file')
    expect(checkPath('lessons/growth.md')).toBeNull()
    expect(commitMessage(lesson, 3)).toBe('Tune-up: cold_email v3: Shorter subject lines')
  })
})
