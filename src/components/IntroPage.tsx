import { playUiClick } from '../audio/sfx'
import { cachedUsername } from '../session'
import { IntroGalaxyBackground } from './IntroGalaxyBackground'
import { useState } from 'react'
import { LoginPage } from './LoginPage'
import { UniversePage } from './UniversePage'
import { CreateUniversePage } from './CreateUniversePage'

const modes = [
  { id: 'arcade-1v1', label: 'Arcade 1 v 1' },
  { id: 'arcade-agent', label: 'Arcade 1 v Agent', disabled: true },
  { id: 'dark-forest-simulator', label: 'Dark Forest Simulator', disabled: true },
]

export function IntroPage() {
  const [arcadeHovered, setArcadeHovered] = useState(false)
  const [stage, setStage] = useState(() => new URLSearchParams(window.location.search).get('stage'))
  const [universePreview, setUniversePreview] = useState({ starCount: 20, shipCount: 3 })
  const [creationRequested, setCreationRequested] = useState(false)
  const loginStage = stage === 'intro-login'
  const universeStage = stage === 'intro-universe'
  const createUniverseStage = stage === 'intro-universe-new'

  function openLoginStage() {
    window.history.pushState({}, '', '/?stage=intro-login')
    setStage('intro-login')
  }

  function closeLoginStage() {
    window.history.pushState({}, '', '/')
    setArcadeHovered(false)
    setStage(null)
  }

  function openUniverseStage() {
    window.history.pushState({}, '', '/?stage=intro-universe')
    setArcadeHovered(false)
    setStage('intro-universe')
  }

  function openCreateUniverseStage() {
    window.history.pushState({}, '', '/?stage=intro-universe-new')
    setStage('intro-universe-new')
    setCreationRequested(false)
  }

  async function beginCreation() {
    setCreationRequested(true)
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1000))
  }

  return (
    <main className={`intro-page${creationRequested ? ' intro-creating' : ''}`}>
      <IntroGalaxyBackground cameraMode={loginStage ? 'intro-login' : arcadeHovered ? 'arcade-hover' : 'idle'} shipVisible={!universeStage && !createUniverseStage} setupPreview={createUniverseStage ? universePreview : undefined} creationRequested={creationRequested} />
      {loginStage ? <LoginPage embedded onBack={closeLoginStage} onAuthenticated={openUniverseStage} /> : createUniverseStage ? <CreateUniversePage embedded onBeforeCreate={beginCreation} onCreationFailed={() => setCreationRequested(false)} onPreviewChange={setUniversePreview} onBack={() => {
        window.history.pushState({}, '', '/?stage=intro-universe')
        setStage('intro-universe')
      }} /> : universeStage ? <UniversePage embedded onCreateNew={openCreateUniverseStage} onBack={() => {
        window.history.pushState({}, '', '/?stage=intro-login')
        setStage('intro-login')
      }} /> : <section className="intro-panel" aria-labelledby="intro-title">
        <span className="intro-kicker">DARK FOREST</span>
        <h1 id="intro-title">SELECT GAME MODE</h1>
        <div className="intro-modes">
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className="intro-mode"
              disabled={mode.disabled}
              onMouseEnter={() => { if (mode.id === 'arcade-1v1') setArcadeHovered(true) }}
              onMouseLeave={() => { if (mode.id === 'arcade-1v1') setArcadeHovered(false) }}
              onFocus={() => { if (mode.id === 'arcade-1v1') setArcadeHovered(true) }}
              onBlur={() => { if (mode.id === 'arcade-1v1') setArcadeHovered(false) }}
              onClick={() => {
                playUiClick()
                if (cachedUsername()) openUniverseStage()
                else openLoginStage()
              }}
            >
              {mode.label}
              {mode.disabled && <small>UNAVAILABLE</small>}
            </button>
          ))}
        </div>
      </section>}
    </main>
  )
}
