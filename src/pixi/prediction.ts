import type { Curve, UniverseObject } from '../types/universe'

export type Position = { x: number; y: number }

const TAU = Math.PI * 2

export function predictPositions(objects: Record<string, UniverseObject>, simulationTime: number): Map<string, Position> {
  const positions = new Map<string, Position>()
  const evaluating = new Set<string>()

  function predictObject(id: string): Position | null {
    const cached = positions.get(id)
    if (cached) return cached
    if (evaluating.has(id)) return storedPosition(objects[id])
    const object = objects[id]
    if (!object) return null
    evaluating.add(id)
    const curve = activeCurve(object.curves, simulationTime)
    const position = curve ? predictCurve(curve, object, predictObject, simulationTime) : storedPosition(object)
    evaluating.delete(id)
    if (position) positions.set(id, position)
    return position
  }

  Object.keys(objects).forEach(predictObject)
  return positions
}

function activeCurve(curves: UniverseObject['curves'], time: number): Curve | null {
  for (const curve of curveList(curves)) {
    const validFrom = number(curve.valid_from, Number.NEGATIVE_INFINITY)
    const validTill = number(curve.valid_till, -1)
    const scheduled = curve.active === true || curve.valid_from !== undefined
    // Keep an expired projectile at its endpoint until the worker removes
    // the whole object on the next tick. Otherwise it falls back to an old
    // Firebase location and visibly flies backwards.
    if (scheduled && validFrom <= time && (validTill === -1 || time < validTill || curve.type === 'STRAIGHT_LINE')) return curve
  }
  return null
}

function curveList(curves: UniverseObject['curves']): Curve[] {
  if (Array.isArray(curves)) return curves.filter((curve): curve is Curve => Boolean(curve) && typeof curve === 'object')
  return Object.values(curves ?? {}).filter((curve): curve is Curve => Boolean(curve) && typeof curve === 'object')
}

function predictCurve(curve: Curve, object: UniverseObject, focus: (id: string) => Position | null, time: number): Position | null {
  const phase = number(curve.phase, initialPhase(curve, object, focus))
  const velocity = Math.max(0, number(curve.velocity, 0))

  if (curve.type === 'STRAIGHT_LINE' || curve.motion_type === 'STRAIGHT_LINE') {
    const start = curve.start_location
    const vector = curve.direction_vector
    if (typeof start?.x !== 'number' || typeof start?.y !== 'number' || typeof vector?.x !== 'number' || typeof vector?.y !== 'number') return storedPosition(object)
    const length = Math.hypot(vector.x, vector.y)
    if (length === 0) return { x: start.x, y: start.y }
    // A projectile has no orbital phase. Its valid_from is its one stable
    // time reference, so evaluate it from that point on every render frame.
    const validTill = number(curve.valid_till, -1)
    const evaluationTime = validTill === -1 ? time : Math.min(time, validTill)
    const elapsed = Math.max(0, evaluationTime - number(curve.valid_from, evaluationTime))
    return { x: start.x + (vector.x / length) * velocity * elapsed, y: start.y + (vector.y / length) * velocity * elapsed }
  }

  const elapsed = Math.max(0, time - number(curve.phase_updated_at, time))

  if (curve.motion_type === 'INTERSTELLAR_ELLIPSE') {
    const centre = asPosition(curve.centre)
    const basisU = asPosition(curve.basis_u)
    const basisV = asPosition(curve.basis_v)
    if (!centre || !basisU || !basisV) return storedPosition(object)
    const nextPhase = advanceBasisPhase(phase, velocity, elapsed, basisU, basisV)
    return basisPosition(centre, basisU, basisV, nextPhase)
  }

  if (!curve.focus1) return storedPosition(object)
  const focusPosition = focus(curve.focus1)
  if (!focusPosition) return storedPosition(object)
  const a = number(curve.major_axis, 0)
  const eccentricity = number(curve.eccentricity, 0)
  if (a <= 0 || eccentricity < 0 || eccentricity >= 1) return storedPosition(object)
  const b = a * Math.sqrt(Math.max(0, 1 - eccentricity ** 2))
  const nextPhase = advancePhase(phase, velocity, elapsed, a, b, curve.direction)
  return ellipsePosition(focusPosition, a, eccentricity, number(curve.rotation, 0), nextPhase)
}

