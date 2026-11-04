// Sends one email from the Gmail account in GMAIL_USER with an app password
// (GMAIL_APP_PASSWORD), over implicit TLS on smtp.gmail.com:465. Supabase
// Edge Functions block outbound 25 and 587; 465 is probed in Task 11 of the
// daily-briefing plan. If it's blocked, Task 10 swaps this for the Gmail API.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

export async function sendGmail({ to, subject, text, html, fromName = 'Atkinson Sales OS' }) {
  const user = Deno.env.get('GMAIL_USER')
  const pass = Deno.env.get('GMAIL_APP_PASSWORD')
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set as function secrets')
  const client = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: user, password: pass } } })
  try {
    await client.send({ from: `${fromName} <${user}>`, to, subject, content: text, html })
  } finally {
    try {
      await client.close()
    } catch {
      /* the message was already handed to Gmail */
    }
  }
}
