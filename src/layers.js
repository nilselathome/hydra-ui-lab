import { LAYER_TYPES, MOD_SOURCES, MOD_FNS, TRANSFORM_TYPES } from './layerDefs.js';

let layers = [];
let nextId = 1;

// s0–s3 are Hydra globals for external media sources (images, video, cam)
const usedSlots = new Set();
function allocateSlot() {
  for (let i = 0; i < 4; i++) {
    if (!usedSlots.has(i)) { usedSlots.add(i); return i; }
  }
  return null;
}
function freeSlot(i) { usedSlots.delete(i); }

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
  const fnCfg = MOD_FNS['modulate'];
  return {
    enabled: true,
    fn: 'modulate',
    src,
    amount: 0.1,
    srcParams: defaultModParams(src),
    animate: { enabled: false, mode: 'loop', speed: 0.5, min: fnCfg.min, max: fnCfg.max, _expanded: true },
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
    _expanded: true,
  };
  if (type === 'img') {
    const slot = allocateSlot();
    layer._hydraSlot = slot;
    layer._hydraSource = slot !== null ? window[`s${slot}`] : null;
    layer.imgUrl = '';
  }

  layers.push(layer);
  return layer;
}

export function removeLayer(id) {
  const layer = layers.find(l => l.id === id);
  if (layer?._hydraSlot != null) freeSlot(layer._hydraSlot);
  layers = layers.filter(l => l.id !== id);
}

export function applyState(dataArray) {
  // Clear existing state
  layers = [];
  usedSlots.clear();
  nextId = 1;

  dataArray.forEach(data => {
    const layer = addLayer(data.type);
    layer.visible   = data.visible   ?? true;
    layer.opacity   = data.opacity   ?? 0.5;
    layer.blendMode = data.blendMode ?? 'blend';
    layer._expanded = data._expanded ?? true;
    Object.assign(layer.params, data.params ?? {});
    layer.transforms = data.transforms ?? [];
    layer.mods       = data.mods       ?? [];
    if (data.type === 'img' && data.imgUrl) {
      layer.imgUrl = data.imgUrl;
      layer._hydraSource?.initImage(data.imgUrl);
    }
  });
}

// dir: 1 = move toward front (higher index), -1 = move toward back (lower index)
export function moveLayer(id, dir) {
  const i = layers.findIndex(l => l.id === id);
  const j = i + dir;
  if (j < 0 || j >= layers.length) return;
  [layers[i], layers[j]] = [layers[j], layers[i]];
}
