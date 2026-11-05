# Application Sent email: design

Date: 2026-11-05. Status: design for review, not built.

The temperature/forecast spec (2026-11-03) set email and drips aside. This
spec brings back one email: when Chandler moves a Bayway lead to
**Application Sent**, the lead gets the application-link email. It goes out
from his Outlook, through FollowUpBoss.

## Decisions (settled with the user)

- **Confirm first.** Moving a lead to Application Sent opens a preview (To,
  subject, body) with **Send** and **Skip**. Nothing sends on the move by
  itself, so a mis-drag costs nothing.
- **Sent by FUB, not the OS.** On Send, the OS adds a tag to the FUB lead. An
  FUB Automations 2.0 automation (trigger **Tag Added**, action **Send email**)
  sends the template from Chandler's connected Outlook
  (chandler@baywayhtx.com). There is no Microsoft Graph and no Azure app, and
  Bayway's Microsoft 365 admin doesn't have to approve anything. FUB logs the
  email on the lead, and the OS already syncs FUB emails into `activities`
  (`fub-activity.ts`, `/emails`).
- **Why a tag and not the action-plan API.** FUB's docs mark
  `POST /actionPlansPeople` as "planned for deprecation" under Automations 2.0.
  Chandler's FUB already runs Automations 2.0, which has a Tag Added trigger.
  Adding a tag uses the same `PUT /people` tag write the OS already makes for
  every stage move.
- **Three versions.** The preview offers *first home*, *next home* and
  *refinance*. Each one is its own FUB template, tag and automation.
- **Copy:** Chandler's draft, word for word, with one fix ("I look forwarding
  to" becomes "I look forward to"). Subject: **Your pre-approval: next steps**.
- **W2 years roll forward on their own:** the last two tax years, so Nov 2026
  reads "2024 & 2025" and Jan 2027 reads "2025 & 2026". To make that work, the
  OS owns the template copy and publishes it to FUB (below).
- **Signature:** Chandler's Outlook signature. FUB adds the sender's FUB email
  signature, which Chandler sets to match Outlook (setup). See *Verify*.
- **No email on file:** the stage still moves. The preview shows an email field;
  Send saves that email to the FUB lead first, then tags it. A missing first
  name works the same way.
- **Never twice per lead.** A `lead_emails` row (unique per lead and email)
  plus a check of the lead's current FUB tags.

## The email

Subject: `Your pre-approval: next steps`

```
Hey {first name},
It was nice speaking with you about {goal}!
To get started, please click this link to create an account and complete the
questions for your pre-approval: [Click Here to Start Application]
Please upload the following supporting documents:

1. Last 30 Day Paystubs
2. Most Recent 2 Months' Bank Statements
3. {Y-2} & {Y-1} W2s

Once I receive your application and supporting documents, I will review within
48 hours. I'll determine the best programs that fit your situation then we'll
schedule a call to talk through your options.

Feel free to reach out with any questions. I look forward to helping you!

Thank you,
{FUB email signature}
```

- `{goal}`: first home = "buying your first home", next home = "buying your
  next home", refinance = "refinancing your home".
- The link text "Click Here to Start Application" is a real HTML link to
  `https://baywayhtx.my1003app.com/1851744/register`.
- `{first name}` is FUB's first-name merge field in the template, so FUB fills
  it in. The preview shows the lead's actual first name.
- `{Y-2} & {Y-1}`: years taken from today's date in America/Chicago. W2s for a
  year arrive by Jan 31 of the next one, so `Y` is just the current year.

**Default version:** taken from the lead's FUB tags. A tag containing "refi"
picks refinance. "move up", "repeat" or "second home" picks next home.
Anything else picks first home. Chandler can change it in the preview.

## How it works

### 1. The offer (browser)

`invokeCrmAction` already fires `crm-action:done` after a successful action.
It will now also put the request in the event detail. A new **`AppEmailHost`**,
mounted in `Layout` next to `ReminderHost`, listens for it. It opens the
preview when the request moved a Bayway lead to `application_sent` (either a
`set_stage` action, or a `log_call` whose `set_stage` is `application_sent`)
and that step came back ok. Hooking in at this one place covers the board, the
Move stage menu, Workbench and the dialer.

