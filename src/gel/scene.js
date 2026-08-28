// The gel stage: colour-field RT, lens/refraction-map RT, then the surface
// pass. Ported from the <gel-stage> custom element to a plain class so React
// owns the mount, the options and the teardown.
import * as THREE from 'three'
import { GEL_SHADER } from './shader.js'
import { gelAudio } from './audio.js'
import { GEL_DEFAULTS, DEFAULT_PALETTE, MAX_STOPS } from './config.js'

// three r152+ turned colour management on and made the output sRGB-encoded.
// The design was authored against r150, whose defaults were the opposite, so
// the passes are kept linear here or every colour shifts.
THREE.ColorManagement.enabled = false

const easeOut = (x) => 1 - Math.pow(1 - x, 3)

export class GelStage {
  constructor(host, { options = {}, palette = DEFAULT_PALETTE, onAudioChange, autoStartAudio = true } = {}) {
    this.host = host
    this.opts = { ...GEL_DEFAULTS, ...options }
    this.onAudioChange = onAudioChange
    this.time = 0
    this.frame = 0
    this.fps = 0
    this.running = false
    this.visible = true
    this.start = 0
    this.disposed = false

    Object.assign(host.style, { display: 'block', position: 'relative', width: '100%', height: '100%' })

    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.touch = matchMedia('(pointer: coarse)').matches

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.renderer.setClearColor(0x000000, 1)
    Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' })
    host.appendChild(this.renderer.domElement)

    const rtOpts = { depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
    const CW = this.touch ? 512 : 768
    this.rtA = new THREE.WebGLRenderTarget(CW, CW, rtOpts)
    this.rtB = new THREE.WebGLRenderTarget(CW, CW, rtOpts)
    this.rtC = new THREE.WebGLRenderTarget(CW, CW, rtOpts)
    ;[this.rtA, this.rtB, this.rtC].forEach((rt) => {
      rt.texture.wrapS = THREE.MirroredRepeatWrapping
      rt.texture.wrapT = THREE.MirroredRepeatWrapping
      rt.texture.generateMipmaps = false
    })
    this.rtH = new THREE.WebGLRenderTarget(2, 2, rtOpts)   // sized in resize()
    this.rtH.texture.generateMipmaps = false
    this.texel = new THREE.Vector2(1 / CW, 1 / CW)

    this.camera = new THREE.Camera()
    this.scene = new THREE.Scene()
    this.geo = new THREE.PlaneGeometry(2, 2)

    this.uColorP = {
      uTime: { value: 0 }, uHue: { value: 0 }, uOct: { value: 5 },
      uNScale: { value: 2.6 }, uNWarp: { value: 1 }, uNContrast: { value: 1 },
      uNSpeed: { value: 1 }, uNMix: { value: 1 },
      uPal: { value: Array.from({ length: MAX_STOPS }, () => new THREE.Color(1, 1, 1)) },
      uPalN: { value: 5 }
    }
    this.setPalette(palette)
    this.uBlur = {
      uTex: { value: null }, uTexel: { value: this.texel },
      uDir: { value: new THREE.Vector2(1, 0) }, uRadius: { value: 2 }
    }
    const grid = () => ({
      uElemW: { value: 220 }, uElemH: { value: 340 }, uRadius: { value: 32 },
      uCols: { value: 4 }, uRows: { value: 3 }, uGapX: { value: 48 }, uGapY: { value: 48 }
    })
    this.uHeight = Object.assign({
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 }, uReduced: { value: this.reduced ? 1 : 0 },
      uBreath: { value: 0 }, uBreathAmt: { value: 0.055 },
      uIntro: { value: 0 }
    }, grid())
    this.uFinal = Object.assign(grid(), {
      uColor: { value: this.rtC.texture },
      uHeight: { value: this.rtH.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 }, uFocus: { value: 0 },
      uGlow: { value: 1 }, uHilite: { value: 1 }, uRefract: { value: 1 },
      uVoidRX: { value: 0.22 }, uVoidRY: { value: 0.29 }, uStretch: { value: 1.8 },
      uLupeZoom: { value: 2.2 }, uSphere: { value: 1.4 }, uLensGrad: { value: 0.8 },
      uBulge: { value: 1.6 }, uIOR: { value: 1.45 }, uVoidSoft: { value: 0.06 },
      uMouse: { value: new THREE.Vector2(-1e4, -1e4) },
      uMouseIn: { value: 0 }, uBreath: { value: 0 }, uBreathAmt: { value: 0.055 },
      uVignette: { value: 0.55 }, uTilt: { value: 1 },
      uReduced: { value: this.reduced ? 1 : 0 }, uIntro: { value: 0 }, uDebug: { value: 0 }
    })
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({
      uniforms, vertexShader: GEL_SHADER.quadVert, fragmentShader: frag,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending
    })
    this.mColor = mk(GEL_SHADER.colorFrag, this.uColorP)
    this.mBlur = mk(GEL_SHADER.blurFrag, this.uBlur)
    this.mHeight = mk(GEL_SHADER.heightFrag, this.uHeight)
    this.mFinal = mk(GEL_SHADER.finalFrag, this.uFinal)
    this.quad = new THREE.Mesh(this.geo, this.mFinal)
    this.scene.add(this.quad)

    // pointer targeting: smoothed towards the raw position every frame
    this.mouse = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, vx: 0, vy: 0, in: 0, iv: 0, want: 0 }
    this.onMove = (e) => {
      const r = host.getBoundingClientRect()
      const dpr = this.renderer.getPixelRatio()
      this.mouse.tx = (e.clientX - r.left) * dpr
      this.mouse.ty = (r.height - (e.clientY - r.top)) * dpr
      if (this.mouse.want === 0) { this.mouse.x = this.mouse.tx; this.mouse.y = this.mouse.ty }
      this.mouse.want = 1
    }
    this.onLeave = () => { this.mouse.want = 0 }
    host.addEventListener('pointermove', this.onMove, { passive: true })
    host.addEventListener('pointerdown', this.onMove, { passive: true })
    host.addEventListener('pointerleave', this.onLeave)
    host.addEventListener('pointercancel', this.onLeave)

