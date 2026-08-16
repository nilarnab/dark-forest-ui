import { useEffect, useRef, useState } from 'react'
import { playUiClick } from '../audio/sfx'
import { cacheCareerGuestUserId, cachedCareerGuestUserId } from '../session'

type InviteMode = 'choice' | 'creating'

export function LevelOneInvitePage() {
  const [cachedGuestId] = useState(() => cachedCareerGuestUserId())
  const [mode, setMode] = useState<InviteMode>(() => cachedGuestId ? 'choice' : 'creating')
  const [status, setStatus] = useState('INITIALIZING PERSONAL SIGNAL…')
  const [progress, setProgress] = useState(0)
  const [requestPending, setRequestPending] = useState(false)
  const alive = useRef(true)

  async function enter(reset: boolean) {
    setMode('creating')
    setStatus(reset ? 'ERASING PREVIOUS CAREER SIGNAL…' : 'ESTABLISHING FIRST CONTACT…')
    setProgress(0)
    setRequestPending(Boolean(cachedGuestId))
    const startedAt = performance.now()
    const minimumDuration = cachedGuestId ? 0 : 3000
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    const progressTimer = window.setInterval(() => {
      if (!alive.current) return
      setProgress(Math.min(100, ((performance.now() - startedAt) / Math.max(1, minimumDuration)) * 100))
    }, 50)
    try {
      const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
      const response = await fetch(`${apiUrl}/auth/career/invite/level1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_user_id: cachedGuestId, reset }),
        signal: controller.signal,
      })
      const body = await response.json() as { ok?: boolean; error?: string; user_id?: string; universe_id?: string }
      if (!response.ok || !body.ok || !body.user_id || !body.universe_id) throw new Error(body.error ?? 'Could not prepare Level 1.')
      cacheCareerGuestUserId(body.user_id)
      if (alive.current) {
        setRequestPending(false)
        setStatus('FIRST CONTACT READY…')
      }
      const remaining = Math.max(0, minimumDuration - (performance.now() - startedAt))
      await new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
      if (!alive.current) return
      setProgress(100)
      window.location.replace(`/game?universe=${encodeURIComponent(body.universe_id)}`)
    } catch (error) {
      if (alive.current) {
        setRequestPending(false)
        setStatus(error instanceof DOMException && error.name === 'AbortError' ? 'CAREER REQUEST TIMED OUT · RETRY' : error instanceof Error ? error.message : 'CAREER SIGNAL UNAVAILABLE')
        setMode('choice')
      }
    } finally {
      window.clearInterval(progressTimer)
      window.clearTimeout(timeout)
    }
  }

  useEffect(() => {
    // React Strict Mode performs a development-only mount/cleanup/remount.
    // Reset the shared guard on the real mount so an in-flight successful
    // invite is allowed to navigate instead of being silently abandoned.
    alive.current = true
    if (!cachedGuestId) void enter(false)
    return () => { alive.current = false }
    // `cachedGuestId` is intentionally fixed for this one invite visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (mode === 'choice') {
    return <main className="intro-page"><section className="intro-panel invite-panel">
      <span className="intro-kicker">DARK FOREST · LEVEL 1</span><h1>EXISTING UNIVERSE FOUND</h1>
      <output>Resume your current career signal, or erase it and begin again.</output>
      <div className="invite-actions">
        <button type="button" className="intro-mode" onClick={() => { playUiClick(); void enter(false) }}>ENTER</button>
        <button type="button" className="intro-mode danger" onClick={() => { playUiClick(); void enter(true) }}>CREATE NEW</button>
      </div>
    </section></main>
  }

  return <main className="intro-page"><section className="intro-panel invite-panel"><span className="intro-kicker">DARK FOREST · LEVEL 1</span><h1>FIRST CONTACT</h1><output>{status}</output><div className={`invite-progress${requestPending ? ' indeterminate' : ''}`} aria-label="Preparing Level 1"><i style={{ width: `${progress}%` }} /></div></section></main>
}
