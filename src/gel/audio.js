// Audio layer for the gel stage: a click per element the pointer moves onto,
// and a swoosh per breathing sweep. Starts muted — browsers require a gesture.
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22]   // minor pentatonic, two octaves

class GelAudio {
  constructor() {
    this.on = false
    this.ctx = null
    this.lastCell = -1
    this.lastBell = 0
    this.sample = null
    this.swoosh = null
    this.sampleReq = null
    this.lastSweep = 0
  }

  // uploaded samples, decoded once: the click for hover, the swoosh for the
  // breathing sweep
  loadSample() {
    if (this.sampleReq || !this.ctx) return
    const grab = (url) => fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => this.ctx.decodeAudioData(b))
    this.sampleReq = Promise.all([
      grab('/uploads/click-high.mp3').then((b) => { this.sample = b }).catch(() => {}),
      grab('/uploads/swoosh.mp3').then((b) => { this.swoosh = b }).catch(() => {})
    ])
  }

  // one swoosh per pill, fired as the sweep band reaches it. Each shot draws
  // its own pitch; gain scales down as more pills fire at once.
  sweep(voices) {
    if (!this.on || !this.ctx || !this.swoosh) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.swoosh
    src.playbackRate.value = 0.72 + Math.random() * 0.56
    const g = this.ctx.createGain()
    g.gain.value = 0.30 / Math.sqrt(Math.max(voices || 1, 1))
    src.connect(g).connect(this.wet)
    src.start(t + Math.random() * 0.05)
  }

  build() {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return false
    const ctx = this.ctx = new AC()
    const out = this.master = ctx.createGain()
    out.gain.value = 0
    out.connect(ctx.destination)

    // the click sample is the only voice: straight to the master
    const wet = this.wet = ctx.createGain()
    wet.gain.value = 1
    wet.connect(out)
    return true
  }

  // resume first: only commit the state once the context is actually running,
  // so the flag, the gain ramp and the UI can never disagree
  async toggle() {
    if (!this.ctx && !this.build()) return this.on
    const want = !this.on
    if (want) {
      try { await this.ctx.resume() } catch (e) { return this.on }
      if (this.ctx.state !== 'running') return this.on
      this.loadSample()
    }
    this.on = want
    const t = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setTargetAtTime(want ? 0.5 : 0, t, want ? 1.6 : 0.5)
    if (!want) setTimeout(() => { if (!this.on) this.ctx.suspend() }, 900)
    return this.on
  }

  // hard mute, for when the host unmounts the stage
  silence() {
    if (!this.ctx) return
    this.on = false
    this.master.gain.cancelScheduledValues(this.ctx.currentTime)
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15)
    setTimeout(() => { if (!this.on) this.ctx.suspend() }, 400)
  }

  // the uploaded click, one shot per element the pointer moves onto. Every
  // shot draws its own pitch, so no two hits share a rate.
  bell(index, bright) {
    if (!this.on || !this.ctx || !this.sample) return
    const t = this.ctx.currentTime
    if (t - this.lastBell < 0.05) return
    this.lastBell = t
    const src = this.ctx.createBufferSource()
    src.buffer = this.sample
    // independent per-shot pitch: a random pentatonic step, then a random
    // detune on top of it
    const semi = SCALE[Math.floor(Math.random() * SCALE.length)]
    src.playbackRate.value = Math.pow(2, (semi - 11) / 24) * (1 + (Math.random() - 0.5) * 0.14)
    const g = this.ctx.createGain()
    g.gain.value = 0.55 * (0.5 + bright * 0.5)
    src.connect(g).connect(this.wet)
    src.start(t)
  }

  frame() {}
}

export const gelAudio = new GelAudio()
