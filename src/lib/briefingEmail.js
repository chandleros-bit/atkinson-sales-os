// Renders the daily briefing model (briefing.js) as an email: subject, plain
// text and simple inline-styled HTML (email clients ignore <style> blocks).
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const timeLabel = (t) =>
  t === 'All day' ? t : new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(t))
const BOOK = { bay: 'Bayway', mpg: 'MPG' }
const STATUS = { hit: 'hit', pace: 'on pace', behind: 'behind' }

function goalLine(g) {
  const fmt = (v) => (g.unit === 'currency' ? money(v) : Math.round(Number(v) || 0))
  const need = g.needPerDay ? ` · need ${g.needPerDay} per business day` : ''
  return `${g.label} ${fmt(g.value)} / ${fmt(g.target)} · ${STATUS[g.status] || g.status}${need}`
}

// A titled list: "Title (count)", up to five "name — detail" rows, "+N more", link.
function section(title, block, href) {
  if (!block.count) return null
  const rows = block.top.map((p) => (p.detail ? `${p.name} — ${p.detail}` : p.name))
  const more = block.count > block.top.length ? `+${block.count - block.top.length} more` : null
  return { title: `${title} (${block.count})`, rows: more ? rows.concat(more) : rows, href }
}

export function renderOwnerBriefing(m, { appUrl }) {
  const url = (p) => `${String(appUrl).replace(/\/$/, '')}${p}`
  const subject = `Briefing · ${m.dateLabel} · ${m.callFirstCount} to call first · ${money(m.numbers.forecast.expected)} forecast`

  const f = m.numbers.forecast
  const s = m.numbers.scorecard
  const numbers = [
    ...m.numbers.goals.map(goalLine),
    `Forecast this month ${money(f.expected)} (funded ${money(f.funded)} · weighted ${money(f.weighted)})` +
      (f.mpgExpected != null ? ` · MPG ${money(f.mpgExpected)}` : ` · MPG ${f.mpgAccounts} accounts expected`),
    `${s.label || 'Yesterday'}: ${s.calls} calls · ${s.connects} connects · ${s.applications} new applications · ${s.texts} texts`,
  ]
  const today = [
    ...(m.today.meetings.length ? m.today.meetings.map((e) => `${timeLabel(e.time)} · ${e.title} (${BOOK[e.book]})`) : ['No meetings today']),
    ...(m.today.closings.count ? [`Closing this week (${m.today.closings.count}): ${m.today.closings.top.map((c) => `${c.name} ${c.date.slice(5)}`).join(', ')}`] : []),
  ]
  const cf = m.callFirst
  const callFirst = [
    section('They reached out', cf.replied, '/workbench'),
    section('New leads not called', cf.newLeads, '/workbench'),
    cf.cadence.bay + cf.cadence.mpg ? { title: `Call cadence due today: Bayway ${cf.cadence.bay} · MPG ${cf.cadence.mpg}`, rows: [], href: '/workbench' } : null,
    section('Overdue follow-ups', cf.overdue, '/tasks'),
    section('Hot, going cold', cf.hotCold, '/workbench'),
  ].filter(Boolean)
  const sl = m.slipping
  const slipping = m.nothingSlipping
    ? []
    : [
        section('Applications gone quiet', sl.quietApps, '/workbench'),
        section('Docs aging', sl.docsAging, '/workbench'),
        section('MPG statements overdue', sl.statementsLate, '/tasks'),
        sl.syncProblems.length ? { title: 'Sync problems', rows: sl.syncProblems.map((p) => `${p.label}: ${p.text}`), href: '/sync' } : null,
      ].filter(Boolean)

  // ---- Plain text ---------------------------------------------------------
  const textBlocks = [
    `Numbers\n${numbers.map((l) => `- ${l}`).join('\n')}`,
    `Today\n${today.map((l) => `- ${l}`).join('\n')}`,
    `Call first\n${callFirst.length ? callFirst.map((b) => [b.title, ...b.rows.map((r) => `  - ${r}`), `  ${url(b.href)}`].join('\n')).join('\n') : '- Nobody waiting'}`,
    `Slipping\n${slipping.length ? slipping.map((b) => [b.title, ...b.rows.map((r) => `  - ${r}`), `  ${url(b.href)}`].join('\n')).join('\n') : 'Nothing slipping today.'}`,
  ]
  const text = `${subject}\n\n${textBlocks.join('\n\n')}\n\nOpen the dashboard: ${url('/')}\n`

  // ---- HTML ---------------------------------------------------------------
  const h2 = (t) => `<h2 style="font:600 15px Arial,sans-serif;margin:20px 0 6px">${esc(t)}</h2>`
  const ul = (items) => `<ul style="font:14px Arial,sans-serif;margin:0;padding-left:18px">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
  const blockHtml = (b) =>
    `<p style="font:600 14px Arial,sans-serif;margin:10px 0 4px"><a href="${esc(url(b.href))}" style="color:#1d4ed8">${esc(b.title)}</a></p>${b.rows.length ? ul(b.rows) : ''}`
  const html = [
    `<div style="max-width:600px">`,
    `<p style="font:13px Arial,sans-serif;color:#667085;margin:0">${esc(m.dateLabel)}</p>`,
    h2('Numbers'), ul(numbers),
    h2('Today'), ul(today),
    h2('Call first'), callFirst.length ? callFirst.map(blockHtml).join('') : ul(['Nobody waiting']),
    h2('Slipping'), slipping.length ? slipping.map(blockHtml).join('') : `<p style="font:14px Arial,sans-serif">Nothing slipping today.</p>`,
    `<p style="font:13px Arial,sans-serif;margin-top:24px"><a href="${esc(url('/'))}">Open the dashboard</a></p>`,
    `</div>`,
  ].join('')

  return { subject, text, html }
}
