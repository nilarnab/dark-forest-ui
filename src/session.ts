const usernameKey = 'username'
const careerGuestUserKey = 'career_guest_user_id'

export function cachedUsername() {
  return sessionStorage.getItem(usernameKey)
}

export function cacheUsername(username: string) {
  sessionStorage.setItem(usernameKey, username)
}

export function cachedCareerGuestUserId() {
  return localStorage.getItem(careerGuestUserKey)
}

export function cacheCareerGuestUserId(userId: string) {
  localStorage.setItem(careerGuestUserKey, userId)
}

/** The current gameplay owner ID. A pending career identity is not a login. */
export function cachedPlayerId() {
  return cachedUsername() ?? cachedCareerGuestUserId()
}
