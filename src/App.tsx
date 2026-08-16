import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { subscribeToUniverse } from './firebase/listener'
import type { AppDispatch } from './store'
import { GalaxyView } from './components/GalaxyView'
import { MusicPlayer } from './components/MusicPlayer'
import { IntroPage } from './components/IntroPage'
import { LoginPage } from './components/LoginPage'
import { UniversePage } from './components/UniversePage'
import { CreateUniversePage } from './components/CreateUniversePage'
import { DarkForestIntroPage } from './components/DarkForestIntroPage'
import { currentUniverseId } from './firebase/listener'
import { cachedPlayerId } from './session'
import { LevelOneInvitePage } from './components/LevelOneInvitePage'

export default function App() {
  const dispatch = useDispatch<AppDispatch>()
  const isIntro = window.location.pathname === '/' || window.location.pathname === '/intro'
  const isLogin = window.location.pathname === '/intro/login'
  const isDarkForestIntro = window.location.pathname === '/intro/darkforest'
  const isUniverseSelection = window.location.pathname === '/intro/universe'
  const isUniverseCreation = window.location.pathname === '/intro/universe/new'
  const isLevelOneInvite = window.location.pathname === '/invite/level1'
  const isGame = !isIntro && !isLogin && !isDarkForestIntro && !isUniverseSelection && !isUniverseCreation && !isLevelOneInvite
  useEffect(() => {
    if (isIntro || isLogin || isDarkForestIntro || isUniverseSelection || isUniverseCreation || isLevelOneInvite) return
    return subscribeToUniverse(dispatch)
  }, [dispatch, isIntro, isLogin, isDarkForestIntro, isUniverseSelection, isUniverseCreation, isLevelOneInvite])
  useEffect(() => {
    if (!isGame) return
    const username = cachedPlayerId()
    if (!username) return
    const universeId = currentUniverseId()
    const apiUrl = import.meta.env.VITE_SIMULATION_API_URL ?? 'http://localhost:5000'
    const heartbeat = () => {
      void fetch(`${apiUrl}/auth/universe/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, universe_id: universeId }),
      }).catch(() => undefined)
    }
    heartbeat()
    const timer = window.setInterval(heartbeat, 20_000)
    return () => window.clearInterval(timer)
  }, [isGame])
  if (isIntro) return <IntroPage />
  if (isDarkForestIntro) return <DarkForestIntroPage />
  if (isLogin) return <LoginPage />
  if (isUniverseSelection) return <UniversePage />
  if (isUniverseCreation) return <CreateUniversePage />
  if (isLevelOneInvite) return <LevelOneInvitePage />
  return <GalaxyView musicControl={<MusicPlayer />} />
}
