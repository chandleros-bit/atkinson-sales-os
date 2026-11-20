// Power Dialer compliance guard (spec 2026-11-20, "Compliance guardrails").
// App behavior, not legal advice. Cold lists: calls only Mon-Sat 9 AM-8 PM and
// Sun noon-8 PM in the lead's local time (the combined Texas + Florida
// window). Every list: no 4th dial to the same number within 24 hours.
// The lead's time zone comes from its mapped state, then its area code; when
// a lead could be in more than one zone, the window must hold in all of them.

const ET = 'America/New_York'
const CT = 'America/Chicago'
const MT = 'America/Denver'
const PT = 'America/Los_Angeles'
const ALL_CONTINENTAL = [ET, CT, MT, PT]

// The zone most of each state is in.
const STATE_ZONE = {
  AL: CT, AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET, FL: ET,
  GA: ET, HI: 'Pacific/Honolulu', ID: MT, IL: CT, IN: ET, IA: CT, KS: CT, KY: ET, LA: CT, ME: ET, MD: ET, MA: ET,
  MI: ET, MN: CT, MS: CT, MO: CT, MT: MT, NE: CT, NV: PT, NH: ET, NJ: ET, NM: MT, NY: ET, NC: ET, ND: CT, OH: ET,
  OK: CT, OR: PT, PA: ET, RI: ET, SC: ET, SD: CT, TN: CT, TX: CT, UT: MT, VT: ET, VA: ET, WA: PT, WV: ET, WI: CT, WY: MT,
}
const STATE_NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

// US area codes by state (fallback when no state is mapped).
const AREA_CODES = {
  AL: '205 251 256 334 659 938', AK: '907', AZ: '480 520 602 623 928', AR: '327 479 501 870',
  CA: '209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951',
  CO: '303 719 720 970 983', CT: '203 475 860 959', DE: '302', DC: '202 771',
  FL: '239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 813 850 863 904 941 954',
  GA: '229 404 470 478 678 706 762 770 912 943', HI: '808', ID: '208 986',
  IL: '217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872', IN: '219 260 317 463 574 765 812 930',
  IA: '319 515 563 641 712', KS: '316 620 785 913', KY: '270 364 502 606 859', LA: '225 318 337 504 985',
  ME: '207', MD: '227 240 301 410 443 667', MA: '339 351 413 508 617 774 781 857 978',
  MI: '231 248 269 313 517 586 616 679 734 810 906 947 989', MN: '218 320 507 612 651 763 952', MS: '228 601 662 769',
  MO: '314 417 557 573 636 660 816 975', MT: '406', NE: '308 402 531', NV: '702 725 775', NH: '603',
  NJ: '201 551 609 640 732 848 856 862 908 973', NM: '505 575',
  NY: '212 315 332 347 363 516 518 585 607 624 631 646 680 716 718 838 845 914 917 929 934',
  NC: '252 336 472 704 743 828 910 919 980 984', ND: '701', OH: '216 220 234 283 326 330 380 419 436 440 513 567 614 740 937',
  OK: '405 539 572 580 918', OR: '458 503 541 971', PA: '215 223 267 272 412 445 484 570 582 610 717 724 814 835 878',
  RI: '401', SC: '803 821 839 843 854 864', SD: '605', TN: '423 615 629 731 865 901 931',
  TX: '210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 915 936 940 945 956 972 979',
  UT: '385 435 801', VT: '802', VA: '276 434 540 571 686 703 757 804 826 948', WA: '206 253 360 425 509 564',
  WV: '304 681', WI: '262 274 414 534 608 715 920', WY: '307',
}
const AREA_STATE = {}
for (const [st, codes] of Object.entries(AREA_CODES)) for (const c of codes.split(' ')) AREA_STATE[c] = st

// Area codes in a split state that sit in another zone, or straddle two.
const AREA_ZONES = {
  915: [MT], // El Paso
  850: [ET, CT], // Florida panhandle
  270: [CT], 364: [CT], // western Kentucky
  423: [ET], 865: [ET], // east Tennessee
  219: [CT], // northwest Indiana
  605: [CT, MT], 308: [CT, MT], // South Dakota, western Nebraska
  208: [MT, PT], 986: [MT, PT], // Idaho
}

const normState = (s) => {
  const t = String(s ?? '').trim()
  if (!t) return null
  const up = t.toUpperCase()
  if (STATE_ZONE[up]) return up
  return STATE_NAMES[t.toLowerCase()] || null
}
const areaCode = (e164) => (/^\+1\d{10}$/.test(e164 || '') ? e164.slice(2, 5) : null)

