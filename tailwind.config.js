/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0E0E10',
        panel: '#17171A',
        panel2: '#131316',
        hoverbg: '#1E1E22',
        line: '#26262B',
        line2: '#2E2E34',
        muted: '#9A9AA2',
        dim: '#6E6E77',
        mpg: { DEFAULT: '#26ABE0', deep: '#151518' },
        bay: { DEFAULT: '#7CAD44', deep: '#0B5E42', gold: '#C9A052' },
      },
      fontFamily: {
        sans: ['"Work Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
      },
    },
  },
  plugins: [],
}
