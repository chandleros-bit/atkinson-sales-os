import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Claude Code session worktrees live under .claude/worktrees with their own
    // node_modules; their copies of the tests must not run (or load a 2nd React).
    exclude: [...configDefaults.exclude, '.claude/**'],
    alias: {
      // The edge functions import ical.js from esm.sh (Deno has no node_modules).
      // Point that specifier at the npm devDependency so ics.ts can be unit
      // tested here. Test-only — the deployed function still uses the esm.sh URL.
      // Keep the version in sync with the URL in _shared/ics.ts.
      'https://esm.sh/ical.js@1.5.0': 'ical.js',
      // Same reason: _shared/db.ts imports supabase-js from esm.sh so it runs
      // under Deno. Map it to the npm dependency so db.ts (and fetchAll) load
      // in vitest. Keep the version aligned with the URL in db.ts.
      'https://esm.sh/@supabase/supabase-js@2.45.0': '@supabase/supabase-js',
    },
  },
})
