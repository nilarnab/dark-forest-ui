import { Application, Assets, Circle, Container, FederatedPointerEvent, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { Curve, Universe, UniverseObject } from '../types/universe'
import { predictPositions } from './prediction'
import { STAR_DEATH_WAVE_DURATIONS, STAR_DEATH_WAVE_RADII, STAR_DEATH_WAVE_STARTS } from '../animations/starDeath'

type Position = { x: number; y: number }
type TransferArc = { centre: Position; basisU: Position; basisV: Position; phaseStart: number; phaseEnd: number }
type CurveState = { x: number; y: number; a: number; b: number; rotation: number; dotted: boolean; transferArc?: TransferArc }
type PendingPredictedHit = { targetId: string; predictedAt: number; clientDistance: number; verificationRequested?: boolean }
type LocalProjectilePreview = { view: Graphics; rangeView: Graphics; start: Position; rotation: number; speed: number; firedAt: number; expiresAt: number; sourceId: string; hitRadius: number; lastPosition: Position; lastSimulationTime: number; pendingHit?: { targetId: string; hitTime: number; clientDistance: number }; stoppedPosition?: Position }
type ProjectileFiredEvent = { projectile_id: string; source_id: string; start_location: Position; rotation: number; velocity: number; hit_radius: number; fired_at: number; range: number }
type OpeningCamera = { startedAt: number; startZoom: number; endZoom: number; startFocus: Position; endFocus: Position }
type StarDeathEffect = { view: Graphics; position: Position; startedAt: number }

const subtypeIconUrls: Record<string, string> = {
  cruise_level_1: '/icons/scout-ship.svg',
}

export class GalaxyRenderer {
  private app: Application
  private world = new Container()
  private starfield = new Container()
  private grid = new Container()
  private radarRanges = new Container()
  private blastRanges = new Container()
  private curves = new Container()
  private objects = new Container()
  private ownerIndicators = new Container()
  private hitEffects = new Container()
  private aimPreview = new Graphics()
  private transferPreview = new Graphics()
  private selections = new Container()
  private objectViews = new Map<string, Container>()
  private ownerIndicatorViews = new Map<string, Graphics>()
  private curveViews = new Map<string, Graphics>()
  private radarViews = new Map<string, Graphics>()
  private radarOwners = new Map<string, string>()
  private radarRadii = new Map<string, number>()
  private blastViews = new Map<string, Graphics>()
  private blastRadii = new Map<string, number>()
  private objectTargets = new Map<string, Position>()
  private objectVisibility = new Map<string, number>()
  private objectIconSubtypes = new Map<string, string | undefined>()
  private hiddenProjectiles = new Set<string>()
  private pendingPredictedHits = new Map<string, PendingPredictedHit>()
  private localProjectilePreviews = new Map<string, LocalProjectilePreview>()
  private reportedCollisionPairs = new Set<string>()
  private lastObjectPositions = new Map<string, Position>()
  private lastPredictedSimulationTime: number | null = null
  private hitEffectViews = new Map<string, { view: Graphics; expiresAt: number }>()
  private starDeathEffects = new Map<string, StarDeathEffect>()
  private starDeathStartedAt = new Map<string, number>()
  private knownLife = new Map<string, number>()
  private displayedStarLife = new Map<string, { current: number; target: number }>()
  private curveTargets = new Map<string, CurveState>()
  private curveStates = new Map<string, CurveState>()
  private curveVisibility = new Map<string, number>()
  private selectionRing: Graphics | null = null
  private selectionLine: Graphics | null = null
  private selectionPanel: Container | null = null
  private selectionContentKey: string | null = null
  private selectedId: string | null = null
  private ownerUsername: string | null = null
  private hasCenteredOnAssignedStar = false
  private dragging = false
  private initialized = false
  private disposed = false
  private targetZoom = 1
  private openingCamera: OpeningCamera | null = null
  private zoomAnchor: { screen: Position; world: Position } | null = null
  private lastFrameTime = 0
  private predictionUniverse: Universe | null = null
  private predictionObjects: Record<string, UniverseObject> = {}
  private localSimulationTime = 0
  private localSimulationUpdatedAt = 0
  private simulationPaused = true
  private dragStart = { x: 0, y: 0, worldX: 0, worldY: 0 }
  private previewTargetId: string | null = null
  private previewRadius = 0
  private previewDragging = false
  private onPreviewRadiusChange: ((radius: number) => void) | null = null
  private aimSourceId: string | null = null
  private aimRange = 0
  private aimPointer: Position | null = null

  constructor(
    private host: HTMLElement,
  private onObjectClick: (id: string) => void,
  private onBlankClick: (position: Position) => void,
  private onHitCorrection: (message: string) => void,
  private onHitVerification: (projectileId: string, targetId: string, hitTime: number, clientDistance: number) => void,
  private onCollisionVerification: (firstId: string, secondId: string, hitTime: number) => void,
  ) {
    this.app = new Application()
  }

  async initialize(): Promise<boolean> {
    await this.app.init({ background: '#02050a', resizeTo: this.host, antialias: true })
    // React Strict Mode may unmount this instance while Pixi is initializing.
    if (this.disposed) {
      this.app.destroy(true, { children: true })
      return false
    }
    this.initialized = true
    this.host.appendChild(this.app.canvas)
    this.app.stage.eventMode = 'static'
    this.app.stage.hitArea = this.app.screen
    this.app.stage.on('pointertap', (event) => {
      // Do not treat a click that hit an object/container as blank map input.
      // This is especially important while orbit-transfer mode is waiting for
      // a natural-object destination.
      if (event.target !== this.app.stage) return
      this.onBlankClick(this.world.toLocal(event.global))
    })
    this.starfield.addChild(this.makeStarfield())
    this.world.addChild(this.starfield, this.grid, this.radarRanges, this.blastRanges, this.curves, this.objects, this.ownerIndicators, this.hitEffects, this.aimPreview, this.transferPreview, this.selections)
    // The aiming guide is display-only. It must never absorb a map click.
    this.aimPreview.eventMode = 'none'
    this.grid.addChild(this.makeGrid())
    this.app.stage.addChild(this.world)
    this.transferPreview.eventMode = 'static'
    this.transferPreview.cursor = 'grab'
    this.transferPreview.on('pointerdown', this.startPreviewDrag)
    this.transferPreview.on('pointertap', (event) => {
      if (this.isOnPreviewRim(event)) event.stopPropagation()
    })
    this.app.stage.on('pointermove', this.movePreviewDrag)
    this.app.stage.on('pointermove', this.moveAimPreview)
    this.app.stage.on('pointerup', this.stopPreviewDrag)
    this.world.position.set(this.host.clientWidth / 2, this.host.clientHeight / 2)
    this.installCameraControls()
    this.app.ticker.add(this.animate)
    return true
  }

  render(universe: Universe | null, selectedId: string | null) {
    let incomingTime: number | null = null
    if (universe !== this.predictionUniverse) {
      const receivedAt = performance.now()
      const currentLocalTime = this.localSimulationNow(receivedAt)
      const active = universe?.active === true
      incomingTime = active ? estimatedUniverseTime(universe) : (universe?.time ?? 0)
      this.predictionUniverse = universe
      this.predictionObjects = universe?.objects ?? {}
      // An inactive universe must display its stored state without advancing
      // its local prediction clock. Active snapshots remain lower bounds.
      this.localSimulationTime = !active || this.localSimulationUpdatedAt === 0
        ? incomingTime
        : Math.max(currentLocalTime, incomingTime)
      this.localSimulationUpdatedAt = receivedAt
      this.simulationPaused = !active
    }
    const entries = Object.entries(universe?.objects ?? {})
    const objectIds = new Set(entries.map(([id]) => id))
    this.objectViews.forEach((_view, id) => { if (!objectIds.has(id)) this.objectTargets.delete(id) })
    this.lastObjectPositions.forEach((_position, id) => { if (!objectIds.has(id)) this.lastObjectPositions.delete(id) })
    for (const [id, object] of entries) {
      this.trackStarLife(id, object)
      this.renderObject(id, object)
    }
    this.knownLife.forEach((_life, id) => { if (!objectIds.has(id)) this.knownLife.delete(id) })
    this.displayedStarLife.forEach((_life, id) => { if (!objectIds.has(id)) this.displayedStarLife.delete(id) })
    this.starDeathStartedAt.forEach((_time, id) => { if (!objectIds.has(id)) this.starDeathStartedAt.delete(id) })
    this.reconcileLocalProjectilePreviews()
    this.renderOwnerIndicators(entries)
    this.centerOnAssignedStar(entries)
    if (this.simulationPaused) {
      for (const [id, object] of entries) {
        const position = objectPosition(object)
        if (position) this.objectTargets.set(id, position)
      }
    }
    this.renderAttachedObjects(universe?.objects ?? {})
    this.renderProjectileBlastRanges(universe?.objects ?? {})
    this.renderCurves(universe?.objects ?? {})
    this.selectedId = selectedId
    this.renderSelection(universe?.objects ?? {})
    this.drawTransferPreview()
  }

  destroy() {
    this.disposed = true
    if (!this.initialized) return
    this.initialized = false
    this.app.destroy(true, { children: true })
  }

  zoomBy(factor: number, clientPoint?: Position) {
    this.openingCamera = null
    const anchorScreen = clientPoint ? this.clientToCanvasPoint(clientPoint) : {
      x: this.host.clientWidth / 2,
      y: this.host.clientHeight / 2,
    }
    const currentZoom = this.world.scale.x
    this.zoomAnchor = {
      screen: anchorScreen,
      world: {
        x: (anchorScreen.x - this.world.x) / currentZoom,
        y: (anchorScreen.y - this.world.y) / currentZoom,
      },
    }
    this.targetZoom = Math.min(8, Math.max(0.08, this.targetZoom * factor))
  }

  getSimulationTime() {
    return this.localSimulationUpdatedAt ? this.currentSimulationTime(performance.now()) : 0
  }

  getObjectPosition(id: string): Position | null {
    const position = this.objectTargets.get(id)
    return position ? { ...position } : null
  }

  setTransferPreview(targetId: string | null, radius: number, onRadiusChange?: (radius: number) => void) {
    this.previewTargetId = targetId
    this.previewRadius = radius
    this.onPreviewRadiusChange = onRadiusChange ?? null
    this.drawTransferPreview()
  }

  setAimPreview(sourceId: string | null, range: number) {
    this.aimSourceId = sourceId
    this.aimRange = range
    this.drawAimPreview()
  }

  launchLocalProjectile(id: string, sourceId: string, start: Position, rotation: number, speed: number, hitRadius: number, firedAt: number, range: number) {
    if (this.localProjectilePreviews.has(id) || !Number.isFinite(speed) || speed <= 0) return
    const view = new Graphics().circle(0, 0, 1.8).fill({ color: 0xff6f61, alpha: 1 })
    const rangeView = new Graphics()
    this.objects.addChild(view)
    this.blastRanges.addChild(rangeView)
    this.localProjectilePreviews.set(id, {
      view,
      rangeView,
      start,
      rotation: rotation * Math.PI / 180,
      speed,
      firedAt,
      expiresAt: firedAt + Math.max(0, range) / speed + 2,
      sourceId,
      hitRadius,
      lastPosition: start,
      lastSimulationTime: firedAt,
    })
  }

  promoteLocalProjectile(localId: string, projectileId: string, firedAt: number) {
    const preview = this.localProjectilePreviews.get(localId)
    if (!preview) return
    this.localProjectilePreviews.delete(localId)
    const lifetime = preview.expiresAt - preview.firedAt
    preview.firedAt = firedAt
    preview.lastSimulationTime = Math.max(preview.lastSimulationTime, firedAt)
    preview.expiresAt = firedAt + lifetime
    this.localProjectilePreviews.set(projectileId, preview)
    if (preview.pendingHit) this.reportLocalProjectileHit(projectileId, preview, preview.pendingHit)
  }

  discardLocalProjectile(id: string) {
    const preview = this.localProjectilePreviews.get(id)
    if (!preview) return
    preview.view.destroy()
    preview.rangeView.destroy()
    this.localProjectilePreviews.delete(id)
  }

  receiveProjectileFired(event: ProjectileFiredEvent) {
    if (this.localProjectilePreviews.has(event.projectile_id)) return
    const localMatch = [...this.localProjectilePreviews.entries()].find(([localId, preview]) => (
      localId.startsWith('local-projectile-')
      && preview.sourceId === event.source_id
      && Math.abs(preview.firedAt - event.fired_at) <= 1
    ))
    if (localMatch) {
      this.promoteLocalProjectile(localMatch[0], event.projectile_id, event.fired_at)
      return
    }
    this.launchLocalProjectile(
      event.projectile_id,
      event.source_id,
      event.start_location,
      event.rotation,
      event.velocity,
      event.hit_radius,
      event.fired_at,
      event.range,
    )
  }

  receiveProjectileCancelled(projectileId: string) {
    this.discardLocalProjectile(projectileId)
  }

  private reconcileLocalProjectilePreviews() {
    const authoritativeProjectiles = Object.entries(this.predictionObjects).filter(([, object]) => object.sub_type === 'PROJECTILE')
    for (const [localId, preview] of this.localProjectilePreviews) {
      if (!localId.startsWith('local-projectile-')) continue
      const match = authoritativeProjectiles
        .filter(([projectileId, object]) => !this.localProjectilePreviews.has(projectileId) && object.source_objectid === preview.sourceId)
        .map(([projectileId, object]) => ({ projectileId, firedAt: projectileFiredAt(object) }))
        .filter((candidate) => candidate.firedAt !== null && Math.abs(candidate.firedAt - preview.firedAt) <= 1)
        .sort((first, second) => Math.abs(first.firedAt! - preview.firedAt) - Math.abs(second.firedAt! - preview.firedAt))[0]
      if (match?.firedAt !== null && match) this.promoteLocalProjectile(localId, match.projectileId, match.firedAt)
    }
  }

  setOwnerUsername(username: string | null) {
    if (this.ownerUsername !== username) this.hasCenteredOnAssignedStar = false
    this.ownerUsername = username
    this.renderOwnerIndicators(Object.entries(this.predictionObjects))
    this.centerOnAssignedStar(Object.entries(this.predictionObjects))
  }

  flashHit(targetId: string, color = 0xffcf70) {
    const existing = this.hitEffectViews.get(targetId)
    if (existing) {
      drawHitRing(existing.view, color)
      existing.expiresAt = performance.now() + 850
      return
    }
    const view = new Graphics()
    drawHitRing(view, color)
    this.hitEffects.addChild(view)
    this.hitEffectViews.set(targetId, { view, expiresAt: performance.now() + 850 })
  }

  confirmProjectileHit(projectileId: string) {
    this.pendingPredictedHits.delete(projectileId)
  }

  resolveHitVerification(projectileId: string, status: 'confirmed' | 'rejected' | 'pending') {
    const pending = this.pendingPredictedHits.get(projectileId)
    if (!pending) return
    if (status === 'confirmed') {
      this.pendingPredictedHits.delete(projectileId)
      this.flashHit(pending.targetId, 0xff5d5d)
      return
    }
    if (status === 'rejected') {
      this.pendingPredictedHits.delete(projectileId)
      this.hiddenProjectiles.delete(projectileId)
      this.onHitCorrection(`HIT DESYNC · ${pending.targetId}`)
      return
    }
    pending.verificationRequested = false
    pending.predictedAt = this.localSimulationNow(performance.now())
  }

  private renderObject(id: string, object: UniverseObject) {
    const position = objectPosition(object)
    if (!position) {
      this.objectTargets.delete(id)
      return
    }
    let view = this.objectViews.get(id)
    if (!view) {
      view = new Container()
      view.eventMode = 'static'
      // Keep interaction forgiving without making the visible symbol larger.
      // The inverse world scale makes this a constant 16px screen radius.
      view.hitArea = new Circle(0, 0, 16)
      view.cursor = 'pointer'
      let hoverRing: Graphics | null = null
      view.on('pointerover', () => {
        this.app.canvas.style.cursor = 'pointer'
        if (!hoverRing) {
          hoverRing = new Graphics().circle(0, 0, 14).stroke({ color: 0x79b8ff, width: 1.5, alpha: 0.95, pixelLine: true })
          view!.addChild(hoverRing)
        }
      })
      view.on('pointerout', () => {
        this.app.canvas.style.cursor = 'grab'
        hoverRing?.destroy()
        hoverRing = null
      })
      view.on('pointertap', (event) => {
        event.stopPropagation()
        this.onObjectClick(id)
      })
      this.objects.addChild(view)
      this.objectViews.set(id, view)
      this.objectTargets.set(id, position)
      this.objectVisibility.set(id, 0)
      view.position.set(position.x, position.y)
    }
    if (!this.objectTargets.has(id)) this.objectTargets.set(id, position)
    if (view.children.length === 0 || this.objectIconSubtypes.get(id) !== object.sub_type) {
      this.refreshObjectSymbol(id, view, object.sub_type)
    }
    this.updateObjectLifeAppearance(id, view, object)
  }

  private trackStarLife(id: string, object: UniverseObject) {
    const life = object.life
    const previousLife = this.knownLife.get(id)
    if (isStarObject(object) && typeof life === 'number' && life <= 0 && typeof previousLife === 'number' && previousLife > 0) {
      const position = objectPosition(object) ?? this.objectTargets.get(id)
      if (position) this.triggerStarDeathEffect(id, position)
    }
    if (typeof life === 'number') this.knownLife.set(id, life)
  }

  private updateObjectLifeAppearance(id: string, view: Container, object: UniverseObject) {
    if (!isStarObject(object)) return
    const marker = view.children.find((child): child is Graphics => child instanceof Graphics)
    if (!marker) return
    const target = lifeFraction(object)
    const appearance = this.displayedStarLife.get(id) ?? { current: target, target }
    appearance.target = target
    this.displayedStarLife.set(id, appearance)
    this.drawStarLifeAppearance(marker, appearance.current, this.starDeathStartedAt.get(id))
  }

  private drawStarLifeAppearance(marker: Graphics, life: number, deathStartedAt?: number) {
    const deathElapsed = deathStartedAt === undefined ? null : (performance.now() - deathStartedAt) / 1000
    if (deathElapsed !== null && deathElapsed >= 3.82) {
      drawBlackHoleRemnant(marker)
      return
    }
    // Below 40%, a star swells from its normal 4px marker to 12px and drifts
    // from white through orange to red. Screen-constant view scaling preserves
    // that readable warning at every map zoom.
    const damage = Math.max(0, Math.min(1, (0.4 - life) / 0.4))
    const flare = deathElapsed === null ? 0 : Math.max(0, 1 - deathElapsed / .75) * 4
    const radius = 4 + damage * 8 + flare
    const color = interpolateColor(0xf2f7ff, 0xff3d3d, damage)
    marker.clear().circle(0, 0, radius).fill({ color })
    marker.alpha = 1
  }

  private triggerStarDeathEffect(id: string, position: Position) {
    const existing = this.starDeathEffects.get(id)
    if (existing) existing.view.destroy()
    const view = new Graphics()
    this.hitEffects.addChild(view)
    const startedAt = performance.now()
    this.starDeathStartedAt.set(id, startedAt)
    this.starDeathEffects.set(id, { view, position: { ...position }, startedAt })
  }

  private renderOwnerIndicators(entries: [string, UniverseObject][]) {
    const expected = new Set(
      this.ownerUsername
        ? entries
          .filter(([, object]) => typeof object.owner === 'string' && object.sub_type !== 'PROJECTILE')
          .map(([id]) => id)
        : [],
    )
    for (const id of expected) {
      const object = this.predictionObjects[id]
      if (!object) continue
      let indicator = this.ownerIndicatorViews.get(id)
      if (!indicator) {
        indicator = new Graphics()
        this.ownerIndicators.addChild(indicator)
        this.ownerIndicatorViews.set(id, indicator)
      }
      drawOwnershipRing(indicator, object.owner === this.ownerUsername, lifeFraction(object))
    }
    this.ownerIndicatorViews.forEach((indicator, id) => {
      if (expected.has(id)) return
      indicator.destroy()
      this.ownerIndicatorViews.delete(id)
    })
  }

  private centerOnAssignedStar(entries: [string, UniverseObject][]) {
    if (this.hasCenteredOnAssignedStar || !this.ownerUsername) return
    const assignedStar = entries.find(([, object]) => (
      object.owner === this.ownerUsername && object.type === 'NATURAL'
    ))
    if (!assignedStar) return
    const position = this.objectTargets.get(assignedStar[0]) ?? objectPosition(assignedStar[1])
    if (!position) return
    const zoom = 3
    const finalFrame = frameNaturalObjects(entries, this.host.clientWidth, this.host.clientHeight)
    this.world.scale.set(zoom)
    this.targetZoom = zoom
    this.world.position.set(
      this.host.clientWidth / 2 - position.x * zoom,
      this.host.clientHeight / 2 - position.y * zoom,
    )
    if (finalFrame) {
      this.openingCamera = {
        // Hold the close assigned-star view before the map reveal begins.
        startedAt: performance.now() + 3000,
        startZoom: zoom,
        endZoom: finalFrame.zoom,
        startFocus: position,
        endFocus: finalFrame.focus,
      }
    }
    this.hasCenteredOnAssignedStar = true
  }

  private renderCurves(allObjects: Record<string, UniverseObject>) {
    const expected = new Set<string>()
    const displayTime = this.currentSimulationTime(performance.now())
    for (const [objectId, object] of Object.entries(allObjects)) {
      for (const [index, curve] of curveEntries(object.curves)) {
        if (curve.active === false) continue
        // Completed transfer/source curves no longer need server-side removal:
        // every client hides them from their shared analytic clock.
        if (typeof curve.valid_till === 'number' && curve.valid_till !== -1 && curve.valid_till <= displayTime) continue
        const id = `${objectId}:${index}`
        const focus = curve.focus1 ? allObjects[curve.focus1] : undefined
        if (!focus && curve.motion_type !== 'INTERSTELLAR_ELLIPSE') continue
        // Curves remain useful without a visible focus object. In that case,
        // display the curve in the world-origin reference frame.
        const focusPosition = objectPosition(focus ?? {}) ?? { x: 0, y: 0 }
        expected.add(id)
        // Planned destination curves are dotted only before they become the
        // active trajectory. The old position worker used to persist this
        // cosmetic toggle; event-driven clients derive it from time instead.
        const target = curveState(focusPosition, {
          ...curve,
          dotted: Boolean(curve.dotted && (typeof curve.valid_from !== 'number' || curve.valid_from > displayTime)),
        })
        this.curveTargets.set(id, target)
        let view = this.curveViews.get(id)
        if (!view) {
          view = new Graphics()
          this.curves.addChild(view)
          this.curveViews.set(id, view)
          this.curveStates.set(id, target)
          this.curveVisibility.set(id, 0)
        }
      }
    }
    this.curveViews.forEach((_view, id) => { if (!expected.has(id)) this.curveTargets.delete(id) })
  }

  private renderAttachedObjects(allObjects: Record<string, UniverseObject>) {
    const expected = new Set<string>()
    for (const [ownerId, object] of Object.entries(allObjects)) {
      for (const [attachedId, attached] of Object.entries(object.objects ?? {})) {
        if (attached.type !== 'RADAR' || typeof attached.radius !== 'number' || attached.radius <= 0) continue
        const id = `${ownerId}:${attachedId}`
        expected.add(id)
        let view = this.radarViews.get(id)
        if (!view) {
          view = new Graphics()
          this.radarRanges.addChild(view)
          this.radarViews.set(id, view)
          this.radarOwners.set(id, ownerId)
        }
        this.radarRadii.set(id, attached.radius)
      }
    }
    this.radarViews.forEach((view, id) => {
      if (expected.has(id)) return
      view.destroy()
      this.radarViews.delete(id)
      this.radarOwners.delete(id)
      this.radarRadii.delete(id)
    })
  }

  private renderProjectileBlastRanges(allObjects: Record<string, UniverseObject>) {
    const expected = new Set<string>()
    for (const [objectId, object] of Object.entries(allObjects)) {
      if (object.sub_type !== 'PROJECTILE' || typeof object.hit_radius !== 'number' || object.hit_radius <= 0) continue
      expected.add(objectId)
      if (!this.blastViews.has(objectId)) {
        const view = new Graphics()
        this.blastRanges.addChild(view)
        this.blastViews.set(objectId, view)
      }
      this.blastRadii.set(objectId, object.hit_radius)
    }
    this.blastViews.forEach((view, objectId) => {
      if (expected.has(objectId)) return
      view.destroy()
      this.blastViews.delete(objectId)
      this.blastRadii.delete(objectId)
    })
  }

  private renderSelection(allObjects: Record<string, UniverseObject>) {
    const object = this.selectedId ? allObjects[this.selectedId] : undefined
    const key = this.selectedId && object ? `${this.selectedId}:${object.type ?? ''}:${object.sub_type ?? ''}` : null
    // Location updates arrive continuously. The callout content does not
    // change with them, so preserve the existing Pixi nodes and let animate()
    // move the callout with its selected object.
    if (key && key === this.selectionContentKey && this.selectionRing) return
    this.selections.removeChildren().forEach((child) => child.destroy())
    this.selectionRing = null
    this.selectionLine = null
    this.selectionPanel = null
    this.selectionContentKey = key
    if (!this.selectedId || !object) return
    const view = this.objectViews.get(this.selectedId)
    if (!view) return
    const ring = new Graphics().circle(0, 0, 9).stroke({ color: 0x79b8ff, width: 1, pixelLine: true })
    this.selectionRing = ring
    // Object information belongs in the command sidebar, not over the map.
    this.selections.addChild(ring)
  }

  private updateScreenConstantSizes() {
    const inverseZoom = 1 / this.world.scale.x
    this.objectViews.forEach((view) => view.scale.set(inverseZoom))
    this.selections.children.forEach((view) => view.scale.set(inverseZoom))
  }

  private animate = () => {
    const now = performance.now()
    const delta = this.lastFrameTime ? Math.min((now - this.lastFrameTime) / 1000, 0.1) : 0
    this.lastFrameTime = now
    const easing = 1 - Math.exp(-18 * delta)
    const fade = Math.min(1, delta * 4)

    const opening = this.openingCamera
    if (opening) {
      // Same accelerated profile as the intro camera: it starts almost still
      // at the assigned star, then quickly opens out to reveal the map.
      const progress = Math.min(1, Math.max(0, (now - opening.startedAt) / 1000))
      const easeIn = progress ** 4
      const zoom = opening.startZoom + (opening.endZoom - opening.startZoom) * easeIn
      const focusX = opening.startFocus.x + (opening.endFocus.x - opening.startFocus.x) * easeIn
      const focusY = opening.startFocus.y + (opening.endFocus.y - opening.startFocus.y) * easeIn
      this.world.scale.set(zoom)
      this.world.position.set(this.host.clientWidth / 2 - focusX * zoom, this.host.clientHeight / 2 - focusY * zoom)
      if (progress >= 1) {
        this.targetZoom = opening.endZoom
        this.openingCamera = null
      }
    } else {
      const zoom = this.world.scale.x + (this.targetZoom - this.world.scale.x) * easing
      this.world.scale.set(zoom)
    }
    if (!this.openingCamera && this.zoomAnchor) {
      const zoom = this.world.scale.x
      this.world.position.set(
        this.zoomAnchor.screen.x - this.zoomAnchor.world.x * zoom,
        this.zoomAnchor.screen.y - this.zoomAnchor.world.y * zoom,
      )
      if (Math.abs(this.targetZoom - zoom) < 0.0001) this.zoomAnchor = null
    }

    const zoom = this.world.scale.x
    const simulationTime = this.currentSimulationTime(now)
    if (this.localSimulationUpdatedAt && !this.simulationPaused) {
      const positions = predictPositions(this.predictionObjects, simulationTime)
      positions.forEach((position, id) => this.objectTargets.set(id, position))
      this.detectPredictedHits(positions, simulationTime)
      this.requestDueHitVerifications(simulationTime)
    }

    this.objectViews.forEach((view, id) => {
      const target = this.objectTargets.get(id)
      const object = this.predictionObjects[id]
      // A received fire event owns the projectile's visual for its entire
      // flight. Firebase still supplies the shared projectile record, but it
      // must not replace the client prediction mid-flight or produce a pause
      // while the two representations reconcile.
      const shouldShow = Boolean(target)
        && !this.localProjectilePreviews.has(id)
        && !this.hiddenProjectiles.has(id)
        && !isExpiredProjectile(object, simulationTime)
      const visible = Math.max(0, Math.min(1, (this.objectVisibility.get(id) ?? 0) + (shouldShow ? fade : -fade)))
      this.objectVisibility.set(id, visible)
      if (target) view.position.set(view.x + (target.x - view.x) * easing, view.y + (target.y - view.y) * easing)
      view.alpha = visible
      view.scale.set((1 / zoom) * (0.6 + visible * 0.4))
      if (!target && visible === 0) {
        view.destroy()
        this.objectViews.delete(id)
        this.objectVisibility.delete(id)
        this.objectIconSubtypes.delete(id)
      }
    })

    // Life changes arrive as discrete Firebase values; ease the visual state
    // every rendered frame so a star's colour and size never jump.
    this.displayedStarLife.forEach((appearance, id) => {
      appearance.current += (appearance.target - appearance.current) * (1 - Math.exp(-4.5 * delta))
      if (Math.abs(appearance.target - appearance.current) < .001) appearance.current = appearance.target
      const view = this.objectViews.get(id)
      const object = this.predictionObjects[id]
      const marker = view?.children.find((child): child is Graphics => child instanceof Graphics)
      if (object && isStarObject(object) && marker) this.drawStarLifeAppearance(marker, appearance.current, this.starDeathStartedAt.get(id))
    })

    this.localProjectilePreviews.forEach((preview, id) => {
      const elapsed = Math.max(0, simulationTime - preview.firedAt)
      const position = preview.stoppedPosition ?? {
        x: preview.start.x + Math.cos(preview.rotation) * preview.speed * elapsed,
        y: preview.start.y + Math.sin(preview.rotation) * preview.speed * elapsed,
      }
      if (simulationTime > preview.expiresAt) {
        preview.view.destroy()
        preview.rangeView.destroy()
        this.localProjectilePreviews.delete(id)
        return
      }
      // A locally named shot may contact something before Flask returns its
      // permanent projectile ID. Keep both layers hidden while it waits to be
      // promoted; otherwise the next animation frame restores rangeView.alpha
      // and leaves a moving blast circle after the dot has vanished.
      if (preview.pendingHit) {
        preview.view.alpha = 0
        preview.rangeView.alpha = 0
        return
      }
      const hit = this.detectLocalProjectilePreviewHit(id, preview, position, simulationTime)
      if (hit) {
        if (id.startsWith('local-projectile-')) {
          preview.pendingHit = hit
          // The server-generated projectile ID may not have returned yet.
          // Hide this one immediately instead of leaving it frozen at contact;
          // promoteLocalProjectile will submit this queued verification once
          // the ID arrives.
          preview.view.alpha = 0
          preview.rangeView.alpha = 0
        } else {
          this.reportLocalProjectileHit(id, preview, hit)
        }
        return
      }
      preview.view.position.set(position.x, position.y)
      preview.view.scale.set(1 / zoom)
      preview.rangeView.position.set(position.x, position.y)
      preview.rangeView.alpha = 1
      drawBlastRange(preview.rangeView, preview.hitRadius, (Math.sin((now / 1000) * Math.PI * 6) + 1) / 2)
      preview.lastPosition = position
      preview.lastSimulationTime = simulationTime
    })

    this.ownerIndicatorViews.forEach((indicator, id) => {
      const owner = this.objectViews.get(id)
      if (!owner) {
        indicator.alpha = 0
        return
      }
      indicator.position.copyFrom(owner.position)
      indicator.scale.set(1 / zoom)
      const life = lifeFraction(this.predictionObjects[id])
      const pulse = life < 0.1
        ? 0.35 + ((Math.sin(now / 65) + 1) / 2) * 0.65
        : life < 0.25
          ? 0.5 + ((Math.sin(now / 220) + 1) / 2) * 0.5
          : 1
      indicator.alpha = owner.alpha * pulse
    })

    this.hitEffectViews.forEach((effect, id) => {
      const target = this.objectViews.get(id)
      const remaining = effect.expiresAt - now
      if (!target || remaining <= 0) {
        effect.view.destroy()
        this.hitEffectViews.delete(id)
        return
      }
      const progress = 1 - remaining / 850
      effect.view.position.copyFrom(target.position)
      effect.view.scale.set((1 / zoom) * (1 + progress * 0.65))
      effect.view.alpha = Math.max(0, 1 - progress) * target.alpha
    })

    this.starDeathEffects.forEach((effect, id) => {
      const elapsed = (now - effect.startedAt) / 1000
      if (elapsed > 3.9) {
        effect.view.destroy()
        this.starDeathEffects.delete(id)
        return
      }
      const maxRadius = Math.hypot(this.host.clientWidth, this.host.clientHeight) / zoom
      drawStarDeathShockwaves(effect.view, elapsed, maxRadius)
      effect.view.position.set(effect.position.x, effect.position.y)
      effect.view.alpha = 1
    })

    this.curveViews.forEach((view, id) => {
      const target = this.curveTargets.get(id)
      const objectId = id.slice(0, id.indexOf(':'))
      const shouldShow = Boolean(target) && !isExpiredProjectile(this.predictionObjects[objectId], simulationTime)
      const visible = Math.max(0, Math.min(1, (this.curveVisibility.get(id) ?? 0) + (shouldShow ? fade : -fade)))
      this.curveVisibility.set(id, visible)
      const current = this.curveStates.get(id)
      if (target && current) {
        const next = interpolateCurve(current, target, easing)
        this.curveStates.set(id, next)
        drawEllipse(view, next)
      }
      view.alpha = visible
      if (!target && visible === 0) {
        view.destroy()
        this.curveViews.delete(id)
        this.curveStates.delete(id)
        this.curveVisibility.delete(id)
      }
    })

    this.radarViews.forEach((view, id) => {
      const owner = this.radarOwners.get(id)
      const object = owner ? this.objectViews.get(owner) : undefined
      if (!object) {
        view.alpha = 0
        return
      }
      view.position.copyFrom(object.position)
      view.alpha = object.alpha
      const radius = this.radarRadii.get(id)
      if (radius) drawRadarRange(view, radius, rippleProgress(id, now))
    })

    this.blastViews.forEach((view, objectId) => {
      const projectile = this.objectViews.get(objectId)
      const radius = this.blastRadii.get(objectId)
      // The local fire-event visual owns this projectile during flight. Do
      // not also render Firebase's blast layer, otherwise its ring can keep
      // moving after the predicted dot has disappeared at contact.
      if (!projectile || !radius || this.localProjectilePreviews.has(objectId) || this.hiddenProjectiles.has(objectId)) {
        view.alpha = 0
        return
      }
      view.position.copyFrom(projectile.position)
      view.alpha = projectile.alpha
      drawBlastRange(view, radius, (Math.sin((now / 1000) * Math.PI * 6) + 1) / 2)
    })
    this.drawTransferPreview()
    this.drawAimPreview()

    const ring = this.selectionRing
    const selected = this.selectedId ? this.objectViews.get(this.selectedId) : undefined
    if (ring && this.selectionLine && this.selectionPanel && selected) {
      const pulse = 1 + Math.sin(now / 260) * 0.12
      ring.position.copyFrom(selected.position)
      ring.scale.set((1 / zoom) * pulse)
      ring.alpha = 0.55 + Math.sin(now / 260) * 0.2
      const panelX = selected.x + 30 / zoom
      const panelY = selected.y - 52 / zoom
      this.selectionPanel.position.set(panelX, panelY)
      this.selectionPanel.scale.set(1 / zoom)
      this.selectionLine.clear()
        .moveTo(selected.x, selected.y)
        .lineTo(panelX, panelY)
        .stroke({ color: 0x79b8ff, width: 1, alpha: 0.85, pixelLine: true })
    }
  }

  private makeObjectCallout(id: string, object: UniverseObject) {
    const panel = new Container()
    const background = new Graphics()
      .roundRect(0, 0, 220, 112, 2)
      .fill({ color: 0x040f19, alpha: 0.94 })
      .stroke({ color: 0x4d738c, width: 1, pixelLine: true })
    const title = new Text({ text: 'SELECTED OBJECT', style: { fill: 0x79b8ff, fontFamily: 'monospace', fontSize: 10 } })
    const name = new Text({ text: id, style: { fill: 0xffffff, fontFamily: 'monospace', fontSize: 13 } })
    const type = new Text({ text: `TYPE      ${object.type ?? 'UNKNOWN'}`, style: { fill: 0xdceeff, fontFamily: 'monospace', fontSize: 11 } })
    const subtype = new Text({ text: `SUBTYPE   ${object.sub_type ?? 'UNKNOWN'}`, style: { fill: 0xdceeff, fontFamily: 'monospace', fontSize: 11 } })
    const life = new Text({ text: `LIFE      ${formatLife(object.life)}`, style: { fill: 0x8ff0bd, fontFamily: 'monospace', fontSize: 11 } })
    title.position.set(13, 11)
    name.position.set(13, 29)
    type.position.set(13, 55)
    subtype.position.set(13, 73)
    life.position.set(13, 91)
    panel.addChild(background, title, name, type, subtype, life)
    return panel
  }

  private refreshObjectSymbol(id: string, view: Container, subtype: string | undefined) {
    this.objectIconSubtypes.set(id, subtype)
    view.removeChildren().forEach((child) => child.destroy())
    const isProjectile = subtype === 'PROJECTILE'
    const isDeadStar = subtype === 'DEAD_STAR'
    const fallbackMarker = new Graphics().circle(0, 0, isProjectile ? 1.8 : isDeadStar ? 5 : 4).fill({ color: isProjectile || isDeadStar ? 0xff4d4d : 0xf2f7ff })
    view.addChild(fallbackMarker)
    if (isProjectile) return
    void this.applySubtypeIcon(id, view, subtype, fallbackMarker)
  }

  private async applySubtypeIcon(id: string, view: Container, subtype: string | undefined, fallbackMarker: Graphics) {
    const url = subtype ? subtypeIconUrls[subtype] : undefined
    if (!url) return
    try {
      const texture = await Assets.load<Texture>(url)
      if (view.destroyed || this.objectIconSubtypes.get(id) !== subtype) return
      const icon = new Sprite(texture)
      icon.anchor.set(0.5)
      icon.width = 18
      icon.height = 18
      icon.tint = 0xf2f7ff
      fallbackMarker.visible = false
      view.addChild(icon)
    } catch (error) {
      console.error(`Could not load icon for subtype ${subtype}:`, error)
    }
  }

  private makeStarfield() {
    const stars = new Graphics()
    for (let i = 0; i < 400; i++) {
      const x = ((i * 919) % 4000) - 2000
      const y = ((i * 613) % 3000) - 1500
      stars.circle(x, y, i % 7 === 0 ? 1.2 : 0.65)
    }
    return stars.fill({ color: 0xffffff, alpha: 0.55 })
  }

  private makeGrid() {
    const grid = new Graphics()
    const size = 5_000
    const step = 100
    for (let coordinate = -size; coordinate <= size; coordinate += step) {
      grid.moveTo(coordinate, -size).lineTo(coordinate, size)
      grid.moveTo(-size, coordinate).lineTo(size, coordinate)
    }
    grid.stroke({ color: 0x1c3549, width: 1, alpha: 0.4, pixelLine: true })
    grid.moveTo(-size, 0).lineTo(size, 0).moveTo(0, -size).lineTo(0, size)
    grid.stroke({ color: 0x47718f, width: 1, alpha: 0.65, pixelLine: true })
    return grid
  }

  private installCameraControls() {
    const canvas = this.app.canvas
    canvas.addEventListener('pointerdown', (event) => {
      if (this.isScreenPointOnPreviewRim(event)) {
        this.dragging = false
        return
      }
      this.dragging = true
      this.zoomAnchor = null
      this.dragStart = { x: event.clientX, y: event.clientY, worldX: this.world.x, worldY: this.world.y }
      canvas.setPointerCapture(event.pointerId)
    })
    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return
      this.world.position.set(this.dragStart.worldX + event.clientX - this.dragStart.x, this.dragStart.worldY + event.clientY - this.dragStart.y)
    })
    canvas.addEventListener('pointerup', () => { this.dragging = false })
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault()
      this.zoomBy(event.deltaY > 0 ? 0.9 : 1.1, { x: event.clientX, y: event.clientY })
    }, { passive: false })
  }

  private clientToCanvasPoint(point: Position): Position {
    const bounds = this.app.canvas.getBoundingClientRect()
    return { x: point.x - bounds.left, y: point.y - bounds.top }
  }

  private startPreviewDrag = (event: FederatedPointerEvent) => {
    if (!this.isOnPreviewRim(event)) return
    event.stopPropagation()
    this.dragging = false
    this.previewDragging = true
    this.app.canvas.style.cursor = 'grabbing'
  }

  private movePreviewDrag = (event: FederatedPointerEvent) => {
    if (!this.previewDragging || !this.previewTargetId) return
    const target = this.objectTargets.get(this.previewTargetId)
    if (!target) return
    const point = this.world.toLocal(event.global)
    const radius = Math.max(20, Math.hypot(point.x - target.x, point.y - target.y))
    this.previewRadius = radius
    this.drawTransferPreview()
    this.onPreviewRadiusChange?.(radius)
  }

  private stopPreviewDrag = () => {
    if (!this.previewDragging) return
    this.previewDragging = false
    this.app.canvas.style.cursor = 'grab'
  }

  private moveAimPreview = (event: FederatedPointerEvent) => {
    if (!this.aimSourceId) return
    this.aimPointer = this.world.toLocal(event.global)
    this.drawAimPreview()
  }

  private drawAimPreview() {
    this.aimPreview.clear()
    if (!this.aimSourceId || !this.aimPointer || this.aimRange <= 0) return
    const source = this.objectViews.get(this.aimSourceId)
    if (!source) return
    const dx = this.aimPointer.x - source.x
    const dy = this.aimPointer.y - source.y
    const length = Math.hypot(dx, dy)
    if (length < 0.001) return
    const directionX = dx / length
    const directionY = dy / length
    const dashLength = 12
    const gapLength = 8
    for (let distance = 0; distance < this.aimRange; distance += dashLength + gapLength) {
      const end = Math.min(this.aimRange, distance + dashLength)
      this.aimPreview
        .moveTo(source.x + directionX * distance, source.y + directionY * distance)
        .lineTo(source.x + directionX * end, source.y + directionY * end)
    }
    this.aimPreview.stroke({ color: 0xffe8a3, width: 1, alpha: 0.85, pixelLine: true })
  }

  private detectPredictedHits(positions: Map<string, Position>, simulationTime: number) {
    const previousTime = this.lastPredictedSimulationTime
    if (previousTime === null || simulationTime <= previousTime) {
      this.lastObjectPositions = new Map(positions)
      this.lastPredictedSimulationTime = simulationTime
      return
    }
    for (const [projectileId, projectile] of Object.entries(this.predictionObjects)) {
      if (
        projectile.sub_type !== 'PROJECTILE'
        || isExpiredProjectile(projectile, simulationTime)
        || this.localProjectilePreviews.has(projectileId)
        || this.hiddenProjectiles.has(projectileId)
        || this.pendingPredictedHits.has(projectileId)
      ) continue
      const radius = projectile.hit_radius
      const current = positions.get(projectileId)
      if (typeof radius !== 'number' || radius <= 0 || !current) continue
      const previous = this.lastObjectPositions.get(projectileId) ?? current
      let firstHit: { targetId: string; fraction: number; clientDistance: number } | null = null
      for (const [targetId, target] of Object.entries(this.predictionObjects)) {
        if (targetId === projectileId || targetId === projectile.source_objectid || target.sub_type === 'PROJECTILE') continue
        const targetPosition = positions.get(targetId)
        const targetPrevious = this.lastObjectPositions.get(targetId) ?? targetPosition
        if (!targetPosition || !targetPrevious) continue
        const fraction = sweptCircleIntersection(previous, current, targetPrevious, targetPosition, radius)
        if (fraction === null || (firstHit && fraction >= firstHit.fraction)) continue
        firstHit = {
          targetId,
          fraction,
          clientDistance: movingDistanceAt(previous, current, targetPrevious, targetPosition, fraction),
        }
      }
      if (firstHit) {
        const hitTime = previousTime + (simulationTime - previousTime) * firstHit.fraction
        this.pendingPredictedHits.set(projectileId, { targetId: firstHit.targetId, predictedAt: hitTime, clientDistance: firstHit.clientDistance })
        this.hiddenProjectiles.add(projectileId)
        this.objectVisibility.set(projectileId, 0)
        this.flashHit(firstHit.targetId)
      }
    }
    this.detectPredictedObjectCollisions(positions, simulationTime)
    this.lastObjectPositions = new Map(positions)
    this.lastPredictedSimulationTime = simulationTime
  }

  private detectPredictedObjectCollisions(positions: Map<string, Position>, simulationTime: number) {
    const previousTime = this.lastPredictedSimulationTime
    if (previousTime === null) return
    const candidates = Object.entries(this.predictionObjects).filter(([, object]) => (
      object.sub_type !== 'PROJECTILE' && typeof object.life === 'number' && object.life > 0
    ))
    for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
      const [firstId, first] = candidates[firstIndex]
      for (const [secondId, second] of candidates.slice(firstIndex + 1)) {
        const pairId = [firstId, secondId].sort().join(':')
        if (this.reportedCollisionPairs.has(pairId)) continue
        const radius = collisionRadius(first, second)
        if (radius === null) continue
        const firstCurrent = positions.get(firstId)
        const secondCurrent = positions.get(secondId)
        if (!firstCurrent || !secondCurrent) continue
        const firstPrevious = this.lastObjectPositions.get(firstId) ?? firstCurrent
        const secondPrevious = this.lastObjectPositions.get(secondId) ?? secondCurrent
        const fraction = sweptCircleIntersection(firstPrevious, firstCurrent, secondPrevious, secondCurrent, radius)
        if (fraction === null) continue
        this.reportedCollisionPairs.add(pairId)
        const hitTime = previousTime + (simulationTime - previousTime) * fraction
        this.flashHit(firstId)
        this.flashHit(secondId)
        this.onCollisionVerification(firstId, secondId, hitTime)
      }
    }
  }

  private detectLocalProjectilePreviewHit(projectileId: string, preview: LocalProjectilePreview, current: Position, simulationTime: number) {
    let firstHit: { targetId: string; fraction: number; clientDistance: number } | null = null
    for (const [targetId, target] of Object.entries(this.predictionObjects)) {
      if (targetId === projectileId || targetId === preview.sourceId || target.sub_type === 'PROJECTILE') continue
      const targetCurrent = this.objectTargets.get(targetId)
      if (!targetCurrent) continue
      const targetPrevious = this.lastObjectPositions.get(targetId) ?? targetCurrent
      const fraction = sweptCircleIntersection(preview.lastPosition, current, targetPrevious, targetCurrent, preview.hitRadius)
      if (fraction === null || (firstHit && fraction >= firstHit.fraction)) continue
      firstHit = {
        targetId,
        fraction,
        clientDistance: movingDistanceAt(preview.lastPosition, current, targetPrevious, targetCurrent, fraction),
      }
    }
    if (!firstHit) return null
    return {
      ...firstHit,
      hitTime: preview.lastSimulationTime + (simulationTime - preview.lastSimulationTime) * firstHit.fraction,
    }
  }

  private reportLocalProjectileHit(projectileId: string, preview: LocalProjectilePreview, hit: { targetId: string; hitTime: number; clientDistance: number }) {
    preview.view.destroy()
    preview.rangeView.destroy()
    this.localProjectilePreviews.delete(projectileId)
    this.pendingPredictedHits.set(projectileId, {
      targetId: hit.targetId,
      predictedAt: hit.hitTime,
      clientDistance: hit.clientDistance,
    })
    this.hiddenProjectiles.add(projectileId)
    this.flashHit(hit.targetId)
  }

  private requestDueHitVerifications(simulationTime: number) {
    for (const [projectileId, pending] of this.pendingPredictedHits) {
      if (pending.verificationRequested) continue
      pending.verificationRequested = true
      this.onHitVerification(projectileId, pending.targetId, pending.predictedAt, pending.clientDistance)
    }
  }

  private localSimulationNow(now: number) {
    return this.localSimulationTime + Math.max(0, (now - this.localSimulationUpdatedAt) / 1000)
  }

  private currentSimulationTime(now: number) {
    return this.simulationPaused ? this.localSimulationTime : this.localSimulationNow(now)
  }

  private isOnPreviewRim(event: FederatedPointerEvent) {
    return this.isWorldPointOnPreviewRim(this.world.toLocal(event.global))
  }

  private isScreenPointOnPreviewRim(event: PointerEvent) {
    const bounds = this.app.canvas.getBoundingClientRect()
    const worldPoint = {
      x: (event.clientX - bounds.left - this.world.x) / this.world.scale.x,
      y: (event.clientY - bounds.top - this.world.y) / this.world.scale.y,
    }
    return this.isWorldPointOnPreviewRim(worldPoint)
  }

  private isWorldPointOnPreviewRim(point: Position) {
    if (!this.previewTargetId) return false
    const target = this.objectTargets.get(this.previewTargetId)
    if (!target) return false
    const distance = Math.hypot(point.x - target.x, point.y - target.y)
    const tolerance = Math.max(18 / this.world.scale.x, this.previewRadius * 0.08)
    return Math.abs(distance - this.previewRadius) <= tolerance
  }

  private drawTransferPreview() {
    const target = this.previewTargetId ? this.objectTargets.get(this.previewTargetId) : undefined
    this.transferPreview.clear()
    if (!target || this.previewRadius <= 0) {
      this.transferPreview.eventMode = 'none'
      return
    }
    this.transferPreview.eventMode = 'static'
    this.transferPreview.position.set(target.x, target.y)
    const dashes = 72
    for (let index = 0; index < dashes; index += 2) {
      const start = (index / dashes) * Math.PI * 2
      const end = ((index + 1) / dashes) * Math.PI * 2
      this.transferPreview.moveTo(Math.cos(start) * this.previewRadius, Math.sin(start) * this.previewRadius)
        .lineTo(Math.cos(end) * this.previewRadius, Math.sin(end) * this.previewRadius)
    }
    this.transferPreview.stroke({ color: 0x70f0ab, width: 2, alpha: 0.9, pixelLine: true })
      .circle(this.previewRadius, 0, Math.max(3 / this.world.scale.x, 1))
      .fill({ color: 0xb3ffd1, alpha: 0.95 })
    // A full circular hit area blocks all objects inside the planned orbit,
    // especially when zoomed out. Only the visible rim is draggable.
    const hitTolerance = Math.max(18 / this.world.scale.x, this.previewRadius * 0.08)
    this.transferPreview.hitArea = {
      contains: (x: number, y: number) => Math.abs(Math.hypot(x, y) - this.previewRadius) <= hitTolerance,
    }
  }
}

