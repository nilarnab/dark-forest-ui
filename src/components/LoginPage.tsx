import { FormEvent, useEffect, useState } from 'react'
import { playUiClick } from '../audio/sfx'
import { cacheUsername, cachedUsername } from '../session'

function goTo(path: string) {
  window.location.assign(path)
}

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (cachedUsername()) goTo('/intro/universe')
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    playUiClick()
    setSubmitting(true)
    setStatus('AUTHENTICATING…')
    try {
      const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const body = await response.json() as { ok?: boolean; error?: string; username?: string; action?: 'login' | 'signup' }
      if (!response.ok || !body.ok || !body.username) throw new Error(body.error ?? 'Authentication failed.')
      cacheUsername(body.username)
      setStatus(body.action === 'signup' ? 'ACCOUNT CREATED · ENTERING ARCADE…' : 'LOGIN ACCEPTED · ENTERING ARCADE…')
      window.setTimeout(() => goTo('/intro/universe'), 350)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Authentication failed.')
      setSubmitting(false)
    }
  }

  return (
    <main className="intro-page">
      <form className="intro-panel login-panel" onSubmit={submit}>
        <span className="intro-kicker">ARCADE 1 V 1</span>
        <h1>IDENTIFY YOURSELF</h1>
        <label>
          USERNAME
          <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
        </label>
        <label>
          PASSWORD
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button className="intro-mode" type="submit" disabled={submitting}>{submitting ? 'PLEASE WAIT…' : 'CONTINUE'}</button>
        <small>New username? A HUMAN account will be created automatically.</small>
        {status && <output className="login-status">{status}</output>}
      </form>
    </main>
  )
}
