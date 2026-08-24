import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { GalaxyRenderer } from '../pixi/GalaxyRenderer'
import { predictPositions } from '../pixi/prediction'
import type { RootState } from '../store'
import { selectObject } from '../store/universeSlice'
import { currentUniverseId } from '../firebase/listener'
import type { UniverseObject } from '../types/universe'
import { playGunFire, playUiClick } from '../audio/sfx'
import { cachedPlayerId } from '../session'

type TransientMessage = {
  id: number
  text: string
  tone: 'correction' | 'verification'
}

export function GalaxyView({ musicControl }: { musicControl?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const renderer = useRef<GalaxyRenderer | null>(null)
  const fireShotRef = useRef<((objectId: string, gunId: string, source: { x: number; y: number }, target: { x: number; y: number }) => Promise<void>) | null>(null)
  const rendererReady = useRef(false)
  const dispatch = useDispatch()
  const universe = useSelector((state: RootState) => state.universe.universe)
  const selectedObjectId = useSelector((state: RootState) => state.universe.selectedObjectId)
  // Firebase can deliver the first universe snapshot while Pixi is still
  // loading. Keep the current scene outside the initialization closure so
  // startup always paints the latest snapshot, rather than its initial null.
  const latestScene = useRef({ universe, selectedObjectId })
  latestScene.current = { universe, selectedObjectId }
  const [transferTargetId, setTransferTargetId] = useState<string | null>(null)
  const [transferRadius, setTransferRadius] = useState(100)
  const [transferStatus, setTransferStatus] = useState<string | null>(null)
  const [orbitTransferMode, setOrbitTransferMode] = useState(false)
  const [leftCollapsed, setLeftCollapsed] = useState(() => window.innerWidth < 640)
  const [rightCollapsed, setRightCollapsed] = useState(() => window.innerWidth < 640)
  const [aimingGunId, setAimingGunId] = useState<string | null>(null)
  const [localGunCooldowns, setLocalGunCooldowns] = useState<Record<string, number>>({})
  const localGunCooldownsRef = useRef<Record<string, number>>({})
  const [transientMessages, setTransientMessages] = useState<TransientMessage[]>([])
  const [clockPulse, setClockPulse] = useState(0)
  const [tutorialSaving, setTutorialSaving] = useState(false)
  const [tutorialRevealed, setTutorialRevealed] = useState(true)
  const [matchStatePending, setMatchStatePending] = useState(false)
  const [inviteStatus, setInviteStatus] = useState<string | null>(null)
  const [tutorialPointer, setTutorialPointer] = useState<{ left: number; top: number; width: number; height: number; shape: 'circle' | 'rectangle'; tone: 'green' | 'red' } | null>(null)
  const seenHitEvents = useRef(new Set<string>())
  const nextMessageId = useRef(0)
  const messageTimers = useRef(new Map<number, number>())
  const tutorialRequestInFlight = useRef(false)
  const tutorialIntermissionTimer = useRef<number | null>(null)
  const enemyContactRequested = useRef<string | null>(null)
  const combatStarRequested = useRef(false)
  const combatStartTimer = useRef<number | null>(null)
  const contactProgressFill = useRef<HTMLElement>(null)
  const objects = universe?.objects ?? {}
  const selectedObject = selectedObjectId ? objects[selectedObjectId] : undefined
  const transferTarget = transferTargetId ? objects[transferTargetId] : undefined
  const universeId = currentUniverseId()
  const currentUsername = cachedPlayerId()
  const levelOneCareer = universe?.career === true && universe.career_level === 1
  const regularMatch = Boolean(universe && universe.career !== true && typeof universe.creator_id === 'string')
  const isMatchCreator = regularMatch && universe?.creator_id === currentUsername
  const matchPaused = regularMatch && universe?.active !== true
  const tutorialStep = levelOneCareer
    ? Math.max(0, Math.min(6, universe.career_state?.tutorial_step ?? 0))
    : null
  const enemyContactStep = levelOneCareer && typeof universe?.career_state?.enemy_contact_tutorial_step === 'number'
    ? Math.max(0, Math.min(2, universe.career_state.enemy_contact_tutorial_step))
    : null
  const combatTutorialStep = levelOneCareer && typeof universe?.career_state?.combat_tutorial_step === 'number'
    ? Math.max(0, Math.min(7, universe.career_state.combat_tutorial_step)) : null
  const tutorialIntermission = universe?.career_state?.tutorial_intermission === true
  const tutorialIntermissionStartedAt = universe?.career_state?.tutorial_intermission_started_at_ms
  const initialTutorialActive = tutorialStep !== null && tutorialStep < 6 && !tutorialIntermission
  const enemyContactTutorialActive = enemyContactStep !== null && enemyContactStep < 2
  const combatTutorialActive = combatTutorialStep !== null && combatTutorialStep < 7 && combatTutorialStep !== 4
  const tutorialActive = initialTutorialActive || enemyContactTutorialActive || combatTutorialActive
  const playerCardRef = useRef<HTMLDivElement>(null)
  const agentCardRef = useRef<HTMLDivElement>(null)
  const actionPanelRef = useRef<HTMLDivElement>(null)
  const transferSendRef = useRef<HTMLButtonElement>(null)
  const assignedStarId = Object.entries(objects).find(([, object]) => object.owner === currentUsername && object.type === 'NATURAL')?.[0] ?? null
  const assignedShipId = Object.entries(objects).find(([, object]) => object.owner === currentUsername && object.type === 'ARTIFICIAL' && object.sub_type !== 'PROJECTILE')?.[0] ?? null
  // The shared clock advances analytically between authoritative action and
  // outcome writes; no once-per-second Firebase time updates are required.
  const currentTime = estimatedUniverseTime(universe, clockPulse)
  const enemyContactExpectedAt = universe?.career_state?.enemy_contact_expected_at
  const enemyContactProgressStartsAt = universe?.career_state?.enemy_contact_progress_starts_at
  const enemyContactProgress = levelOneCareer && tutorialStep === 6 && enemyContactStep === null &&
    typeof enemyContactExpectedAt === 'number' && typeof enemyContactProgressStartsAt === 'number' && enemyContactExpectedAt > enemyContactProgressStartsAt
    ? Math.max(0, Math.min(1, (currentTime - enemyContactProgressStartsAt) / (enemyContactExpectedAt - enemyContactProgressStartsAt)))
    : null
  const enemyContactProgressDuration = typeof enemyContactExpectedAt === 'number' && typeof enemyContactProgressStartsAt === 'number'
    ? enemyContactExpectedAt - enemyContactProgressStartsAt
    : null
  const detectedObjectIds = darkForestDetectedObjectIds(objects, currentUsername, currentTime, universe?.darkforest === true)
  const detectedEnemyShipId = Object.entries(objects).find(([id, object]) =>
    object.type === 'ARTIFICIAL' && object.sub_type !== 'PROJECTILE' &&
    typeof object.owner === 'string' && object.owner !== currentUsername && detectedObjectIds.has(id),
  )?.[0] ?? null
  const tutorialObjectId = combatTutorialActive
    ? combatTutorialStep === 0 ? assignedShipId : combatTutorialStep === 2 ? universe?.career_state?.enemy_contact_star_id ?? null : null
    : enemyContactTutorialActive
    ? enemyContactStep === 0 ? universe?.career_state?.enemy_contact_ship_id ?? detectedEnemyShipId : universe?.career_state?.enemy_contact_star_id ?? null
    : tutorialStep === 2 ? assignedStarId : tutorialStep === 3 ? assignedShipId : null
  const controlsSelectedObject = Boolean(currentUsername && selectedObject?.owner === currentUsername)
  const selectedDetected = Boolean(selectedObject && (
    universe?.darkforest !== true || selectedObject.owner === currentUsername || detectedObjectIds.has(selectedObjectId ?? '')
  ))
  const maneuverBlocked = typeof selectedObject?.maneuver_blocked_till === 'number' && selectedObject.maneuver_blocked_till > currentTime
  const guns = Object.entries(selectedObject?.objects ?? {}).filter(([, attached]) => attached.type === 'GUN')
  const activeGun = aimingGunId ? selectedObject?.objects?.[aimingGunId] : undefined
  const activeGunCooldown = typeof activeGun?.cooldown_seconds === 'number' ? activeGun.cooldown_seconds : 1
  const activeGunKey = aimingGunId && selectedObjectId ? `${selectedObjectId}:${aimingGunId}` : null
  const activeGunReadyAt = activeGunKey
    ? Math.max(
      typeof activeGun?.last_fired_at === 'number' ? activeGun.last_fired_at + activeGunCooldown : Number.NEGATIVE_INFINITY,
      localGunCooldowns[activeGunKey] ?? Number.NEGATIVE_INFINITY,
    )
    : Number.NEGATIVE_INFINITY
  const activeGunCooldownRemaining = Math.max(0, activeGunReadyAt - currentTime)
  const activeGunCooldownProgress = activeGunCooldown > 0 ? Math.max(0, Math.min(1, 1 - activeGunCooldownRemaining / activeGunCooldown)) : 1
  const players = [...new Set(Object.values(objects).map((object) => object.owner).filter((owner): owner is string => typeof owner === 'string'))]
  const participants = [...new Set([...(Object.keys(universe?.participants ?? {})), ...players])]
  const participantStates = new Map(participants.map((player) => [player, defeatState(player, objects)]))
  const localDefeat = currentUsername ? participantStates.get(currentUsername) : undefined
  const opponents = currentUsername ? participants.filter((player) => player !== currentUsername) : []
  const won = Boolean(currentUsername && !localDefeat?.defeated && opponents.length && opponents.every((player) => participantStates.get(player)?.defeated))
  const interaction = useRef({ objects, selectedObjectId, selectedObject, controlsSelectedObject, maneuverBlocked, currentTime, aimingGunId, orbitTransferMode, combatTutorialStep, assignedShipId, enemyStarId: universe?.career_state?.enemy_contact_star_id })
  interaction.current = { objects, selectedObjectId, selectedObject, controlsSelectedObject, maneuverBlocked, currentTime, aimingGunId, orbitTransferMode, combatTutorialStep, assignedShipId, enemyStarId: universe?.career_state?.enemy_contact_star_id }

  useEffect(() => {
    if (!host.current) return
    let mounted = true
    const galaxy = new GalaxyRenderer(
      host.current,
      (id) => {
        console.log('Object clicked:', id)
        playUiClick()
        const current = interaction.current
        const clicked = current.objects[id]
        if (current.combatTutorialStep === 0) {
          if (id === current.assignedShipId) {
            dispatch(selectObject(id))
            void runTutorialAction('combat_ship')
          }
          return
        }
        if (current.combatTutorialStep === 2) {
          if (id === current.enemyStarId && current.selectedObject?.type === 'ARTIFICIAL') {
            setTransferTargetId(id)
            setTransferRadius(suggestRadius(current.selectedObject, clicked, id))
            setTransferStatus(null)
            void runTutorialAction('combat_star')
          }
          return
        }
        if (current.controlsSelectedObject && current.aimingGunId && current.selectedObjectId && current.selectedObject && clicked) {
          const source = positionOf(current.selectedObject)
          const target = positionOf(clicked)
          if (source && target) void fireShotRef.current?.(current.selectedObjectId, current.aimingGunId, source, target)
          return
        }
        if (current.orbitTransferMode && current.controlsSelectedObject && current.selectedObject?.type === 'ARTIFICIAL' && clicked?.type === 'NATURAL' && id !== current.selectedObjectId) {
          if (current.maneuverBlocked) {
            setTransferStatus(`Maneuver blocked until t=${current.selectedObject.maneuver_blocked_till?.toFixed(1)}`)
            return
          }
          setTransferTargetId(id)
          setTransferRadius(suggestRadius(current.selectedObject, clicked, id))
          setTransferStatus(null)
          return
        }
        setTransferTargetId(null)
        setTransferStatus(null)
        setOrbitTransferMode(false)
        const clickedGun = clicked?.owner === currentUsername && clicked.type === 'ARTIFICIAL'
          ? Object.entries(clicked.objects ?? {}).find(([, attached]) => attached.type === 'GUN')?.[0] ?? null
          : null
        setAimingGunId(clickedGun)
        dispatch(selectObject(id))
      },
      (point) => {
        playUiClick()
        const current = interaction.current
        if (current.combatTutorialStep !== null && current.combatTutorialStep < 5) return
        if (current.controlsSelectedObject && current.aimingGunId && current.selectedObjectId && current.selectedObject) {
          const source = positionOf(current.selectedObject)
          if (source) void fireShotRef.current?.(current.selectedObjectId, current.aimingGunId, source, point)
          return
        }
        setTransferTargetId(null)
        setTransferStatus(null)
        setOrbitTransferMode(false)
        setAimingGunId(null)
        dispatch(selectObject(null))
      },
      (message) => {
        addTransientMessage(message, 'correction')
      },
      (projectileId, targetId, hitTime, clientDistance) => {
        void verifyPredictedHit(projectileId, targetId, hitTime, clientDistance)
      },
      (firstId, secondId, hitTime) => {
        void verifyObjectCollision(firstId, secondId, hitTime)
      },
    )
    renderer.current = galaxy
    void galaxy.initialize().then((ready) => {
      if (!ready || !mounted) return
      rendererReady.current = true
      const scene = latestScene.current
      galaxy.render(scene.universe, scene.selectedObjectId)
    })
    return () => {
      mounted = false
      rendererReady.current = false
      messageTimers.current.forEach((timer) => window.clearTimeout(timer))
      messageTimers.current.clear()
      galaxy.destroy()
    }
  }, [dispatch])

  useEffect(() => {
    if (rendererReady.current) renderer.current?.render(universe, selectedObjectId)
  }, [universe, selectedObjectId])
  useEffect(() => { renderer.current?.setOwnerUsername(currentUsername) }, [currentUsername])
  useEffect(() => {
    setTransferTargetId(null)
    setOrbitTransferMode(false)
    const firstGun = Object.entries(selectedObject?.objects ?? {}).find(([, attached]) => attached.type === 'GUN')?.[0]
    setAimingGunId(controlsSelectedObject && selectedObject?.type === 'ARTIFICIAL' ? firstGun ?? null : null)
  }, [selectedObjectId])
  useEffect(() => {
    if (universe?.active !== true) return
    const timer = window.setInterval(() => setClockPulse((value) => value + 1), 250)
    return () => window.clearInterval(timer)
  }, [universe?.active])

  useEffect(() => {
    const delay = 0
    setTutorialRevealed(delay === 0)
    if (delay === 0) return
    const timer = window.setTimeout(() => setTutorialRevealed(true), delay)
    return () => window.clearTimeout(timer)
  }, [tutorialStep, enemyContactStep, combatTutorialStep])

  useEffect(() => {
    if (!levelOneCareer || tutorialStep !== 6 || enemyContactStep !== null || !detectedEnemyShipId) return
    const requestKey = `${universeId}:${detectedEnemyShipId}`
    if (enemyContactRequested.current === requestKey) return
    enemyContactRequested.current = requestKey
    void runTutorialAction('enemy_contact', detectedEnemyShipId)
  }, [levelOneCareer, tutorialStep, enemyContactStep, detectedEnemyShipId, universeId])
  useEffect(() => {
    const enemyStarId = universe?.career_state?.enemy_contact_star_id
    if (combatTutorialStep !== 2 || !enemyStarId || !detectedObjectIds.has(enemyStarId) || combatStarRequested.current) return
    combatStarRequested.current = true
    void runTutorialAction('combat_star')
  }, [combatTutorialStep, detectedObjectIds, universe?.career_state?.enemy_contact_star_id])
  useEffect(() => {
    const enemyStarId = universe?.career_state?.enemy_contact_star_id
    if (combatTutorialStep !== 4 || !enemyStarId || !detectedObjectIds.has(enemyStarId)) return
    void runTutorialAction('combat_radar_locked')
  }, [combatTutorialStep, detectedObjectIds, universe?.career_state?.enemy_contact_star_id])
  useEffect(() => {
    if (tutorialStep !== 6 || enemyContactStep !== 2 || combatTutorialStep !== null) return
    combatStartTimer.current = window.setTimeout(() => {
      combatStartTimer.current = null
      void runTutorialAction('begin_combat')
    }, 2000)
    return () => {
      if (combatStartTimer.current !== null) window.clearTimeout(combatStartTimer.current)
      combatStartTimer.current = null
    }
  }, [tutorialStep, enemyContactStep, combatTutorialStep])

  useLayoutEffect(() => {
    const playerCardTutorial = initialTutorialActive && tutorialStep === 1
    const actionPanelTutorial = combatTutorialActive && combatTutorialStep === 1
    const transferSendTutorial = combatTutorialActive && combatTutorialStep === 3
    const agentStatusTutorial = combatTutorialActive && combatTutorialStep === 5
    if (!tutorialActive || !tutorialRevealed || (!tutorialObjectId && !playerCardTutorial && !actionPanelTutorial && !transferSendTutorial && !agentStatusTutorial)) {
      setTutorialPointer(null)
      return
    }
    let frame = 0
    const updatePointer = () => {
      const bounds = playerCardTutorial
        ? playerCardRef.current?.getBoundingClientRect()
        : actionPanelTutorial
          ? actionPanelRef.current?.getBoundingClientRect()
        : transferSendTutorial
          ? transferSendRef.current?.getBoundingClientRect()
        : agentStatusTutorial
          ? agentCardRef.current?.getBoundingClientRect()
        : tutorialObjectId ? renderer.current?.getObjectTutorialBounds(tutorialObjectId) : null
      setTutorialPointer(bounds ? {
        left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
        shape: playerCardTutorial || actionPanelTutorial || transferSendTutorial || agentStatusTutorial ? 'rectangle' : 'circle',
        tone: enemyContactTutorialActive ? 'red' : 'green',
      } : null)
      frame = window.requestAnimationFrame(updatePointer)
    }
    updatePointer()
    return () => window.cancelAnimationFrame(frame)
  }, [tutorialActive, initialTutorialActive, enemyContactTutorialActive, combatTutorialActive, combatTutorialStep, tutorialStep, tutorialRevealed, tutorialObjectId, currentUsername, participants.length])

  useEffect(() => {
    // Reset the legacy muted effect, then give own radar fields a dedicated
    // brighter green pulse during their tutorial explanation.
    renderer.current?.setTutorialRadarMuted(false)
    renderer.current?.setTutorialRadarHighlighted(initialTutorialActive && tutorialRevealed && tutorialStep === 4)
  }, [initialTutorialActive, tutorialRevealed, tutorialStep])

  useEffect(() => {
    if (!tutorialIntermission) return
    // The final observation beat is intentionally shorter: let the player
    // watch the restored radar field for two seconds before prompting them.
    const intermissionDuration = tutorialStep === 5 ? 2000 : 3000
    const elapsed = typeof tutorialIntermissionStartedAt === 'number' ? Math.max(0, Date.now() - tutorialIntermissionStartedAt) : intermissionDuration
    const remaining = Math.max(0, intermissionDuration - elapsed)
    tutorialIntermissionTimer.current = window.setTimeout(() => {
      tutorialIntermissionTimer.current = null
      void runTutorialAction('auto_pause')
    }, remaining)
    return () => {
      if (tutorialIntermissionTimer.current !== null) window.clearTimeout(tutorialIntermissionTimer.current)
      tutorialIntermissionTimer.current = null
    }
  }, [tutorialIntermission, tutorialIntermissionStartedAt, tutorialStep])

  useEffect(() => {
    if (!tutorialActive || universe?.active !== true) return
    void runTutorialAction('ensure_paused')
  }, [tutorialActive, universe?.active])
  useEffect(() => {
    if (!tutorialActive) return
    renderer.current?.restoreTutorialCamera()
  }, [tutorialActive, tutorialStep, enemyContactStep])
  useEffect(() => {
    if (enemyContactProgress === null || !contactProgressFill.current || typeof enemyContactProgressStartsAt !== 'number' || !enemyContactProgressDuration || enemyContactProgressDuration <= 0) return
    let frame = 0
    const update = () => {
      const simulationTime = estimatedUniverseTime(universe, 0)
      const progress = Math.max(0, Math.min(1, (simulationTime - enemyContactProgressStartsAt) / enemyContactProgressDuration))
      if (contactProgressFill.current) contactProgressFill.current.style.transform = `scaleX(${progress})`
      frame = window.requestAnimationFrame(update)
    }
    update()
    return () => window.cancelAnimationFrame(frame)
  }, [enemyContactProgress, enemyContactProgressDuration, enemyContactProgressStartsAt, universe])
  useEffect(() => {
    const newHits = Object.entries(universe?.events ?? {})
      .filter(([id, event]) => event?.type === 'PROJECTILE_HIT' && !seenHitEvents.current.has(id))
      .sort(([, first], [, second]) => (first.hit_time ?? 0) - (second.hit_time ?? 0))
    for (const [id] of newHits) seenHitEvents.current.add(id)
    for (const [, event] of newHits) {
      if (event.projectile_id) renderer.current?.confirmProjectileHit(event.projectile_id)
      if (event.target_id) renderer.current?.flashHit(event.target_id, 0xff5d5d)
    }
  }, [universe?.events])
  useEffect(() => {
    const enabled = orbitTransferMode && !maneuverBlocked && selectedObject?.type === 'ARTIFICIAL' && transferTarget?.type === 'NATURAL'
    renderer.current?.setTransferPreview(
      enabled ? transferTargetId : null,
      transferRadius,
      (radius) => setTransferRadius(distinctTransferRadius(radius, selectedObject, transferTargetId)),
    )
  }, [maneuverBlocked, orbitTransferMode, selectedObject, selectedObject?.type, transferRadius, transferTarget?.type, transferTargetId])
  useEffect(() => {
    const range = typeof activeGun?.range === 'number' ? activeGun.range : Number(import.meta.env.VITE_PROJECTILE_RANGE ?? 400)
    renderer.current?.setAimPreview(aimingGunId && selectedObjectId ? selectedObjectId : null, Number.isFinite(range) && range > 0 ? range : 400)
  }, [activeGun?.range, aimingGunId, selectedObjectId])

  async function sendTransfer() {
    if (!selectedObjectId || !transferTargetId || maneuverBlocked) return
    playUiClick()
    setTransferStatus('Sending maneuver…')
    try {
      const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
      const response = await fetch(`${apiUrl}/universes/${encodeURIComponent(universeId)}/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectid1: selectedObjectId, objectid2: transferTargetId, radnew: transferRadius }),
      })
      const body = await response.json() as { ok?: boolean; error?: string; t2?: number }
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Transfer request failed.')
      setTransferStatus(`Maneuver scheduled · arrival t=${body.t2?.toFixed(1) ?? '?'}`)
      setTransferTargetId(null)
      setOrbitTransferMode(false)
      if (combatTutorialStep === 3) void runTutorialAction('combat_transfer_sent')
      setAimingGunId(guns[0]?.[0] ?? null)
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : 'Transfer request failed.')
    }
  }

  async function fireShot(objectId: string, gunId: string, source: { x: number; y: number }, target: { x: number; y: number }) {
    const shotStart = renderer.current?.getObjectPosition(objectId) ?? source
    const rotation = Math.atan2(target.y - shotStart.y, target.x - shotStart.x) * 180 / Math.PI
    const clientFiredAt = renderer.current?.getSimulationTime() ?? 0
    // GalaxyRenderer's map callback is created once; use the ref-backed
    // current selection rather than the callback's initial React closure.
    const gun = interaction.current.selectedObject?.objects?.[gunId]
    const speed = typeof gun?.velocity === 'number' ? gun.velocity : 0
    const hitRadius = typeof gun?.hit_radius === 'number' ? gun.hit_radius : 0
    const range = typeof gun?.range === 'number' ? gun.range : Number(import.meta.env.VITE_PROJECTILE_RANGE ?? 400)
    const cooldownSeconds = typeof gun?.cooldown_seconds === 'number' ? gun.cooldown_seconds : 1
    const cooldownKey = `${objectId}:${gunId}`
    const readyAt = Math.max(
      typeof gun?.last_fired_at === 'number' ? gun.last_fired_at + cooldownSeconds : Number.NEGATIVE_INFINITY,
      localGunCooldownsRef.current[cooldownKey] ?? Number.NEGATIVE_INFINITY,
    )
    if (clientFiredAt < readyAt) return
    localGunCooldownsRef.current = { ...localGunCooldownsRef.current, [cooldownKey]: clientFiredAt + cooldownSeconds }
    setLocalGunCooldowns(localGunCooldownsRef.current)
    const localProjectileId = `local-projectile-${Date.now()}-${Math.random().toString(36).slice(2)}`
    renderer.current?.launchLocalProjectile(
      localProjectileId,
      objectId,
      shotStart,
      rotation,
      speed,
      hitRadius,
      clientFiredAt,
      Number.isFinite(range) && range > 0 ? range : 400,
    )
    playGunFire()
    setTransferStatus('Firing…')
    try {
      const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
      const response = await fetch(`${apiUrl}/universes/${encodeURIComponent(universeId)}/shots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectid: objectId,
          gun_id: gunId,
          rotation,
          client_fired_at: clientFiredAt,
          client_shot_id: localProjectileId,
        }),
      })
      const body = await response.json() as { ok?: boolean; error?: string; projectile_id?: string; fired_at?: number }
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Shot request failed.')
      if (body.projectile_id && typeof body.fired_at === 'number') {
        const firedAt = body.fired_at
        renderer.current?.promoteLocalProjectile(localProjectileId, body.projectile_id, firedAt)
        localGunCooldownsRef.current = { ...localGunCooldownsRef.current, [cooldownKey]: firedAt + cooldownSeconds }
        setLocalGunCooldowns(localGunCooldownsRef.current)
      }
      setTransferStatus('Shot fired.')
    } catch (error) {
      renderer.current?.discardLocalProjectile(localProjectileId)
      const nextCooldowns = { ...localGunCooldownsRef.current }
      delete nextCooldowns[cooldownKey]
      localGunCooldownsRef.current = nextCooldowns
      setLocalGunCooldowns(nextCooldowns)
      setTransferStatus(error instanceof Error ? error.message : 'Shot request failed.')
    }
  }
  // The renderer is initialized once, so its pointer callbacks must call the
  // current render's firing function rather than retaining an old closure.
  fireShotRef.current = fireShot

  async function runTutorialAction(action: 'next' | 'back' | 'auto_pause' | 'ensure_paused' | 'enemy_contact' | 'contact_next' | 'contact_back' | 'begin_combat' | 'combat_ship' | 'combat_orbit' | 'combat_star' | 'combat_transfer_sent' | 'combat_radar_locked' | 'combat_status_next' | 'combat_finish', objectId?: string) {
    if (!universeId || tutorialRequestInFlight.current) return
    tutorialRequestInFlight.current = true
    setTutorialSaving(true)
    if (action === 'next' || action === 'back') playUiClick()
    const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
    try {
      const response = await fetch(`${apiUrl}/universes/${encodeURIComponent(universeId)}/tutorial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, object_id: objectId }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error ?? `Tutorial request failed (${response.status}).`)
    } catch (error) {
      addTransientMessage(error instanceof Error ? error.message : 'Could not save tutorial progress.', 'correction')
    } finally {
      tutorialRequestInFlight.current = false
      setTutorialSaving(false)
    }
  }

  function addTransientMessage(text: string, tone: TransientMessage['tone']) {
    const id = nextMessageId.current++
    setTransientMessages((messages) => [...messages, { id, text, tone }])
    const timer = window.setTimeout(() => {
      messageTimers.current.delete(id)
      setTransientMessages((messages) => messages.filter((message) => message.id !== id))
    }, 4000)
    messageTimers.current.set(id, timer)
  }

  async function verifyPredictedHit(projectileId: string, targetId: string, hitTime: number, clientDistance: number) {
    // The client is authoritative for a predicted projectile contact. Commit
    // its visual result immediately; Flask only persists the reported hit.
    renderer.current?.resolveHitVerification(projectileId, 'confirmed')
    try {
      const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
      await fetch(`${apiUrl}/universes/${encodeURIComponent(universeId)}/projectiles/${encodeURIComponent(projectileId)}/verify-hit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: targetId, hit_time: hitTime, client_distance: clientDistance }),
      })
    } catch {
      // The next Firebase update remains authoritative for persistent state;
      // never roll back the player's immediate confirmed-hit feedback.
    }
  }

  async function verifyObjectCollision(firstId: string, secondId: string, hitTime: number) {
    try {
      const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
      const response = await fetch(`${apiUrl}/universes/${encodeURIComponent(universeId)}/collisions/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object_id_1: firstId, object_id_2: secondId, hit_time: hitTime }),
      })
      const body = await response.json() as { ok?: boolean; status?: 'confirmed' | 'rejected'; reason?: string }
      if (response.ok && body.ok && body.status === 'confirmed') {
        renderer.current?.flashHit(firstId, 0xff5d5d)
        renderer.current?.flashHit(secondId, 0xff5d5d)
      } else if (body.reason) {
        addTransientMessage(`COLLISION REJECTED · ${body.reason}`, 'correction')
      }
    } catch {
      addTransientMessage('COLLISION VERIFICATION · RETRYING', 'verification')
    }
  }

  const tutorialMapColorVisible = (initialTutorialActive && tutorialStep === 4) || (enemyContactTutorialActive && enemyContactStep === 1) || (combatTutorialActive && (combatTutorialStep ?? 0) >= 1)

  async function setMatchActive(active: boolean) {
    if (!isMatchCreator || matchStatePending) return
    playUiClick()
    setMatchStatePending(true)
    try {
      const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
      const response = await fetch(`${apiUrl}/universes/${encodeURIComponent(universeId)}/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUsername, active }),
      })
      const body = await response.json() as { ok?: boolean; error?: string }
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not update match state.')
    } catch (error) {
      setInviteStatus(error instanceof Error ? error.message : 'MATCH STATE UPDATE FAILED')
    } finally {
      setMatchStatePending(false)
    }
  }

  async function copyInviteLink() {
    const inviteLink = `${window.location.origin}/invite/universe/${encodeURIComponent(universeId)}`
    try {
      await navigator.clipboard.writeText(inviteLink)
      playUiClick()
      setInviteStatus('INVITE LINK COPIED')
    } catch {
      setInviteStatus(`COPY THIS LINK · ${inviteLink}`)
    }
  }

  return (
    <div className={`galaxy-shell${tutorialActive ? ' tutorial-active' : ''}${combatTutorialActive ? ' combat-tutorial' : ''}${combatTutorialStep === 2 ? ' combat-target-lock' : ''}${tutorialMapColorVisible ? ' tutorial-map-color-visible' : ''}${matchPaused ? ' match-paused' : ''}`}>
      <div ref={host} className="galaxy-view" aria-label="Galaxy map" />
      {aimingGunId && <button type="button" className="aim-cancel-overlay" onClick={() => { playUiClick(); setAimingGunId(null) }}>
        <b>×</b><span>CANCEL AIMING MODE</span>
      </button>}
      {orbitTransferMode && !transferTargetId && !maneuverBlocked && <div className="transfer-choice-overlay" role="status">
        CHOOSE ANY STAR YOU WANT TO TRANSFER ORBIT TO
      </div>}
      <aside className={`game-sidebar game-sidebar-left${leftCollapsed ? ' collapsed' : ''}`}>
        <button className="sidebar-collapse" onClick={() => setLeftCollapsed((value) => !value)}>{leftCollapsed ? '›' : '‹'}</button>
        <span className="sidebar-title">UNIVERSE ID · {universeId}</span>
        {regularMatch && <section className="match-control">
          <span className="sidebar-title">MATCH STATE</span>
          {isMatchCreator ? <button type="button" className={matchPaused ? 'match-start glowing' : 'match-pause'} disabled={matchStatePending} onClick={() => void setMatchActive(matchPaused)}>
            {matchStatePending ? 'SYNCING…' : matchPaused ? 'START MATCH' : 'PAUSE MATCH'}
          </button> : <output>{matchPaused ? 'PAUSED · WAITING FOR HOST' : 'MATCH ACTIVE'}</output>}
        </section>}
        {regularMatch && isMatchCreator && <section className="match-control invite-control">
          <span className="sidebar-title">INVITE LINK</span>
          <button type="button" onClick={() => void copyInviteLink()}>COPY INVITE LINK</button>
          {inviteStatus && <small>{inviteStatus}</small>}
        </section>}
        <span className="sidebar-title">PLAYERS</span>
        {participants.map((player) => {
          const owned = Object.entries(objects).filter(([, object]) => object.owner === player)
          const hasRadarContact = player === currentUsername || universe?.darkforest !== true || owned.some(([id]) => detectedObjectIds.has(id))
          const knownOwned = hasRadarContact ? owned.filter(([id]) => detectedObjectIds.has(id) || player === currentUsername || universe?.darkforest !== true) : []
          const stars = knownOwned.filter(([, object]) => object.type === 'NATURAL')
          // Ship silhouettes are strategic information in Dark Forest. Keep
          // their count visible even before a radar scan; only their health
          // and the opponent's stars require a signal lock.
          const ships = owned.filter(([, object]) => object.type === 'ARTIFICIAL' && object.sub_type !== 'PROJECTILE')
          const agentOnline = universe?.participants?.[player]?.type === 'AGENT' || player === 'agent_level_1'
          const state = participantStates.get(player) ?? { defeated: false, reasons: [] }
          const defeated = state.defeated && hasRadarContact
          return <div ref={player === currentUsername ? playerCardRef : player === 'agent_level_1' ? agentCardRef : undefined} key={player} className={`player-card${player === currentUsername || agentOnline ? ' online' : ' offline'}${defeated ? ' defeated' : ''}`}>
            <strong>{player} <small>{defeated ? 'DEFEATED' : player === currentUsername || agentOnline ? 'ONLINE' : 'OFFLINE'}</small></strong>
            {hasRadarContact ? <>
              {stars.map(([id, star]) => <StatusBar key={id} label={`STAR ${id.slice(-4)}`} value={lifePercent(star)} />)}
              <ShipCount ships={ships} />
            </> : <>
              <small>RADAR SIGNAL REQUIRED</small>
              <ShipCount ships={ships} />
            </>}
          </div>
        })}
        <div className="sidebar-music">{musicControl}</div>
      </aside>
      {localDefeat?.defeated && <TerminalOverlay tone="lost" reason={localDefeat.reasons.join(' · ')} />}
      {won && <TerminalOverlay tone="won" reason="ALL OTHER PLAYERS ARE DEFEATED." />}
      {enemyContactProgress !== null && <div className="enemy-contact-progress" aria-label="Incoming radar contact"><i ref={contactProgressFill} style={{ transform: `scaleX(${enemyContactProgress})` }} /></div>}
      <aside className={`game-sidebar game-sidebar-right${rightCollapsed ? ' collapsed' : ''}`}>
        <button className="sidebar-collapse" onClick={() => setRightCollapsed((value) => !value)}>{rightCollapsed ? '‹' : '›'}</button>
        <span className="sidebar-title">COMMAND CENTER</span>
        {selectedObjectId && selectedObject && <div className={`selected-status ${selectedObject.owner ? selectedObject.owner === currentUsername ? 'owned' : 'hostile' : 'neutral'}`}>
          {selectedDetected ? <>
            <strong>{shortId(selectedObjectId)}</strong><span>TYPE · {selectedObject.type ?? 'UNKNOWN'}</span><span>SUBTYPE · {selectedObject.sub_type ?? 'UNKNOWN'}</span>
            <StatusBar label="LIFE" value={lifePercent(selectedObject)} />
          </> : <>
            <strong>UNKNOWN STAR</strong><span>RADAR CONTACT REQUIRED</span>
          </>}
        </div>}
      <div className="zoom-controls" aria-label="Map zoom controls">
        <button type="button" aria-label="Zoom in" onClick={(event) => { playUiClick(); renderer.current?.zoomBy(1.2, { x: event.clientX, y: event.clientY }) }}>+</button>
        <button type="button" aria-label="Zoom out" onClick={(event) => { playUiClick(); renderer.current?.zoomBy(1 / 1.2, { x: event.clientX, y: event.clientY }) }}>−</button>
      </div>
      <div className="transient-messages" aria-live="polite">
        {transientMessages.map((message) => (
          <aside key={message.id} className={`transient-message ${message.tone}`} role="status">{message.text}</aside>
        ))}
      </div>
      {controlsSelectedObject && selectedObject?.type === 'ARTIFICIAL' && (
        <div ref={actionPanelRef} className="transfer-panel">
          {guns.length > 0 && (
            <div className="gun-actions">
              <span className="transfer-title">GUNS</span>
              {aimingGunId ? (
                <>
                  <span className="aiming-status">AIMING · click any map point</span>
                  {activeGunCooldownRemaining > 0 && <div className="gun-cooldown" aria-label={`Gun ready in ${activeGunCooldownRemaining.toFixed(1)} seconds`}><i style={{ transform: `scaleX(${activeGunCooldownProgress})` }} /><span>RECHARGING</span></div>}
                  <button type="button" onClick={() => { playUiClick(); setAimingGunId(null) }}>CANCEL AIM</button>
                </>
              ) : guns.map(([gunId, gun]) => (
                <button key={gunId} type="button" onClick={() => { playUiClick(); setOrbitTransferMode(false); setTransferTargetId(null); setAimingGunId(gunId); setTransferStatus(null) }}>
                  AIM {gunId}{typeof gun.velocity === 'number' ? ` · ${gun.velocity}` : ''}
                </button>
              ))}
            </div>
          )}
          <div className="gun-actions">
            <span className="transfer-title">ORBIT</span>
            {!orbitTransferMode ? (
              <button type="button" disabled={maneuverBlocked} onClick={() => { playUiClick(); if (combatTutorialStep === 1) { setAimingGunId(null); setOrbitTransferMode(true); setTransferStatus(null); void runTutorialAction('combat_orbit'); return }; setAimingGunId(null); setOrbitTransferMode(true); setTransferStatus(null) }}>
                ORBIT TRANSFER
              </button>
            ) : (
              <>
                <button type="button" onClick={() => { playUiClick(); setOrbitTransferMode(false); setTransferTargetId(null); setTransferStatus(null) }}>CANCEL TRANSFER</button>
                {maneuverBlocked ? (
                  <span className="transfer-blocked">MANEUVER BLOCKED UNTIL t={selectedObject.maneuver_blocked_till?.toFixed(1)}</span>
                ) : !transferTarget ? (
                  <span>Select a NATURAL object as destination.</span>
                ) : (
                  <>
                    <label>ORBIT RADIUS <output>{Math.round(transferRadius)}</output></label>
                    <span className="transfer-hint">Drag the green dotted orbit on the map.</span>
                    <button ref={transferSendRef} className="transfer-send" type="button" onClick={() => void sendTransfer()}>SEND TRANSFER</button>
                  </>
                )}
              </>
            )}
          </div>
          {transferStatus && <small>{transferStatus}</small>}
        </div>
      )}
      <section className="owned-objects-panel">
        <span className="sidebar-title">MY OBJECTS</span>
        {Object.entries(objects)
          .filter(([, object]) => object.owner === currentUsername && object.sub_type !== 'PROJECTILE')
          .map(([id, object]) => (
            <button className="object-status" key={id} onClick={() => dispatch(selectObject(id))}>
              <span>{object.type === 'NATURAL' ? 'STAR' : 'SHIP'} · {shortId(id)}</span>
              <StatusBar label={(object.life ?? 1) <= 0 ? 'DESTROYED' : 'LIFE'} value={lifePercent(object)} />
            </button>
          ))}
      </section>
      </aside>
      {tutorialPointer && <TutorialPointer pointer={tutorialPointer} />}
      {initialTutorialActive && tutorialStep !== null && <TutorialGuide
          step={tutorialStep}
          revealed={tutorialRevealed}
          saving={tutorialSaving}
          onBack={() => void runTutorialAction('back')}
          onNext={() => void runTutorialAction('next')}
        />}
      {enemyContactTutorialActive && enemyContactStep !== null && <EnemyContactGuide
          step={enemyContactStep}
          saving={tutorialSaving}
          onBack={() => void runTutorialAction('contact_back')}
          onNext={() => void runTutorialAction('contact_next')}
        />}
      {combatTutorialActive && combatTutorialStep !== null && <CombatTutorialGuide
        step={combatTutorialStep} saving={tutorialSaving}
        onNext={() => void runTutorialAction(combatTutorialStep === 5 ? 'combat_status_next' : 'combat_finish')}
      />}
    </div>
  )
}

