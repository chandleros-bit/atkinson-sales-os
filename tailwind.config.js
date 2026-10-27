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
        mpg: { DEFAULT: '#26ABE0', ink: '#0F7AA8', deep: '#E8F6FC' },
        bay: { DEFAULT: '#7CAD44', ink: '#4F7A22', deep: '#0B5E42', gold: '#B54708' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
      },
    },
  },
  plugins: [],
}
