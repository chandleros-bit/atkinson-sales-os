# Application Sent email: setup

When you move a Bayway lead to **Application Sent**, the OS opens a preview of
the application-link email: who it goes to, the subject, the body, and a
choice of version. Click **Send** and the OS tags the lead in FollowUpBoss. An
FUB automation then sends the email from your Outlook. Each lead gets it once.

Design: `docs/superpowers/specs/2026-11-05-application-sent-email-design.md`.

The email stays off (`app_email.enabled = false`) until the steps below are
done.

## 1. Deploy

```bash
supabase db push --project-ref cnmipfxwqnbtkohfixkf
supabase functions deploy crm-action --project-ref cnmipfxwqnbtkohfixkf
```

The migration (`0060_lead_emails.sql`) adds the `lead_emails` table and an
`app_email` settings row with the email turned off.

## 2. In FollowUpBoss

1. **Email signature.** In your FUB email settings, set your signature to
   match your Outlook signature. FUB adds it under "Thank you,".
2. **Outlook connection.** Check that chandler@baywayhtx.com is connected in
   FUB → Settings → Email integration. That connection is why the email comes
   from your Outlook.
3. **Three email templates.** Create these, each with any placeholder body (the
   OS writes the real copy into them on the first send):
   - `Sales OS - Application - First Home`
   - `Sales OS - Application - Next Home`
   - `Sales OS - Application - Refinance`

   Open each template and copy the number from its URL. That's its id.
4. **Three automations** (Admin → Automations, the 2.0 canvas), one per
   version:

   | Trigger: Tag Added | Action: Send email (immediately) |
   | --- | --- |
   | `App Email - First Home` | `Sales OS - Application - First Home` |
   | `App Email - Next Home` | `Sales OS - Application - Next Home` |
   | `App Email - Refinance` | `Sales OS - Application - Refinance` |

   Don't add any other steps. Type the tag names exactly as shown.

## 3. Turn it on

In the Supabase SQL editor, fill in the three template ids and run:

```sql
update settings set value = jsonb_build_object(
  'enabled', true,
  'templates', jsonb_build_object('first_home', 111, 'next_home', 222, 'refinance', 333),
  'published_years', null)
where key = 'app_email';
```

Leave `published_years` as `null`. The first send fills it in after it writes
the copy into the three templates. When the year changes, the next send updates
the W2 line on its own.

To switch the email off, set `enabled` to `false`. Nothing else changes.

## 4. Test on yourself

1. Create a Bayway lead with your own name and an email you can read.
2. Move it to **Application Sent**. The preview opens. Pick **First home** and
   click **Send**.
3. Check each of these:
   - [ ] The three FUB templates now hold the real copy.
         *If this failed:* `PUT /templates/{id}` didn't take
         `{ name, subject, body }`, and the dialog shows FUB's error.
   - [ ] The email arrives, and it **comes from chandler@baywayhtx.com**.
   - [ ] It says **"Hey `<your first name>`,"**.
         *If it shows `%contact_first_name%` instead:* the merge field is
         spelled differently. Find the right one in FUB's template editor and
         change `FUB_FIRST_NAME` in `supabase/functions/_shared/app-email.ts`.
   - [ ] **Your signature** sits under "Thank you,".
         *If it doesn't:* put the signature into `renderAppEmail` in
         `app-email.ts`.
   - [ ] The **Click Here to Start Application** link opens the my1003app
         register page.
   - [ ] The W2 line reads **2024 & 2025** (in 2026).
   - [ ] The email shows on the lead in FUB, and in the OS after the next
         activity sync.
   - [ ] Moving the lead out and back to Application Sent **does not** offer the
         email again. It shows "Application email already sent `<date>`"
         instead.
4. Test the missing-email path: on a test lead with no email, type one into
   the preview. It should be saved to the lead in FUB. This is how we confirm
   FUB accepts `isPrimary` as 1/0.

## Day to day

- **Skip** leaves nothing behind. To send the email later, open **Move stage**
  on the lead and pick **Application email…**.
- **If a send fails** (FUB down, bad email), nothing is tagged. Try again from
  the dialog or from Move stage.
- **If you add an App Email tag by hand in FUB,** FUB sends the email, and the
  OS then counts the lead as already sent.
- **The record of every send** is in the `lead_emails` table: one row per
  lead, holding the status, the version, the address and the time it was
  tagged.
