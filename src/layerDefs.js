// Layer type definitions.
// Each type has a param schema and a build() function that returns a Hydra source node.
// build() is called with the layer's params object; o0-o3 and all Hydra globals are available.

// Hydra's chain methods (.scroll(), .blend(), .add(), etc.) mutate the source's
// own `transforms` array in place and return `this` — they do NOT return a copy.
// Reusing the same source object as both a chain's base and a nested argument
// (e.g. `node.blend(node.scroll(...), amt)`) makes it reference its own
// still-growing transform list, which Hydra then recurses into forever when
// compiling the shader (silently fails → black output). Effects that need to
// sample the same upstream node more than once (blur, chromatic aberration)
// must clone it first so each branch mutates its own independent array.
function cloneSource(src) {
  const clone = Object.create(Object.getPrototypeOf(src));
  Object.assign(clone, src);
  clone.transforms = [...src.transforms];
  return clone;
}

// Animated params arrive as a live closure (Hydra calls it itself, once per
// frame, to update the uniform) rather than a plain number — plain JS `-fn`
// coerces the function to NaN instead of negating its per-frame result, which
// Hydra then bakes into the shader as the literal (invalid) text "NaN.",
// breaking the whole compiled chain. This negates either case correctly.
function negate(v) {
  return typeof v === 'function' ? () => -v() : -v;
}

// A few effects below (chromatic aberration, scanlines, grain) need small custom
// GLSL functions that aren't part of stock Hydra. Registered once, from app.js,
// right after `new Hydra(...)` — must run before any layer using them is built.
export function registerCustomEffects() {
  // Channel isolation (zero out the other two channels) — used to recombine
  // separately-shifted R/G/B samples for chromatic aberration.
  // 'color' type functions receive the implicit color arg as `_c0`, not `_c`.
  setFunction({ name: 'isolateR', type: 'color', inputs: [], glsl: 'return vec4(_c0.r, 0.0, 0.0, _c0.a);' });
  setFunction({ name: 'isolateG', type: 'color', inputs: [], glsl: 'return vec4(0.0, _c0.g, 0.0, _c0.a);' });
  setFunction({ name: 'isolateB', type: 'color', inputs: [], glsl: 'return vec4(0.0, 0.0, _c0.b, _c0.a);' });

  setFunction({
    name: 'scanlines',
    type: 'src',
    inputs: [
      { name: 'freq',      type: 'float', default: 800 },
      { name: 'thickness', type: 'float', default: 1 },
    ],
    glsl: `
      float v = sin(_st.y * freq) * 0.5 + 0.5;
      v = pow(v, thickness);
      return vec4(vec3(v), 1.0);
    `,
  });

  setFunction({
    name: 'grain',
    type: 'src',
    inputs: [{ name: 'scale', type: 'float', default: 1 }],
    glsl: `
      vec2 uv = _st * resolution.xy * scale;
      float n = fract(sin(dot(uv + time * 113.0, vec2(12.9898, 78.233))) * 43758.5453);
      return vec4(vec3(n), 1.0);
    `,
  });
}

