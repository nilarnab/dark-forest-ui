import { getApp, getApps, initializeApp } from 'firebase/app'
import { getDatabase, onValue, ref } from 'firebase/database'
import type { AppDispatch } from '../store'
import { universeReceived } from '../store/universeSlice'
import type { Universe } from '../types/universe'

const defaultUniverseId = 'univid1123'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export function currentUniverseId() {
  const requested = new URLSearchParams(window.location.search).get('universe')?.trim()
  return requested || defaultUniverseId
}

export function firebaseDatabase() {
  if (!config.databaseURL) {
    throw new Error('Firebase is not configured. Add VITE_FIREBASE_DATABASE_URL and the other values to .env.local.')
  }
  const app = getApps().length ? getApp() : initializeApp(config)
  return getDatabase(app)
}

export function subscribeToUniverse(dispatch: AppDispatch, universeId = currentUniverseId()): () => void {
  let database
  try {
    database = firebaseDatabase()
  } catch (error) {
    console.warn(error instanceof Error ? error.message : 'Firebase is not configured.')
    return () => undefined
  }
  return onValue(ref(database, `universes/${universeId}`), (snapshot) => {
    const universe = snapshot.val() as Universe | null
    console.log(`[Firebase] Received universes/${universeId}:`, universe)
    dispatch(universeReceived(universe))
  }, (error) => {
    console.error(`[Firebase] Could not read universes/${universeId}:`, error)
  })
}
