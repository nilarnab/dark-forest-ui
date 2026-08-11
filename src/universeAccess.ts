import { cachedUsername } from './session'

export async function enterUniverse(universeId: string) {
  const username = cachedUsername()
  if (!username) throw new Error('Please log in first.')
  const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
  const response = await fetch(`${apiUrl}/auth/universe/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, universe_id: universeId }),
  })
  const body = await response.json() as { ok?: boolean; error?: string }
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not enter universe.')
}
