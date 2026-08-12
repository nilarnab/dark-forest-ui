import { useEffect, useRef } from 'react'

type Point = { x: number; y: number; radius: number; alpha: number }
type NaturalObject = { x: number; y: number; twinkleOffset: number; twinkleRate: number }

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function drawSetupPreview(context: CanvasRenderingContext2D, anchor: NaturalObject, width: number, height: number, now: number, opacity: number, shipCount: number) {
  const starX = anchor.x * width
  const starY = anchor.y * height
  const activeShips = Math.max(0, Math.min(3, shipCount))
  for (let index = 0; index < Math.ceil(activeShips); index += 1) {
    const appearance = Math.min(1, Math.max(0, activeShips - index)) * opacity
    if (appearance <= 0) continue
    const orbitRadius = 64 + index * 42
    const angle = (index - 1) * 0.72 + now / 1000 * (0.16 - index * 0.016)
    const shipX = starX + Math.cos(angle) * orbitRadius
    const shipY = starY + Math.sin(angle) * orbitRadius
    const radarPulse = (Math.sin(now / 1000 * Math.PI * 1.1 + index) + 1) / 2
    context.save()
    context.globalAlpha *= appearance
    context.setLineDash([7, 7])
    context.beginPath()
    context.strokeStyle = 'rgba(100, 184, 235, .68)'
    context.lineWidth = 1
    context.arc(starX, starY, orbitRadius, 0, Math.PI * 2)
    context.stroke()
    context.setLineDash([])
    context.beginPath()
    context.fillStyle = `rgba(53, 229, 128, ${0.025 + radarPulse * 0.04})`
    context.strokeStyle = `rgba(77, 217, 135, ${0.24 + radarPulse * 0.22})`
    context.arc(shipX, shipY, Math.max(38, orbitRadius * 0.48), 0, Math.PI * 2)
    context.fill()
    context.stroke()
    context.translate(shipX, shipY)
    context.rotate(angle + Math.PI / 2)
    context.beginPath()
    context.moveTo(8, 0)
    context.lineTo(-6, -4.5)
    context.lineTo(-3.5, 0)
    context.lineTo(-6, 4.5)
    context.closePath()
    context.fillStyle = '#dceeff'
    context.shadowColor = '#79b8ff'
    context.shadowBlur = 9
    context.fill()
    context.restore()
  }
}

type IntroCameraMode = 'idle' | 'arcade-hover' | 'intro-login'

