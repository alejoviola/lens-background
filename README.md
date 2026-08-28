# lens-background

A full-viewport WebGL background: a grid of gel capsules that refract an animated
colour field through a rounded-rectangle glass lens. The capsules tilt toward the
cursor, a slow "breathing" sweep travels across the grid, and every parameter is
exposed through a Tweakpane panel.

<img width="1504" height="777" alt="banner" src="https://github.com/user-attachments/assets/a55566e3-19ab-4889-be23-d27884ca65d7" />

**Live demo:** https://lens-background.alejoviola.dev/

## Inspiration

The goal was to build an interactive experience in the style of the German artist
Martin Naumann.

## Stack

Vite 5 · React 18 · three 0.169 · Tweakpane 4

## Getting started

```bash
pnpm install
pnpm run dev      # http://localhost:5173
```

```bash
pnpm run build    # production bundle into dist/
pnpm run preview  # serve the built bundle
```

> **pnpm 10 note:** dependency build scripts are blocked by default, which leaves
> esbuild without its binary and breaks Vite. Run `pnpm approve-builds` (or
> `pnpm rebuild esbuild`) once after a fresh install.

## Layout

```
src/
  gel/
    shader.js   GLSL for all four passes
    scene.js    GelStage — renderer, render targets, uniforms, animation loop
    audio.js    Web Audio layer (hover clicks + sweep swooshes)
    config.js   Control schema, defaults, palette templates
  App.jsx       Mounts the stage and builds the Tweakpane panel
public/uploads/ Audio samples
```

### How it renders

Four passes, the first three into offscreen render targets:

1. **colour** — domain-warped fractal noise interpolated across the palette.
2. **blur** — separable box blur of that field.
3. **height** — per-capsule lens height plus a packed normal, at half resolution.
4. **final** — refracts the colour texture through that normal map, then adds the
   lens remap, rim, fresnel, specular and glow.

The colour and height passes run every other frame (every third on touch
devices); only the final pass runs every frame.

## Controls

The panel groups parameters exactly as the source design did: **Motion**,
**Grid**, **Central void**, **Lens**, **Look**, **Breathe** and **Noise**. Ranges
and defaults come from the design's own prop schema.

**Palette** offers nine templates — Fiery, Rainbow, Summer, Pastel, Forest,
Water, Cherry, Boca Juniors, Vibrant — plus the default. Stops can be recoloured
individually, the count adjusted from 3 to 10, and `random` / `reset` regenerate
or restore the ramp.

`sound` toggles the audio layer.

**Debug** shows a smoothed `fps` readout and two view toggles: `noise` renders
the raw colour field before any refraction, `effects` renders the lens height and
refraction map. Both are backed by the same `uDebug` uniform, so enabling one
clears the other. The shader also has a third mode (`3`, the lens boundary) that
is not currently surfaced in the panel.

## Notes

Three things worth knowing if you touch this code:

**Colour management.** The design targets three r0.150, where
`ColorManagement.enabled` defaulted to `false` and output was linear. Since r152
both defaults flipped. `scene.js` sets `ColorManagement.enabled = false` and
`renderer.outputColorSpace = LinearSRGBColorSpace` to restore the original
behaviour — without them every colour in the piece shifts.

**Palette size.** The design capped the palette at six stops. Three of the
templates have ten, so `uPal` and the `palStop` loop in the shader were widened
to `MAX_STOPS`. All three declarations must stay in agreement.

**Audio autoplay.** Sound is on by default, but browsers refuse to run an
`AudioContext` before the page has user activation, so it cannot make noise on
load. `GelStage` keeps a listener armed and starts at the first pointer, key or
touch event anywhere on the page. The toggle reflects the intent, so it reads on
from the first frame. Attempting a start without activation is deliberately
skipped: a blocked `resume()` returns a promise that never settles.

Respects `prefers-reduced-motion` by slowing the animation and disabling the
breathing sweep. Device pixel ratio is capped by viewport size so fill rate holds
up on phones and 4K displays alike.

## Credits

Built by **Alejo Viola** — [github.com/alejoviola](https://github.com/alejoviola)
· [alejo@alejoviola.dev](mailto:alejo@alejoviola.dev)

## License

MIT © Alejo Viola — see [LICENSE](LICENSE).
