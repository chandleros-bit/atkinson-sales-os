// Applying an approved tune-up change to a bot file (pure; bot-repo function
// does the GitHub calls). A lesson appends one line under the lessons file; an
// instruction edit replaces one exact passage that must appear exactly once.
// compliance.md is never edited.

export interface Change {
  kind: 'lesson' | 'instruction'
  bot: string
  file_path: string
  summary: string
  lesson?: string | null
  old_text?: string | null
  new_text?: string | null
}

export const SAFE_PATH = /^(bots|lessons)\/[a-z0-9._-]+\.md$/

export function checkPath(path: string): string | null {
  if (!SAFE_PATH.test(path)) return `Not a bot file: ${path}`
  if (/compliance/i.test(path)) return 'compliance.md is never changed by the tune-up'
  return null
}

const LESSON_HEADER = (bot: string) => `# Lessons: ${bot}\n\nOne line per lesson. The Friday tune-up adds lines you approve; keep this under about 30 lines.\n`

export function applyChange(current: string | null, c: Change, today: string): { content: string } | { error: string } {
  const bad = checkPath(c.file_path)
  if (bad) return { error: bad }
  if (c.kind === 'lesson') {
    const line = String(c.lesson || '').trim().replace(/\s+/g, ' ')
    if (!line) return { error: 'Empty lesson' }
    const base = current ?? LESSON_HEADER(c.bot)
    return { content: `${base.replace(/\s*$/, '')}\n- ${line} (${today})\n` }
  }
  if (current == null) return { error: `${c.file_path} doesn't exist in the repo` }
  const old = String(c.old_text || '')
  if (!old) return { error: 'No text to replace' }
  const first = current.indexOf(old)
  if (first < 0) return { error: 'The text to replace is no longer in the file' }
  if (current.indexOf(old, first + old.length) >= 0) return { error: 'The text to replace appears more than once' }
  return { content: current.slice(0, first) + String(c.new_text ?? '') + current.slice(first + old.length) }
}

export function commitMessage(c: Change, version: number): string {
  return `Tune-up: ${c.bot} v${version}: ${c.summary}`.slice(0, 200)
}
