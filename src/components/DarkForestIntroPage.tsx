import { useEffect, useRef, useState } from 'react'
import { playUiClick } from '../audio/sfx'
import { StarAssaultSequence, type StarAssaultSequenceHandle } from './StarAssaultSequence'

type Emphasis = { words: string[]; delay: number }
type ScriptLine = { text: string; typingDuration: number; emphasis?: Emphasis[] }

// Give each completed sentence room to land before its key words brighten.
const EMPHASIS_DELAY_SECONDS = 1

const script: ScriptLine[] = [
  { text: 'The universe contains countless potentially habitable star systems.', typingDuration: 6, emphasis: [{ words: ['countless'], delay: EMPHASIS_DELAY_SECONDS }] },
  { text: 'So where is everybody?', typingDuration: 3, emphasis: [{ words: ['everybody'], delay: EMPHASIS_DELAY_SECONDS }] },
  { text: 'The Dark Forest hypothesis offers a chilling answer.', typingDuration: 5, emphasis: [{ words: ['dark', 'forest'], delay: EMPHASIS_DELAY_SECONDS }] },
  {
    text: 'Every civilization hides—because being discovered can mean destruction.', typingDuration: 7,
    emphasis: [
      { words: ['civilization', 'hides'], delay: EMPHASIS_DELAY_SECONDS },
      { words: ['discovered', 'destruction'], delay: 3 },
    ],
  },
  { text: 'In the dark, silence is survival.', typingDuration: 4, emphasis: [{ words: ['silence', 'survival'], delay: EMPHASIS_DELAY_SECONDS }] },
]

function renderText(line: ScriptLine, characterCount: number, activeWords: Set<string>) {
  const text = line.text.slice(0, characterCount)
  return text.split(/(\s+)/).map((part, index) => {
    const normalized = part.toLowerCase().replace(/[^a-z]/g, '')
    // Always render a stable span for every word. Switching between a text
    // node and a <strong> while requestAnimationFrame is re-rendering caused
    // the whole line to reflow/flicker when emphasis began.
    if (!normalized) return part
    return <span className={`crawl-word${activeWords.has(normalized) ? ' emphasized' : ''}`} key={`${part}-${index}`}>{part}</span>
  })
}