It does not open, and shows a short toast instead, when:
- `settings.app_email.enabled` is off;
- the lead already has a `lead_emails` row with status `tagged` ("Application
  email already sent Nov 5");
- the lead's FUB tags already hold one of the App Email tags.

**The preview dialog:**
- **To:** the lead's email. If the lead has none, a required email field.
- **First name.** If the lead has none, a required field.
- **Version picker:** first home / next home / refinance.
- **Subject and body**, rendered from the same module the server uses.
- **Send** and **Skip.** Skip leaves nothing behind.

**On the contact card:** the Move stage sheet for any Bayway lead has an
**Application email…** button. It opens the preview, which is how you send
the email after a Skip. If the email already went out, the button shows the
toast "Application email already sent `<date>`" instead.

### 2. The send (crm-action)

New action **`send_app_email`**:
`{ client_action_id, contact_id, payload: { variant, email?, first_name? } }`.
It uses the usual crm-action path: allowed user, `crm_actions` claim,
`writeback_enabled` for Bayway, preflight, then steps.

**Preflight refuses when:**
- the book isn't Bayway;
- the version is unknown;
- `app_email.enabled` is off;
- a template id is missing from `app_email.templates`;
- the lead has no email and none was given, or the given one isn't a valid
  email.

**Steps** (planned in `plan.ts`):

1. **`update_person`**, only when an email or first name was given. One
   `PUT /people/{id}`: the existing emails plus the new one (as primary), and
   the first name. If this step fails, nothing after it runs: no email address
   means nothing to send.
2. **`app_email`**:
   1. **Claim.** Insert `lead_emails (contact_id, template_key='application_sent',
      variant, to_email, status='pending', client_action_id)`. On a unique
      clash, read the row:
      - `tagged`: refuse "Already sent `<date>`";
      - `pending` and under 2 minutes old: refuse "Already sending";
      - `failed`, or a `pending` row stuck past 2 minutes: take it over with
        a conditional update that only matches those states.
   2. **Re-read the FUB person.** If it already carries any App Email tag, mark
      the row `tagged` (the email went out outside the OS) and refuse "Already
      sent from FUB".
   3. **Publish templates if needed** (below).
   4. **Add the version's tag.** Additive, like `TAG_TARGETS`: the full tag list
      plus the new tag, sent in one `PUT /people/{id}`.
   5. **Mark the row `tagged`** with `tagged_at`. Any error marks it `failed`
      with the message, so it can be retried from the contact card.
   - **Mirror:** re-read the person and upsert the contact through the people
     sync's mapper, as `set_stage` does.

The App Email tags aren't workflow tags, so `retagForTarget` keeps them on
every later stage move. A lead never loses its tag, so FUB's Tag Added trigger
can't fire twice from the OS.

### 3. Publishing the templates

The copy lives in `supabase/functions/_shared/app-email.ts`. It's a pure
module, imported by the browser for the preview and by crm-action for
publishing. It exports:
- `APP_EMAIL_VARIANTS`
- `appEmailTags`
- `defaultVariant(tags)`
- `w2Years(now)`
- `renderAppEmail({ variant, firstName, now, mode })`, where `mode` is
  `'preview'` (the real name, HTML-escaped) or `'fub'` (FUB's first-name merge
  field)
- `SUBJECT`

`settings.app_email.published_years` records the W2 years last pushed to FUB.
On each send, if it differs from `w2Years(now)` (or is empty), the step sends
`PUT /templates/{id}` with the `'fub'` render for each of the three templates,
then saves the new years. Publishing runs before tagging, so the email that
goes out always has this year's text.

- If publishing fails **and templates were never published**, the send fails.
  FUB would otherwise send an empty placeholder.
- If publishing fails **and the templates were published before**, the send
  still tags the lead and reports a warning ("FUB template still shows
  2024 & 2025"). The email goes out with last year's W2 line, which is better
  than not sending it.

The first send on a test lead (setup) does the first publish.

### Data

Migration `0060_lead_emails.sql`. Renumber it if another branch takes 0060
first.

```sql
create table lead_emails (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  template_key text not null,
  variant text not null,
  to_email text not null,
  status text not null check (status in ('pending','tagged','failed')),
  client_action_id uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tagged_at timestamptz,
  unique (contact_id, template_key)
);
-- RLS on; read for signed-in users (same as other tables); writes only through
-- the service role (crm-action).
```

Settings row `app_email`:

```json
{
  "enabled": true,
  "templates": { "first_home": 0, "next_home": 0, "refinance": 0 },
  "published_years": null
}
```

The FUB template ids are filled in during setup. The `app_email` flag is
separate from `writeback_enabled`: both must be on.

Tags, in Chandler's casing: `App Email - First Home`, `App Email - Next Home`,
`App Email - Refinance`.

## Errors

| Case | What Chandler sees |
| --- | --- |
| Stage move fails | No preview (unchanged behavior). |
| Send refused (already sent, bad email, off) | Message in the dialog; dialog stays open. |
| `update_person` fails | "Couldn't save the email to FUB: ...". Nothing tagged. Retry from the dialog. |
| Tag write fails | "Couldn't start the email in FUB: ...". Row is `failed`; the card offers Send again. |
| Template publish fails, published before | Sent, with a warning toast about the W2 years. |
| FUB automation off or broken | The OS can't see it. The lead has the tag but no email in FUB. The OS counts the lead as sent ("already sent `<date>`"), so FUB's email log on the lead is the check. |

## Testing (vitest, fakes as in `run.test.js`)

- `app-email.test.js`:
  - each version's goal line;
  - `w2Years` on Dec 31 / Jan 1 in Chicago time;
  - the preview escapes HTML in a name;
  - the FUB render holds the merge field and no real name;
  - the link is present;
  - the typo is fixed;
  - `defaultVariant` across tag sets.
- `plan.test.js`: `send_app_email` steps with and without email or first name;
  `update_person` failure stops the run.
- `run.test.js`:
  - the happy path (claim, publish when years are stale, tag, `tagged`);
  - a second send is refused;
  - two Sends racing produce one tag write;
  - a `failed` row is retried;
  - a stuck `pending` row is taken over;
  - an App Email tag already in FUB is refused and the row marked;
  - no email and none given is refused;
  - a given email is written before the tag;
  - a publish failure blocks only the first publish;
  - MPG is refused.
- `bay-stages.test.js`: a stage move keeps the App Email tags.
- `AppEmailHost.render.test.jsx`:
  - opens on `application_sent` ok and not on other targets or failed moves;
  - shows the email field when the lead has none;
  - Send builds the right request;
  - an already-sent lead gets a toast, not the dialog.
- `crmActions.test.js`: `buildActionRequest({ action: 'send_app_email' })`.

## Setup (Chandler, in FUB)

1. **Email signature:** in FUB, set your email signature to match your Outlook
   signature.
2. **Templates:** create three email templates, named
   `Sales OS - Application - First Home`, `... - Next Home` and
   `... - Refinance`. Any placeholder body works; the OS overwrites it. Note
   each template's id (from its URL).
3. **Automations (Admin > Automations, 2.0):** create three, one per version.
   Trigger **Tag Added** = `App Email - First Home` (and so on), then **Send
   email** with the matching template, sent right away. No other steps.
4. **Settings row:** run the SQL from the setup doc, with the three template
   ids.
5. **Test lead:** create a lead with your own email and move it to Application
   Sent. Send the first-home version, then check the items under *Verify*.

## Verify on the test lead (unknowns in FUB's docs)

- `PUT /templates/{id}` accepts `{ name, subject, body }` with an HTML body.
  The docs list no fields. Marked `VERIFY` in code, like `FUB_PUSH_MODE`.
- The first-name merge field syntax (`%contact_first_name%` is the working
  guess) fills in correctly.
- A tag added through the API fires the Tag Added automation.
- The email comes from chandler@baywayhtx.com through the Outlook connection,
  and the FUB signature is added. If the signature isn't added, it goes into
  `app-email.ts` instead.
- The email shows on the lead in FUB and, after the next activity sync, in the
  OS.

## Out of scope

- Other templated emails, drips and follow-up sequences.
- Different document lists per version. A refinance lead gets the same
  paystubs / bank statements / W2s list and the same "pre-approval" wording.
- MPG.
- Sending when the tag is added by hand in FUB. FUB's automation does that on
  its own, and the OS's check of FUB tags then treats the lead as sent.
