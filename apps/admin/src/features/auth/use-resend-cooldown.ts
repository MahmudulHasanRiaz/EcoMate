import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Resend-code cooldown (login redesign Step 1). After a code is sent,
 * the resend button is disabled for `seconds` (default 30) and shows
 * the remaining wait — the preview's cooldown, wired to the real
 * rotate-resend on the service. The timer is cleaned up on unmount and
 * never fires a resend by itself.
 */
export function useResendCooldown(seconds = 30): {
  /** Seconds left on the cooldown (0 = resend is available). */
  remaining: number
  /** Start (or restart) the cooldown — call after a code is sent. */
  start: () => void
} {
  const [remaining, setRemaining] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  const start = useCallback(() => {
    stop()
    setRemaining(seconds)
    timer.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          stop()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [seconds, stop])

  useEffect(() => stop, [stop])

  return { remaining, start }
}
