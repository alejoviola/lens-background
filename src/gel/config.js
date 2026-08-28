// The design's prop schema, transcribed from the .dc.html `data-props` block.
// Each entry keeps its editor range so Tweakpane reproduces the same sliders,
// grouped into the same sections. `key` is the option name the stage reads.
export const GEL_SECTIONS = [
  {
    title: 'Motion',
    params: [
      { key: 'tilt3D', min: 0, max: 2.5, step: 0.05 },
      { key: 'speed', min: 0.2, max: 12, step: 0.1 }
    ]
  },
  {
    title: 'Grid',
    params: [
      { key: 'elementWidth', min: 60, max: 800, step: 2, unit: 'px' },
      { key: 'elementHeight', min: 60, max: 1200, step: 2, unit: 'px' },
      { key: 'cornerRadius', min: 0, max: 400, step: 1, unit: 'px' },
      { key: 'gapX', min: 0, max: 300, step: 2, unit: 'px' },
      { key: 'gapY', min: 0, max: 300, step: 2, unit: 'px' }
    ]
  },
  {
    title: 'Central void',
    params: [
      { key: 'voidRadiusX', min: 0.02, max: 1.5, step: 0.01 },
      { key: 'voidRadiusY', min: 0.02, max: 1.5, step: 0.01 },
      { key: 'textureStretch', min: 0.2, max: 4, step: 0.05 }
    ]
  },
  {
    title: 'Lens',
    params: [
      { key: 'lupeZoom', min: 1, max: 40, step: 0.05 },
      { key: 'sphericalRefraction', min: 0, max: 4, step: 0.05 },
      { key: 'lensGradient', min: 0, max: 1, step: 0.02 },
      { key: 'sphereBulge', min: 0.2, max: 4, step: 0.05 },
      { key: 'ior', min: 1.02, max: 2.4, step: 0.01 }
    ]
  },
  {
    title: 'Look',
    params: [
      { key: 'vignette', min: 0, max: 1, step: 0.02 },
      { key: 'refract', min: 0, max: 2.5, step: 0.05 },
      { key: 'glow', min: 0, max: 2, step: 0.05 }
    ]
  },
  {
    title: 'Breathe',
    params: [
      { key: 'breatheEvery', min: 3, max: 30, step: 0.5, unit: 's' },
      { key: 'breatheDuration', min: 1, max: 20, step: 0.25, unit: 's' },
      { key: 'breatheStrength', min: 0, max: 0.2, step: 0.005 }
    ]
  },
  {
    title: 'Noise',
    params: [
      { key: 'noiseScale', min: 0.4, max: 10, step: 0.1 },
      { key: 'noiseWarp', min: 0, max: 4, step: 0.05 },
      { key: 'noiseContrast', min: 0.2, max: 4, step: 0.05 },
      { key: 'noiseSpeed', min: 0, max: 4, step: 0.05 },
      { key: 'noiseBlur', min: 0, max: 8, step: 0.1 }
    ]
  }
]

// Defaults are the `default` values from the same schema — what the design
// actually renders with, not the wider fallbacks in its renderVals().
export const GEL_DEFAULTS = {
  tilt3D: 0.6,
  speed: 12,
  elementWidth: 90,
  elementHeight: 140,
  cornerRadius: 32,
  gapX: 4,
  gapY: 4,
  voidRadiusX: 0.62,
  voidRadiusY: 0.65,
  textureStretch: 4,
  lupeZoom: 40,
  sphericalRefraction: 2,
  lensGradient: 1,
  sphereBulge: 4,
  ior: 1.23,
  vignette: 0.55,
  refract: 1.5,
  glow: 1,
  breatheEvery: 10,
  breatheDuration: 8,
  breatheStrength: 0.055,
  noiseScale: 4,
  noiseWarp: 1,
  noiseContrast: 2,
  noiseSpeed: 0.7,
  noiseBlur: 4,
  hue: 0,
  // 0 = normal, 1 = raw colour field, 2 = refraction map, 3 = lens boundary
  debug: 0
}

export const DEBUG_NONE = 0
export const DEBUG_NOISE = 1
export const DEBUG_EFFECTS = 2

export const DEFAULT_PALETTE = ['#ff2ca8', '#7b3dff', '#147dff', '#00d6c9', '#d6ff1f']

export const MIN_STOPS = 3
// Raised from the design's 6 so the 10-stop templates below survive intact;
// the shader's uPal array and palStop loop were widened to match.
export const MAX_STOPS = 10

export const PALETTE_TEMPLATES = {
  Default: DEFAULT_PALETTE,
  Fiery: ['#5f0f40', '#9a031e', '#fb8b24', '#e36414', '#0f4c5c'],
  Rainbow: [
    '#fbf8cc', '#fde4cf', '#ffcfd2', '#f1c0e8', '#cfbaf0',
    '#a3c4f3', '#90dbf4', '#8eecf5', '#98f5e1', '#b9fbc0'
  ],
  Summer: ['#8ecae6', '#219ebc', '#023047', '#ffb703', '#fb8500'],
  Pastel: ['#cdb4db', '#ffc8dd', '#ffafcc', '#bde0fe', '#a2d2ff'],
  Forest: ['#dad7cd', '#a3b18a', '#588157', '#3a5a40', '#344e41'],
  Water: ['#22577a', '#38a3a5', '#57cc99', '#80ed99', '#c7f9cc'],
  Cherry: [
    '#590d22', '#800f2f', '#a4133c', '#c9184a', '#ff4d6d',
    '#ff758f', '#ff8fa3', '#ffb3c1', '#ffccd5', '#fff0f3'
  ],
  'Boca Juniors': ['#00296b', '#003f88', '#00509d', '#fdc500', '#ffd500'],
  Vibrant: [
    '#f94144', '#f3722c', '#f8961e', '#f9844a', '#f9c74f',
    '#90be6d', '#43aa8b', '#4d908e', '#577590', '#277da1'
  ]
}

function hslHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const seg = Math.floor(h / 60) % 6
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg]
  return '#' + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')
}

// harmonious: one base hue, stops spread on a fixed interval, high saturation
export function randomPalette() {
  const n = 3 + Math.floor(Math.random() * 4)
  const base = Math.random() * 360
  const step = [47, 64, 88, 137][Math.floor(Math.random() * 4)]
  return Array.from({ length: n }, (_, i) => {
    const h = (base + i * step) % 360
    const s = 0.86 + Math.random() * 0.14
    const l = 0.48 + (i % 2) * 0.12
    return hslHex(h, s, l)
  })
}
