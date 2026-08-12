import { useEffect, useState } from 'react'
import { get, ref } from 'firebase/database'
import { playUiClick } from '../audio/sfx'
import { firebaseDatabase } from '../firebase/listener'
import { cachedUsername } from '../session'
import { enterUniverse } from '../universeAccess'

type LookupState = 'idle' | 'checking' | 'available' | 'missing' | 'error'

function goTo(path: string) {
  window.location.assign(path)
}

function universeList(value: unknown): string[] {
  if (Array.isArray(value)) return []
  if (!value || typeof value !== 'object') return []
  return Object.keys(value as Record<string, unknown>).sort()
}

export function UniversePage({ embedded = false, onBack, onCreateNew }: { embedded?: boolean; onBack?: () => void; onCreateNew?: () => void }) {
  const username = cachedUsername()
  const [universeId, setUniverseId] = useState('')
  const [lookup, setLookup] = useState<LookupState>('idle')
  const [universes, setUniverses] = useState<string[]>([])

  useEffect(() => {
    if (!username) {
      if (onBack) onBack()
      else goTo('/intro/login')
    }
  }, [username, onBack])

  useEffect(() => {
    if (!username) return
    let live = true
    let running = false
    const typedUniverseId = universeId.trim()
    setLookup(typedUniverseId ? 'checking' : 'idle')
    const check = async () => {
      if (running) return
      running = true
      try {
        const database = firebaseDatabase()
        const [savedSnapshot, universeSnapshot] = await Promise.all([
          get(ref(database, `users/${username}/universe_memberships`)),
          typedUniverseId ? get(ref(database, `universes/${typedUniverseId}`)) : Promise.resolve(null),
        ])
        if (!live) return
        setUniverses(universeList(savedSnapshot.val()))
        setLookup(typedUniverseId ? (universeSnapshot?.exists() ? 'available' : 'missing') : 'idle')
      } catch {
        if (live) setLookup('error')
      } finally {
        running = false
      }
    }
    void check()
    if (!typedUniverseId) return () => { live = false }
    const timer = window.setInterval(() => void check(), 800)
    return () => { live = false; window.clearInterval(timer) }
  }, [universeId, username])

  async function enter(id: string) {
    playUiClick()
    setLookup('checking')
    try {
      await enterUniverse(id)
      goTo(`/game?universe=${encodeURIComponent(id)}`)
    } catch {
      setLookup('error')
    }
  }

  if (!username) return null
  const content = (
    <section className="intro-panel universe-panel" aria-labelledby="universe-title">
        {onBack && <button className="intro-back" type="button" onClick={() => { playUiClick(); onBack() }}>← BACK</button>}
        <span className="intro-kicker">ARCADE 1 V 1 · {username.toUpperCase()}</span>
        <h1 id="universe-title">SELECT UNIVERSE</h1>
        <label>
          UNIVERSE ID
          <input value={universeId} onChange={(event) => setUniverseId(event.target.value)} placeholder="univid1123" autoFocus />
        </label>
        <output className={`universe-status ${lookup}`}>
          {lookup === 'idle' && 'ENTER A UNIVERSE ID'}
          {lookup === 'checking' && 'CHECKING…'}
          {lookup === 'available' && 'UNIVERSE AVAILABLE'}
          {lookup === 'missing' && 'UNIVERSE NOT FOUND'}
          {lookup === 'error' && 'FIREBASE LOOKUP FAILED'}
        </output>
        {lookup === 'available' && <button className="intro-mode" type="button" onClick={() => void enter(universeId.trim())}>ENTER UNIVERSE</button>}
        <button className="intro-mode create-universe" type="button" onClick={() => { playUiClick(); if (onCreateNew) onCreateNew(); else goTo('/intro/universe/new') }}>
          CREATE NEW UNIVERSE
        </button>
        <div className="saved-universes">
          <span>YOUR UNIVERSES</span>
          {universes.length === 0 ? <small>NO SAVED UNIVERSES</small> : universes.map((id) => (
            <button key={id} className="intro-mode" type="button" onClick={() => void enter(id)}>{id}</button>
          ))}
        </div>
    </section>
  )
  return embedded ? content : <main className="intro-page">{content}</main>
}