function CombatTutorialGuide({ step, saving, onNext }: { step: number; saving: boolean; onNext: () => void }) {
  const message = [
    'CLICK YOUR SHIP TO COMMAND ITS MOVEMENTS AND WEAPONS.',
    'HERE YOU CAN SHOOT BY DEFAULT OR ENTER ORBIT TRANSFER MODE. LET’S CHECK OUR SUSPECT STAR. CLICK ORBIT TRANSFER.',
    'NOW CLICK THE STAR YOU WANT TO VISIT. IT CAN BE YOUR OWN STAR FOR A DIFFERENT ORBIT — BUT FOR NOW, VISIT THE ENEMY STAR.',
    'CLICK SEND TRANSFER TO INITIATE THE MANEUVER.',
    '',
    'YOU GOT IT! IT IS THE ENEMY STAR. WE CAN SEE ITS STATUS.',
    'OH NO, THEY ARE SHOOTING AT OUR STAR. A SHIP IS LESS RESILIENT THAN A STAR — SHOOT IT DOWN. YOU GOT THIS. BEST OF LUCK.',
  ][step] ?? ''
  const button = step === 5 ? 'NEXT ›' : 'FINISH ›'
  return <section className="tutorial-guide" role="dialog"><p>{message}</p>{step >= 5 && <div><button type="button" onClick={onNext}>{saving ? 'SAVING…' : button}</button></div>}</section>
}

