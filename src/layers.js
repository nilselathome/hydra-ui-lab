import { LAYER_TYPES, MOD_SOURCES, TRANSFORM_TYPES } from './layerDefs.js';

let layers = [];
let nextId = 1;

export function getLayers() {
  return layers;
}

function defaultModParams(srcType) {
  const p = {};
  LAYER_TYPES[srcType].params.forEach(def => { p[def.key] = def.default; });
  return p;
}

export function createTransformAnimate(type) {
  const animate = {};
  TRANSFORM_TYPES[type].params.forEach(p => {
    animate[p.key] = { enabled: false, mode: 'loop', speed: 0.5, min: p.min, max: p.max, _expanded: true };
  });
  return animate;
}

export function createTransform(type = 'rotate') {
  const params = {};
  TRANSFORM_TYPES[type].params.forEach(p => { params[p.key] = p.default; });
  return { type, params, animate: createTransformAnimate(type), _expanded: true };
}

export function createMod() {
  const src = MOD_SOURCES[0]; // noise
  return {
    enabled: true,
    fn: 'modulate',
    src,
    amount: 0.1,
    srcParams: defaultModParams(src),
    animate: { enabled: false, mode: 'loop', speed: 0.5, _expanded: true },
    _expanded: true,
  };
}

export function resetModSrcParams(mod, newSrc) {
  mod.src = newSrc;
  mod.srcParams = defaultModParams(newSrc);
}

export function addLayer(type, overrides = {}) {
  const def = LAYER_TYPES[type];
  if (!def) throw new Error(`Unknown layer type: ${type}`);

  const params = {};
  def.params.forEach(p => { params[p.key] = overrides[p.key] ?? p.default; });

  const layer = {
    id: nextId++,
    type,
    name: def.label,
    visible: true,
    opacity: 0.5,
    blendMode: 'blend',
    params,
    transforms: [],
    mods: [],
  };
  layers.push(layer);
  return layer;
}

export function removeLayer(id) {
  layers = layers.filter(l => l.id !== id);
}

// dir: 1 = move toward front (higher index), -1 = move toward back (lower index)
export function moveLayer(id, dir) {
  const i = layers.findIndex(l => l.id === id);
  const j = i + dir;
  if (j < 0 || j >= layers.length) return;
  [layers[i], layers[j]] = [layers[j], layers[i]];
}
