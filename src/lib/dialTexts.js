// The texts the dialer offers after a call (spec: Texts). Short and plain, the
// way Chandler texts. {first} is the lead's first name. Keys: a1 / a3 / a5 /
// a6 = after attempts 1, 3, 5 and 6; nurture (nurture and cold calls);
// credit_repair (Bayway parked in Credit Repair); and the Bayway weekday
// themes (dialThemes.js): new_realtor, loan_status, past_client,
// pre_approved, top_partner.
export const TEXTS = {
  bay: {
    a1: "Hi {first}, this is Chandler with Bayway. Just tried calling about your home loan. When's a good time to talk?",
    a3: 'Hey {first}, Chandler again. Still happy to help with your loan. Do you have 10 min today or tomorrow?',
    a5: '{first}, quick check in. Are you still looking at a loan, or should I check back later?',
    a6: "Hi {first}, I'll stop reaching out for now. If anything changes just text me here.",
    nurture: 'Hey {first}, Chandler here. Just checking in, anything I can help with on the home search?',
    credit_repair: 'Hi {first}, checking in on how the credit is coming along. Happy to take another look anytime.',
    new_realtor: 'Hey {first}, Chandler with Bayway. Good to connect. Anything I can help your buyers with this week?',
    loan_status: 'Hi {first}, Chandler here with a quick update on your loan. Got a minute to talk today?',
    past_client: 'Hey {first}, Chandler with Bayway. Hope the house is treating you well. Anything I can help with?',
    pre_approved: 'Hi {first}, checking in on the house hunt. Found anything you like yet?',
    top_partner: 'Hey {first}, Chandler here. Just checking in, anything I can help with on your deals?',
  },
  mpg: {
    a1: "Hi {first}, this is Chandler with Media Payments Group. Just tried calling about your card processing. When's a good time?",
    a3: 'Hey {first}, Chandler again. Got a few minutes this week to look at your processing rates?',
    a5: '{first}, quick check in. Still want to look at lowering your fees, or should I check back later?',
    a6: "Hi {first}, I'll stop reaching out for now. Text me here if you want to pick it back up.",
    nurture: 'Hey {first}, Chandler with MPG checking in. Anything I can help with on the processing side?',
  },
}

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there'

export function textFor(book, key, name) {
  const t = key ? TEXTS[book]?.[key] : null
  return t ? t.replaceAll('{first}', firstName(name)) : null
}

// Opens Messages on an iPhone / Mac (iMessage when the other person has it,
// SMS otherwise) with the number and text filled in. "?&body=" works on iOS
// and Android alike.
export function smsHref(phone, body) {
  const num = String(phone || '').replace(/[^\d+]/g, '')
  return num ? `sms:${num}?&body=${encodeURIComponent(body || '')}` : null
}