function TutorialGuide({ step, revealed, saving, onBack, onNext }: { step: number; revealed: boolean; saving: boolean; onBack: () => void; onNext: () => void }) {
  const messages = [
    'WELCOME TO THE DARK FOREST UNIVERSE.',
    'YOU LOSE IF YOUR STAR LOSES LIFE OR ALL YOUR SHIPS ARE DESTROYED.',
    'THIS IS YOUR HOME STAR.',
    'AND THIS IS A SHIP OWNED BY YOU.',
    'THESE ARE YOUR RADARS. TO SEE AN ENEMY STAR OR SHIP, IT MUST BE INSIDE YOUR RADAR.',
    'WE CAN WAIT AND SEE IF WE CAN DETECT AN ENEMY.',
  ]
  const message = messages[step] ?? ''
  if (!revealed) return <section className="tutorial-guide tutorial-wait" role="status" aria-live="polite"><span>…</span></section>
  return <section className="tutorial-guide" role="dialog" aria-modal="true" aria-label="Tutorial guidance">
    <p>{message}</p>
    <div>
      {step > 0 && <button type="button" onClick={onBack}>‹ BACK</button>}
      <button type="button" onClick={onNext}>{saving ? 'SAVING…' : step === 5 ? 'BEGIN ›' : 'NEXT ›'}</button>
    </div>
  </section>
}

