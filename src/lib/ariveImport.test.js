import { describe, it, expect } from 'vitest'
import { parseCsv } from './csv'
import {
  REQUIRED_HEADERS, STAGE_GROUPS, stageGroup, parseUsDate, isScenarioRow, rowToLoan, matchContact, buildPreview,
} from './ariveImport'

const HEADER = 'Primary Borrower,Primary Loan Officer Name,Primary Borrower First Name,Primary Borrower Last Name,Primary Borrower Email,Primary Borrower Cell Phone,Co-Borrower,Co-Borrower Email,ARIVE Loan Id,Total Loan Amount,Loan Purpose,Stage Name,Subject Property,Subject State,Docs Signed / Loan Closed,Loan Funded,Lender,Firm Closing Date,Buyer Agent,Buyer Agent Company Name,Buyer Agent Email,Buyer Agent Phone,Seller Agent,Seller Agent Company Name,Seller Agent Email,Seller Agent Phone,Title Company'
const FIXTURE = [
  HEADER,
  'Gina Park,Chandler Dean Atkinson,Gina,Park,gina.park@example.com,7135550101,Lee Park,lee@example.com,100001,410000,Purchase,Loan Funded,1 Elm St Houston HARRIS TX 77001,Texas,10/2/2026,10/3/2026,UWM,10/2/2026,Rita Agent,Best Realty,rita@example.com,7135550199,,,,,"Lone Star Title, LLC"',
  'Omar Vale,Ronnie Gaydos,Omar,Vale,omar@example.com,,,,100002,,Refinance,App Intake,IL,Illinois,,,,,,,,,,,,,',
  'Test test,Chandler Dean Atkinson,Test,Test,aaa@gmail.com,,,,100003,633750,Refinance,App Intake,,,,,,,,,,,,,,,',
  'Ana Ruiz,Chandler Dean Atkinson,Ana,Ruiz,ana@example.com,,,,100004,250000,Purchase,Underwriting Hold,TX,Texas,,,,,,,,,,,,,',
  ',Chandler Dean Atkinson,,,,,,,,1,Purchase,App Intake,,,,,,,,,,,,,,,',
].join('\n')
const LO = 'Chandler Dean Atkinson'

describe('stage groups', () => {
  it('maps every Arive stage, case- and space-insensitive', () => {
    expect(stageGroup('App Intake')).toBe('prospect')
    expect(stageGroup('approved w/  conditions')).toBe('processing')
    expect(stageGroup('Clear To Close')).toBe('closing')
    expect(stageGroup('Broker Check Received')).toBe('funded')
    expect(stageGroup('Adverse')).toBe('adverse')
    expect(stageGroup('Underwriting Hold')).toBe('other')
    expect(STAGE_GROUPS.flatMap((g) => g.stages)).toHaveLength(15)
  })
})

describe('parseUsDate', () => {
  it('turns M/D/YYYY into YYYY-MM-DD and blanks into null', () => {
    expect(parseUsDate('10/3/2026')).toBe('2026-10-03')
    expect(parseUsDate('')).toBeNull()
    expect(parseUsDate('soon')).toBeNull()
  })
  it('rejects impossible dates', () => {
    expect(parseUsDate('2/30/2026')).toBeNull()
    expect(parseUsDate('13/1/2026')).toBeNull()
    expect(parseUsDate('0/5/2026')).toBeNull()
    expect(parseUsDate('2/29/2024')).toBe('2024-02-29')
    expect(parseUsDate('2/29/2026')).toBeNull()
  })
})