    this.audioOn = gelAudio.on
    // Sound is wanted from the start. The actual AudioContext can only run once
    // the browser grants user activation, so `audioWanted` is the intent and
    // `audioOn` is reality; the two converge at the first interaction.
    this.audioWanted = autoStartAudio
    if (autoStartAudio) this.armAudio()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.onVis = () => this.setRunning(!document.hidden && this.visible)
    document.addEventListener('visibilitychange', this.onVis)
    this.io = new IntersectionObserver((es) => { this.visible = es[0].isIntersecting; this.onVis() })
    this.io.observe(host)

    this.resize()
    this.setRunning(true)
  }

  setOptions(patch) {
    Object.assign(this.opts, patch)
  }

  // ['#ff2ca8', '#7b3dff', ...] -> up to MAX_STOPS linear-ish rgb stops
  setPalette(stops) {
    const hexes = (Array.isArray(stops) ? stops : String(stops).split(','))
      .map((h) => String(h).trim()).filter(Boolean).slice(0, MAX_STOPS)
    if (!hexes.length) return
    this.palette = hexes
    const arr = this.uColorP.uPal.value
    for (let i = 0; i < MAX_STOPS; i++) {
      const h = hexes[Math.min(i, hexes.length - 1)].replace('#', '')
      const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
      arr[i].setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
    }
    this.uColorP.uPalN.value = hexes.length
  }

  async toggleAudio() {
    if (this.audioPending) return this.audioOn
    this.audioPending = true
    try {
      this.audioOn = await gelAudio.toggle()
    } finally {
      this.audioPending = false
    }
    this.onAudioChange && this.onAudioChange(this.audioOn)
    return this.audioOn
  }

  // Set the desired sound state. Turning it on may not take effect until the
  // browser allows it, in which case the arming below finishes the job.
  async setAudio(want) {
    this.audioWanted = want
    if (want === gelAudio.on) return gelAudio.on
    await this.toggleAudio()
    return gelAudio.on
  }

  // An AudioContext cannot run before a user gesture, so sound-on-by-default
  // means: stay armed and start at the first interaction anywhere on the page,
  // including the control panel, without waiting to be asked.
  armAudio() {
    // Without activation resume() returns a promise that never settles, which
    // would leave toggleAudio pending forever and swallow the real gesture.
    const canStart = () => navigator.userActivation
      ? navigator.userActivation.hasBeenActive
      : true
    const start = async () => {
      if (this.disposed || gelAudio.on || !this.audioWanted || !canStart()) return
      await this.toggleAudio()
      if (gelAudio.on) this.releaseAudioArm()
    }
    this.releaseAudioArm = () => {
      window.removeEventListener('pointerdown', start)
      window.removeEventListener('keydown', start)
      window.removeEventListener('touchstart', start)
    }
    window.addEventListener('pointerdown', start)
    window.addEventListener('keydown', start)
    window.addEventListener('touchstart', start)
    start()   // no-op until the page has been interacted with
  }

  dispose() {
    this.disposed = true
    this.setRunning(false)
    this.releaseAudioArm && this.releaseAudioArm()
    gelAudio.silence()
    this.host.removeEventListener('pointermove', this.onMove)
    this.host.removeEventListener('pointerdown', this.onMove)
    this.host.removeEventListener('pointerleave', this.onLeave)
    this.host.removeEventListener('pointercancel', this.onLeave)
    this.ro && this.ro.disconnect()
    this.io && this.io.disconnect()
    document.removeEventListener('visibilitychange', this.onVis)
    ;[this.rtA, this.rtB, this.rtC, this.rtH].forEach((rt) => rt && rt.dispose())
    ;[this.mColor, this.mBlur, this.mHeight, this.mFinal].forEach((m) => m && m.dispose())
    this.geo.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    if (this.renderer.domElement.parentNode === this.host) {
      this.host.removeChild(this.renderer.domElement)
    }
  }

  resize() {
    if (!this.renderer || this.disposed) return
    const w = this.host.clientWidth || innerWidth
    const h = this.host.clientHeight || innerHeight
    // DPR budget by viewport: phones stay light, 4K+ caps so fill rate holds
    const px = w * h
    const raw = devicePixelRatio || 1
    let cap
    if (this.touch) cap = w < 480 ? 2 : 1.6
    else if (px > 8.0e6) cap = 1          // 4K and up: 1 device pixel is plenty
    else if (px > 3.6e6) cap = 1.25       // 1440p / ultrawide
    else cap = 1.75
    const dpr = Math.max(0.75, Math.min(raw, cap))
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    const rw = Math.round(w * dpr), rh = Math.round(h * dpr)
    this.uFinal.uRes.value.set(rw, rh)
    this.uHeight.uRes.value.set(rw, rh)
    this.applyLayout()
    // the lens map is smooth: half resolution is plenty
    this.rtH.setSize(Math.max(2, Math.round(rw / 2)), Math.max(2, Math.round(rh / 2)))
  }

  applyLayout() {
    if (!this.renderer) return
    const o = this.opts
    const dpr = this.renderer.getPixelRatio()
    const rw = this.uFinal.uRes.value.x, rh = this.uFinal.uRes.value.y
    // element size scales with the viewport so a phone shows fewer, larger
    // pills and a 4K wall shows more without them turning into confetti
    const cssW = rw / dpr, cssH = rh / dpr
    const shortSide = Math.min(cssW, cssH)
    let sizeK = 1
    if (shortSide < 420) sizeK = 1.9
    else if (shortSide < 760) sizeK = 1.45
    else if (Math.max(cssW, cssH) > 2400) sizeK = 1.5
    else if (Math.max(cssW, cssH) > 1800) sizeK = 1.2

    const ew = o.elementWidth * sizeK * dpr, eh = o.elementHeight * sizeK * dpr
    const gx = o.gapX * sizeK * dpr, gy = o.gapY * sizeK * dpr, rad = o.cornerRadius * sizeK * dpr

    // fill the viewport: enough elements to cover it edge to edge, plus one
    // rank of bleed so the grid never shows a gap at the borders
    const cols = Math.max(1, Math.ceil((rw + gx) / (ew + gx)) + 1)
    const rows = Math.max(1, Math.ceil((rh + gy) / (eh + gy)) + 1)
    ;[this.uFinal, this.uHeight].forEach((u) => {
      u.uElemW.value = ew; u.uElemH.value = eh; u.uRadius.value = rad
      u.uCols.value = cols; u.uRows.value = rows
      u.uGapX.value = gx; u.uGapY.value = gy
    })
  }

  setRunning(on) {
    if (on === this.running || (on && this.disposed)) return
    this.running = on
    if (on) { this.last = performance.now(); this.loop() }
    else if (this.raf) cancelAnimationFrame(this.raf)
  }

  renderColor() {
    const r = this.renderer
    this.quad.material = this.mColor
    r.setRenderTarget(this.rtA)
    r.render(this.scene, this.camera)
    this.quad.material = this.mBlur
    const pass = (src, dst, dx, dy) => {
      this.uBlur.uTex.value = src.texture
      this.uBlur.uDir.value.set(dx, dy)
      r.setRenderTarget(dst)
      r.render(this.scene, this.camera)
    }
    pass(this.rtA, this.rtB, 1, 0)
    pass(this.rtB, this.rtC, 0, 1)
    r.setRenderTarget(null)
  }

  renderHeight() {
    this.quad.material = this.mHeight
    this.renderer.setRenderTarget(this.rtH)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(null)
  }

  loop = () => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    const elapsed = (now - this.last) / 1000
    const dt = Math.min(elapsed, 0.05)
    this.last = now
    if (!this.start) this.start = now

    // measured before dt is clamped, or a stalled frame would still read 20fps;
    // smoothed so the readout is legible rather than jittering every frame
    if (elapsed > 0) {
      const instant = 1 / elapsed
      this.fps = this.fps ? this.fps * 0.9 + instant * 0.1 : instant
    }

    const o = this.opts
    const speed = this.reduced ? 0.12 : (o.speed || 1)
    this.time += dt * speed
    this.clock = (this.clock || 0) + dt
    const focus = easeOut(Math.min(1, (now - this.start) / (this.reduced ? 350 : 1600)))

    this.uColorP.uTime.value = this.time
    this.uColorP.uHue.value = o.hue
    const co = this.uColorP
    co.uOct.value = 2.0 + 1.0 * focus
    co.uNScale.value = o.noiseScale
    co.uNWarp.value = o.noiseWarp
    co.uNContrast.value = o.noiseContrast
    co.uNSpeed.value = o.noiseSpeed
    co.uNMix.value = 1
    this.uBlur.uRadius.value = 7.0 - (7.0 - o.noiseBlur) * focus
    this.uHeight.uTime.value = this.time

    const f = this.uFinal
    f.uTime.value = this.time
    // entrance: elements expand into place on a diagonal stagger
    const intro = Math.min(1, (now - this.start) / (this.reduced ? 380 : 1500))
    f.uIntro.value = intro
    this.uHeight.uIntro.value = intro
    f.uFocus.value = focus
    f.uGlow.value = o.glow
    f.uHilite.value = 0
    f.uRefract.value = o.refract
    f.uVoidRX.value = o.voidRadiusX
    f.uVoidRY.value = o.voidRadiusY
    // breathing sweep: idle, then one slow pass every breatheEvery seconds
    const bPer = Math.max(o.breatheEvery, 1)
    const bDur = Math.min(Math.max(o.breatheDuration, 0.5), bPer)
    const bPh = this.clock % bPer
    // ease-out: the sweep starts with pace and decelerates as it crosses
    const bLin = bPh < bDur ? bPh / bDur : 0
    const bProg = this.reduced ? 0 : (bLin > 0 ? 1 - Math.pow(1 - bLin, 3) : 0)
    const bAmt = this.reduced ? 0 : o.breatheStrength
    // per-pill swoosh: fire for every element the band crossed this frame
    if (bProg > 0 && gelAudio.on && gelAudio.swoosh) {
      const band = bProg * 2.6 - 0.80
      const prev = this.bandPrev === undefined ? -1 : this.bandPrev
      if (band > prev) {
        const cols = f.uCols.value, rows = f.uRows.value
        const span = Math.max(cols + rows - 2, 1)
        let hits = 0
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const dg = (x + y) / span
            if (dg > prev && dg <= band) hits++
          }
        }
        for (let i = 0; i < hits; i++) gelAudio.sweep(hits)
      }
      this.bandPrev = band
    } else if (bProg === 0) {
      this.bandPrev = undefined
    }
    f.uBreath.value = bProg
    f.uBreathAmt.value = bAmt
    this.uHeight.uBreath.value = bProg
    this.uHeight.uBreathAmt.value = bAmt
    if (gelAudio.on) {
      const rh = Math.max(f.uRes.value.y, 1)
      gelAudio.frame(Math.min(Math.max(this.mouse.y / rh, 0), 1) * this.mouse.in, bProg)
      if (this.mouse.in > 0.2) {
        const nc = f.uCols.value, nr = f.uRows.value
        const pw = f.uElemW.value + f.uGapX.value, ph = f.uElemH.value + f.uGapY.value
        const cx = Math.round((this.mouse.x - f.uRes.value.x / 2) / pw + (nc - 1) / 2)
        const cy = Math.round((this.mouse.y - rh / 2) / ph + (nr - 1) / 2)
        const cell = Math.min(Math.max(cy, 0), nr - 1) * nc + Math.min(Math.max(cx, 0), nc - 1)
        if (cell !== gelAudio.lastCell) { gelAudio.lastCell = cell; gelAudio.bell(cell, this.mouse.in) }
      }
    }
    f.uVignette.value = o.vignette
    f.uStretch.value = o.textureStretch
    f.uLupeZoom.value = o.lupeZoom
    f.uSphere.value = o.sphericalRefraction
    f.uLensGrad.value = o.lensGradient
    f.uBulge.value = o.sphereBulge
    f.uIOR.value = o.ior
    f.uVoidSoft.value = 0
    this.applyLayout()
    f.uDebug.value = o.debug

    // spring physics: stiffness pulls towards the cursor, light damping lets
    // the slabs overshoot and settle back with a wobble
    const m = this.mouse
    const ST = 190, DP = 9.0, ST_IN = 240, DP_IN = 9.5
    const sub = 2, h = dt / sub
    for (let i = 0; i < sub; i++) {
      m.vx += ((m.tx - m.x) * ST - m.vx * DP) * h
      m.vy += ((m.ty - m.y) * ST - m.vy * DP) * h
      m.x += m.vx * h
      m.y += m.vy * h
      m.iv += ((m.want - m.in) * ST_IN - m.iv * DP_IN) * h
      m.in += m.iv * h
    }
    m.in = Math.max(m.in, 0)
    f.uMouse.value.set(m.x, m.y)
    f.uMouseIn.value = m.in
    f.uTilt.value = (o.tilt3D ?? 1) * (this.reduced ? 0.35 : 1)

    const every = this.touch ? 3 : 2
    if (this.frame % every === 0 || focus < 1 || intro < 1) { this.renderColor(); this.renderHeight() }
    this.frame++

    this.quad.material = this.mFinal
    this.renderer.render(this.scene, this.camera)
  }
}