function EnemyContactGuide({ step, saving, onBack, onNext }: { step: number; saving: boolean; onBack: () => void; onNext: () => void }) {
  const message = step === 0
    ? 'THIS IS AN ENEMY SHIP. IT JUST CAME UNDER YOUR RADAR. YOU CAN ALSO SEE ITS PATH WHEN IT COMES UNDER YOUR RADAR.'
    : 'ITS CURVE SUGGESTS THIS IS ITS HOME STAR — THE SYSTEM IT MAY BE COMING FROM.'
  return <section className="tutorial-guide enemy-contact-guide" role="dialog" aria-modal="true" aria-label="Enemy contact guidance">
    <p>{message}</p>
    <div>
      {step > 0 && <button type="button" onClick={onBack}>‹ BACK</button>}
      <button type="button" onClick={onNext}>{saving ? 'SAVING…' : step === 1 ? 'CONTINUE ›' : 'NEXT ›'}</button>
    </div>
  </section>
}

function TutorialPointer({ pointer }: { pointer: { left: number; top: number; width: number; height: number; shape: 'circle' | 'rectangle'; tone: 'green' | 'red' } }) {
  const { shape, tone, ...style } = pointer
  return <div className={`tutorial-pointer ${shape} ${tone}`} aria-hidden="true" style={style} />
}

