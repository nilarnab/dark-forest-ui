const usernameKey = 'username'

export function cachedUsername() {
  return sessionStorage.getItem(usernameKey)
}

export function cacheUsername(username: string) {
  sessionStorage.setItem(usernameKey, username)
}
