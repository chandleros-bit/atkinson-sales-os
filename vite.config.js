import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    alias: {
      // The edge functions import ical.js from esm.sh (Deno has no node_modules).
      // Point that specifier at the npm devDependency so ics.ts can be unit
      // tested here. Test-only — the deployed function still uses the esm.sh URL.
      // Keep the version in sync with the URL in _shared/ics.ts.
      'https://esm.sh/ical.js@1.5.0': 'ical.js',
    },
  },
})