function TerminalOverlay({ tone, reason }: { tone: 'won' | 'lost'; reason: string }) {
  return <section className={`terminal-overlay ${tone}`} role="status" aria-live="assertive">
    <div><strong>{tone === 'won' ? 'YOU WON' : 'YOU LOST'}</strong><span>{reason}</span></div>
  </section>
}

function defeatState(player: string, objects: Record<string, UniverseObject>) {
  const owned = Object.values(objects).filter((object) => object.owner === player)
  const stars = owned.filter((object) => object.type === 'NATURAL')
  const ships = owned.filter((object) => object.type === 'ARTIFICIAL' && object.sub_type !== 'PROJECTILE')
  const starsDestroyed = stars.length > 0 && stars.every((star) => (star.life ?? 1) <= 0)
  const shipsDestroyed = ships.length === 0 || ships.reduce((total, ship) => total + Math.max(0, ship.life ?? 1), 0) <= 0
  const reasons = [
    ...(starsDestroyed ? ['ASSIGNED STAR DESTROYED.'] : []),
    ...(shipsDestroyed ? ['NO SHIPS REMAIN.'] : []),
  ]
  return { defeated: starsDestroyed || shipsDestroyed, reasons }
}

function formatHitDifference(diagnostics: {
  client_hit_time?: number
  client_distance?: number
  flask_evaluated_at?: number
  flask_distance?: number
  hit_radius?: number
}) {
  const client = typeof diagnostics.client_distance === 'number' ? diagnostics.client_distance.toFixed(1) : '?'
  const flask = typeof diagnostics.flask_distance === 'number' ? diagnostics.flask_distance.toFixed(1) : 'unavailable'
  const radius = typeof diagnostics.hit_radius === 'number' ? diagnostics.hit_radius.toFixed(1) : '?'
  const clientTime = typeof diagnostics.client_hit_time === 'number' ? diagnostics.client_hit_time.toFixed(2) : '?'
  const flaskTime = typeof diagnostics.flask_evaluated_at === 'number' ? diagnostics.flask_evaluated_at.toFixed(2) : '?'
  return `HIT DESYNC · CLIENT d=${client} t=${clientTime} · FLASK d=${flask} / r=${radius} t=${flaskTime}`
}