function initialPhase(curve: Curve, object: UniverseObject, focus: (id: string) => Position | null): number {
  const position = storedPosition(object)
  const focusPosition = curve.focus1 ? focus(curve.focus1) : null
  if (!position || !focusPosition) return 0
  const a = number(curve.major_axis, 0)
  const b = a * Math.sqrt(Math.max(0, 1 - number(curve.eccentricity, 0) ** 2))
  if (a <= 0 || b <= 0) return 0
  const rotation = (number(curve.rotation, 0) * Math.PI) / 180
  const c = a * number(curve.eccentricity, 0)
  const centreX = focusPosition.x - c * Math.cos(rotation)
  const centreY = focusPosition.y - c * Math.sin(rotation)
  const dx = position.x - centreX
  const dy = position.y - centreY
  const localX = dx * Math.cos(rotation) + dy * Math.sin(rotation)
  const localY = -dx * Math.sin(rotation) + dy * Math.cos(rotation)
  return Math.atan2(localY / b, localX / a)
}

function advancePhase(phase: number, velocity: number, seconds: number, a: number, b: number, direction: number | undefined): number {
  const distance = velocity * seconds
  if (distance === 0) return phase % TAU
  // In event-driven mode phase_updated_at may be old. Do not replay an
  // entire universe lifetime on every rendered frame.
  const steps = Math.min(160, Math.max(1, Math.ceil(distance / Math.max(1, Math.min(a, b) * 0.03))))
  const distancePerStep = distance / steps
  const sign = number(direction, 1) > 0 ? 1 : -1
  let result = phase
  for (let index = 0; index < steps; index++) {
    const estimate = sign * distancePerStep / Math.max(ellipseSpeed(result, a, b), 1e-9)
    result += sign * distancePerStep / Math.max(ellipseSpeed(result + estimate / 2, a, b), 1e-9)
  }
  return ((result % TAU) + TAU) % TAU
}

function advanceBasisPhase(phase: number, velocity: number, seconds: number, u: Position, v: Position): number {
  const distance = velocity * seconds
  if (distance === 0) return phase
  const steps = Math.min(160, Math.max(1, Math.ceil(distance / Math.max(1, Math.min(Math.hypot(u.x, u.y), Math.hypot(v.x, v.y)) * 0.03))))
  let result = phase
  for (let index = 0; index < steps; index++) {
    const stepDistance = distance / steps
    const estimate = stepDistance / Math.max(basisSpeed(result, u, v), 1e-9)
    result += stepDistance / Math.max(basisSpeed(result + estimate / 2, u, v), 1e-9)
  }
  return result
}

function ellipsePosition(focus: Position, a: number, eccentricity: number, rotationDegrees: number, phase: number): Position {
  const rotation = (rotationDegrees * Math.PI) / 180
  const b = a * Math.sqrt(Math.max(0, 1 - eccentricity ** 2))
  const c = a * eccentricity
  const centreX = focus.x - c * Math.cos(rotation)
  const centreY = focus.y - c * Math.sin(rotation)
  const localX = a * Math.cos(phase)
  const localY = b * Math.sin(phase)
  return { x: centreX + localX * Math.cos(rotation) - localY * Math.sin(rotation), y: centreY + localX * Math.sin(rotation) + localY * Math.cos(rotation) }
}

function basisPosition(centre: Position, u: Position, v: Position, phase: number): Position {
  return { x: centre.x + u.x * Math.cos(phase) + v.x * Math.sin(phase), y: centre.y + u.y * Math.cos(phase) + v.y * Math.sin(phase) }
}

function ellipseSpeed(phase: number, a: number, b: number) { return Math.hypot(a * Math.sin(phase), b * Math.cos(phase)) }
function basisSpeed(phase: number, u: Position, v: Position) { return Math.hypot(-u.x * Math.sin(phase) + v.x * Math.cos(phase), -u.y * Math.sin(phase) + v.y * Math.cos(phase)) }
function number(value: unknown, fallback: number) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }

function storedPosition(object: UniverseObject | undefined): Position | null {
  const x = object?.location?.x ?? object?.position?.x ?? object?.x
  const y = object?.location?.y ?? object?.position?.y ?? object?.y
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null
}

function asPosition(value: { x?: number; y?: number } | undefined): Position | null {
  return typeof value?.x === 'number' && typeof value.y === 'number' ? { x: value.x, y: value.y } : null
}
