import { playUiClick } from '../audio/sfx'
import { cachedUsername } from '../session'

const modes = [
  { id: 'arcade-1v1', label: 'Arcade 1 v 1' },
  { id: 'arcade-agent', label: 'Arcade 1 v Agent', disabled: true },
  { id: 'dark-forest-simulator', label: 'Dark Forest Simulator', disabled: true },
]

export function IntroPage() {
  return (
    <main className="intro-page">
      <section className="intro-panel" aria-labelledby="intro-title">
        <span className="intro-kicker">DARK FOREST</span>
        <h1 id="intro-title">SELECT GAME MODE</h1>
        <div className="intro-modes">
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className="intro-mode"
              disabled={mode.disabled}
              onClick={() => {
                playUiClick()
                window.location.assign(cachedUsername() ? '/intro/universe' : '/intro/login')
              }}
            >
              {mode.label}
              {mode.disabled && <small>UNAVAILABLE</small>}
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}
