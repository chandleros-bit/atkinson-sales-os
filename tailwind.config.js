/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Keep in step with the :root tokens in src/index.css.
      colors: {
        bg: '#FFFFFF',
        panel: '#FFFFFF',
        panel2: '#F8F9FB',
        hoverbg: '#F2F4F7',
        line: '#EAECF0',
        line2: '#DDE1E7',
        muted: '#475467',
        dim: '#667085',
        chrome: '#1F2A5C',
        ink2: '#344054', // secondary button and control text
        link: '#1D4ED8',
        pos: { bg: '#ECFDF3', ink: '#067647', line: '#ABEFC6' },
        neg: { bg: '#FEF3F2', ink: '#B42318', line: '#FECDCA' },
        warn: { bg: '#FFFAEB', ink: '#B54708', line: '#FEDF89' },
        mpg: { DEFAULT: '#26ABE0', ink: '#0E74A0', deep: '#E8F6FC' },
        bay: { DEFAULT: '#7CAD44', ink: '#4F7A22', deep: '#0B5E42', gold: '#B54708' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // The type scale. Use these, not text-[Npx]: seven steps, nothing under 11px.
      fontSize: {
        micro: '11px', // uppercase badges and tags only
        caption: '12px', // timestamps, footnotes, axis labels
        body: '13px', // lists, tables, card body
        ui: '14px', // controls, emphasized body, subtitles
        lead: '17px', // card stat values, section heads
        title: '24px', // page titles (phone), big stats
        display: '32px', // page titles (desktop)
      },
      // Three radii: md for chips and tags, lg for controls, card for cards.
      borderRadius: {
        md: '6px',
        lg: '10px',
        card: '16px',
      },
    },
  },
  plugins: [],
}