describe('isScenarioRow', () => {
  it('flags placeholder emails, phones and names', () => {
    expect(isScenarioRow({ email: 'aaa@gmail.com' })).toBe(true)
    expect(isScenarioRow({ email: 'x@noone.com' })).toBe(true)
    expect(isScenarioRow({ phone: '1111111111' })).toBe(true)
    expect(isScenarioRow({ first: 'Josh', last: 'DSCR' })).toBe(true)
    expect(isScenarioRow({ name: 'Darren Cost Sheet' })).toBe(true)
    expect(isScenarioRow({ first: 'Gina', last: 'Park', email: 'gina.park@example.com', phone: '7135550101' })).toBe(false)
  })
  it('flags every placeholder email local part and domain', () => {
    for (const email of ['123@gmail.com', '456@x.com', 'lead@gmail.com', 'test@x.com', 'x@123.com']) {
      expect(isScenarioRow({ email }), email).toBe(true)
    }
  })
  it('flags placeholder first or last names and phrases in the full name', () => {
    expect(isScenarioRow({ first: 'tbd', last: 'Smith' })).toBe(true)
    expect(isScenarioRow({ first: 'Sam', last: 'Client' })).toBe(true)
    expect(isScenarioRow({ name: 'Jo Smith Renovation Loan' })).toBe(true)
  })
  it('flags a repeated-digit phone even with a country code', () => {
    expect(isScenarioRow({ phone: '+1 (222) 222-2222' })).toBe(true)
    expect(isScenarioRow({ phone: '+1 (713) 555-0101' })).toBe(false)
  })
})

describe('rowToLoan', () => {
  const { rows } = parseCsv(FIXTURE)
  it('maps a full row', () => {
    const l = rowToLoan(rows[0], { loName: LO })
    expect(l).toMatchObject({
      arive_loan_id: '100001', role: 'primary', borrower_name: 'Gina Park', borrower_email: 'gina.park@example.com',
      borrower_phone: '7135550101', co_borrower_name: 'Lee Park', amount: 410000, purpose: 'Purchase',
      stage: 'Loan Funded', stage_group: 'funded', funded_on: '2026-10-03', closed_on: '2026-10-02',
      firm_closing_on: '2026-10-02', lender: 'UWM', title_company: 'Lone Star Title, LLC',
      buyer_agent_name: 'Rita Agent', buyer_agent_phone: '7135550199', seller_agent_name: null,
      scenario_auto: false, application_on: null, rate: null,
    })
    expect(l.raw['ARIVE Loan Id']).toBe('100001')
  })
  it('marks other loan officers as assisted and blank amounts as null', () => {
    expect(rowToLoan(rows[1], { loName: LO })).toMatchObject({ role: 'assisted', amount: null, loan_officer: 'Ronnie Gaydos' })
  })
  it('reads a note rate written with a percent sign', () => {
    expect(rowToLoan({ 'Note Rate': '6.125%' }, { loName: LO }).rate).toBe(6.125)
    expect(rowToLoan({ 'Note Rate': '6.125' }, { loName: LO }).rate).toBe(6.125)
  })
  it('flags scenario rows', () => {
    expect(rowToLoan(rows[2], { loName: LO }).scenario_auto).toBe(true)
  })
})

describe('matchContact', () => {
  const contacts = [
    { id: 'c1', name: 'Gina Park', email: 'GINA.PARK@example.com', phone: null },
    { id: 'c2', name: 'Someone', email: null, phone: '(713) 555-0101' },
    { id: 'c3', name: 'Ana Ruiz', email: null, phone: null },
    { id: 'c4', name: 'Ana Ruiz', email: null, phone: null },
  ]
  it('matches email first, then phone, then a unique name', () => {
    expect(matchContact({ borrower_email: 'gina.park@example.com', borrower_phone: '7135550101' }, contacts)).toBe('c1')
    expect(matchContact({ borrower_email: 'nope@example.com', borrower_phone: '7135550101' }, contacts)).toBe('c2')
    expect(matchContact({ borrower_name: 'Gina Park' }, contacts)).toBe('c1')
    expect(matchContact({ borrower_name: 'Ana Ruiz' }, contacts)).toBeNull()
  })
  it('never matches a scenario loan', () => {
    expect(matchContact({ borrower_email: 'gina.park@example.com', scenario_auto: true }, contacts)).toBeNull()
  })
})