function formatLife(life: number | undefined) {
  if (typeof life !== 'number' || !Number.isFinite(life)) return 'UNKNOWN'
  return Number.isInteger(life) ? String(life) : life.toFixed(1)
}

function lifeFraction(object: UniverseObject | undefined) {
  const { life } = object ?? {}
  // Existing universes predate max_life. Keep their health rings useful while
  // generated objects carry the authoritative max_life field going forward.
  const maxLife = object?.max_life
    ?? (object?.type === 'NATURAL' ? 1000 : object?.type === 'ARTIFICIAL' ? 200 : undefined)
  if (typeof life !== 'number' || typeof maxLife !== 'number' || !Number.isFinite(life) || !Number.isFinite(maxLife) || maxLife <= 0) {
    return 1
  }
  return Math.max(0, Math.min(1, life / maxLife))
}

function isStarObject(object: UniverseObject) {
  return object.type === 'NATURAL' && object.sub_type !== 'DEAD_STAR'
}

function drawOwnershipRing(view: Graphics, isOwned: boolean, fraction: number) {
  const baseColor = isOwned ? 0x174b34 : 0x4a171c
  const lifeColor = isOwned ? 0x4dd987 : 0xff5d5d
  const radius = 13
  view.clear()
    .circle(0, 0, radius)
    .stroke({ color: baseColor, width: 2, alpha: 0.95, pixelLine: true })
  if (fraction <= 0) return
  view.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction)
    .stroke({ color: lifeColor, width: 2, alpha: 1, pixelLine: true })
}