function StatusBar({ label, value }: { label: string; value: number }) {
  const percent = Math.max(0, Math.min(100, value))
  return <label className="status-bar"><span>{label}</span><i><b style={{ width: `${percent}%` }} /></i><output>{Math.round(percent)}%</output></label>
}

function ShipCount({ ships }: { ships: [string, UniverseObject][] }) {
  const remaining = ships.filter(([, ship]) => (ship.life ?? 1) > 0).length
  return <span className="ship-count">SHIPS <b>{remaining} / {ships.length}</b></span>
}

function lifePercent(object: UniverseObject) {
  if (typeof object.life !== 'number') return 100
  const max = typeof object.max_life === 'number' && object.max_life > 0
    ? object.max_life
    : object.type === 'NATURAL' ? 1000 : object.type === 'ARTIFICIAL' ? 200 : object.life
  return max > 0 ? object.life / max * 100 : 0
}

function shortId(id: string) {
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function positionOf(object: UniverseObject) {
  const x = object.location?.x ?? object.position?.x ?? object.x
  const y = object.location?.y ?? object.position?.y ?? object.y
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null
}

function darkForestDetectedObjectIds(
  objects: Record<string, UniverseObject>,
  playerId: string | null,
  simulationTime: number,
  darkForest: boolean,
) {
  const entries = Object.entries(objects)
  if (!darkForest || !playerId) return new Set(entries.map(([id]) => id))
  const predicted = predictPositions(objects, simulationTime)
  const positionFor = (id: string, object: UniverseObject) => predicted.get(id) ?? positionOf(object)
  const radars = entries.flatMap(([id, object]) => {
    if (object.owner !== playerId) return []
    const position = positionFor(id, object)
    if (!position) return []
    return Object.values(object.objects ?? {})
      .filter((attached) => attached.type === 'RADAR' && typeof attached.radius === 'number' && attached.radius > 0)
      .map((attached) => ({ position, radius: attached.radius! }))
  })
  const detected = new Set<string>()
  for (const [id, object] of entries) {
    if (object.owner === playerId || (object.source_objectid && objects[object.source_objectid]?.owner === playerId)) {
      detected.add(id)
      continue
    }
    const position = positionFor(id, object)
    if (position && radars.some((radar) => Math.hypot(position.x - radar.position.x, position.y - radar.position.y) <= radar.radius)) detected.add(id)
  }
  return detected
}

function estimatedUniverseTime(universe: RootState['universe']['universe'], _clockPulse: number) {
  const base = universe?.time ?? 0
  const anchor = universe?.time_updated_at_ms
  if (universe?.active !== true || typeof anchor !== 'number' || !Number.isFinite(anchor)) return base
  return base + Math.max(0, (Date.now() - anchor) / 1000)
}

function suggestRadius(source: UniverseObject, target: UniverseObject, targetId: string) {
  const sourcePosition = positionOf(source)
  const targetPosition = positionOf(target)
  if (!sourcePosition || !targetPosition) return 100
  const distance = Math.hypot(sourcePosition.x - targetPosition.x, sourcePosition.y - targetPosition.y)
  return distinctTransferRadius(Math.max(150, distance * 0.2), source, targetId)
}

function distinctTransferRadius(radius: number, ship: UniverseObject | undefined, targetId: string | null) {
  if (!ship || !targetId) return radius
  const currentOrbit = curveList(ship.curves).find((curve) => curve.focus1 === targetId && curve.active !== false)
  const existingRadius = currentOrbit?.major_axis
  if (typeof existingRadius !== 'number' || Math.abs(radius - existingRadius) > Math.max(2, existingRadius * 0.02)) return radius
  return existingRadius + Math.max(10, existingRadius * 0.2)
}

function curveList(curves: UniverseObject['curves']) {
  return Array.isArray(curves)
    ? curves.filter((curve): curve is NonNullable<typeof curve> => Boolean(curve))
    : Object.values(curves ?? {}).filter((curve): curve is NonNullable<typeof curve> => Boolean(curve))
}
