import { useEffect, useRef, useState } from 'react'
import { playUiClick } from '../audio/sfx'

const tracks = [
  { title: 'lo-fi space', artist: 'Music-for-Videos', src: 'https://cdn.pixabay.com/audio/2024/01/23/audio_fc7f78c2a0.mp3' },
  { title: 'Neptune / Lofi', artist: 'LofCosmos', src: 'https://cdn.pixabay.com/audio/2025/04/10/audio_6724301322.mp3' },
  { title: 'Subspace Daydream', artist: 'RubyZephyr', src: 'https://cdn.pixabay.com/audio/2026/02/25/audio_52674f8230.mp3' },
  { title: 'Night Whispers / Lofi', artist: 'LofCosmos', src: 'https://cdn.pixabay.com/audio/2025/03/17/audio_295ad9df2d.mp3' },
]

export function MusicPlayer() {
  const audio = useRef<HTMLAudioElement>(null)
  const hasStarted = useRef(false)
  const fadeFrame = useRef<number | null>(null)
  const [trackIndex, setTrackIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.16)
  const track = tracks[trackIndex]

  const startPlayback = async () => {
    const player = audio.current
    if (!player) return
    try {
      await player.play()
      setPlaying(true)
      if (!hasStarted.current) {
        hasStarted.current = true
        player.volume = 0
        const startTime = performance.now()
        const fadeIn = (now: number) => {
          const progress = Math.min(1, (now - startTime) / 1600)
          player.volume = volume * progress
          if (progress < 1) fadeFrame.current = requestAnimationFrame(fadeIn)
        }
        fadeFrame.current = requestAnimationFrame(fadeIn)
      }
    } catch (error) {
      console.error('Could not start playlist playback:', error)
    }
  }

  useEffect(() => {
    const player = audio.current
    if (!player) return
    player.volume = volume
  }, [volume])

  useEffect(() => () => {
    if (fadeFrame.current !== null) cancelAnimationFrame(fadeFrame.current)
  }, [])

  useEffect(() => {
    const player = audio.current
    if (!player) return
    void startPlayback()
  }, [])

  useEffect(() => {
    // A map click, drag, zoom-control click, or key press counts as the user
    // gesture browsers require before audible playback can begin.
    const startFromFirstInteraction = () => {
      void startPlayback()
      window.removeEventListener('pointerdown', startFromFirstInteraction)
      window.removeEventListener('keydown', startFromFirstInteraction)
    }
    window.addEventListener('pointerdown', startFromFirstInteraction)
    window.addEventListener('keydown', startFromFirstInteraction)
    return () => {
      window.removeEventListener('pointerdown', startFromFirstInteraction)
      window.removeEventListener('keydown', startFromFirstInteraction)
    }
  }, [])

  useEffect(() => {
    const player = audio.current
    if (!player) return
    player.load()
    if (playing) void player.play().catch(() => setPlaying(false))
  }, [trackIndex])

  const togglePlayback = async () => {
    const player = audio.current
    if (!player) return
    if (playing) {
      player.pause()
      setPlaying(false)
      return
    }
    await startPlayback()
  }

  const nextTrack = () => setTrackIndex((index) => (index + 1) % tracks.length)

  return (
    <div className="music-player" aria-label="Background music player">
      <audio ref={audio} src={track.src} preload="none" onEnded={nextTrack} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      <button type="button" className="music-play" onClick={() => { playUiClick(); void togglePlayback() }} aria-label={playing ? 'Pause music' : 'Play music'}>
        {playing ? 'Ⅱ' : '▶'}
      </button>
      <div className="music-track">
        <span>AMBIENT PLAYLIST · {trackIndex + 1}/{tracks.length}</span>
        <strong>{track.title}</strong>
        <small>{track.artist}</small>
      </div>
      <button type="button" className="music-next" onClick={() => { playUiClick(); nextTrack() }} aria-label="Next track">›</button>
      <input aria-label="Music volume" type="range" min="0" max="0.4" step="0.01" value={volume} onPointerDown={playUiClick} onChange={(event) => setVolume(Number(event.target.value))} />
    </div>
  )
}