export const LAYER_TYPES = {
  osc: {
    label: 'Oscillator',
    shortLabel: 'Osc',
    icon: 'ph-wave-sine',
    params: [
      { key: 'freq',   label: 'Frequency', min: 0,  max: 60, default: 10 },
      { key: 'sync',   label: 'Sync',      min: 0,  max: 1,  default: 0.1 },
      { key: 'offset', label: 'Offset',    min: -1, max: 1,  default: 0 },
    ],
    build: (p) => osc(p.freq, p.sync, p.offset),
  },

  shape: {
    label: 'Shape',
    shortLabel: 'Shape',
    icon: 'ph-polygon',
    params: [
      { key: 'sides',  label: 'Sides',     min: 3, max: 12, default: 3, step: 1 },
      { key: 'radius', label: 'Radius',    min: 0, max: 1,  default: 0.5 },
      { key: 'smooth', label: 'Smoothing', min: 0, max: 1,  default: 0.01 },
    ],
    build: (p) => shape(p.sides, p.radius, p.smooth),
  },

  voronoi: {
    label: 'Voronoi',
    shortLabel: 'Voronoi',
    icon: 'ph-graph',
    params: [
      { key: 'scale',    label: 'Scale',    min: 1, max: 50, default: 5 },
      { key: 'speed',    label: 'Speed',    min: 0, max: 2,  default: 0.3 },
      { key: 'blending', label: 'Blending', min: 0, max: 1,  default: 0.3 },
    ],
    build: (p) => voronoi(p.scale, p.speed, p.blending),
  },

  noise: {
    label: 'Noise',
    shortLabel: 'Noise',
    icon: 'ph-cloud',
    params: [
      { key: 'scale',  label: 'Scale',  min: 0, max: 20, default: 3 },
      { key: 'offset', label: 'Offset', min: 0, max: 1,  default: 0.1 },
    ],
    build: (p) => noise(p.scale, p.offset),
  },

  gradient: {
    label: 'Gradient',
    shortLabel: 'Grad',
    icon: 'ph-gradient',
    params: [
      { key: 'speed', label: 'Speed', min: 0, max: 2, default: 0.1 },
    ],
    build: (p) => gradient(p.speed),
  },

  // Cheap procedural sources (single-pass, O(1) per pixel) — mostly meant as
  // Mod sources (multiply/blend onto another layer) but also usable standalone.
  scanlines: {
    label: 'Scanlines',
    shortLabel: 'Scan',
    icon: 'ph-rows',
    params: [
      { key: 'freq',      label: 'Frequency',  min: 50,  max: 2000, default: 800, step: 10 },
      { key: 'thickness', label: 'Thickness',  min: 0.1, max: 5,    default: 1,   step: 0.05 },
    ],
    build: (p) => scanlines(p.freq, p.thickness),
  },

  grain: {
    label: 'Grain',
    shortLabel: 'Grain',
    icon: 'ph-sparkle',
    params: [
      { key: 'scale', label: 'Scale', min: 0.1, max: 4, default: 1, step: 0.05 },
    ],
    build: (p) => grain(p.scale),
  },

  img: {
    label: 'Image',
    shortLabel: 'Img',
    icon: 'ph-image',
    params: [],
    // layer._hydraSource is an s0–s3 slot assigned at layer creation
    build: (p, layer) => layer._hydraSource ? src(layer._hydraSource) : solid(0, 0, 0),
  },

  text: {
    label: 'Text',
    shortLabel: 'Text',
    icon: 'ph-text-t',
    params: [
      { key: 'size',     label: 'Size',       min: 8,  max: 1200, default: 80, step: 1 },
      { key: 'x',        label: 'X',          min: 0,  max: 1,    default: 0.5 },
      { key: 'y',        label: 'Y',          min: 0,  max: 1,    default: 0.5 },
      // r/g/b are edited via the native color picker in addTextControls, not a slider
      { key: 'r',        label: 'R',          min: 0,  max: 1,    default: 1, hidden: true },
      { key: 'g',        label: 'G',          min: 0,  max: 1,    default: 1, hidden: true },
      { key: 'b',        label: 'B',          min: 0,  max: 1,    default: 1, hidden: true },
      { key: 'scrollSpd', label: 'Scroll spd', min: -1.5, max: 1.5, default: 0, step: 0.05 },
      { key: 'scrambleIn',   label: 'Scramble in',   min: 0, max: 5,  default: 0, step: 0.05 },
      { key: 'scrambleHold', label: 'Scramble hold', min: 0, max: 10, default: 0, step: 0.05 },
      { key: 'scrambleOut',  label: 'Scramble out',  min: 0, max: 5,  default: 0, step: 0.05 },
    ],
    // layer._hydraSource is an s0–s3 slot; layer._canvas is the offscreen canvas it samples
    build: (p, layer) => layer._hydraSource ? src(layer._hydraSource) : solid(0, 0, 0),
  },

  // Special source: reads the previous frame's composite from o0 — creates feedback/trails
  feedback: {
    label: 'Feedback',
    noLayer: true,
    params: [],
    build: () => src(o0),
  },

  glsl: {
    label: 'GLSL',
    shortLabel: 'GLSL',
    icon: 'ph-code',
    params: [],
    build: (p, layer) => {
      const fn = window[layer._glslName];
      return fn ? fn() : solid(0, 0, 0);
    },
  },

  three: {
    label: 'Three.js',
    shortLabel: '3D',
    icon: 'ph-cube',
    params: [],
    build: () => solid(0, 0, 0), // DOM overlay — not part of Hydra chain
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

// Source types available as mod inputs (includes feedback)
export const MOD_SOURCES = ['noise', 'voronoi', 'osc', 'gradient', 'feedback', 'scanlines', 'grain'];

// Mod functions: key = Hydra method name, value = UI config
// Includes both color blend ops and coordinate modulations
export const MOD_FNS = {
  // Color blend (these + feedback = self-feedback chain)
  blend:          { label: 'Blend',        min: 0,   max: 1,  step: 0.01 },
  add:            { label: 'Add',          min: 0,   max: 1,  step: 0.01 },
  mult:           { label: 'Multiply',     min: 0,   max: 1,  step: 0.01 },
  diff:           { label: 'Difference',   min: 0,   max: 1,  step: 0.01 },
  sub:            { label: 'Subtract',     min: 0,   max: 1,  step: 0.01 },
  // Coordinate modulations
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

  // ── Filters ───────────────────────────────────────────────────────────────
  brightness: {
    label: 'Brightness',
    params: [{ key: 'amount', label: 'Amount', min: -1, max: 2, step: 0.01, default: 0.4 }],
    build: (node, p) => node.brightness(p.amount),
  },
  contrast: {
    label: 'Contrast',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 4, step: 0.01, default: 1 }],
    build: (node, p) => node.contrast(p.amount),
  },
  saturate: {
    label: 'Saturate',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 4, step: 0.01, default: 2 }],
    build: (node, p) => node.saturate(p.amount),
  },
  hue: {
    label: 'Hue',
    params: [{ key: 'hueRotate', label: 'Rotate', min: -1, max: 1, step: 0.01, default: 0 }],
    build: (node, p) => node.hue(p.hueRotate),
  },
  color: {
    label: 'Color',
    params: [
      { key: 'r', label: 'R', min: 0, max: 2, step: 0.01, default: 1 },
      { key: 'g', label: 'G', min: 0, max: 2, step: 0.01, default: 1 },
      { key: 'b', label: 'B', min: 0, max: 2, step: 0.01, default: 1 },
    ],
    build: (node, p) => node.color(p.r, p.g, p.b),
  },
  invert: {
    label: 'Invert',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 }],
    build: (node, p) => node.invert(p.amount),
  },
  luma: {
    label: 'Luma Key',
    params: [
      { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'tolerance', label: 'Tolerance', min: 0, max: 1, step: 0.01, default: 0.1 },
    ],
    build: (node, p) => node.luma(p.threshold, p.tolerance),
  },
  thresh: {
    label: 'Threshold',
    params: [
      { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'tolerance', label: 'Tolerance', min: 0, max: 1, step: 0.01, default: 0.04 },
    ],
    build: (node, p) => node.thresh(p.threshold, p.tolerance),
  },
  posterize: {
    label: 'Posterize',
    params: [
      { key: 'bins',  label: 'Bins',  min: 1, max: 20, step: 1,    default: 3 },
      { key: 'gamma', label: 'Gamma', min: 0, max: 4,  step: 0.01, default: 0.6 },
    ],
    build: (node, p) => node.posterize(p.bins, p.gamma),
  },

  // ── Multi-sample (costlier) ──────────────────────────────────────────────
  // These re-render the upstream chain several times per frame to combine
  // shifted copies — real GPU cost that scales with how heavy the rest of the
  // layer's chain already is. Cheap at amount 0 (short-circuited below), but
  // climbs fast once dialed up, especially stacked on other layers/effects.
  blur: {
    label: 'Blur',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 0.05, step: 0.001, default: 0.01 }],
    // 5-tap plus-shaped box blur: original + 4 shifted copies, equally weighted
    // via chained crossfades. Re-evaluates the upstream chain 5x per frame.
    build: (node, p) => {
      if (typeof p.amount === 'number' && p.amount <= 0) return node;
      const r = p.amount;
      const base  = cloneSource(node);
      const right = cloneSource(node).scroll(r, 0);
      const left  = cloneSource(node).scroll(negate(r), 0);
      const up    = cloneSource(node).scroll(0, r);
      const down  = cloneSource(node).scroll(0, negate(r));
      return base
        .blend(right, 0.5)
        .blend(left, 1 / 3)
        .blend(up, 1 / 4)
        .blend(down, 1 / 5);
    },
  },
  chroma: {
    label: 'Chromatic Aberration',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 0.05, step: 0.001, default: 0.01 }],
    // Samples R/G/B from 3 differently-shifted copies of the upstream chain and
    // recombines them — re-evaluates the upstream chain 3x per frame.
    build: (node, p) => {
      if (typeof p.amount === 'number' && p.amount <= 0) return node;
      const r = p.amount;
      const red   = cloneSource(node).scroll(r, 0).isolateR();
      const green = cloneSource(node).isolateG();
      const blue  = cloneSource(node).scroll(negate(r), 0).isolateB();
      return red.add(green, 1).add(blue, 1);
    },
  },
};