export function DarkForestIntroPage() {
  const [started, setStarted] = useState(false)
  const [soundGate, setSoundGate] = useState(false)
  const [muted, setMuted] = useState(() => localStorage.getItem('dark-forest-intro-muted') === 'true')
  const [step, setStep] = useState(0)
  const [stepStartedAt, setStepStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [finale, setFinale] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const assaultRef = useRef<StarAssaultSequenceHandle>(null)
  const soundGateTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!started || finale) return
    let frame = 0
    const tick = (time: number) => {
      setNow(time)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [finale, started])

  useEffect(() => () => {
    if (soundGateTimer.current !== null) window.clearTimeout(soundGateTimer.current)
  }, [])

  const line = script[step]
  const elapsed = started ? Math.max(0, (now - stepStartedAt) / 1000) : 0
  const typingProgress = Math.min(1, elapsed / line.typingDuration)
  const characterCount = Math.floor(line.text.length * typingProgress)
  const typed = typingProgress >= 1
  const activeWords = new Set(
    (line.emphasis ?? [])
      .filter((emphasis) => typed && elapsed >= line.typingDuration + emphasis.delay)
      .flatMap((emphasis) => emphasis.words.map((word) => word.toLowerCase())),
  )
  const emphasisComplete = typed && (line.emphasis ?? []).every((emphasis) => elapsed >= line.typingDuration + emphasis.delay + 1)

  function begin() {
    playUiClick()
    assaultRef.current?.unlockImpactAudio()
    setSoundGate(true)
    const audio = audioRef.current
    if (audio) {
      audio.currentTime = 0
      audio.volume = 0
      audio.muted = muted
      void audio.play().catch(() => undefined)
      const fadeStartedAt = performance.now()
      const fadeIn = (time: number) => {
        const progress = Math.min(1, (time - fadeStartedAt) / 2000)
        audio.volume = .22 * progress
        if (progress < 1) requestAnimationFrame(fadeIn)
      }
      requestAnimationFrame(fadeIn)
    }
    soundGateTimer.current = window.setTimeout(() => {
      const time = performance.now()
      setSoundGate(false)
      setStarted(true)
      setStepStartedAt(time)
      setNow(time)
    }, 4100)
  }

  function goBack() {
    playUiClick()
    if (soundGate) {
      if (soundGateTimer.current !== null) window.clearTimeout(soundGateTimer.current)
      soundGateTimer.current = null
      audioRef.current?.pause()
      setSoundGate(false)
      return
    }
    if (finale) {
      setFinale(false)
      return
    }
    if (!started) {
      window.location.assign('/')
      return
    }
    if (step === 0) {
      audioRef.current?.pause()
      setStarted(false)
      setFinale(false)
      return
    }
    const time = performance.now()
    setStep((current) => current - 1)
    setStepStartedAt(time)
    setNow(time)
  }

  function toggleMute() {
    playUiClick()
    const nextMuted = !muted
    setMuted(nextMuted)
    localStorage.setItem('dark-forest-intro-muted', String(nextMuted))
    if (audioRef.current) audioRef.current.muted = nextMuted
  }

  function next() {
    playUiClick()
    if (step === script.length - 1) {
      setFinale(true)
      return
    }
    const time = performance.now()
    setStep((current) => current + 1)
    setStepStartedAt(time)
    setNow(time)
  }

  return (
    <main className="dark-forest-intro">
      <StarAssaultSequence ref={assaultRef} step={started ? step : -1} typingProgress={started ? typingProgress : 0} muted={muted} />
      <audio ref={audioRef} src="/audio/ambiant-cinematic-drone-main.mp3" preload="auto" loop />
      <button className="dark-forest-mute" type="button" onClick={toggleMute}>{muted ? 'UNMUTE' : 'MUTE'}</button>
      {started && !finale && <button className="dark-forest-next dark-forest-back" type="button" onClick={goBack}>&lt; BACK</button>}
      {!started && !soundGate ? (
        <section className="dark-forest-welcome">
          <h1>WELCOME TO DARK FOREST SURVIVAL</h1>
          <button className="dark-forest-next ready" type="button" onClick={begin}>START</button>
        </section>
      ) : soundGate ? (
        <section className="dark-forest-sound-gate" aria-live="polite">
          <span>TURN UP YOUR VOLUME</span>
          <i><b /></i>
        </section>
      ) : <>
        <section className={`dark-forest-crawl${finale ? ' disappearing' : ''}`} aria-live="polite">
          {script.slice(0, step + 1).map((previous, index) => {
            const isCurrent = index === step
            const age = step - index
            const count = isCurrent ? characterCount : previous.text.length
            return (
              <p key={previous.text} className={`dark-forest-line${isCurrent ? ' current' : ''}`} style={{ '--crawl-age': age } as React.CSSProperties}>
                <span className="crawl-measure" aria-hidden="true">{previous.text}</span>
                <span className="crawl-typed">
                  {renderText(previous, count, isCurrent ? activeWords : new Set())}
                  {isCurrent && !finale && <span className="type-cursor">|</span>}
                </span>
              </p>
            )
          })}
        </section>
        {!finale && <button className={`dark-forest-next dark-forest-next-bottom${emphasisComplete ? ' ready' : ''}`} type="button" onClick={next}>NEXT &gt;</button>}
      </>}
      <div className="dark-forest-progress" aria-label={started ? `Narrative progress: ${step + 1} of ${script.length}` : 'Narrative progress: not started'}>
        <i style={{ width: `${finale ? 100 : (started ? ((step + 1) / script.length) * 100 : 0)}%` }} />
      </div>
      <section className={`dark-forest-title${finale ? ' visible' : ''}`} aria-hidden={!finale}>
        <span>DARK FOREST</span>
        <button className="dark-forest-next ready" type="button" onClick={() => { playUiClick(); window.location.assign('/?stage=intro-login') }}>LOGIN</button>
        <button className="dark-forest-next dark-forest-final-back" type="button" onClick={goBack}>&lt; BACK</button>
      </section>
    </main>
  )
}
