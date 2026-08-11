const clickSound = new Audio('/audio/select_007.ogg')
const gunFireSound = new Audio('/audio/minimize_004.ogg')

clickSound.volume = 0.35
gunFireSound.volume = 0.45

function play(sound: HTMLAudioElement, label: string) {
  sound.currentTime = 0
  void sound.play().catch((error) => console.error(`Could not play ${label} sound:`, error))
}

export function playUiClick() {
  play(clickSound, 'UI click')
}

export function playGunFire() {
  play(gunFireSound, 'gun fire')
}