describe('buildPreview', () => {
  const { header, rows } = parseCsv(FIXTURE)
  const contacts = [{ id: 'c1', name: 'Gina Park', email: 'gina.park@example.com', phone: null }]
  const existing = [
    { arive_loan_id: '100001', stage: 'Clear To Close', amount: 410000 },
    { arive_loan_id: '100002', ...rowToLoan(rows[1], { loName: LO }) },
    { arive_loan_id: '999999', stage: 'App Intake' },
  ]

  it('refuses a file missing required headers', () => {
    const p = buildPreview({ header: ['Lender'], rows: [], existing: [], contacts: [], loName: LO })
    expect(p.error).toContain('ARIVE Loan Id')
    expect(REQUIRED_HEADERS).toHaveLength(5)
  })

  it('sorts rows into new, updated, unchanged and skipped', () => {
    const p = buildPreview({ header, rows, existing, contacts, loName: LO })
    expect(p.error).toBeUndefined()
    expect(p.loans.map((l) => l.arive_loan_id)).toEqual(['100001', '100002', '100003', '100004'])
    expect(p.counts).toEqual({ total: 4, new: 2, updated: 1, unchanged: 1, skipped: 1, scenario: 1, unmatched: 2, missing: 1 })
    expect(p.unknownStages).toEqual(['Underwriting Hold'])
    expect(p.missingIds).toEqual(['999999'])
    expect(p.loans[0].contact_id).toBe('c1')
  })

  it('treats a numeric string amount from PostgREST as unchanged', () => {
    const first = buildPreview({ header, rows: [rows[0]], existing: [], contacts, loName: LO }).loans[0]
    const p = buildPreview({ header, rows: [rows[0]], existing: [{ ...first, amount: '410000.00' }], contacts, loName: LO })
    expect(p.counts).toMatchObject({ unchanged: 1, updated: 0, new: 0 })
  })

  describe('scenario override on an existing loan', () => {
    const mk = (o) => ({ 'Primary Borrower': 'Gina Park', 'Primary Loan Officer Name': LO, 'ARIVE Loan Id': '7', 'Stage Name': 'App Intake', 'Total Loan Amount': '1', ...o })
    const H = REQUIRED_HEADERS.concat(['Primary Borrower Email'])
    const ctc = [{ id: 'c1', name: 'Gina Park', email: 'gina.park@example.com', phone: null }, { id: 'c9', name: 'Placeholder', email: 'aaa@gmail.com', phone: null }]

    it('matches a placeholder-email loan the user marked as real, and does not count it as scenario', () => {
      const row = mk({ 'Primary Borrower Email': 'aaa@gmail.com' })
      const p = buildPreview({ header: H, rows: [row], existing: [{ arive_loan_id: '7', scenario_override: false }], contacts: ctc, loName: LO })
      expect(p.loans[0].scenario_auto).toBe(true)
      expect(p.loans[0].contact_id).toBe('c9')
      expect(p.counts).toMatchObject({ scenario: 0, unmatched: 0 })
      expect(p.loans[0]).not.toHaveProperty('scenario_override')
    })

    it('leaves a normal loan the user marked as scenario unmatched and counts it as scenario', () => {
      const row = mk({ 'Primary Borrower Email': 'gina.park@example.com' })
      const p = buildPreview({ header: H, rows: [row], existing: [{ arive_loan_id: '7', scenario_override: true }], contacts: ctc, loName: LO })
      expect(p.loans[0].scenario_auto).toBe(false)
      expect(p.loans[0].contact_id).toBeNull()
      expect(p.counts).toMatchObject({ scenario: 1, unmatched: 0 })
    })

    it('falls back to detection when there is no override', () => {
      const row = mk({ 'Primary Borrower Email': 'aaa@gmail.com' })
      const p = buildPreview({ header: H, rows: [row], existing: [{ arive_loan_id: '7', scenario_override: null }], contacts: ctc, loName: LO })
      expect(p.loans[0].contact_id).toBeNull()
      expect(p.counts).toMatchObject({ scenario: 1, unmatched: 0 })
    })
  })

  it('lists a blank stage among the unknown stages', () => {
    const row = { 'Primary Borrower': 'A B', 'Primary Loan Officer Name': LO, 'ARIVE Loan Id': '8', 'Stage Name': '', 'Total Loan Amount': '1' }
    const p = buildPreview({ header: REQUIRED_HEADERS, rows: [row], existing: [], contacts: [], loName: LO })
    expect(p.loans[0].stage_group).toBe('other')
    expect(p.unknownStages).toEqual(['(blank)'])
  })
})