function drawStarDeathShockwaves(view: Graphics, elapsed: number, screenRadius: number) {
  view.clear()
  // A hot core flash makes the transition from swollen red star to remnant
  // feel energetic before the larger rings take over.
  const flash = Math.max(0, 1 - elapsed / .72)
  if (flash > 0) {
    view.circle(0, 0, 18 + (1 - flash) * 95)
      .fill({ color: 0xff5a32, alpha: flash * .18 })
    view.circle(0, 0, 10 + (1 - flash) * 42)
      .stroke({ color: 0xffb13d, width: 2.8, alpha: flash, pixelLine: true })
  }
  for (let index = 0; index < STAR_DEATH_WAVE_STARTS.length; index += 1) {
    const progress = Math.max(0, Math.min(1, (elapsed - STAR_DEATH_WAVE_STARTS[index]) / STAR_DEATH_WAVE_DURATIONS[index]))
    if (progress <= 0 || progress >= 1) continue
    const radius = index === 3 ? screenRadius : STAR_DEATH_WAVE_RADII[index]
    view.circle(0, 0, 4 + radius * progress)
      .stroke({ color: index === 3 ? 0xff7548 : 0xff3f3f, width: index === 3 ? 2.4 : 1.8, alpha: 1 - progress, pixelLine: true })
  }
}

