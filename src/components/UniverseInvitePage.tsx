import { useEffect, useState } from 'react'
import { cacheUniverseInviteGuestUserId, ensureUniverseInviteGuestUserId } from '../session'

export function UniverseInvitePage({ universeId }: { universeId: string }) {
  const [status, setStatus] = useState('ESTABLISHING SECURE CHANNEL…')

  useEffect(() => {
    if (!universeId) return
    const controller = new AbortController()
    const join = async () => {
      try {
        const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
        const response = await fetch(`${apiUrl}/auth/universe/invite/enter`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guest_user_id: ensureUniverseInviteGuestUserId(), universe_id: universeId }),
          signal: controller.signal,
        })
        const body = await response.json() as { ok?: boolean; error?: string; user_id?: string; universe_id?: string }
        if (!response.ok || !body.ok || !body.user_id || !body.universe_id) throw new Error(body.error ?? 'Could not join this universe.')
        cacheUniverseInviteGuestUserId(body.user_id)
        setStatus('SIGNAL ACCEPTED · ENTERING UNIVERSE…')
        window.location.replace(`/game?universe=${encodeURIComponent(body.universe_id)}`)
      } catch (error) {
        if (controller.signal.aborted) return
        setStatus(error instanceof Error ? error.message : 'UNIVERSE SIGNAL UNAVAILABLE')
      }
    }
    void join()
    return () => controller.abort()
  }, [universeId])

  return <main className="intro-page"><section className="intro-panel invite-panel">
    <span className="intro-kicker">DARK FOREST · SHARED UNIVERSE</span>
    <h1>INCOMING INVITATION</h1>
    <output>{status}</output>
    <div className="invite-progress indeterminate" aria-label="Joining shared universe"><i /></div>
  </section></main>
}
