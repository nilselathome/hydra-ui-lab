// Layer type definitions.
// Each type has a param schema and a build() function that returns a Hydra source node.
// build() is called with the layer's params object; o0-o3 and all Hydra globals are available.

export const LAYER_TYPES = {
  osc: {
    label: 'Oscillator',
    params: [
      { key: 'freq',   label: 'Frequency', min: 0,  max: 60, default: 10 },
      { key: 'sync',   label: 'Sync',      min: 0,  max: 1,  default: 0.1 },
      { key: 'offset', label: 'Offset',    min: -1, max: 1,  default: 0 },
    ],
    build: (p) => osc(p.freq, p.sync, p.offset),
  },

  shape: {
    label: 'Shape',
    params: [
      { key: 'sides',  label: 'Sides',     min: 3, max: 12, default: 3, step: 1 },
      { key: 'radius', label: 'Radius',    min: 0, max: 1,  default: 0.5 },
      { key: 'smooth', label: 'Smoothing', min: 0, max: 1,  default: 0.01 },
    ],
    build: (p) => shape(p.sides, p.radius, p.smooth),
  },

  voronoi: {
    label: 'Voronoi',
    params: [
      { key: 'scale',    label: 'Scale',    min: 1, max: 50, default: 5 },
      { key: 'speed',    label: 'Speed',    min: 0, max: 2,  default: 0.3 },
      { key: 'blending', label: 'Blending', min: 0, max: 1,  default: 0.3 },
    ],
    build: (p) => voronoi(p.scale, p.speed, p.blending),
  },

  noise: {
    label: 'Noise',
    params: [
      { key: 'scale',  label: 'Scale',  min: 0, max: 20, default: 3 },
      { key: 'offset', label: 'Offset', min: 0, max: 1,  default: 0.1 },
    ],
    build: (p) => noise(p.scale, p.offset),
  },

  gradient: {
    label: 'Gradient',
    params: [
      { key: 'speed', label: 'Speed', min: 0, max: 2, default: 0.1 },
    ],
    build: (p) => gradient(p.speed),
  },
};

// Keys must match Hydra method names (used directly as node[blendMode](src, amount))
export const BLEND_MODES = {
  blend: 'Normal',
  add:   'Add',
  sub:   'Subtract',
  mult:  'Multiply',
  diff:  'Difference',
  layer: 'Layer',
  mask:  'Mask',
};

// Source types available as modulation inputs
export const MOD_SOURCES = ['noise', 'voronoi', 'osc', 'gradient'];

// Modulation functions: key = Hydra method name, value = UI config
export const MOD_FNS = {
  modulate:       { label: 'Displace',     min: -1,  max: 1,  step: 0.01 },
  modulateHue:    { label: 'Hue',          min: -1,  max: 1,  step: 0.01 },
  modulateScale:  { label: 'Scale',        min: -2,  max: 2,  step: 0.01 },
  modulateRotate: { label: 'Warp Rotate',  min: -1,  max: 1,  step: 0.01 },
  modulateKaleid: { label: 'Warp Kaleid',  min: 2,   max: 20, step: 1    },
};

// Geometry/color transforms applied directly to a layer's source chain
// build(node, p) — p values may be functions when animate is on (Hydra handles this natively)
export const TRANSFORM_TYPES = {
  rotate: {
    label: 'Rotate',
    params: [{ key: 'angle', label: 'Angle', min: -3.14, max: 3.14, step: 0.01, default: 0 }],
    build: (node, p) => node.rotate(p.angle),
  },
  scale: {
    label: 'Scale',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 4, step: 0.01, default: 1 }],
    build: (node, p) => node.scale(p.amount),
  },
  kaleid: {
    label: 'Kaleid',
    params: [{ key: 'nSides', label: 'Sides', min: 2, max: 20, step: 1, default: 4 }],
    build: (node, p) => node.kaleid(p.nSides),
  },
  pixelate: {
    label: 'Pixelate',
    params: [
      { key: 'pixelX', label: 'X', min: 1, max: 200, step: 1, default: 20 },
      { key: 'pixelY', label: 'Y', min: 1, max: 200, step: 1, default: 20 },
    ],
    build: (node, p) => node.pixelate(p.pixelX, p.pixelY),
  },
  scroll: {
    label: 'Scroll',
    params: [
      { key: 'scrollX', label: 'X', min: -1, max: 1, step: 0.01, default: 0 },
      { key: 'scrollY', label: 'Y', min: -1, max: 1, step: 0.01, default: 0 },
    ],
    build: (node, p) => node.scroll(p.scrollX, p.scrollY),
  },
};
