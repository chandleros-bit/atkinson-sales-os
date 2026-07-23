/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#EDEFF3',
        panel: '#FFFFFF',
        panel2: '#F6F7F9',
        hoverbg: '#F1F3F6',
        line: '#E6E8ED',
        line2: '#D9DDE4',
        muted: '#6B7280',
        dim: '#9AA1AC',
        mpg: { DEFAULT: '#26ABE0', ink: '#1483B4', deep: '#EAF6FC' },
        bay: { DEFAULT: '#7CAD44', ink: '#5F8A2E', deep: '#0B5E42', gold: '#B07A1F' },
      },
      fontFamily: {
        sans: ['"Work Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '20px',
      },
    },
  },
  plugins: [],
}
