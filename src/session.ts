const usernameKey = 'username'
const careerGuestUserKey = 'career_guest_user_id'
const universeInviteGuestUserKey = 'universe_invite_guest_user_id'

export function cachedUsername() {
  return sessionStorage.getItem(usernameKey)
}

export function cacheUsername(username: string) {
  localStorage.removeItem(universeInviteGuestUserKey)
  sessionStorage.setItem(usernameKey, username)
}

export function cachedCareerGuestUserId() {
  return localStorage.getItem(careerGuestUserKey)
}

export function cacheCareerGuestUserId(userId: string) {
  localStorage.removeItem(universeInviteGuestUserKey)
  localStorage.setItem(careerGuestUserKey, userId)
}

export function cachedUniverseInviteGuestUserId() {
  return localStorage.getItem(universeInviteGuestUserKey)
}

export function cacheUniverseInviteGuestUserId(userId: string) {
  localStorage.setItem(universeInviteGuestUserKey, userId)
}

/**
 * Allocate the guest identity before making the join request. React's
 * development effect replay may abort/retry that request; using the same ID
 * makes the backend transaction idempotent rather than creating two guests.
 */
export function ensureUniverseInviteGuestUserId() {
  const existing = cachedUniverseInviteGuestUserId()
  if (existing) return existing
  const id = `guest_user_${crypto.randomUUID().replace(/-/g, '')}`
  cacheUniverseInviteGuestUserId(id)
  return id
}

/** The current gameplay owner ID. A pending career identity is not a login. */
export function cachedPlayerId() {
  return cachedUniverseInviteGuestUserId() ?? cachedUsername() ?? cachedCareerGuestUserId()
}
