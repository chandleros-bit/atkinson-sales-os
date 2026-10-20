// One clock per page for live labels (speed-to-lead timers). Re-renders the
// caller every `ms`; pauses while the tab is hidden and catches up on return.
import { useEffect, useState } from 'react'

export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && setNow(Date.now())
    const id = setInterval(tick, ms)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [ms])
  return now
}
