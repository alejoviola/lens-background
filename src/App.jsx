import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Pane } from 'tweakpane'

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uSpeed;
  uniform float uScale;
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  varying vec2 vUv;

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * uScale;
    float t = uTime * uSpeed;
    float field = sin(p.x + t) * cos(p.y - t * 0.7) * 0.5 + 0.5;
    vec3 color = mix(uColorA, uColorB, field);
    gl_FragColor = vec4(color, 1.0);
  }
`

const params = {
  speed: 0.4,
  scale: 6.0,
  colorA: '#0b1020',
  colorB: '#4d7cff',
}

export default function App() {
  const canvasHostRef = useRef(null)
  const paneHostRef = useRef(null)

  useEffect(() => {
    const host = canvasHostRef.current
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(host.clientWidth, host.clientHeight)
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(host.clientWidth, host.clientHeight) },
      uSpeed: { value: params.speed },
      uScale: { value: params.scale },
      uColorA: { value: new THREE.Color(params.colorA) },
      uColorB: { value: new THREE.Color(params.colorB) },
    }

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms }),
    )
    scene.add(mesh)

    const pane = new Pane({ container: paneHostRef.current, title: 'lens-background' })
    pane.addBinding(params, 'speed', { min: 0, max: 2, step: 0.01 })
      .on('change', (e) => { uniforms.uSpeed.value = e.value })
    pane.addBinding(params, 'scale', { min: 1, max: 20, step: 0.1 })
      .on('change', (e) => { uniforms.uScale.value = e.value })
    pane.addBinding(params, 'colorA')
      .on('change', (e) => { uniforms.uColorA.value.set(e.value) })
    pane.addBinding(params, 'colorB')
      .on('change', (e) => { uniforms.uColorB.value.set(e.value) })

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host
      renderer.setSize(w, h)
      uniforms.uResolution.value.set(w, h)
    }
    window.addEventListener('resize', resize)

    const clock = new THREE.Clock()
    let frame = 0
    const tick = () => {
      uniforms.uTime.value = clock.getElapsedTime()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      pane.dispose()
      mesh.geometry.dispose()
      mesh.material.dispose()
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <>
      <div className="canvas-host" ref={canvasHostRef} />
      <div className="pane-host" ref={paneHostRef} />
    </>
  )
}
