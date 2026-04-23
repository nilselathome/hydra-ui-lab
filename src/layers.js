import { LAYER_TYPES, MOD_SOURCES, MOD_FNS, TRANSFORM_TYPES } from './layerDefs.js';
import { getImage } from './imageStore.js';

// ── Three.js helpers ──────────────────────────────────────────────────────────

const DEFAULT_THREE_CODE = `const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
const mat = new THREE.MeshPhongMaterial({
  color: 0x88ccff,
  shininess: 120,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
});
const cube = new THREE.Mesh(geo, mat);
scene.add(cube);

const light = new THREE.DirectionalLight(0xffffff, 1.2);
light.position.set(1, 2, 2);
scene.add(light);
scene.add(new THREE.AmbientLight(0x222244, 1));

function update(t) {
  cube.rotation.x = t * 0.5;
  cube.rotation.y = t * 0.7;
}`;

function evalThreeCode(layer) {
  const scene = layer._threeScene;
  if (!scene) return;

  // Clear existing scene objects
  const toRemove = [...scene.children];
  toRemove.forEach(obj => {
    scene.remove(obj);
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(m => m?.dispose());
  });

  layer._threeUpdate = null;
  try {
    // User code runs with THREE and scene in scope; can define update(t) which gets returned
    const fn = new Function('THREE', 'scene', `${layer._threeCode}\nreturn typeof update === 'function' ? update : null;`);
    layer._threeUpdate = fn(window.THREE, scene);
  } catch (e) {
    console.warn('Three.js code error:', e);
  }
}

function createThreeLayer(layer) {
  if (!window.THREE) { console.warn('Three.js not loaded'); return; }

  const slot = allocateSlot();
  layer._hydraSlot   = slot;
  layer._hydraSource = slot !== null ? window[`s${slot}`] : null;
  if (!layer._hydraSource) return;

  const w = window.innerWidth;
  const h = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(w, h);
  renderer.setClearColor(0x000000, 0);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
  camera.position.z = 3;

  layer._threeRenderer = renderer;
  layer._threeScene    = scene;
  layer._threeCamera   = camera;
  layer._threeUpdate   = null;
  layer._threeRafId    = null;

  evalThreeCode(layer);

  layer._hydraSource.init({ src: renderer.domElement, dynamic: true });

  const startTime = performance.now();
  function tick() {
    const t = (performance.now() - startTime) / 1000;
    if (layer._threeUpdate) layer._threeUpdate(t);
    renderer.render(scene, camera);
    layer._threeRafId = requestAnimationFrame(tick);
  }
  layer._threeRafId = requestAnimationFrame(tick);
}

function destroyThreeLayer(layer) {
  if (layer._threeRafId) { cancelAnimationFrame(layer._threeRafId); layer._threeRafId = null; }
  if (layer._threeRenderer) { layer._threeRenderer.dispose(); layer._threeRenderer = null; }
}

export function reloadThree(layer) {
  evalThreeCode(layer);
}

// ── GLSL helpers ──────────────────────────────────────────────────────────────

const DEFAULT_GLSL = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0.0, 2.0, 4.0));
  fragColor = vec4(col, 1.0);
}`;

// Hydra's setFunction expects the GLSL *body* of `vec4 fnName(vec2 _st) { ... }`,
// not a full function definition. We extract the mainImage body and emit Shadertoy-
// compatible preamble variables so user code can use fragCoord/fragColor naturally.
function transpileGlsl(code) {
  const transformed = code
    .replace(/\biTime\b/g,       'time')
    .replace(/\biResolution\b/g, 'resolution')
    .replace(/\biMouse\b/g,      'mouse');

  // Find the mainImage function and extract its body via brace matching
  const sigIdx = transformed.search(/void\s+mainImage\s*\(/);
  if (sigIdx !== -1) {
    const braceStart = transformed.indexOf('{', sigIdx);
    if (braceStart !== -1) {
      let depth = 1, i = braceStart + 1;
      while (i < transformed.length && depth > 0) {
        if (transformed[i] === '{') depth++;
        else if (transformed[i] === '}') depth--;
        i++;
      }
      const body = transformed.slice(braceStart + 1, i - 1);
      return `vec2 fragCoord=_st*resolution;\nvec4 fragColor=vec4(0.0);\n${body}\nreturn fragColor;`;
    }
  }

  // Fallback: treat as a raw Hydra function body (already has return statement)
  return transformed;
}

export function registerGlsl(layer) {
  try {
    const glsl = transpileGlsl(layer._glslCode);
    setFunction({ name: layer._glslName, type: 'src', inputs: [], glsl });
  } catch (e) {
    console.warn('GLSL registration error:', e);
  }
}

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

  if (type === 'glsl') {
    layer._glslName = `hydraGlsl_${layer.id}`;
    layer._glslCode = DEFAULT_GLSL;
    registerGlsl(layer);
  }

  if (type === 'three') {
    layer._threeCode = DEFAULT_THREE_CODE;
    createThreeLayer(layer);
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
  if (layer?.type === 'three') destroyThreeLayer(layer);
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
    if (data.type === 'glsl') {
      layer._glslName = `hydraGlsl_${layer.id}`;
      layer._glslCode = data.glslCode ?? DEFAULT_GLSL;
      registerGlsl(layer);
    }
    if (data.type === 'three') {
      layer._threeCode = data.threeCode ?? DEFAULT_THREE_CODE;
      reloadThree(layer);
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
