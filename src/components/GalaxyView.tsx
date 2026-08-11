import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { GalaxyRenderer } from '../pixi/GalaxyRenderer'
import type { RootState } from '../store'
import { selectObject } from '../store/universeSlice'
import { currentUniverseId } from '../firebase/listener'
import type { UniverseObject } from '../types/universe'
import { playGunFire, playUiClick } from '../audio/sfx'
import { cachedUsername } from '../session'

type TransientMessage = {
  id: number
  text: string
  tone: 'correction' | 'verification'
}

export function GalaxyView({ musicControl }: { musicControl?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const renderer = useRef<GalaxyRenderer | null>(null)
  const dispatch = useDispatch()
  const universe = useSelector((state: RootState) => state.universe.universe)
  const selectedObjectId = useSelector((state: RootState) => state.universe.selectedObjectId)
  const [transferTargetId, setTransferTargetId] = useState<string | null>(null)
  const [transferRadius, setTransferRadius] = useState(100)
  const [transferStatus, setTransferStatus] = useState<string | null>(null)
  const [orbitTransferMode, setOrbitTransferMode] = useState(false)
  const [leftCollapsed, setLeftCollapsed] = useState(() => window.innerWidth < 760)
  const [rightCollapsed, setRightCollapsed] = useState(() => window.innerWidth < 760)
  const [aimingGunId, setAimingGunId] = useState<string | null>(null)
  const [transientMessages, setTransientMessages] = useState<TransientMessage[]>([])
  const [clockPulse, setClockPulse] = useState(0)
  const seenHitEvents = useRef(new Set<string>())
  const nextMessageId = useRef(0)
  const messageTimers = useRef(new Map<number, number>())
  const objects = universe?.objects ?? {}
  const selectedObject = selectedObjectId ? objects[selectedObjectId] : undefined
  const transferTarget = transferTargetId ? objects[transferTargetId] : undefined
  const universeId = currentUniverseId()
  const currentUsername = cachedUsername()
  // The shared clock advances analytically between authoritative action and
  // outcome writes; no once-per-second Firebase time updates are required.
  const currentTime = estimatedUniverseTime(universe, clockPulse)
  const controlsSelectedObject = Boolean(currentUsername && selectedObject?.owner === currentUsername)
  const maneuverBlocked = typeof selectedObject?.maneuver_blocked_till === 'number' && selectedObject.maneuver_blocked_till > currentTime
  const guns = Object.entries(selectedObject?.objects ?? {}).filter(([, attached]) => attached.type === 'GUN')
  const players = [...new Set(Object.values(objects).map((object) => object.owner).filter((owner): owner is string => typeof owner === 'string'))]
  const interaction = useRef({ objects, selectedObjectId, selectedObject, controlsSelectedObject, maneuverBlocked, currentTime, aimingGunId, orbitTransferMode })
  interaction.current = { objects, selectedObjectId, selectedObject, controlsSelectedObject, maneuverBlocked, currentTime, aimingGunId, orbitTransferMode }

  useEffect(() => {
    if (!host.current) return
    const galaxy = new GalaxyRenderer(
      host.current,
      (id) => {
        console.log('Object clicked:', id)
        playUiClick()
        const current = interaction.current
        const clicked = current.objects[id]
        if (current.controlsSelectedObject && current.aimingGunId && current.selectedObjectId && current.selectedObject && clicked) {
          const source = positionOf(current.selectedObject)
          const target = positionOf(clicked)
          if (source && target) void fireShot(current.selectedObjectId, current.aimingGunId, source, target)
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
        if (current.controlsSelectedObject && current.aimingGunId && current.selectedObjectId && current.selectedObject) {
          const source = positionOf(current.selectedObject)
          if (source) void fireShot(current.selectedObjectId, current.aimingGunId, source, point)
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
      if (ready) galaxy.render(universe, selectedObjectId)
    })
    return () => {
      messageTimers.current.forEach((timer) => window.clearTimeout(timer))
      messageTimers.current.clear()
      galaxy.destroy()
    }
  }, [dispatch])

  useEffect(() => { renderer.current?.render(universe, selectedObjectId) }, [universe, selectedObjectId])
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
    if (!universeId) return
    const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
    const stream = new EventSource(`${apiUrl}/universes/${encodeURIComponent(universeId)}/live-events`)
    stream.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as {
          type?: string
          projectile_id?: string
          source_id?: string
          start_location?: { x?: number; y?: number }
          rotation?: number
          velocity?: number
          hit_radius?: number
          fired_at?: number
          range?: number
        }
        if (
          (event.type !== 'PROJECTILE_FIRED' && event.type !== 'PROJECTILE_FIRED_PREVIEW') || !event.projectile_id || !event.source_id
          || typeof event.start_location?.x !== 'number' || typeof event.start_location?.y !== 'number'
          || typeof event.rotation !== 'number' || typeof event.velocity !== 'number'
          || typeof event.hit_radius !== 'number' || typeof event.fired_at !== 'number' || typeof event.range !== 'number'
        ) return
        renderer.current?.receiveProjectileFired({
          projectile_id: event.projectile_id,
          source_id: event.source_id,
          start_location: { x: event.start_location.x, y: event.start_location.y },
          rotation: event.rotation,
          velocity: event.velocity,
          hit_radius: event.hit_radius,
          fired_at: event.fired_at,
          range: event.range,
        })
      } catch {
        // Firebase remains the authoritative fallback if an event is malformed.
      }
    }
    stream.addEventListener('message', (message) => {
      try {
        const event = JSON.parse(message.data) as { type?: string; projectile_id?: string }
        if (event.type === 'PROJECTILE_CANCELLED' && event.projectile_id) renderer.current?.receiveProjectileCancelled(event.projectile_id)
      } catch {
        // Ignore malformed transient events.
      }
    })
    return () => stream.close()
  }, [universeId])
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
    const range = Number(import.meta.env.VITE_PROJECTILE_RANGE ?? 1000)
    renderer.current?.setAimPreview(aimingGunId && selectedObjectId ? selectedObjectId : null, Number.isFinite(range) && range > 0 ? range : 1000)
  }, [aimingGunId, selectedObjectId])

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
    const range = Number(import.meta.env.VITE_PROJECTILE_RANGE ?? 1000)
    const localProjectileId = `local-projectile-${Date.now()}-${Math.random().toString(36).slice(2)}`
    renderer.current?.launchLocalProjectile(
      localProjectileId,
      objectId,
      shotStart,
      rotation,
      speed,
      hitRadius,
      clientFiredAt,
      Number.isFinite(range) && range > 0 ? range : 1000,
    )
    void relayProjectilePreview({
      projectile_id: localProjectileId,
      source_id: objectId,
      start_location: shotStart,
      rotation,
      velocity: speed,
      hit_radius: hitRadius,
      fired_at: clientFiredAt,
      range: Number.isFinite(range) && range > 0 ? range : 1000,
    })
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
        }),
      })
      const body = await response.json() as { ok?: boolean; error?: string; projectile_id?: string; fired_at?: number }
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Shot request failed.')
      if (body.projectile_id && typeof body.fired_at === 'number') {
        renderer.current?.promoteLocalProjectile(localProjectileId, body.projectile_id, body.fired_at)
      }
      setTransferStatus('Shot fired.')
    } catch (error) {
      renderer.current?.discardLocalProjectile(localProjectileId)
      void cancelProjectilePreview(localProjectileId)
      setTransferStatus(error instanceof Error ? error.message : 'Shot request failed.')
    }
  }

  async function relayProjectilePreview(event: {
    projectile_id: string
    source_id: string
    start_location: { x: number; y: number }
    rotation: number
    velocity: number
    hit_radius: number
    fired_at: number
    range: number
  }) {
    const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
    try {
      await fetch(`${apiUrl}/universes/${encodeURIComponent(universeId)}/projectile-previews`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event),
      })
    } catch {
      // Firebase remains the fallback for remote clients.
    }
  }

  async function cancelProjectilePreview(previewId: string) {
    const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
    try {
      await fetch(`${apiUrl}/universes/${encodeURIComponent(universeId)}/projectile-previews/${encodeURIComponent(previewId)}/cancel`, { method: 'POST' })
    } catch {
      // The remote preview expires quickly if this cosmetic cancellation is lost.
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
    addTransientMessage('VERIFYING HIT · CONTACTING FLASK', 'verification')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
      const response = await fetch(`${apiUrl}/universes/${encodeURIComponent(universeId)}/projectiles/${encodeURIComponent(projectileId)}/verify-hit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: targetId, hit_time: hitTime, client_distance: clientDistance }),
      })
      const body = await response.json() as {
        ok?: boolean
        status?: 'confirmed' | 'rejected' | 'pending'
        diagnostics?: { client_hit_time?: number; client_distance?: number; flask_evaluated_at?: number; flask_distance?: number; hit_radius?: number }
      }
      const status = response.ok && body.ok && body.status ? body.status : 'pending'
      if (status === 'confirmed') {
        addTransientMessage('HIT VERIFIED · FLASK CONFIRMED', 'verification')
      } else if (status === 'pending') {
        addTransientMessage('HIT VERIFICATION · PENDING', 'verification')
      } else if (body.diagnostics) {
        addTransientMessage(formatHitDifference(body.diagnostics), 'correction')
      }
      renderer.current?.resolveHitVerification(projectileId, status)
    } catch {
      addTransientMessage('HIT VERIFICATION · RETRYING', 'verification')
      renderer.current?.resolveHitVerification(projectileId, 'pending')
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

  return (
    <div className="galaxy-shell">
      <div ref={host} className="galaxy-view" aria-label="Galaxy map" />
      {aimingGunId && <button type="button" className="aim-cancel-overlay" onClick={() => { playUiClick(); setAimingGunId(null) }}>
        <b>×</b><span>CANCEL AIMING MODE</span>
      </button>}
      <aside className={`game-sidebar game-sidebar-left${leftCollapsed ? ' collapsed' : ''}`}>
        <button className="sidebar-collapse" onClick={() => setLeftCollapsed((value) => !value)}>{leftCollapsed ? '›' : '‹'}</button>
        <span className="sidebar-title">UNIVERSE ID · {universeId}</span>
        <span className="sidebar-title">PLAYERS</span>
        {players.map((player) => {
          const owned = Object.entries(objects).filter(([, object]) => object.owner === player)
          const stars = owned.filter(([, object]) => object.type === 'NATURAL')
          const ships = owned.filter(([, object]) => object.type === 'ARTIFICIAL' && object.sub_type !== 'PROJECTILE')
          const defeated = stars.some(([, star]) => (star.life ?? 1) <= 0) || (ships.length > 0 && ships.every(([, ship]) => (ship.life ?? 1) <= 0))
          return <div key={player} className={`player-card${player === currentUsername ? ' online' : ' offline'}${defeated ? ' defeated' : ''}`}>
            <strong>{player} <small>{player === currentUsername ? 'ONLINE' : 'OFFLINE'}</small></strong>
            {stars.map(([id, star]) => <StatusBar key={id} label={`STAR ${id.slice(-4)}`} value={lifePercent(star)} />)}
            <StatusBar label="SHIPS" value={ships.length ? ships.filter(([, ship]) => (ship.life ?? 1) > 0).length / ships.length * 100 : 0} />
          </div>
        })}
        <div className="sidebar-music">{musicControl}</div>
      </aside>
      <aside className={`game-sidebar game-sidebar-right${rightCollapsed ? ' collapsed' : ''}`}>
        <button className="sidebar-collapse" onClick={() => setRightCollapsed((value) => !value)}>{rightCollapsed ? '‹' : '›'}</button>
        <span className="sidebar-title">COMMAND CENTER</span>
        {selectedObjectId && selectedObject && <div className={`selected-status ${selectedObject.owner ? selectedObject.owner === currentUsername ? 'owned' : 'hostile' : 'neutral'}`}>
          <strong>{shortId(selectedObjectId)}</strong><span>TYPE · {selectedObject.type ?? 'UNKNOWN'}</span><span>SUBTYPE · {selectedObject.sub_type ?? 'UNKNOWN'}</span>
          <StatusBar label="LIFE" value={lifePercent(selectedObject)} />
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
        <div className="transfer-panel">
          {guns.length > 0 && (
            <div className="gun-actions">
              <span className="transfer-title">GUNS</span>
              {aimingGunId ? (
                <>
                  <span className="aiming-status">AIMING · click any map point</span>
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
              <button type="button" disabled={maneuverBlocked} onClick={() => { playUiClick(); setAimingGunId(null); setOrbitTransferMode(true); setTransferStatus(null) }}>
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
                    <button className="transfer-send" type="button" onClick={() => void sendTransfer()}>SEND TRANSFER</button>
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
    </div>
  )
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
  return distinctTransferRadius(Math.max(20, Math.min(200, distance * 0.2)), source, targetId)
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
