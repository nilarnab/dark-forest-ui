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

/** The current gameplay owner ID. A pending career identity is not a login. */
export function cachedPlayerId() {
  return cachedUniverseInviteGuestUserId() ?? cachedUsername() ?? cachedCareerGuestUserId()
}