export function zonesFor(lead) {
  const st = normState(lead.state)
  const ac = areaCode(lead.phone_e164)
  const acState = ac ? AREA_STATE[ac] : null
  if (st) return ac && acState === st && AREA_ZONES[ac] ? AREA_ZONES[ac] : [STATE_ZONE[st]]
  if (acState) return AREA_ZONES[ac] || [STATE_ZONE[acState]]
  return ALL_CONTINENTAL
}

const ZONE_LABEL = {
  [ET]: 'Eastern', [CT]: 'Central', [MT]: 'Mountain', [PT]: 'Pacific',
  'America/Phoenix': 'Arizona', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii',
}

const fmtCache = new Map()
function partsIn(zone, t) {
  let f = fmtCache.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    })
    fmtCache.set(zone, f)
  }
  const p = Object.fromEntries(f.formatToParts(t).map((x) => [x.type, x.value]))
  return { weekday: p.weekday, year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute }
}

// Sun 12-20, Mon-Sat 9-20 (local hours).
const openHour = (weekday) => (weekday === 'Sun' ? 12 : 9)
const CLOSE_HOUR = 20

function inWindow(zone, t) {
  const p = partsIn(zone, t)
  const mins = p.hour * 60 + p.minute
  return mins >= openHour(p.weekday) * 60 && mins < CLOSE_HOUR * 60
}

// The instant a local wall time happens in a zone.
function zonedInstant(zone, y, m, d, h) {
  let guess = Date.UTC(y, m - 1, d, h)
  for (let i = 0; i < 2; i++) {
    const p = partsIn(zone, guess)
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    guess += Date.UTC(y, m - 1, d, h) - asUtc
  }
  return guess
}

const fmtTime = (zone, t) => new Date(t).toLocaleString('en-US', { timeZone: zone, weekday: 'long', hour: 'numeric', minute: '2-digit' })

// explain: false skips the reason and the next opening (the queue only needs ok).
export function callingWindow(zones, now = Date.now(), explain = true) {
  const closed = zones.find((z) => !inWindow(z, now))
  if (!closed) return { ok: true, reason: null, opensAt: null }
  if (!explain) return { ok: false, reason: null, opensAt: null }
  // The window only opens at a local opening hour, so try each zone's next
  // few openings, earliest first, until every zone is open at once.
  const candidates = []
  for (const z of zones) {
    const p = partsIn(z, now)
    for (let d = 0; d < 4; d++) {
      const day = new Date(Date.UTC(p.year, p.month - 1, p.day + d))
      const wd = day.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
      const t = zonedInstant(z, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), openHour(wd))
      if (t > now) candidates.push(t)
    }
  }
  candidates.sort((a, b) => a - b)
  const opensAt = candidates.find((t) => zones.every((z) => inWindow(z, t))) ?? null
  const reason = `It's ${fmtTime(closed, now)} for this lead (${ZONE_LABEL[closed] || closed} time). Cold calls are allowed Mon-Sat 9 AM-8 PM and Sun noon-8 PM, lead's local time.`
  return { ok: false, reason, opensAt }
}

export const MAX_PER_DAY = 3
const DAY = 24 * 3600_000

const recentDials = (calls, phone, now) =>
  calls.filter((c) => c.phone_e164 === phone && now - Date.parse(c.dialed_at) < DAY).map((c) => Date.parse(c.dialed_at)).sort((a, b) => a - b)

export const recentCount = (calls, phone, now = Date.now()) => recentDials(calls, phone, now).length

// May this lead be dialed now? calls: this user's dials in the last 24 hours
// (any list). cold: the list is a Cold Bayway list; hoursGuard: the setting.
export function canDial(lead, { cold, hoursGuard = true, calls = [], now = Date.now(), explain = true }) {
  const recent = recentDials(calls, lead.phone_e164, now)
  if (recent.length >= MAX_PER_DAY) {
    const opensAt = recent[recent.length - MAX_PER_DAY] + DAY
    return { ok: false, reason: `${MAX_PER_DAY} calls to this number in the last 24 hours. The next one is allowed ${new Date(opensAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`, opensAt }
  }
  if (cold && hoursGuard) return callingWindow(zonesFor(lead), now, explain)
  return { ok: true, reason: null, opensAt: null }
}
