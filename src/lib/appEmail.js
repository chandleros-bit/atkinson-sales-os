// Application Sent email, browser side (spec 2026-11-05-application-sent-email-design.md).
// AppEmailHost opens the preview after a move to Application Sent from any
// surface (board, Move stage menu, Workbench, dialer: all fire
// crm-action:done), or when the Move stage sheet asks for it.

// The contact to offer the email for, or null. `detail` is crm-action:done's
// ({ ...response, request }).
export function appEmailOfferFor(detail) {
  const req = detail?.request
  if (!req?.contact_id) return null
  const moved =
    (req.action === 'set_stage' && req.payload?.target === 'application_sent') ||
    (req.action === 'log_call' && req.payload?.set_stage === 'application_sent')
  if (!moved) return null
  return (detail.results || []).some((r) => r.step === 'set_stage' && r.ok) ? req.contact_id : null
}

export const openAppEmail = (contactId) =>
  window.dispatchEvent(new CustomEvent('app-email:open', { detail: { contactId } }))