export function IntroGalaxyBackground({ cameraMode, shipVisible = true, setupPreview, creationRequested = false }: { cameraMode: IntroCameraMode; shipVisible?: boolean; setupPreview?: { starCount: number; shipCount: number }; creationRequested?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraModeRef = useRef<IntroCameraMode>(cameraMode)
  const shipVisibleRef = useRef(shipVisible)
  const setupPreviewRef = useRef(setupPreview)
  const creationRequestedRef = useRef(creationRequested)

  useEffect(() => { cameraModeRef.current = cameraMode }, [cameraMode])
  useEffect(() => { shipVisibleRef.current = shipVisible }, [shipVisible])
  useEffect(() => { setupPreviewRef.current = setupPreview }, [setupPreview])
  useEffect(() => { creationRequestedRef.current = creationRequested }, [creationRequested])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const random = seededRandom(2312)
    // Match the game renderer's deliberately deterministic background field:
    // many quiet stars placed over the grid, without gameplay objects.
    const stars: Point[] = Array.from({ length: 1400 }, () => ({
      // A field several viewports wide prevents the camera pan/zoom from
      // exposing an edge of the decorative universe.
      x: -1.5 + random() * 4,
      y: -1.5 + random() * 4,
      radius: 0.35 + random() * 1.35, alpha: 0.2 + random() * 0.7,
    }))
    // These are decorative equivalents of the larger selectable natural
    // objects in the game view—not the tiny background starfield dots.
    const naturalObjects: NaturalObject[] = Array.from({ length: 100 }, () => ({
      x: 0.08 + random() * 0.84,
      y: 0.08 + random() * 0.84,
      twinkleOffset: random() * Math.PI * 2,
      twinkleRate: 0.35 + random() * 0.65,
    }))
    const storyNaturals = naturalObjects.slice(0, 9)
    const leftmostNatural = storyNaturals.reduce((leftmost, object) => object.x < leftmost.x ? object : leftmost)
    const setupAnchor: NaturalObject = { x: 0.76, y: 0.5, twinkleOffset: 0, twinkleRate: 0.55 }
    const sequenceStartedAt = performance.now()
    let hoveredObject = -1
    let camera = { zoom: 1, rotation: 0, targetX: 0, targetY: 0, viewWidth: 1, viewHeight: 1 }
    let cameraProgress = 0
    let cameraTargetRequested = cameraModeRef.current !== 'idle'
    let cameraTransitionStartedAt = sequenceStartedAt
    let cameraTransitionInitialProgress = 0
    let shipFocusProgress = cameraModeRef.current === 'intro-login' ? 1 : 0
    let shipFocusRequested = cameraModeRef.current === 'intro-login'
    let shipFocusTransitionStartedAt = sequenceStartedAt
    let shipFocusInitialProgress = shipFocusProgress
    let shipOpacity = shipVisibleRef.current ? 1 : 0
    let shipTargetVisible = shipVisibleRef.current
    let shipVisibilityTransitionStartedAt = sequenceStartedAt
    let shipVisibilityInitial = shipOpacity
    let previewStarCount = 9
    let previewTargetCount = 9
    let previewCountStartedAt = sequenceStartedAt
    let previewCountInitial = 9
    let previewShipCount = 0
    let previewTargetShipCount = 0
    let previewShipCountStartedAt = sequenceStartedAt
    let previewShipCountInitial = 0
    let creationStartedAt: number | null = creationRequestedRef.current ? sequenceStartedAt : null

    const draw = (now = performance.now()) => {
      const bounds = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(bounds.width * pixelRatio))
      const height = Math.max(1, Math.round(bounds.height * pixelRatio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.globalAlpha = 1
      const viewWidth = bounds.width
      const viewHeight = bounds.height
      const sequenceElapsed = Math.max(0, (now - sequenceStartedAt) / 1000)
      if (creationRequestedRef.current && creationStartedAt === null) creationStartedAt = now
      if (!creationRequestedRef.current) creationStartedAt = null
      const creationProgress = creationStartedAt === null ? 0 : Math.min(1, Math.max(0, (now - creationStartedAt) / 1000))
      const setup = setupPreviewRef.current
      const desiredStarCount = setup ? Math.max(1, Math.min(100, Math.round(setup.starCount))) : 9
      const desiredShipCount = setup ? Math.max(0, Math.min(3, Math.round(setup.shipCount))) : 0
      if (desiredStarCount !== previewTargetCount) {
        previewTargetCount = desiredStarCount
        previewCountInitial = previewStarCount
        previewCountStartedAt = now
      }
      const previewCountTransition = Math.min(1, Math.max(0, (now - previewCountStartedAt) / 1000))
      previewStarCount = previewCountInitial + (previewTargetCount - previewCountInitial) * previewCountTransition
      if (desiredShipCount !== previewTargetShipCount) {
        previewTargetShipCount = desiredShipCount
        previewShipCountInitial = previewShipCount
        previewShipCountStartedAt = now
      }
      const previewShipCountTransition = Math.min(1, Math.max(0, (now - previewShipCountStartedAt) / 1000))
      previewShipCount = previewShipCountInitial + (previewTargetShipCount - previewShipCountInitial) * previewShipCountTransition
      if (shipVisibleRef.current !== shipTargetVisible) {
        shipTargetVisible = shipVisibleRef.current
        shipVisibilityInitial = shipOpacity
        shipVisibilityTransitionStartedAt = now
      }
      const visibilityTransition = Math.min(1, Math.max(0, (now - shipVisibilityTransitionStartedAt) / 1000))
      shipOpacity = shipVisibilityInitial + ((shipTargetVisible ? 1 : 0) - shipVisibilityInitial) * visibilityTransition
      context.clearRect(0, 0, viewWidth, viewHeight)
      context.fillStyle = '#000000'
      context.fillRect(0, 0, viewWidth, viewHeight)
      // First second: reveal the quiet universe itself from complete black.
      const universeAppearance = Math.min(1, sequenceElapsed)
      context.globalAlpha = universeAppearance
      context.fillStyle = '#02050a'
      context.fillRect(0, 0, viewWidth, viewHeight)

      // Arcade hover drives the camera. Each direction begins slowly and
      // accelerates over one second, including the return to the base view.
      const zoomRequested = cameraModeRef.current !== 'idle'
      if (zoomRequested !== cameraTargetRequested) {
        cameraTargetRequested = zoomRequested
        cameraTransitionInitialProgress = cameraProgress
        cameraTransitionStartedAt = now
      }
      const transitionProgress = Math.min(1, Math.max(0, (now - cameraTransitionStartedAt) / 1000))
      const easeIn = transitionProgress ** 3
      const targetProgress = cameraTargetRequested ? 1 : 0
      cameraProgress = cameraTransitionInitialProgress + (targetProgress - cameraTransitionInitialProgress) * easeIn
      const acceleratedProgress = cameraProgress
      const starX = leftmostNatural.x * viewWidth
      const starY = leftmostNatural.y * viewHeight
      const orbitRadius = Math.min(125, Math.max(72, Math.min(viewWidth, viewHeight) * 0.15))
      const shipAngle = -0.7 + Math.max(0, sequenceElapsed - 3) * 0.22
      const shipX = starX + Math.cos(shipAngle) * orbitRadius
      const shipY = starY + Math.sin(shipAngle) * orbitRadius
      // At the beginning the camera focus is the normal screen centre, which
      // produces the untouched initial map. During 5–6s it pans from there to
      // the star while zooming, so the star reaches the centre at the end.
      // Entering the login stage does not abruptly replace the focus point.
      // It eases from the star to the orbiting ship over one second, then
      // keeps tracking that ship for the rest of the login phase.
      const shouldFollowShip = cameraModeRef.current === 'intro-login'
      if (shouldFollowShip !== shipFocusRequested) {
        shipFocusRequested = shouldFollowShip
        shipFocusInitialProgress = shipFocusProgress
        shipFocusTransitionStartedAt = now
      }
      const shipFocusTransition = Math.min(1, Math.max(0, (now - shipFocusTransitionStartedAt) / 1000))
      shipFocusProgress = shipFocusInitialProgress + ((shipFocusRequested ? 1 : 0) - shipFocusInitialProgress) * shipFocusTransition ** 3
      const focusX = creationProgress > 0 && setup ? setupAnchor.x * viewWidth : starX + (shipX - starX) * shipFocusProgress
      const focusY = creationProgress > 0 && setup ? setupAnchor.y * viewHeight : starY + (shipY - starY) * shipFocusProgress
      const creationEaseIn = creationProgress ** 3
      const focusProgress = Math.max(acceleratedProgress, creationEaseIn)
      const targetX = viewWidth / 2 + (focusX - viewWidth / 2) * focusProgress
      const targetY = viewHeight / 2 + (focusY - viewHeight / 2) * focusProgress
      const zoom = 1 + acceleratedProgress * 1.55 + creationEaseIn * 1.25
      const rotation = acceleratedProgress * Math.PI / 2 + creationEaseIn * Math.PI / 2
      camera = { zoom, rotation, targetX, targetY, viewWidth, viewHeight }
      context.globalAlpha *= 1 - creationProgress
      context.save()
      context.translate(viewWidth / 2, viewHeight / 2)
      context.rotate(rotation)
      context.scale(zoom, zoom)
      context.translate(-targetX, -targetY)

      const grid = 100
      const worldLeft = -viewWidth * 2
      const worldRight = viewWidth * 3
      const worldTop = -viewHeight * 2
      const worldBottom = viewHeight * 3
      // Inverse scaling matches the in-game grid: zooming reveals more grid,
      // but never makes a grid line physically thicker.
      context.lineWidth = 1 / zoom
      context.strokeStyle = 'rgba(43, 111, 143, 0.2)'
      context.beginPath()
      for (let x = Math.floor(worldLeft / grid) * grid; x <= worldRight; x += grid) { context.moveTo(x, worldTop); context.lineTo(x, worldBottom) }
      for (let y = Math.floor(worldTop / grid) * grid; y <= worldBottom; y += grid) { context.moveTo(worldLeft, y); context.lineTo(worldRight, y) }
      context.stroke()
      context.beginPath()
      context.strokeStyle = 'rgba(71, 113, 143, 0.52)'
      context.moveTo(viewWidth / 2, worldTop); context.lineTo(viewWidth / 2, worldBottom)
      context.moveTo(worldLeft, viewHeight / 2); context.lineTo(worldRight, viewHeight / 2)
      context.stroke()

      for (const star of stars) {
        const x = star.x * viewWidth
        const y = star.y * viewHeight
        context.beginPath()
        context.fillStyle = `rgba(210, 233, 255, ${star.alpha})`
        // Keep distant background stars the same screen size during zoom.
        context.arc(x, y, star.radius / zoom, 0, Math.PI * 2)
        context.fill()
      }
      const naturalAppearance = Math.min(1, Math.max(0, (now - sequenceStartedAt - 1000) / 1000))
      const visibleNaturals = setup ? [setupAnchor, ...naturalObjects] : storyNaturals
      for (const [index, object] of visibleNaturals.entries()) {
        if (index >= Math.ceil(previewStarCount)) continue
        const x = object.x * viewWidth
        const y = object.y * viewHeight
        const twinkle = (Math.sin(now / 1000 * object.twinkleRate * Math.PI * 2 + object.twinkleOffset) + 1) / 2
        const countAppearance = Math.min(1, Math.max(0, previewStarCount - index))
        if (index === hoveredObject) {
          context.beginPath()
          context.strokeStyle = 'rgba(121, 184, 255, 0.92)'
          context.lineWidth = 1.5
          context.arc(x, y, 13, 0, Math.PI * 2)
          context.stroke()
        }
        context.beginPath()
        context.fillStyle = `rgba(242, 247, 255, ${(0.5 + twinkle * 0.5) * naturalAppearance * countAppearance})`
        context.shadowColor = '#79b8ff'
        context.shadowBlur = 5 + twinkle * 6
        context.arc(x, y, 4, 0, Math.PI * 2)
        context.fill()
        context.shadowBlur = 0
      }

      if (sequenceElapsed >= 3) {
        const appearance = Math.min(1, (sequenceElapsed - 3) / 1) * shipOpacity
        const starX = leftmostNatural.x * viewWidth
        const starY = leftmostNatural.y * viewHeight
        const angle = shipAngle
        const radarRadius = Math.min(96, orbitRadius * 0.82)
        const radarPulse = (Math.sin(sequenceElapsed * Math.PI * 1.2) + 1) / 2

        context.save()
        context.globalAlpha = appearance
        context.setLineDash([7, 7])
        context.beginPath()
        context.strokeStyle = 'rgba(100, 184, 235, .6)'
        context.lineWidth = 1
        context.arc(starX, starY, orbitRadius, 0, Math.PI * 2)
        context.stroke()
        context.setLineDash([])

        context.beginPath()
        context.fillStyle = `rgba(53, 229, 128, ${0.025 + radarPulse * 0.04})`
        context.strokeStyle = `rgba(77, 217, 135, ${0.25 + radarPulse * 0.25})`
        context.arc(shipX, shipY, radarRadius, 0, Math.PI * 2)
        context.fill()
        context.stroke()

        context.translate(shipX, shipY)
        context.rotate(angle + Math.PI / 2)
        context.beginPath()
        context.moveTo(8, 0)
        context.lineTo(-6, -4.5)
        context.lineTo(-3.5, 0)
        context.lineTo(-6, 4.5)
        context.closePath()
        context.fillStyle = '#dceeff'
        context.shadowColor = '#79b8ff'
        context.shadowBlur = 9
        context.fill()
        context.restore()
      }
      if (setup) drawSetupPreview(context, setupAnchor, viewWidth, viewHeight, now, universeAppearance, previewShipCount)
      context.restore()
      animationFrame = requestAnimationFrame(draw)
    }
    let animationFrame = requestAnimationFrame(draw)
    // The next animation frame redraws after a resize; do not start an extra
    // animation loop from the observer.
    const observer = new ResizeObserver(() => undefined)
    observer.observe(canvas)
    const objectAt = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect()
      const screenX = event.clientX - bounds.left
      const screenY = event.clientY - bounds.top
      const relativeX = screenX - camera.viewWidth / 2
      const relativeY = screenY - camera.viewHeight / 2
      const cos = Math.cos(camera.rotation)
      const sin = Math.sin(camera.rotation)
      const x = (cos * relativeX + sin * relativeY) / camera.zoom + camera.targetX
      const y = (-sin * relativeX + cos * relativeY) / camera.zoom + camera.targetY
      return naturalObjects.findIndex((object) => Math.hypot(x - object.x * bounds.width, y - object.y * bounds.height) <= 17 / camera.zoom)
    }
    const updateHover = (event: PointerEvent) => {
      const next = objectAt(event)
      if (next === hoveredObject) return
      hoveredObject = next
      canvas.style.cursor = next >= 0 ? 'pointer' : 'default'
    }
    const clearHover = () => {
      if (hoveredObject < 0) return
      hoveredObject = -1
      canvas.style.cursor = 'default'
    }
    // Intentionally inert: selecting a natural object on the intro does not
    // create game state or display a callout.
    const consumeObjectClick = (event: PointerEvent) => { if (objectAt(event) >= 0) event.preventDefault() }
    canvas.addEventListener('pointermove', updateHover)
    canvas.addEventListener('pointerleave', clearHover)
    canvas.addEventListener('pointerdown', consumeObjectClick)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(animationFrame)
      canvas.removeEventListener('pointermove', updateHover)
      canvas.removeEventListener('pointerleave', clearHover)
      canvas.removeEventListener('pointerdown', consumeObjectClick)
    }
  }, [])

  return <canvas ref={canvasRef} className="intro-galaxy-background" aria-hidden="true" />
}
