import { useEffect, useRef } from 'react'
import { Pane } from 'tweakpane'
import { GelStage } from './gel/scene.js'
import {
  GEL_SECTIONS, GEL_DEFAULTS, DEFAULT_PALETTE, PALETTE_TEMPLATES,
  MIN_STOPS, MAX_STOPS, randomPalette
} from './gel/config.js'

const TEMPLATE_OPTIONS = Object.fromEntries(
  Object.keys(PALETTE_TEMPLATES).map((name) => [name, name])
)

export default function App() {
  const canvasHostRef = useRef(null)
  const paneHostRef = useRef(null)

  useEffect(() => {
    const params = { ...GEL_DEFAULTS }
    let palette = DEFAULT_PALETTE.slice()
    const ui = { sound: true, stops: palette.length, template: 'Default' }

    let soundBinding
    let stage
    stage = new GelStage(canvasHostRef.current, {
      options: params,
      palette,
      // Reality can only drop the toggle once sound is no longer wanted — a
      // start that the browser has not permitted yet must not read as "off".
      onAudioChange: (on) => {
        ui.sound = on || !!(stage && stage.audioWanted)
        soundBinding && soundBinding.refresh()
      }
    })

    const pane = new Pane({ container: paneHostRef.current, title: 'Gel Capsules' })

    soundBinding = pane.addBinding(ui, 'sound')
    soundBinding.on('change', (e) => stage.setAudio(e.value))

    // ---- palette ----------------------------------------------------------
    const paletteFolder = pane.addFolder({ title: 'Palette' })
    const applyPalette = () => stage.setPalette(palette)

    // Rebuilding disposes the blade whose event is still dispatching, so the
    // swap waits for the current handler to unwind.
    const rebuild = () => queueMicrotask(renderPalette)
    const usePalette = (next) => {
      palette = next.slice()
      ui.stops = palette.length
      applyPalette()
      rebuild()
    }

    const renderPalette = () => {
      ;[...paletteFolder.children].forEach((child) => child.dispose())
      paletteFolder.addBinding(ui, 'template', { options: TEMPLATE_OPTIONS })
        .on('change', (e) => usePalette(PALETTE_TEMPLATES[e.value]))
      const stopsBinding = paletteFolder.addBinding(ui, 'stops', {
        min: MIN_STOPS, max: MAX_STOPS, step: 1
      })
      stopsBinding.on('change', (e) => {
        const next = Math.round(e.value)
        if (next === palette.length) return
        while (palette.length > next) palette.pop()
        while (palette.length < next) palette.push(randomPalette()[0])
        applyPalette()
        rebuild()
      })
      palette.forEach((hex, i) => {
        const stop = { hex }
        paletteFolder.addBinding(stop, 'hex', { label: `stop ${i + 1}` })
          .on('change', (e) => { palette[i] = e.value; applyPalette() })
      })
      paletteFolder.addButton({ title: 'random' }).on('click', () => {
        usePalette(randomPalette())
      })
      paletteFolder.addButton({ title: 'reset' }).on('click', () => {
        ui.template = 'Default'
        usePalette(DEFAULT_PALETTE)
      })
    }
    renderPalette()

    // ---- one folder per section of the design's prop schema ---------------
    GEL_SECTIONS.forEach(({ title, params: entries }) => {
      const folder = pane.addFolder({ title, expanded: false })
      entries.forEach(({ key, min, max, step, unit }) => {
        folder.addBinding(params, key, {
          min, max, step, label: unit ? `${key} (${unit})` : key
        }).on('change', (e) => stage.setOptions({ [key]: e.value }))
      })
    })

    return () => {
      pane.dispose()
      stage.dispose()
    }
  }, [])

  return (
    <>
      <div className="canvas-host" ref={canvasHostRef} />
      <div className="pane-host" ref={paneHostRef} />
    </>
  )
}
