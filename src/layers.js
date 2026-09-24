import { LAYER_TYPES, MOD_SOURCES, MOD_FNS, TRANSFORM_TYPES } from './layerDefs.js';
import { getImage } from './imageStore.js';

// ── Three.js helpers ──────────────────────────────────────────────────────────

export const THREE_PRESETS = {
  Cube: `// Available: THREE, scene, camera, hydraTexture, hydraCanvas
// hydraTexture updates live from Hydra's canvas every frame.
// Use envMap directly — scene.environment uses a cached PMREM cube map
// and won't pick up live texture changes.
hydraTexture.mapping = THREE.EquirectangularReflectionMapping;

const geo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
const mat = new THREE.MeshStandardMaterial({
  metalness: 1.0, roughness: 0.05,
  envMap: hydraTexture, envMapIntensity: 1.5,
});
const cube = new THREE.Mesh(geo, mat);
scene.add(cube);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

function update(t) {
  cube.rotation.x = t * 0.4;
  cube.rotation.y = t * 0.6;
}`,

  Donut: `hydraTexture.mapping = THREE.EquirectangularReflectionMapping;

const geo = new THREE.TorusGeometry(0.8, 0.32, 64, 128);
const mat = new THREE.MeshStandardMaterial({
  metalness: 1.0, roughness: 0.05,
  envMap: hydraTexture, envMapIntensity: 1.5,
});
const torus = new THREE.Mesh(geo, mat);
scene.add(torus);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

function update(t) {
  torus.rotation.x = t * 0.5;
  torus.rotation.y = t * 0.3;
}`,

  Star: `hydraTexture.mapping = THREE.EquirectangularReflectionMapping;

const shape = new THREE.Shape();
const spikes = 5, outer = 0.75, inner = 0.32;
for (let i = 0; i < spikes * 2; i++) {
  const r = i % 2 === 0 ? outer : inner;
  const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
  const x = Math.cos(a) * r, y = Math.sin(a) * r;
  i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
}
shape.closePath();
const geo = new THREE.ExtrudeGeometry(shape, {
  depth: 0.22, bevelEnabled: true,
  bevelThickness: 0.06, bevelSize: 0.04, bevelSegments: 4,
});
geo.center();
const mat = new THREE.MeshStandardMaterial({
  metalness: 1.0, roughness: 0.05,
  envMap: hydraTexture, envMapIntensity: 1.5,
});
const star = new THREE.Mesh(geo, mat);
scene.add(star);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

function update(t) {
  star.rotation.y = t * 0.5;
  star.rotation.z = Math.sin(t * 0.4) * 0.15;
}`,
};

const DEFAULT_THREE_CODE = THREE_PRESETS.Cube;

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
    // User code runs with THREE, scene, camera, hydraTexture, hydraCanvas in scope
    const fn = new Function('THREE', 'scene', 'camera', 'hydraTexture', 'hydraCanvas', `${layer._threeCode}\nreturn typeof update === 'function' ? update : null;`);
    layer._threeUpdate = fn(window.THREE, scene, layer._threeCamera, layer._hydraTexture, document.getElementById('hydraCanvas'));
  } catch (e) {
    console.warn('Three.js code error:', e);
  }
}

const CSS_BLEND_MAP = {
  blend: 'normal', add: 'screen', mult: 'multiply',
  diff: 'difference', sub: 'normal', layer: 'normal', mask: 'normal',
};

function createThreeLayer(layer) {
  if (!window.THREE) { console.warn('Three.js not loaded'); return; }

  const w = window.innerWidth;
  const h = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(w, h);
  renderer.setClearColor(0x000000, 0);

  const el = renderer.domElement;
  el.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:100;pointer-events:none;';
  document.body.appendChild(el);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
  camera.position.z = 6;

  // Hydra's output canvas used as a live texture source
  const hydraCanvas  = document.getElementById('hydraCanvas');
  const hydraTexture = new THREE.CanvasTexture(hydraCanvas);

  layer._threeRenderer = renderer;
  layer._threeScene    = scene;
  layer._threeCamera   = camera;
  layer._threeUpdate   = null;
  layer._threeRafId    = null;
  layer._hydraTexture  = hydraTexture;

  evalThreeCode(layer);

  const startTime = performance.now();
  function tick() {
    // Sync visibility / opacity / blend from layer state
    const visible = layer.visible !== false;
    el.style.display      = visible ? '' : 'none';
    el.style.opacity      = String(layer.opacity ?? 1);
    el.style.mixBlendMode = CSS_BLEND_MAP[layer.blendMode] ?? 'normal';

    if (visible) {
      hydraTexture.needsUpdate = true;
      const t = (performance.now() - startTime) / 1000;
      if (layer._threeUpdate) layer._threeUpdate(t);
      renderer.render(scene, camera);
    }
    layer._threeRafId = requestAnimationFrame(tick);
  }
  layer._threeRafId = requestAnimationFrame(tick);
}

