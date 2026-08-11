import { FormEvent, useEffect, useState } from 'react'
import { playUiClick } from '../audio/sfx'
import { cachedUsername } from '../session'
import { enterUniverse } from '../universeAccess'

const defaultGunRange = Number(import.meta.env.VITE_PROJECTILE_RANGE ?? 1000)

function goTo(path: string) {
  window.location.assign(path)
}

export function CreateUniversePage() {
  const username = cachedUsername()
  const [starCount, setStarCount] = useState(20)
  const [shipCount, setShipCount] = useState(1)
  const [status, setStatus] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!username) goTo('/intro/login')
  }, [username])

  async function createUniverse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username) return
    playUiClick()
    setCreating(true)
    setStatus('GENERATING STAR MAP…')
    try {
      const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
      const response = await fetch(`${apiUrl}/auth/universe/new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, options: { star_count: starCount, ship_count: shipCount } }),
      })
      const body = await response.json() as { ok?: boolean; error?: string; universe_id?: string }
      if (!response.ok || !body.ok || !body.universe_id) throw new Error(body.error ?? 'Universe creation failed.')
      setStatus('UNIVERSE CREATED · ASSIGNING ASSETS…')
      await enterUniverse(body.universe_id)
      window.setTimeout(() => goTo(`/game?universe=${encodeURIComponent(body.universe_id!)}`), 300)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Universe creation failed.')
      setCreating(false)
    }
  }

  if (!username) return null
  return (
    <main className="intro-page">
      <form className="intro-panel setup-panel" onSubmit={createUniverse}>
        <span className="intro-kicker">ARCADE 1 V 1 · UNIVERSE SETUP</span>
        <h1>CONFIGURE NEW UNIVERSE</h1>
        <label className="setup-row">
          <span>NUMBER OF STARS</span>
          <input type="number" min="1" max="100" value={starCount} onChange={(event) => setStarCount(Number(event.target.value))} required />
        </label>
        <label className="setup-row">
          <span>STARTER SHIPS <small>MAX 3</small></span>
          <input type="number" min="0" max="3" value={shipCount} onChange={(event) => setShipCount(Number(event.target.value))} required />
        </label>
        <div className="setup-row static-row">
          <span>GUN RANGE <small>ONE GUN PER SHIP</small></span>
          <output>DEFAULT · {Number.isFinite(defaultGunRange) ? defaultGunRange : 1000}</output>
        </div>
        <button className="intro-mode" type="submit" disabled={creating}>{creating ? 'GENERATING…' : 'CREATE UNIVERSE'}</button>
        {status && <output className="login-status">{status}</output>}
      </form>
    </main>
  )
}
