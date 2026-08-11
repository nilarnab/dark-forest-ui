export interface Curve {
  type?: 'ELLIPSE' | 'STRAIGHT_LINE' | string
  eccentricity: number
  focus1?: string
  major_axis: number
  minor_axis?: number
  rotation: number
  valid_till?: number
  valid_from?: number
  motion_type?: 'INTERSTELLAR_ELLIPSE' | 'ORBIT' | string
  centre?: { x?: number; y?: number }
  basis_u?: { x?: number; y?: number }
  basis_v?: { x?: number; y?: number }
  phase_start?: number
  phase_end?: number
  phase?: number
  phase_updated_at?: number
  velocity?: number
  direction?: number
  start_location?: { x?: number; y?: number }
  direction_vector?: { x?: number; y?: number }
  dotted?: boolean
  active?: boolean
}

export interface UniverseObject {
  curves?: Curve[] | Record<string, Curve>
  type?: string
  owner?: string | null
  sub_type?: string
  life?: number
  max_life?: number
  blast_impact?: number
  border_radius?: number
  x?: number
  y?: number
  location?: { x?: number; y?: number }
  position?: { x?: number; y?: number }
  objects?: Record<string, AttachedObject>
  maneuver_blocked_till?: number
  hit_radius?: number
  source_objectid?: string
  delete_at?: number
}

export interface AttachedObject {
  type?: string
  radius?: number
  velocity?: number
  [property: string]: unknown
}

export interface Universe {
  active?: boolean
  objects?: Record<string, UniverseObject>
  time?: number
  time_updated_at_ms?: number
  events?: Record<string, UniverseEvent>
}

export interface UniverseEvent {
  type?: string
  projectile_id?: string
  target_id?: string
  hit_time?: number
  location?: { x?: number; y?: number }
}