function destroyThreeLayer(layer) {
  if (layer._threeRafId) { cancelAnimationFrame(layer._threeRafId); layer._threeRafId = null; }
  if (layer._threeRenderer) {
    layer._threeRenderer.domElement.remove();
    layer._threeRenderer.dispose();
    layer._threeRenderer = null;
  }
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

// ── Marquee scroll / scramble loop ──────────────────────────────────────────
// Drives per-frame canvas redraws for text layers with scrollSpd != 0 or
// scrambleIn/scrambleOut > 0. Hydra re-reads dynamic sources every frame, so
// just keeping the canvas up-to-date here is enough — no Hydra chain rebuild
// needed.

let _rafId     = null;
let _lastTs    = 0;
const _offsets = new Map(); // layerId → accumulated CSS-pixel offset (marquee)
const _scrambleElapsed = new Map(); // layerId → accumulated seconds (scramble)

const SCRAMBLE_CHARS = '!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
function _scrambleChar() {
  return SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0];
}

function _isScrambling(layer) {
  return layer.params.scrambleIn > 0 || layer.params.scrambleOut > 0;
}

// Per-character reveal thresholds (0..1), regenerated whenever the text changes.
// A character's "in" threshold also doubles (mirrored) as its "out" threshold,
// so characters that settle first are the last to dissolve — a symmetric ripple.
function _ensureScrambleSeeds(layer) {
  const text = layer.textContent ?? '';
  if (layer._scrambleSeedText === text && layer._scrambleSeeds) return;
  layer._scrambleSeedText = text;
  layer._scrambleSeeds = Array.from(text, () => Math.random());
}

