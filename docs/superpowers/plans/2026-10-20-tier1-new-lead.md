# Tier 1 · New Lead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** **+ New → New lead…** creates a lead in FollowUpBoss (Bayway) or Zoho (MPG) from the dashboard. The form:
- **Fields:** book, first and last name, phone, email, company (MPG; Zoho requires it), and an optional note.
- **Duplicate check:** before writing, it searches the dashboard by phone digits and email. A match in the same book shows "Already in FollowUpBoss: Sam Lee" with **Open**, and the button becomes **Create anyway**.
- **After a create:** the new lead mirrors into the dashboard and its person sheet opens.

**Architecture:**
- **crm-action `create_contact`** (`business_id` plus `payload { first_name, last_name, phone, email, company, note }`):
  - **Plan:** `create_contact`, then an optional `add_note`. A failed create stops the run.
  - **Resolve:** the book comes from `business_id`. Refused unless `settings.create_lead_enabled[book]` is true (the on/off switch; migration 0037 seeds both books on).
  - **Preflight:**
    - Bayway needs a name plus a phone or email.
    - MPG needs a last name and a company.
  - **FUB:**
    - `POST /events` (type Registration, source and system "Atkinson Sales OS"), so FUB's lead flow and action plans run and FUB dedupes.
    - The response is the person. No id (a 204) means FUB ignored the lead; that's an error.
    - New and assigned to someone else: `PUT /people/{id} { assignedUserId: FUB_USER_ID }`. FUB can't reassign in the same call.
    - An **existing** person (created more than 5 minutes ago) who belongs to another agent: refuse, never reassign. "Already in FollowUpBoss, assigned to another agent."
  - **Zoho:** `POST Leads` with `Lead_Status: 'Not Contacted'`.
  - **Mirror:** read the record back (`/people/{id}` or `Leads/{id}`) and upsert it through the syncs' own `mapContact`.
    - The new `contacts.id` becomes the target contact, so the note step can attach to it.
    - It's returned as `result.contact_id` and written to `crm_actions.contact_id`.
- **UI:**
  - `crmActions.buildActionRequest({ action: 'create_contact', ... })` with validation.
  - `NewLeadDialog.jsx` (form plus duplicate check through `search_people`).
  - `QuickAddMenu` gets a `showLead` item.
  - `Sidebar` reads `create_lead_enabled` (`useSettingFlags`).

**Spec:** `docs/superpowers/specs/2026-10-19-tier1-pipeline-flow-design.md`, section 5 (New lead). The docs ([FUB events](https://docs.followupboss.com/docs/events-post)) say the response matches `/people`, a 204 means an archived lead flow, and reassignment needs a separate `/people/{id}` call.

**Live test:** creating a real record in each CRM needs Chandler's go-ahead.
- **Bayway:** a lead named "ZZ Test New Lead" with an `@example.com` email and **no phone**, so a FUB action plan can't text a real number.
- **MPG:** "ZZ Test New Lead" with company "ZZ Test Co".
- Chandler deletes the two test records afterwards.

---

### Task 1: Request builders
- [ ] Failing tests in `write-builders.test.js`:
  - `buildFubLeadEvent` gives the event body (empty phone or email arrays left out).
  - `buildZohoLead` gives `{ data: [{ First_Name, Last_Name, Company, Phone, Email, Lead_Status }] }`.
  - Both trim values.
- [ ] Implement them in `fub-write.ts` / `zoho-write.ts`. Commit.

### Task 2: crm-action `create_contact`
- [ ] Failing tests:
  - **plan:** steps with and without a note; `shouldStop` after a failed create.
  - **run:**
    - Bayway create: send, then mirror, then `contact_id` in the result, then the note attaches to the new external id.
    - MPG create through `read.lead` + `map.contact`.
    - Missing fields are refused.
    - The flag off is refused.
    - A failed create doesn't run the note.
  - **crm:**
    - FUB fresh-and-unassigned is reassigned to Chandler.
    - Fresh-and-mine isn't touched.
    - Existing-and-someone-else's throws.
    - A 204 throws.
    - Zoho posts the builder body.
- [ ] Implement `plan.ts`, `run.ts`, `crm.ts`. Commit.

### Task 3: Migration 0037
- [ ] Add `settings.create_lead_enabled = {"bay": true, "mpg": true}` (`on conflict do nothing`). Dry-run it. Commit.

### Task 4: UI
- [ ] Failing tests:
  - **`crmActions.test`:** `create_contact` request building and validation.
  - **`NewLeadDialog.render.test`:**
    - Create stays disabled until the book's required fields are filled.
    - A duplicate shows "Already in FollowUpBoss: …" and "Create anyway".
    - Submit sends the request.
    - On ok, it calls `onCreated(contact_id)`.
  - **`QuickAddMenu.render.test`:** "New lead…" shows with `showLead`.
- [ ] Implement:
  - `crmActions`.
  - `useSettingFlags` in `writeback.js`.
  - `NewLeadDialog`.
  - `QuickAddMenu` `showLead`.
  - `Sidebar`: New lead opens the dialog, then the person sheet when it's created.
- [ ] Run `npm test` and the build. Commit.

### Task 5: Ship
- [ ] Ask before applying 0037, deploying `crm-action`, and the two live creates.
- [ ] Live-test as above and check FUB assignment (Chandler). Push, open the PR.
