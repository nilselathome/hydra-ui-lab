import { LAYER_TYPES, MOD_SOURCES, MOD_FNS, TRANSFORM_TYPES } from './layerDefs.js';
import { getImage } from './imageStore.js';

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

// ── Marquee scroll loop ───────────────────────────────────────────────────────
// Drives per-frame canvas redraws for text layers with scrollSpd != 0.
// Hydra re-reads dynamic sources every frame, so just keeping the canvas
// up-to-date here is enough — no Hydra chain rebuild needed.

let _rafId     = null;
let _lastTs    = 0;
const _offsets = new Map(); // layerId → accumulated CSS-pixel offset

function _drawMarquee(layer, offsetCss) {
  const canvas = layer._canvas;
  if (!canvas) return;
  const p   = layer._marqueeParams; // snapshot set before RAF to avoid mid-frame reads
  const dpr = layer._canvasDpr || 1;
  const logW = canvas.width  / dpr;
  const logH = canvas.height / dpr;
  const ctx  = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.font = p.fontStr;

  // Measure actual text width in logical (CSS) units, within the scaled context
  const textW = ctx.measureText(p.text).width;

  // Period = text width + one full screen width of gap before the next repeat
  const period = textW + logW;
  // Positive speed → scroll left (text enters from right)
  const phase  = ((offsetCss % period) + period) % period;
  const startX = logW - phase;

  ctx.fillStyle  = p.color;
  ctx.textAlign  = 'left';
  ctx.textBaseline = 'middle';
  const y = logH * p.y;

  // Draw up to three copies so the canvas is always seamlessly filled
  ctx.fillText(p.text, startX - period, y);
  ctx.fillText(p.text, startX,          y);
  ctx.fillText(p.text, startX + period, y);

  ctx.restore();
}

function _tick(ts) {
  const dt = Math.min((ts - _lastTs) / 1000, 0.1); // cap at 100 ms to avoid jump on tab-focus
  _lastTs = ts;

  const animated = layers.filter(l => l.type === 'text' && l.params.scrollSpd !== 0);
  if (animated.length === 0) { _rafId = null; return; }

  animated.forEach(layer => {
    const canvas = layer._canvas;
    if (!canvas) return;
    const dpr  = layer._canvasDpr || 1;
    const logW = canvas.width / dpr;
    const spd  = layer.params.scrollSpd; // screen-widths / second (positive = left)
    const off  = (_offsets.get(layer.id) || 0) + spd * logW * dt;
    _offsets.set(layer.id, off);

    // Snapshot params once per frame (avoids mid-draw Tweakpane mutations)
    layer._marqueeParams = {
      fontStr: `${Math.round(layer.params.size)}px "${layer.fontFamily}"`,
      text:    layer.textContent ?? '',
      color:   `rgb(${Math.round(layer.params.r * 255)},${Math.round(layer.params.g * 255)},${Math.round(layer.params.b * 255)})`,
      y:       layer.params.y,
    };

    _drawMarquee(layer, off);
  });

  _rafId = requestAnimationFrame(_tick);
}

function ensureScrollLoop() {
  if (_rafId !== null) return;
  _lastTs = performance.now();
  _rafId  = requestAnimationFrame(_tick);
}

// ── Text canvas (static) ─────────────────────────────────────────────────────

export async function drawTextCanvas(layer) {
  const canvas = layer._canvas;
  if (!canvas) return;
  const p = layer.params;

  const fontStr = `${Math.round(p.size)}px "${layer.fontFamily}"`;
  // Web fonts won't render on an offscreen canvas unless explicitly loaded first
  try { await document.fonts.load(fontStr); } catch (_) {}

  if (p.scrollSpd !== 0) {
    // Hand off to the marquee loop — it reads params live each frame
    ensureScrollLoop();
    return;
  }

  const dpr  = layer._canvasDpr || 1;
  const logW = canvas.width  / dpr;
  const logH = canvas.height / dpr;
  const ctx  = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.font      = fontStr;
  ctx.fillStyle = `rgb(${Math.round(p.r * 255)},${Math.round(p.g * 255)},${Math.round(p.b * 255)})`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(layer.textContent ?? '', logW * p.x, logH * p.y);
  ctx.restore();
}

function defaultModParams(srcType) {
  const p = {};
  LAYER_TYPES[srcType].params.forEach(def => { p[def.key] = def.default; });
  return p;
}

export function createTransformAnimate(type) {
  const animate = {};
  TRANSFORM_TYPES[type].params.forEach(p => {
    animate[p.key] = { enabled: false, mode: 'loop', speed: 0.5, min: p.min, max: p.max, band: 0, bezier: [0.5, 0, 0.5, 1], _expanded: true };
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
    animate: { enabled: false, mode: 'loop', speed: 0.5, min: fnCfg.min, max: fnCfg.max, band: 0, bezier: [0.5, 0, 0.5, 1], _expanded: true },
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
    layer.imgUrl  = '';
    layer.imgName = '';
    if (layer._hydraSource) {
      const blank = document.createElement('canvas');
      blank.width = 1; blank.height = 1;
      layer._hydraSource.init({ src: blank });
    }
  }

  if (type === 'text') {
    const slot = allocateSlot();
    layer._hydraSlot = slot;
    layer._hydraSource = slot !== null ? window[`s${slot}`] : null;
    layer.textContent = 'Text';
    layer.fontFamily = 'Bebas Neue';
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(window.innerWidth  * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    layer._canvas    = canvas;
    layer._canvasDpr = dpr;
    drawTextCanvas(layer); // async — Hydra picks it up on first dynamic tick
    layer._hydraSource?.init({ src: canvas, dynamic: true });
  }

  layers.push(layer);
  return layer;
}

export function removeLayer(id) {
  const layer = layers.find(l => l.id === id);
  if (layer?._hydraSlot != null) freeSlot(layer._hydraSlot);
  _offsets.delete(id);
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
      layer.imgUrl  = data.imgUrl;
      layer.imgName = data.imgName || '';
      if (data.imgUrl.startsWith('idb:')) {
        getImage(data.imgUrl).then(blob => {
          if (blob) layer._hydraSource?.initImage(URL.createObjectURL(blob));
        });
      } else {
        layer._hydraSource?.initImage(data.imgUrl);
      }
    }
    if (data.type === 'text') {
      layer.textContent = data.textContent ?? 'Text';
      layer.fontFamily  = data.fontFamily  ?? 'Bebas Neue';
      drawTextCanvas(layer);
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
