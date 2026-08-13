import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { STAR_DEATH_WAVE_DURATIONS, STAR_DEATH_WAVE_RADII, STAR_DEATH_WAVE_STARTS } from '../animations/starDeath'

export type StarAssaultSequenceProps = {
  /** The current narrative line and its live typing progress. */
  step: number
  typingProgress: number
  muted?: boolean
}

export type StarAssaultSequenceHandle = {
  /**
   * Mobile browsers only permit a new audio element to start from a real tap.
   * Prime this clip during START, then reset it for the timed impact later.
   */
  unlockImpactAudio: () => void
}

type Star = { x: number; y: number; appearAfter: number; radarDisappearAfter: number; shotDelay: number }

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function clamp(value: number) { return Math.min(1, Math.max(0, value)) }

/**
 * A deterministic, reusable star assault / destruction scene. Its inputs are
 * deliberately minimal today; a later game integration can supply positions
 * and object IDs while keeping the attack and death choreography intact.
 */
export const StarAssaultSequence = forwardRef<StarAssaultSequenceHandle, StarAssaultSequenceProps>(function StarAssaultSequence({ step, typingProgress, muted = false }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const impactAudioRef = useRef<HTMLAudioElement | null>(null)
  const storyRef = useRef({ step, typingProgress })
  const mutedRef = useRef(muted)
  useEffect(() => { storyRef.current = { step, typingProgress } }, [step, typingProgress])
  useEffect(() => { mutedRef.current = muted }, [muted])
  useEffect(() => {
    const audio = new Audio('/audio/impaktor-deep-2-low-end-cinematic-impact.mp3')
    audio.preload = 'auto'
    audio.volume = .78
    impactAudioRef.current = audio
    return () => { audio.pause(); impactAudioRef.current = null }
  }, [])

  useImperativeHandle(ref, () => ({
    unlockImpactAudio() {
      const impact = impactAudioRef.current
      if (!impact) return
      // Calling play() here happens synchronously inside the user's START
      // gesture. This grants later timed playback permission on iOS/Safari.
      const originalVolume = impact.volume
      impact.currentTime = 0
      impact.muted = false
      impact.volume = 0
      void impact.play().then(() => {
        impact.pause()
        impact.currentTime = 0
        impact.volume = originalVolume
      }).catch(() => {
        impact.volume = originalVolume
      })
    },
  }), [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const random = seededRandom(6441)
    const enemies: Star[] = Array.from({ length: 10 }, (_, index) => ({
      x: 0.08 + random() * 0.84,
      y: 0.1 + random() * 0.62,
      // Enemy stars enter independently during “So where is everybody?”
      // rather than arriving as a synchronized group.
      appearAfter: .04 + random() * .92,
      radarDisappearAfter: .04 + random() * .92,
      shotDelay: index * .08,
    }))
    let frame = 0
    let currentStep = -1
    let destructionStartedAt: number | null = null
    let impactStarted = false

    const circle = (x: number, y: number, radius: number, fill: string, stroke: string, lineWidth = 1) => {
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fillStyle = fill
      context.fill()
      context.lineWidth = lineWidth
      context.strokeStyle = stroke
      context.stroke()
    }

    const draw = (now: number) => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(bounds.width * ratio))
      const height = Math.max(1, Math.round(bounds.height * ratio))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const viewWidth = bounds.width
      const viewHeight = bounds.height
      context.clearRect(0, 0, viewWidth, viewHeight)
      context.fillStyle = '#02050a'
      context.fillRect(0, 0, viewWidth, viewHeight)

      context.strokeStyle = 'rgba(43, 111, 143, .22)'
      context.lineWidth = 1
      context.beginPath()
      for (let x = 0; x <= viewWidth; x += 100) { context.moveTo(x, 0); context.lineTo(x, viewHeight) }
      for (let y = 0; y <= viewHeight; y += 100) { context.moveTo(0, y); context.lineTo(viewWidth, y) }
      context.stroke()

      const { step: storyStep, typingProgress } = storyRef.current
      if (storyStep !== currentStep) {
        currentStep = storyStep
        destructionStartedAt = null
        impactStarted = false
      }
      // Every new visual beat starts halfway through its associated sentence
      // and completes exactly with the final typed character.
      const transition = clamp((typingProgress - .5) * 2)
      const targetX = viewWidth * .5
      const targetY = viewHeight * .68
      // Phase 0 is the first text line: only the grid. The scene starts
      // partway through the narrative, on “So where is everybody?”.
      const targetReveal = storyStep < 0 ? 0 : storyStep === 0 ? transition : 1
      if (storyStep === 4 && typingProgress >= 1 && destructionStartedAt === null) destructionStartedAt = now
      const destructionTime = destructionStartedAt === null ? 0 : (now - destructionStartedAt) / 1000
      // The final shockwave begins at 5.42s (collapse + its .42s stagger).
      // The selected impact peaks at 2s, so start it at 3.42s.
      if (destructionTime >= 3.42 && !impactStarted) {
        impactStarted = true
        const impact = impactAudioRef.current
        if (impact) {
          impact.currentTime = 0
          impact.muted = mutedRef.current
          void impact.play().catch(() => undefined)
        }
      }

      // Green target: it has the same larger, selectable-star treatment as the game.
      if (targetReveal > 0) {
        const targetDying = destructionTime > 0
        const radarFlicker = targetDying && destructionTime < 2
          ? (Math.sin(now / 1000 * 55) > -.25 ? 1 : .06) * (1 - destructionTime / 2)
          : targetDying ? 0 : 1
        if (radarFlicker > 0) circle(targetX, targetY, 92, `rgba(50, 231, 122, ${.075 * targetReveal * radarFlicker})`, `rgba(77, 217, 135, ${.38 * targetReveal * radarFlicker})`)

        let starRadius = 5
        let starColor = '#f4f8ff'
        if (destructionTime >= 2 && destructionTime < 5) {
          const growth = (destructionTime - 2) / 3
          starRadius = 5 * (1 + growth * 2)
          starColor = `rgb(255, ${Math.round(248 * (1 - growth))}, ${Math.round(255 * (1 - growth))})`
        } else if (destructionTime >= 5) {
          starRadius = 2.2
          starColor = '#ffffff'
        }
        context.save()
        context.globalAlpha = targetReveal
        context.fillStyle = starColor
        context.shadowColor = destructionTime >= 5 ? '#ffffff' : '#79b8ff'
        context.shadowBlur = destructionTime >= 5 ? 22 : 10
        context.beginPath(); context.arc(targetX, targetY, starRadius, 0, Math.PI * 2); context.fill()
        context.restore()
      }

      for (const enemy of enemies) {
        const x = enemy.x * viewWidth
        const y = enemy.y * viewHeight
        const enemyReveal = storyStep < 1 ? 0 : storyStep === 1
          ? clamp((transition - enemy.appearAfter) / (1 - enemy.appearAfter))
          : 1
        if (enemyReveal <= 0) continue
        const radarVisibility = storyStep < 2 ? 0 : storyStep === 2
          ? transition
          : storyStep === 3
            ? clamp(1 - ((transition - enemy.radarDisappearAfter) / (1 - enemy.radarDisappearAfter)))
            : 0
        if (radarVisibility > 0) circle(x, y, 66, `rgba(238, 70, 70, ${.045 * enemyReveal * radarVisibility})`, `rgba(255, 92, 92, ${.28 * enemyReveal * radarVisibility})`)
        context.save()
        context.globalAlpha = enemyReveal
        context.fillStyle = '#edf6ff'
        context.shadowColor = '#79b8ff'; context.shadowBlur = 8
        context.beginPath(); context.arc(x, y, 4.4, 0, Math.PI * 2); context.fill()
        context.restore()
      }

      // Ten incoming shots. Exactly the first nine reach the target; the tenth
      // vanishes when the fatal ninth impact triggers the death sequence.
      for (const [index, enemy] of enemies.entries()) {
        const progress = clamp((transition - enemy.shotDelay) / (1 - enemy.shotDelay))
        if (storyStep < 4 || progress <= 0 || destructionTime > 0 || (index === 9 && typingProgress >= 1)) continue
        const startX = enemy.x * viewWidth
        const startY = enemy.y * viewHeight
        const x = startX + (targetX - startX) * progress
        const y = startY + (targetY - startY) * progress
        context.save()
        context.fillStyle = '#ff9b9b'; context.shadowColor = '#ff4545'; context.shadowBlur = 9
        context.beginPath(); context.arc(x, y, 1.8, 0, Math.PI * 2); context.fill()
        context.restore()
      }

      // Four concentric blast waves after the target collapses to white.
      if (destructionTime >= 5) {
        const waveTime = destructionTime - 5
        for (let index = 0; index < 4; index += 1) {
          const progress = clamp((waveTime - STAR_DEATH_WAVE_STARTS[index]) / STAR_DEATH_WAVE_DURATIONS[index])
          if (progress <= 0 || progress >= 1) continue
          context.globalAlpha = 1 - progress
          const maxRadius = index === 3 ? Math.hypot(viewWidth, viewHeight) : STAR_DEATH_WAVE_RADII[index]
          context.beginPath(); context.arc(targetX, targetY, 4 + maxRadius * progress, 0, Math.PI * 2)
          context.lineWidth = index === 3 ? 1.6 : 1.2
          context.strokeStyle = '#ff5353'; context.stroke()
          context.globalAlpha = 1
        }
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  return <canvas ref={canvasRef} className="star-assault-sequence" aria-hidden="true" />
})