function _drawScramble(layer, elapsed) {
  const canvas = layer._canvas;
  if (!canvas) return;
  const p    = layer.params;
  const text = layer.textContent ?? '';
  const seeds = layer._scrambleSeeds ?? [];
  const dpr  = layer._canvasDpr || 1;
  const logW = canvas.width  / dpr;
  const logH = canvas.height / dpr;
  const ctx  = canvas.getContext('2d');

  const inDur   = Math.max(p.scrambleIn, 0);
  const holdDur = Math.max(p.scrambleHold, 0);
  const outDur  = Math.max(p.scrambleOut, 0);
  const cycle   = inDur + holdDur + outDur;
  const t       = cycle > 0 ? elapsed % cycle : 0;
  const inPhase   = t < inDur;
  const holdPhase = !inPhase && t < inDur + holdDur;

  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ') { out += ch; continue; }
    const seed = seeds[i] ?? 0.5;
    let resolved;
    if (inPhase) {
      // Resolving: each char reveals once elapsed-in-phase crosses its threshold.
      resolved = inDur === 0 ? true : (t / inDur) >= seed;
    } else if (holdPhase) {
      // Holding: fully settled on the original text.
      resolved = true;
    } else {
      // Dissolving: mirrored threshold, so early-resolvers hold longest.
      const localT = outDur === 0 ? 1 : (t - inDur - holdDur) / outDur;
      resolved = localT < (1 - seed);
    }
    out += resolved ? ch : _scrambleChar();
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.font      = `${Math.round(p.size)}px "${layer.fontFamily}"`;
  ctx.fillStyle = `rgb(${Math.round(p.r * 255)},${Math.round(p.g * 255)},${Math.round(p.b * 255)})`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(out, logW * p.x, logH * p.y);
  ctx.restore();
}

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

  // A layer that's scrambling takes priority over marquee scroll — both are
  // full-canvas redraws and combining them isn't worth the complexity.
  const scrambling = layers.filter(l => l.type === 'text' && _isScrambling(l));
  const scrolling  = layers.filter(l => l.type === 'text' && l.params.scrollSpd !== 0 && !_isScrambling(l));
  if (scrambling.length === 0 && scrolling.length === 0) { _rafId = null; return; }

  scrambling.forEach(layer => {
    const elapsed = (_scrambleElapsed.get(layer.id) || 0) + dt;
    _scrambleElapsed.set(layer.id, elapsed);
    _drawScramble(layer, elapsed);
  });

  scrolling.forEach(layer => {
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

function ensureTextAnimLoop() {
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

  _ensureScrambleSeeds(layer);

  if (_isScrambling(layer) || p.scrollSpd !== 0) {
    // Hand off to the animation loop — it reads params live each frame
    ensureTextAnimLoop();
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

// ── Text bank auto-advance (poem/speech mode) ───────────────────────────────
// Cycles a text layer's textBank on a timer, mirroring the Scenes pane's
// player: a uniform interval, or comma-separated per-step custom durations
// that override it. layer.textBankPlaying is persisted (see state.js) so a
// reload/share-link resumes playback rather than requiring Play again.
//
// Each bank entry carries its own text *and* style (font/size/position/color)
// — switching entries applies that style onto the layer, not just the text.
const _textBankTimers = new Map(); // layerId → timeout handle

// Also used by the UI (src/ui.js) to validate the custom-timings input
// against the bank's step count.
export function parseTextBankTimings(timingsStr) {
  return (timingsStr ?? '')
    .split(',')
    .map(s => parseFloat(s.trim()))
    .filter(n => isFinite(n) && n > 0);
}

function textBankDurationForStep(layer, step) {
  const list = parseTextBankTimings(layer.textBankTimings);
  return list.length ? list[step % list.length] : (layer.textBankInterval ?? 5);
}

// Captures the layer's current style into a fresh bank entry (used for the
// layer's first entry, and as a starting point when adding a new one).
export function snapshotTextEntry(layer, text = '') {
  return {
    text,
    fontFamily: layer.fontFamily,
    size: layer.params.size,
    x:    layer.params.x,
    y:    layer.params.y,
    r:    layer.params.r,
    g:    layer.params.g,
    b:    layer.params.b,
  };
}

export function setTextBankIndex(layer, index) {
  const bank = layer.textBank ?? [];
  if (bank.length === 0) return;
  layer.textBankIndex = ((index % bank.length) + bank.length) % bank.length;
  const entry = bank[layer.textBankIndex];
  layer.textContent = entry.text ?? '';
  layer.fontFamily   = entry.fontFamily ?? layer.fontFamily;
  layer.params.size  = entry.size ?? layer.params.size;
  layer.params.x     = entry.x    ?? layer.params.x;
  layer.params.y     = entry.y    ?? layer.params.y;
  layer.params.r     = entry.r    ?? layer.params.r;
  layer.params.g     = entry.g    ?? layer.params.g;
  layer.params.b     = entry.b    ?? layer.params.b;
  drawTextCanvas(layer);
}

export function isTextBankPlaying(layer) {
  return !!layer.textBankPlaying;
}

export function stopTextBankPlayer(layer) {
  const timer = _textBankTimers.get(layer.id);
  if (timer != null) clearTimeout(timer);
  _textBankTimers.delete(layer.id);
  layer.textBankPlaying = false;
}

export function startTextBankPlayer(layer) {
  if ((layer.textBank?.length ?? 0) < 2) return;
  stopTextBankPlayer(layer);
  layer.textBankPlaying = true;
  let step = 0;
  const scheduleNext = () => {
    const dur = textBankDurationForStep(layer, step++);
    _textBankTimers.set(layer.id, setTimeout(tick, Math.max(0.1, dur) * 1000));
  };
  const tick = () => {
    setTextBankIndex(layer, layer.textBankIndex + 1);
    scheduleNext();
  };
  scheduleNext();
}

function defaultModParams(srcType) {
  const p = {};
  LAYER_TYPES[srcType].params.forEach(def => { p[def.key] = def.default; });
  return p;
}

export function createTransformAnimate(type) {
  const animate = {};
  TRANSFORM_TYPES[type].params.forEach(p => {
    animate[p.key] = { enabled: false, mode: 'loop', speed: 0.5, min: p.min, max: p.max, band: 0, bezier: [0.5, 0, 0.5, 1], steps: [p.min, p.max], _expanded: true };
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
    animate: { enabled: false, mode: 'loop', speed: 0.5, min: fnCfg.min, max: fnCfg.max, band: 0, bezier: [0.5, 0, 0.5, 1], steps: [fnCfg.min, fnCfg.max], _expanded: true },
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
    // "Text bank" — a poem/speech's worth of lines (each with its own style),
    // switchable by hand or on an auto-advance timer. textContent/fontFamily/
    // params.size,x,y,r,g,b above always mirror the active entry.
    layer.textBank         = [snapshotTextEntry(layer, 'Text')];
    layer.textBankIndex    = 0;
    layer.textBankInterval = 5;
    layer.textBankTimings  = '';
    layer.textBankPlaying  = false;
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
  if (layer?.type === 'text')  stopTextBankPlayer(layer);
  if (layer?._hydraSlot != null) freeSlot(layer._hydraSlot);
  _offsets.delete(id);
  _scrambleElapsed.delete(id);
  layers = layers.filter(l => l.id !== id);
}

// Applies a plain-data snapshot (as produced by serializeLayer in state.js, or
// duplicateLayer below) onto a freshly created layer of the matching type.
function restoreLayerData(layer, data) {
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
    // Style to fall back on for older saves whose bank entries are plain
    // strings (pre-per-entry-style) or missing a field — the layer's own
    // saved fontFamily/params at the time, or today's defaults.
    const legacyStyle = {
      fontFamily: data.fontFamily ?? 'Bebas Neue',
      size: data.params?.size ?? layer.params.size,
      x:    data.params?.x    ?? layer.params.x,
      y:    data.params?.y    ?? layer.params.y,
      r:    data.params?.r    ?? layer.params.r,
      g:    data.params?.g    ?? layer.params.g,
      b:    data.params?.b    ?? layer.params.b,
    };
    const rawBank = data.textBank?.length ? data.textBank : [data.textContent ?? 'Text'];
    layer.textBank = rawBank.map(entry =>
      typeof entry === 'string' ? { text: entry, ...legacyStyle } : { ...legacyStyle, ...entry }
    );
    layer.textBankIndex    = Math.min(Math.max(data.textBankIndex ?? 0, 0), layer.textBank.length - 1);
    layer.textBankInterval = data.textBankInterval ?? 5;
    layer.textBankTimings  = data.textBankTimings  ?? '';
    layer.textBankPlaying  = false; // set true below if resumed
    setTextBankIndex(layer, layer.textBankIndex); // applies the active entry's style + redraws
    if (data.textBankPlaying) startTextBankPlayer(layer);
  }
  if (data.type === 'glsl') {
    layer._glslCode = data.glslCode ?? DEFAULT_GLSL;
    registerGlsl(layer);
  }
  if (data.type === 'three') {
    layer._threeCode = data.threeCode ?? DEFAULT_THREE_CODE;
    reloadThree(layer);
  }
}

export function applyState(dataArray) {
  // Clear existing state
  layers.forEach(l => {
    if (l.type === 'three') destroyThreeLayer(l);
    if (l.type === 'text')  stopTextBankPlayer(l);
  });
  layers = [];
  usedSlots.clear();
  nextId = 1;

  dataArray.forEach(data => restoreLayerData(addLayer(data.type), data));
}

// dir: 1 = move toward front (higher index), -1 = move toward back (lower index)
export function moveLayer(id, dir) {
  const i = layers.findIndex(l => l.id === id);
  const j = i + dir;
  if (j < 0 || j >= layers.length) return;
  [layers[i], layers[j]] = [layers[j], layers[i]];
}

// Inserts a copy of the layer directly above the original (same params,
// transforms, mods, and type-specific media/code) — a fresh img/text slot is
// allocated if one is free, same as any other new layer.
export function duplicateLayer(id) {
  const idx = layers.findIndex(l => l.id === id);
  if (idx === -1) return null;
  const source = layers[idx];

  const data = {
    type: source.type,
    visible: source.visible,
    opacity: source.opacity,
    blendMode: source.blendMode,
    _expanded: source._expanded,
    params: structuredClone(source.params),
    transforms: structuredClone(source.transforms),
    mods: structuredClone(source.mods),
  };
  if (source.type === 'img') { data.imgUrl = source.imgUrl; data.imgName = source.imgName; }
  if (source.type === 'text') {
    data.fontFamily       = source.fontFamily;
    data.textBank         = [...source.textBank];
    data.textBankIndex    = source.textBankIndex;
    data.textBankInterval = source.textBankInterval;
    data.textBankTimings  = source.textBankTimings;
    data.textBankPlaying  = source.textBankPlaying;
  }
  if (source.type === 'glsl')  data.glslCode  = source._glslCode;
  if (source.type === 'three') data.threeCode = source._threeCode;

  const copy = addLayer(source.type); // appended at the end for now
  restoreLayerData(copy, data);

  layers = layers.filter(l => l.id !== copy.id);
  layers.splice(idx + 1, 0, copy);
  return copy;
}
