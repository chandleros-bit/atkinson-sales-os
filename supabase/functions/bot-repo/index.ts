// Bot repo bridge for the Tune-up page (Bayway Bot Engine doc, learning loop).
// Called from the browser with Chandler's JWT:
//   supabase.functions.invoke('bot-repo', { body: { action: 'sync' } })
//     pulls every bots/*.md and lessons/*.md from the private bayway-bots repo
//     into bot_files, so scheduled bots can read the current text with SQL.
//   supabase.functions.invoke('bot-repo', { body: { action: 'apply', change_id } })
//     commits an approved bot_changes row to the repo (a lesson line or an
//     instruction edit), records the version and commit, refreshes bot_files.
// Secrets: GITHUB_BOTS_TOKEN (fine-grained, Contents read and write on
// bayway-bots only), BOTS_REPO (default chandleros-bit/bayway-bots).
// Deployed WITH JWT verification. Owner only (ALLOWED_USER_ID).

import { serviceClient, logSync } from '../_shared/db.ts'
import { CORS } from '../_shared/cors.ts'
import { applyChange, checkPath, commitMessage, type Change } from '../_shared/bot-repo.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const REPO = Deno.env.get('BOTS_REPO') || 'chandleros-bit/bayway-bots'
const API = `https://api.github.com/repos/${REPO}`

function gh(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'atkinson-sales-os', ...(init.headers || {}) },
  })
}

const b64decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)))
const b64encode = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function readFile(token: string, path: string): Promise<{ content: string; sha: string } | null> {
  const res = await gh(token, `/contents/${path}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub read ${path}: ${res.status}`)
  const j = await res.json()
  return { content: b64decode(j.content || ''), sha: j.sha }
}

async function listDir(token: string, dir: string): Promise<string[]> {
  const res = await gh(token, `/contents/${dir}`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`GitHub list ${dir}: ${res.status}`)
  const j = await res.json()
  return (Array.isArray(j) ? j : []).filter((f) => f.type === 'file' && f.name.endsWith('.md')).map((f) => `${dir}/${f.name}`)
}

const todayChicago = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const db = serviceClient()
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data } = jwt ? await db.auth.getUser(jwt) : { data: null }
  if (!data?.user?.id) return json(401, { error: 'Not signed in' })
  if (data.user.id !== Deno.env.get('ALLOWED_USER_ID')) return json(403, { error: 'Owner only' })

  const token = Deno.env.get('GITHUB_BOTS_TOKEN')
  if (!token) return json(400, { error: 'Add the GITHUB_BOTS_TOKEN secret first' })

  let body: { action?: string; change_id?: string }
  try { body = await req.json() } catch { return json(400, { error: 'Body must be JSON' }) }

  try {
    if (body.action === 'sync') {
      const paths = [...(await listDir(token, 'bots')), ...(await listDir(token, 'lessons'))].filter((p) => !checkPath(p))
      let n = 0
      for (const path of paths) {
        const f = await readFile(token, path)
        if (!f) continue
        const { error } = await db.from('bot_files').upsert({ path, content: f.content, sha: f.sha, updated_at: new Date().toISOString() }, { onConflict: 'path' })
        if (error) throw new Error(`bot_files: ${error.message}`)
        n++
      }
      await logSync(db, 'bot-repo', 'ok', n, `synced ${n} files from ${REPO}`)
      return json(200, { ok: true, synced: n })
    }

    if (body.action === 'apply') {
      const { data: c, error } = await db.from('bot_changes').select('*').eq('id', body.change_id).maybeSingle()
      if (error || !c) return json(404, { error: 'Change not found' })
      if (c.status !== 'approved') return json(409, { error: `Change is ${c.status}, not approved` })

      const fail = async (msg: string) => {
        await db.from('bot_changes').update({ status: 'failed', error: msg }).eq('id', c.id)
        return json(422, { ok: false, error: msg })
      }
      const bad = checkPath(c.file_path)
      if (bad) return fail(bad)

      const current = await readFile(token, c.file_path)
      const out = applyChange(current?.content ?? null, c as Change, todayChicago())
      if ('error' in out) return fail(out.error)

      const { data: prior } = await db.from('bot_changes').select('version').eq('bot', c.bot).not('version', 'is', null).order('version', { ascending: false }).limit(1)
      const version = ((prior || [])[0]?.version || 0) + 1
      const res = await gh(token, `/contents/${c.file_path}`, {
        method: 'PUT',
        body: JSON.stringify({ message: commitMessage(c as Change, version), content: b64encode(out.content), ...(current ? { sha: current.sha } : {}) }),
      })
      if (!res.ok) return fail(`GitHub commit failed: ${res.status} ${(await res.text()).slice(0, 160)}`)
      const j = await res.json()
      await db.from('bot_files').upsert({ path: c.file_path, content: out.content, sha: j.content?.sha ?? null, updated_at: new Date().toISOString() }, { onConflict: 'path' })
      await db.from('bot_changes').update({ status: 'applied', version, commit_sha: j.commit?.sha ?? null, error: null }).eq('id', c.id)
      return json(200, { ok: true, version, commit_sha: j.commit?.sha ?? null, commit_url: j.commit?.html_url ?? null })
    }

    return json(400, { error: "action must be 'sync' or 'apply'" })
  } catch (err) {
    await logSync(db, 'bot-repo', 'error', 0, String((err as Error)?.message || err))
    return json(500, { error: String((err as Error)?.message || err) })
  }
})
