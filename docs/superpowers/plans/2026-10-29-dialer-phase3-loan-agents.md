# Dialer Phase 3: Tuesday Loan Status With Agents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each Tuesday loan row shows the borrower, the buyer's agent and the seller's agent (from FUB Relationships), each callable and textable from the list and the dialer.

**Architecture:** A read-only crm-action action `contact_relationships` pulls FUB `GET /peopleRelationships?personId=` for the Tuesday borrowers (at most once an hour per borrower, tracked in `contact_relationship_syncs`) into a new mirror table `contact_relationships` (agents only). A view `v_loan_agents` matches each agent to one of Chandler's Realtors by phone or email at read time, so a realtor added later links without a re-sync (deviation from the spec's stored `matched_contact_id`: same result, never stale). The Workbench reads the view for the loan-status people and passes agents to ThemeList and the Dialer.

**Tech Stack:** Supabase (Postgres, edge function in Deno), React, Vitest.

Spec: `docs/superpowers/specs/2026-10-29-dialer-cadence-design.md` (Tuesday: borrower and agents).

---

## Files

- Create `supabase/migrations/0051_loan_agents.sql`: `contact_relationships`, `contact_relationship_syncs`, `v_loan_agents`.
- Create `supabase/functions/_shared/fub-relationships.ts` (+ `.test.js`): `relationshipKind(type)`, `mapRelationship(rec, contactId)`.
- Modify `supabase/functions/crm-action/plan.ts` (ACTIONS), `run.ts` (the read-only action), `crm.ts` (`read.relationshipsFor`), `run.test.js`.
- Create `src/lib/loanAgents.js` (+ `.test.js`): `agentsByContact(rows)`, `useLoanAgents(ids)`.
- Modify `src/lib/dialTexts.js` (+ test): `agent_update` text with `{borrower}`.
- Modify `src/components/ThemeList.jsx` (+ render test): agent lines under loan rows, "Add agents in FUB".
- Create `src/components/AgentCalls.jsx` (+ render test): the dialer's agent block (call, text, outcome).
- Modify `src/components/Dialer.jsx`, `src/pages/Workbench.jsx`: pass agents through.

## Rules

- Kind from FUB type, loose: contains "agent" (or "realtor") and buyer/buying → `buyer_agent`; seller/selling/listing → `seller_agent`; anything else is not stored.
- One FUB pull per borrower per hour (server checks `contact_relationship_syncs.synced_at`); each pull replaces that borrower's agent rows, so agents removed in FUB disappear.
- Match: Bayway contact with person stage Realtors or tag Top Partner, same last-10 phone digits or same email (case-insensitive). First match by name wins.
- Agent outcomes in the dialer: No answer / Voicemail / Talked.
  - Matched agent with a phone in FUB: `log_call` on the agent's contact (No Answer / Left Message / Interested), next step "scheduled", so it counts toward their Monday / Friday rhythm.
  - Otherwise: `add_note` on the borrower, "Called buyer's agent Jane Smith: left voicemail".
- Agent text: "Hi {first}, Chandler with Bayway. Quick check in on {borrower}'s loan. Anything you need from me?"
- Loan row with no agents (after the read) shows "Add agents in FUB". The row is done when the borrower is called (unchanged).

## Tasks

### Task 1: Migration 0051
- [ ] Tables with RLS on, `authenticated read` select policy (like 0001's mirror tables); writes only by the service role.
- [ ] `v_loan_agents` (security_invoker): one row per agent with `contact_id, kind, name, phone, email, matched_contact_id, matched_name, matched_phone, matched_url`.
- [ ] `supabase db push --linked` after Chandler approves.

### Task 2: fub-relationships mapping (TDD)
- [ ] Tests: type variants ("Buyer's Agent", "Buyer Agent", "Buyers Agent", "Listing Agent", "Seller Agent", "Seller's Agent", "Spouse" → null); map takes primary phone / email, falls back to the first; name from firstName + lastName or name.
- [ ] Implement.

### Task 3: crm-action `contact_relationships` (TDD)
- [ ] run.test.js: refuses without ids; skips non-Bayway and fresh (synced < 1h) borrowers; replaces rows and stamps the sync for stale ones; reports a per-borrower error without failing the others; writes no crm_actions row.
- [ ] Implement in run.ts; `read.relationshipsFor(personId)` in crm.ts.
- [ ] Deploy crm-action after Chandler approves.

### Task 4: loanAgents lib (TDD)
- [ ] `agentsByContact`: groups by borrower, buyer before seller.
- [ ] `useLoanAgents(ids)`: reads the view (bounded), invokes the action once per id set, reloads; demo mode returns empty.

### Task 5: Texts
- [ ] `agent_update` + `textFor(book, key, name, { borrower })`.

### Task 6: ThemeList agent lines (render test first)
- [ ] Under a loan row: "Buyer's agent · Jane Smith" with call link (name opens the contact card when matched); "Add agents in FUB" when loaded and none.

### Task 7: Dialer AgentCalls (render test first)
- [ ] Block under the borrower for `loan_status` items: label, name, number, Call, Text, three outcomes; a logged agent shows its outcome.

### Task 8: Wire Workbench, full suite, build, browser check (Tuesday preview), PR.