function drawBlackHoleRemnant(marker: Graphics) {
  marker.clear()
  // Broad low-alpha halos give the compact remnant an orange glow without
  // hiding its characteristic black centre.
  marker.circle(0, 0, 16).stroke({ color: 0xff6b25, width: 1.5, alpha: .16, pixelLine: true })
  marker.circle(0, 0, 12).stroke({ color: 0xff8a2e, width: 2, alpha: .35, pixelLine: true })
  marker.circle(0, 0, 8).fill({ color: 0x000000, alpha: 1 })
  marker.circle(0, 0, 8).stroke({ color: 0xffa23d, width: 3.4, alpha: 1, pixelLine: true })
}

function interpolateColor(from: number, to: number, progress: number) {
  const amount = Math.max(0, Math.min(1, progress))
  const red = Math.round(((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * amount)
  const green = Math.round(((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * amount)
  const blue = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * amount)
  return (red << 16) | (green << 8) | blue
}

function collisionRadius(first: UniverseObject, second: UniverseObject) {
  const values = [first.border_radius, first.hit_radius, second.border_radius, second.hit_radius]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  return values.length ? Math.max(...values) : null
}

function projectileFiredAt(projectile: UniverseObject) {
  const curves = curveEntries(projectile.curves)
  const straightLine = curves.find(([, curve]) => curve.type === 'STRAIGHT_LINE')?.[1]
  return typeof straightLine?.valid_from === 'number' ? straightLine.valid_from : null
}

function objectPosition(object: UniverseObject): Position | null {
  const x = object.x ?? object.location?.x ?? object.position?.x
  const y = object.y ?? object.location?.y ?? object.position?.y
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null
}

function estimatedUniverseTime(universe: Universe | null) {
  const baseTime = universe?.time ?? 0
  const anchor = universe?.time_updated_at_ms
  if (typeof anchor !== 'number' || !Number.isFinite(anchor)) return baseTime
  return baseTime + Math.max(0, (Date.now() - anchor) / 1000)
}

function sweptCircleIntersection(projectileStart: Position, projectileEnd: Position, targetStart: Position, targetEnd: Position, radius: number) {
  const relativeStartX = projectileStart.x - targetStart.x
  const relativeStartY = projectileStart.y - targetStart.y
  const relativeVelocityX = (projectileEnd.x - projectileStart.x) - (targetEnd.x - targetStart.x)
  const relativeVelocityY = (projectileEnd.y - projectileStart.y) - (targetEnd.y - targetStart.y)
  const a = relativeVelocityX ** 2 + relativeVelocityY ** 2
  const b = 2 * (relativeStartX * relativeVelocityX + relativeStartY * relativeVelocityY)
  const c = relativeStartX ** 2 + relativeStartY ** 2 - radius ** 2
  if (c <= 0) return 0
  if (a <= 1e-12) return null
  const discriminant = b ** 2 - 4 * a * c
  if (discriminant < 0) return null
  const hitFraction = (-b - Math.sqrt(discriminant)) / (2 * a)
  return hitFraction >= 0 && hitFraction <= 1 ? hitFraction : null
}

function movingDistanceAt(projectileStart: Position, projectileEnd: Position, targetStart: Position, targetEnd: Position, fraction: number) {
  const projectileX = projectileStart.x + (projectileEnd.x - projectileStart.x) * fraction
  const projectileY = projectileStart.y + (projectileEnd.y - projectileStart.y) * fraction
  const targetX = targetStart.x + (targetEnd.x - targetStart.x) * fraction
  const targetY = targetStart.y + (targetEnd.y - targetStart.y) * fraction
  return Math.hypot(projectileX - targetX, projectileY - targetY)
}

function isExpiredProjectile(object: UniverseObject | undefined, simulationTime: number) {
  if (object?.sub_type !== 'PROJECTILE') return false
  return curveEntries(object.curves).some(([, curve]) => (
    curve.type === 'STRAIGHT_LINE'
    && typeof curve.valid_till === 'number'
    && simulationTime >= curve.valid_till
  ))
}

function frameNaturalObjects(entries: [string, UniverseObject][], width: number, height: number) {
  const positions = entries
    .filter(([, object]) => object.type === 'NATURAL')
    .map(([, object]) => objectPosition(object))
    .filter((position): position is Position => position !== null)
  if (!positions.length || width <= 0 || height <= 0) return null
  const minX = Math.min(...positions.map((position) => position.x))
  const maxX = Math.max(...positions.map((position) => position.x))
  const minY = Math.min(...positions.map((position) => position.y))
  const maxY = Math.max(...positions.map((position) => position.y))
  // Extra breathing room around the outermost stars so the opening frame
  // reads as a complete universe rather than a tightly cropped map.
  const padding = 260
  const spanX = Math.max(120, maxX - minX + padding * 2)
  const spanY = Math.max(120, maxY - minY + padding * 2)
  return {
    focus: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    zoom: Math.min(2, Math.max(0.08, Math.min(width / spanX, height / spanY))),
  }
}

function drawHitRing(graphics: Graphics, color: number) {
  graphics.clear().circle(0, 0, 14).stroke({ color, width: 2, alpha: 1, pixelLine: true })
}

function curveEntries(curves: UniverseObject['curves']): [string, Curve][] {
  if (Array.isArray(curves)) {
    return curves.flatMap((curve, index) => curve && typeof curve === 'object' ? [[String(index), curve] as [string, Curve]] : [])
  }
  return Object.entries(curves ?? {}).filter((entry): entry is [string, Curve] => Boolean(entry[1]) && typeof entry[1] === 'object')
}

function curveState(focus: Position, curve: Curve): CurveState {
  const a = curve.major_axis
  const b = curve.minor_axis ?? a * Math.sqrt(Math.max(0, 1 - curve.eccentricity ** 2))
  const rotation = (curve.rotation * Math.PI) / 180
  if (curve.motion_type === 'INTERSTELLAR_ELLIPSE' && curve.centre) {
    const centre = { x: curve.centre.x ?? 0, y: curve.centre.y ?? 0 }
    const basisU = { x: curve.basis_u?.x ?? a, y: curve.basis_u?.y ?? 0 }
    const basisV = { x: curve.basis_v?.x ?? 0, y: curve.basis_v?.y ?? b }
    return {
      x: centre.x, y: centre.y, a, b, rotation, dotted: Boolean(curve.dotted),
      transferArc: { centre, basisU, basisV, phaseStart: curve.phase_start ?? 0, phaseEnd: curve.phase_end ?? Math.PI / 2 },
    }
  }
  const c = a * curve.eccentricity
  const centre = { x: focus.x - c * Math.cos(rotation), y: focus.y - c * Math.sin(rotation) }
  if (curve.motion_type === 'HOHMANN_TRANSFER') {
    return {
      x: centre.x, y: centre.y, a, b, rotation, dotted: Boolean(curve.dotted),
      transferArc: {
        centre,
        basisU: { x: a * Math.cos(rotation), y: a * Math.sin(rotation) },
        basisV: { x: -b * Math.sin(rotation), y: b * Math.cos(rotation) },
        phaseStart: curve.phase_start ?? 0,
        phaseEnd: curve.phase_end ?? Math.PI,
      },
    }
  }
  return {
    x: centre.x,
    y: centre.y,
    a,
    b,
    rotation,
    dotted: Boolean(curve.dotted),
  }
}

function interpolateCurve(current: CurveState, target: CurveState, amount: number): CurveState {
  return {
    x: current.x + (target.x - current.x) * amount,
    y: current.y + (target.y - current.y) * amount,
    a: current.a + (target.a - current.a) * amount,
    b: current.b + (target.b - current.b) * amount,
    rotation: current.rotation + (target.rotation - current.rotation) * amount,
    dotted: target.dotted,
    transferArc: target.transferArc,
  }
}

function drawEllipse(graphics: Graphics, curve: CurveState) {
  graphics.clear()
  if (curve.transferArc) {
    const { centre, basisU, basisV, phaseStart, phaseEnd } = curve.transferArc
    const samples = 96
    for (let index = 0; index <= samples; index++) {
      const phase = phaseStart + ((phaseEnd - phaseStart) * index) / samples
      const x = centre.x + basisU.x * Math.cos(phase) + basisV.x * Math.sin(phase)
      const y = centre.y + basisU.y * Math.cos(phase) + basisV.y * Math.sin(phase)
      if (index === 0) graphics.moveTo(x, y)
      else graphics.lineTo(x, y)
    }
    graphics.stroke({ color: 0x42637f, width: 1, alpha: 0.9, pixelLine: true })
    graphics.position.set(0, 0)
    graphics.rotation = 0
    return
  }
  if (curve.dotted) {
    const segments = 72
    for (let index = 0; index < segments; index += 2) {
      const start = (index / segments) * Math.PI * 2
      const end = ((index + 1) / segments) * Math.PI * 2
      graphics.moveTo(Math.cos(start) * curve.a, Math.sin(start) * curve.b)
        .lineTo(Math.cos(end) * curve.a, Math.sin(end) * curve.b)
    }
    graphics.stroke({ color: 0x70f0ab, width: 1, alpha: 0.9, pixelLine: true })
  } else {
    graphics.ellipse(0, 0, curve.a, curve.b).stroke({ color: 0x42637f, width: 1, alpha: 0.8, pixelLine: true })
  }
  graphics.position.set(curve.x, curve.y)
  graphics.rotation = curve.rotation
}

function drawRadarRange(graphics: Graphics, radius: number, ripple: number) {
  graphics.clear()
    .circle(0, 0, radius)
    .fill({ color: 0x42ff79, alpha: 0.08 })
    .stroke({ color: 0x42ff79, width: 1, alpha: 0.55, pixelLine: true })
    .circle(0, 0, radius * 0.5)
    .stroke({ color: 0x42ff79, width: 1, alpha: 0.2, pixelLine: true })
    .circle(0, 0, radius * ripple)
    .stroke({ color: 0x9cffb5, width: 1, alpha: (1 - ripple) * 0.7, pixelLine: true })
}

function drawBlastRange(graphics: Graphics, radius: number, flicker: number) {
  graphics.clear()
    .circle(0, 0, radius)
    .fill({ color: 0xff2f2f, alpha: 0.045 + flicker * 0.08 })
    .stroke({ color: 0xff5a52, width: 1, alpha: 0.2 + flicker * 0.35, pixelLine: true })
}

function rippleProgress(id: string, now: number) {
  const offset = [...id].reduce((total, character) => total + character.charCodeAt(0), 0) % 2500
  return ((now + offset) % 2500) / 2500
}
