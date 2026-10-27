// Line icons for the app chrome (sidebar, top bar, page headers, cards).
// One stroke style everywhere: 24px grid, round caps, currentColor.
export const ICONS = {
  home: 'M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  bench: 'M3 6h11 M3 12h11 M3 18h7 M16 16l2 2 4-4',
  calendar: 'M4 6h16v15H4z M4 10h16 M8 3v4 M16 3v4',
  tasks: 'M4 4h16v16H4z M8 12l3 3 5-6',
  activity: 'M12 7v5l3 2 M3.5 12a8.5 8.5 0 1 0 2.5-6 M3 3v4h4',
  reports: 'M3 4h18 M4 4v11h16V4 M12 15v4 M8 21l4-2 4 2',
  analytics: 'M4 20V10 M10 20V4 M16 20v-7 M3 20h18',
  pipeline: 'M4 4h4v16H4z M10 4h4v10h-4z M16 4h4v6h-4z',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  users: 'M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 18.5V20 M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7 M21 20v-1.5a3.5 3.5 0 0 0-2.5-3.4 M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  userPlus: 'M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 18.5V20 M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7 M19 8v6 M16 11h6',
  sync: 'M20 11a8 8 0 0 0-14.3-4.9L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.3 4.9L20 16 M20 20v-4h-4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M20 20l-4-4',
  plus: 'M12 5v14 M5 12h14',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z M14 3v5h5 M9 13l2 2 4-4',
  warn: 'M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  doc: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z M14 3v5h5 M12 12v4 M12 18h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 7v5l3 2',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  board: 'M4 4h4v16H4z M10 4h4v10h-4z M16 4h4v13h-4z',
  grouped: 'M3 5h18 M7 9h14 M7 13h14 M3 17h18 M7 21h14',
  user: 'M20 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-7A4.5 4.5 0 0 0 4 19.5V21 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  layers: 'M12 3 2 8l10 5 10-5z M2 13l10 5 10-5',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z M7.5 7.5h.01',
  chevronDown: 'M6 9l6 6 6-6',
}

export default function Icon({ name, size = 18, strokeWidth = 1.8, className = '' }) {
  const d = ICONS[name]
  if (!d) return null
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-none ${className}`}
    >
      <path d={d} />
    </svg>
  )
}

// The app mark: a dark tile with an A drawn in Bayway green, crossed in MPG blue.
export function LogoMark({ size = 30 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 28 28" className="flex-none">
      <rect width="28" height="28" rx="8" fill="#101828" />
      <path d="M8 20 13 8h2l5 12" stroke="#7CAD44" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 15h7" stroke="#26ABE0" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}
