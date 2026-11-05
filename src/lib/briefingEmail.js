// Renders the daily briefing model (briefing.js) as an email: subject, plain
// text and simple inline-styled HTML (email clients ignore <style> blocks).
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const timeLabel = (t) =>
  t === 'All day' ? t : new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(t))
// 'YYYY-MM-DD' -> 'Nov 6' (UTC so the date doesn't shift).
const dayLabel = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${d}T00:00:00Z`))
const BOOK = { bay: 'Bayway', mpg: 'MPG' }
const STATUS = { hit: 'hit', pace: 'on pace', behind: 'behind' }
const goalFmt = (g) => (v) => (g.unit === 'currency' ? money(v) : Math.round(Number(v) || 0))

// ---- HTML tables ------------------------------------------------------------
// Email-safe: plain <table>s with inline styles (clients drop <style> blocks).
// The plain-text part stays a list.
const C = { text: '#101828', muted: '#667085', line: '#e4e7ec', head: '#f2f4f7', link: '#1d4ed8', red: '#b42318' }
const PILL = { hit: ['#ecfdf3', '#067647'], pace: ['#fffaeb', '#b54708'], behind: ['#fef3f2', '#b42318'] }
const cell = (align) => `padding:6px 8px;border-bottom:1px solid ${C.line};text-align:${align || 'left'};vertical-align:top`

// cols: [{ label, width?, align? }]. rows: { cells: [html], alert? } or { note: html }
// (one muted cell across the row). Cells are HTML: escape text before passing it.
function table(cols, rows) {
  const head = `<tr>${cols
    .map((c) => `<th${c.width ? ` width="${c.width}"` : ''} style="${cell(c.align)};background:${C.head};color:${C.muted};font-weight:600;font-size:12px">${esc(c.label)}</th>`)
    .join('')}</tr>`
  const body = rows
    .map((r) =>
      r.note != null
        ? `<tr><td colspan="${cols.length}" style="${cell()};color:${C.muted}">${r.note}</td></tr>`
        : `<tr${r.alert ? ` style="color:${C.red}"` : ''}>${r.cells.map((h, i) => `<td style="${cell(cols[i].align)}">${h}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:13px Arial,sans-serif;color:${C.text};margin:0 0 12px">${head}${body}</table>`
}
function pill(status) {
  const [bg, fg] = PILL[status] || [C.head, C.muted]
  return `<span style="background:${bg};color:${fg};padding:2px 7px;border-radius:6px;font-size:11px;white-space:nowrap">${esc(STATUS[status] || status)}</span>`
}
const heading = (title, href) =>
  `<h2 style="font:600 15px Arial,sans-serif;margin:22px 0 8px;color:${C.text}">${
    href ? `<a href="${esc(href)}" style="color:${C.link};text-decoration:none">${esc(title)}</a>` : esc(title)
  }</h2>`
const link = (href, label) => `<a href="${esc(href)}" style="color:${C.link}">${esc(label)}</a>`
// A model block { count, top } as table rows, plus a "+N more" note.
const blockRows = (b, toCells, alertOf = () => false) =>
  b.top.map((p) => ({ cells: toCells(p), alert: alertOf(p) })).concat(b.count > b.top.length ? [{ note: esc(`+${b.count - b.top.length} more`) }] : [])

function goalLine(g) {
  const fmt = goalFmt(g)
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
  // Subject stays plain ASCII: denomailer mis-encodes non-ASCII subject text,
  // and Outlook then shows the raw =?utf-8?Q?…?= string.
  const subject = `Briefing | ${m.dateLabel} | ${m.callFirstCount} to call first | ${money(m.numbers.forecast.expected)} forecast`

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
    ...(m.today.closings.count ? [`Closing this week (${m.today.closings.count}): ${m.today.closings.top.map((c) => `${c.name} ${dayLabel(c.date)}`).join(', ')}`] : []),
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
  const text = plainSeparators(`${subject}\n\n${textBlocks.join('\n\n')}\n\nOpen the dashboard: ${url('/')}\n`)

  // ---- HTML ---------------------------------------------------------------
  const goalsTable = table(
    [{ label: 'Goal', width: '34%' }, { label: 'MTD', align: 'right' }, { label: 'Target', align: 'right' }, { label: 'Pace' }, { label: 'Need / day', align: 'right' }],
    m.numbers.goals.map((g) => {
      const fmt = goalFmt(g)
      return { cells: [esc(g.label), esc(fmt(g.value)), esc(fmt(g.target)), pill(g.status), g.needPerDay ? esc(g.needPerDay) : '-'] }
    }),
  )
  const forecastTable = table(
    [{ label: 'Forecast this month', width: '31%' }, { label: 'Funded', align: 'right' }, { label: 'Weighted', align: 'right' }, { label: 'MPG', align: 'right' }],
    [{ cells: [`<b>${esc(money(f.expected))}</b>`, esc(money(f.funded)), esc(money(f.weighted)), esc(f.mpgExpected != null ? money(f.mpgExpected) : `${f.mpgAccounts} accounts`)] }],
  )
  const dayTable = table(
    [{ label: 'Day', width: '28%' }, { label: 'Calls', align: 'right' }, { label: 'Connects', align: 'right' }, { label: 'New apps', align: 'right' }, { label: 'Texts', align: 'right' }],
    [{ cells: [esc(s.label || 'Yesterday'), esc(s.calls), esc(s.connects), esc(s.applications), esc(s.texts)] }],
  )

  const todayRows = m.today.meetings
    .map((e) => ({ cells: [esc(timeLabel(e.time)), esc(e.title), esc(BOOK[e.book] || '')] }))
    .concat(blockRows(m.today.closings, (c) => [esc(dayLabel(c.date)), esc(`Closing: ${c.name}`), 'Bayway']))
  const todayTable = table(
    [{ label: 'When', width: '20%' }, { label: 'Meeting or closing' }, { label: 'Book', width: '16%' }],
    todayRows.length ? todayRows : [{ note: 'No meetings or closings today' }],
  )

  const person = (why) => (p) => [esc(p.name), esc(why), esc(p.detail || ''), esc(BOOK[p.book] || '')]
  const callRows = [
    ...blockRows(cf.replied, person('They reached out')),
    ...blockRows(cf.newLeads, person('New lead, not called')),
    ...blockRows(cf.overdue, person('Overdue follow-up')),
    ...blockRows(cf.hotCold, person('Hot, going cold')),
  ]
  if (cf.cadence.bay + cf.cadence.mpg) {
    callRows.push({ note: `${esc(`Cadence due today: Bayway ${cf.cadence.bay}, MPG ${cf.cadence.mpg}`)} &middot; ${link(url('/workbench'), 'Open Workbench')}` })
  }
  const callTable = callRows.length
    ? table([{ label: 'Name', width: '26%' }, { label: 'Why', width: '26%' }, { label: 'Detail' }, { label: 'Book', width: '14%' }], callRows)
    : `<p style="font:14px Arial,sans-serif;margin:0">Nobody waiting.</p>`

  const issue = (why) => (p) => [esc(p.name), esc(why), esc(p.detail || '')]
  const slipRows = [
    ...blockRows(sl.quietApps, issue('Application quiet')),
    ...blockRows(sl.docsAging, issue('Docs aging')),
    ...blockRows(sl.statementsLate, issue('MPG statement late')),
    ...sl.syncProblems.map((p) => ({ cells: [esc(p.label), 'Sync problem', esc(p.text)] })),
  ]
  const slipCount = sl.quietApps.count + sl.docsAging.count + sl.statementsLate.count + sl.syncProblems.length
  const slipTable =
    m.nothingSlipping || !slipRows.length
      ? `<p style="font:14px Arial,sans-serif;margin:0">Nothing slipping today.</p>`
      : table([{ label: 'Name', width: '26%' }, { label: 'Issue', width: '26%' }, { label: 'Detail' }], slipRows)

  const html = [
    `<div style="max-width:640px;font-family:Arial,sans-serif;color:${C.text}">`,
    `<p style="font:13px Arial,sans-serif;color:${C.muted};margin:0">${esc(m.dateLabel)}</p>`,
    heading('Numbers, month to date'), goalsTable, forecastTable, dayTable,
    heading('Today'), todayTable,
    heading(`Call first (${m.callFirstCount})`, url('/workbench')), callTable,
    heading(m.nothingSlipping ? 'Slipping' : `Slipping (${slipCount})`, url('/workbench')), slipTable,
    `<p style="font:13px Arial,sans-serif;margin-top:24px">${link(url('/'), 'Open the dashboard')}</p>`,
    `</div>`,
  ].join('')

  return { subject, text, html: asciiHtml(html) }
}

// Shelby's Bayway files briefing. Rows are { text, alert }: alert rows (a
// disclosure due, a doc to chase) are red in HTML and upper-case in text.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function renderAssistantBriefing(m, { appUrl }) {
  const url = (p) => `${String(appUrl).replace(/\/$/, '')}${p}`
  const subject = `Bayway files | ${m.dateLabel} | ${m.closingCount} closing this week | ${plural(m.chaseCount, 'doc', 'docs')} to chase`

  const agentText = (label, a) => (a ? `${label}: ${a.name}${a.phone ? ` ${a.phone}` : ''}` : null)
  const block = (title, b, href, toRow) => {
    if (!b.count) return null
    const rows = b.top.map(toRow)
    if (b.count > b.top.length) rows.push({ text: `+${b.count - b.top.length} more`, alert: false })
    return { title: `${title} (${b.count})`, rows, href }
  }
  const blocks = [
    block('Closing in 7 days', m.closing, '/pipeline', (c) => ({
      text: [
        `${c.name} - closes ${dayLabel(c.date)}`,
        c.title ? `Title: ${c.title}` : 'Title: not set',
        agentText('Buyer agent', c.buyerAgent),
        agentText('Seller agent', c.sellerAgent),
        c.docs.length ? `Docs: ${c.docs.join(', ')}` : 'Docs: none outstanding',
      ].filter(Boolean).join(' | '),
      alert: false,
    })),
    block('Disclosures due', m.disclosures, '/pipeline', (d) => ({ text: `${d.name} - disclose by ${dayLabel(d.dueBy)}${d.due ? ' (DUE)' : ''}`, alert: d.due })),
    block('Missing docs', m.missingDocs, '/pipeline', (d) => ({
      text: `${d.name} - ${d.docs.join(', ')}${d.days != null ? ` - ${d.days} days` : ''}${d.chase ? ' - CHASE TODAY' : ''}`,
      alert: d.chase,
    })),
    block('New applications', m.newApps, '/pipeline', (a) => ({ text: `${a.name} - set up the file and send the doc list`, alert: false })),
    block('Waiting on borrower', m.waiting, '/workbench', (w) => ({ text: `${w.name} - ${w.detail}`, alert: false })),
  ].filter(Boolean)

  const textBody = blocks.length
    ? blocks.map((b) => [b.title, ...b.rows.map((r) => `  - ${r.text}`), `  ${url(b.href)}`].join('\n')).join('\n\n')
    : 'Nothing on the files today.'
  const text = plainSeparators(`${subject}\n\n${textBody}\n\nOpen the OS: ${url('/workbench')}\n`)

  const agentHtml = (c) =>
    [agentText('Buyer', c.buyerAgent), agentText('Seller', c.sellerAgent)].filter(Boolean).map(esc).join('<br>') || '-'
  const sections = [
    m.closing.count &&
      heading(`Closing in 7 days (${m.closing.count})`, url('/pipeline')) +
        table(
          [{ label: 'Borrower', width: '20%' }, { label: 'Closes', width: '11%' }, { label: 'Title', width: '20%' }, { label: 'Agents', width: '27%' }, { label: 'Docs needed' }],
          blockRows(m.closing, (c) => [esc(c.name), esc(dayLabel(c.date)), esc(c.title || 'Not set'), agentHtml(c), esc(c.docs.length ? c.docs.join(', ') : 'None')]),
        ),
    m.disclosures.count &&
      heading(`Disclosures due (${m.disclosures.count})`, url('/pipeline')) +
        table(
          [{ label: 'Borrower', width: '40%' }, { label: 'Disclose by', width: '30%' }, { label: 'Status' }],
          blockRows(m.disclosures, (d) => [esc(d.name), esc(dayLabel(d.dueBy)), d.due ? '<b>DUE</b>' : 'Upcoming'], (d) => d.due),
        ),
    m.missingDocs.count &&
      heading(`Missing docs (${m.missingDocs.count})`, url('/pipeline')) +
        table(
          [{ label: 'Borrower', width: '26%' }, { label: 'Docs' }, { label: 'Days', width: '10%', align: 'right' }, { label: 'Action', width: '18%' }],
          blockRows(m.missingDocs, (d) => [esc(d.name), esc(d.docs.join(', ')), d.days != null ? esc(d.days) : '-', d.chase ? '<b>Chase today</b>' : ''], (d) => d.chase),
        ),
    m.newApps.count &&
      heading(`New applications (${m.newApps.count})`, url('/pipeline')) +
        table([{ label: 'Borrower', width: '40%' }, { label: 'Next step' }], blockRows(m.newApps, (a) => [esc(a.name), 'Set up the file and send the doc list'])),
    m.waiting.count &&
      heading(`Waiting on borrower (${m.waiting.count})`, url('/workbench')) +
        table([{ label: 'Borrower', width: '30%' }, { label: 'Detail' }], blockRows(m.waiting, (w) => [esc(w.name), esc(w.detail)])),
  ].filter(Boolean)
  const html = [
    `<div style="max-width:640px;font-family:Arial,sans-serif;color:${C.text}">`,
    `<p style="font:13px Arial,sans-serif;color:${C.muted};margin:0">${esc(m.dateLabel)} - Bayway files</p>`,
    sections.length ? sections.join('') : `<p style="font:14px Arial,sans-serif">Nothing on the files today.</p>`,
    `<p style="font:13px Arial,sans-serif;margin-top:24px">${link(url('/workbench'), 'Open the OS')}</p>`,
    `</div>`,
  ].join('')

  return { subject, text, html: asciiHtml(html) }
}

// The body goes out quoted-printable through denomailer; keep it ASCII where we
// can so no client depends on its encoding. Text: our separators (and the
// narrow space Intl puts before AM/PM) become plain characters; names keep
// their accents. HTML: every non-ASCII character becomes a numeric entity.
function plainSeparators(s) {
  return s.replace(/·/g, '|').replace(/—/g, '-').replace(/[  ]/g, ' ')
}
function asciiHtml(s) {
  return Array.from(s, (c) => (c.codePointAt(0) > 0x7e ? `&#${c.codePointAt(0)};` : c)).join('')
}
