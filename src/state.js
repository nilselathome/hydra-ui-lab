import { TRANSFORM_TYPES, MOD_FNS } from './layerDefs.js';

// ── Serialization ─────────────────────────────────────────────────────────────

function serializeTransform(t) {
  const animate = {};
  Object.entries(t.animate).forEach(([k, v]) => {
    animate[k] = { enabled: v.enabled, mode: v.mode, speed: v.speed, min: v.min, max: v.max, band: v.band ?? 0, bezier: v.bezier ?? [0.5, 0, 0.5, 1], _expanded: v._expanded };
  });
  return { type: t.type, params: { ...t.params }, animate, _expanded: t._expanded };
}

function serializeMod(m) {
  return {
    enabled: m.enabled,
    fn: m.fn,
    src: m.src,
    amount: m.amount,
    srcParams: { ...m.srcParams },
    animate: { enabled: m.animate.enabled, mode: m.animate.mode, speed: m.animate.speed, min: m.animate.min, max: m.animate.max, band: m.animate.band ?? 0, bezier: m.animate.bezier ?? [0.5, 0, 0.5, 1], _expanded: m.animate._expanded },
    _expanded: m._expanded,
  };
}

function serializeLayer(layer) {
  const out = {
    type: layer.type,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    params: { ...layer.params },
    transforms: layer.transforms.map(serializeTransform),
    mods: layer.mods.map(serializeMod),
    _expanded: layer._expanded,
  };
  if (layer.type === 'img')  { out.imgUrl = layer.imgUrl || ''; out.imgName = layer.imgName || ''; }
  if (layer.type === 'text') out.textContent = layer.textContent ?? '';
  if (layer.type === 'text') out.fontFamily  = layer.fontFamily  ?? 'Arial';
  if (layer.type === 'glsl') out.glslCode    = layer._glslCode   ?? '';
  return out;
}

// ── Deserialization ───────────────────────────────────────────────────────────

function deserializeTransform(data) {
  const def = TRANSFORM_TYPES[data.type];
  const animate = {};
  def.params.forEach(p => {
    const saved = data.animate?.[p.key] ?? {};
    animate[p.key] = {
      enabled:   saved.enabled   ?? false,
      mode:      saved.mode      ?? 'loop',
      speed:     saved.speed     ?? 0.5,
      min:       saved.min       ?? p.min,
      max:       saved.max       ?? p.max,
      band:      saved.band      ?? 0,
      bezier:    saved.bezier    ?? [0.5, 0, 0.5, 1],
      _expanded: saved._expanded ?? true,
    };
  });
  return { type: data.type, params: { ...data.params }, animate, _expanded: data._expanded ?? true };
}

function deserializeMod(data) {
  const fnCfg = MOD_FNS[data.fn] ?? MOD_FNS['modulate'];
  return {
    enabled:   data.enabled ?? true,
    fn:        data.fn,
    src:       data.src,
    amount:    data.amount,
    srcParams: { ...data.srcParams },
    animate: {
      enabled:   data.animate?.enabled   ?? false,
      mode:      data.animate?.mode      ?? 'loop',
      speed:     data.animate?.speed     ?? 0.5,
      min:       data.animate?.min       ?? fnCfg.min,
      max:       data.animate?.max       ?? fnCfg.max,
      band:      data.animate?.band      ?? 0,
      bezier:    data.animate?.bezier    ?? [0.5, 0, 0.5, 1],
      _expanded: data.animate?._expanded ?? true,
    },
    _expanded: data._expanded ?? true,
  };
}

export function deserializeLayers(dataArray) {
  return dataArray.map(data => ({
    ...data,
    transforms: (data.transforms ?? []).map(deserializeTransform),
    mods:       (data.mods       ?? []).map(deserializeMod),
  }));
}

// ── URL encoding ──────────────────────────────────────────────────────────────

const SCENE_KEY = (n) => `hydra-scene-${n}`;

// Synchronous legacy encode — kept for dirty-check comparisons and localStorage scene slots
export function encodeState(layers, uiState = {}) {
  const payload = { layers: layers.map(serializeLayer), ui: uiState };
  return btoa(encodeURIComponent(JSON.stringify(payload)));
}

// Async gzip + URL-safe base64 (no percent-encoding overhead)
async function compressPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  const u8 = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decompressPayload(encoded) {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(u8);
  writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(buf));
}

export async function getCompressedUrlLength(layers, uiState = {}) {
  const payload = { layers: layers.map(serializeLayer), ui: uiState };
  const encoded = await compressPayload(payload);
  return encoded.length;
}

export async function saveToUrl(layers, uiState = {}) {
  const payload = { layers: layers.map(serializeLayer), ui: uiState };
  try {
    const encoded = await compressPayload(payload);
    history.replaceState(null, '', location.pathname + `#z=${encoded}`);
  } catch (e) {
    showWarning('Failed to save state to URL.');
    console.error(e);
  }
}

export function saveSceneToUrl(slot) {
  history.replaceState(null, '', location.pathname + `#scene=${slot + 1}`);
}

export async function loadFromUrl() {
  // Short scene URL: #scene=N (1-based)
  const sceneMatch = location.hash.match(/^#scene=(\d+)$/);
  if (sceneMatch) {
    const slot = parseInt(sceneMatch[1], 10) - 1;
    const stored = localStorage.getItem(SCENE_KEY(slot));
    if (!stored) return { sceneSlot: slot, layers: [], ui: {} };
    try {
      const payload = JSON.parse(decodeURIComponent(atob(stored)));
      const data = Array.isArray(payload) ? { layers: payload } : payload;
      return { layers: data.layers ?? [], ui: data.ui ?? {}, sceneSlot: slot };
    } catch {
      return { sceneSlot: slot, layers: [], ui: {} };
    }
  }

  // Compressed state: #z=...
  const zMatch = location.hash.match(/^#z=(.+)$/);
  if (zMatch) {
    try {
      const payload = await decompressPayload(zMatch[1]);
      if (Array.isArray(payload)) return { layers: payload, ui: {} };
      return payload;
    } catch {
      return null;
    }
  }

  // Legacy full encoded state: #s=...
  const sMatch = location.hash.match(/^#s=(.+)$/);
  if (!sMatch) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(atob(sMatch[1])));
    if (Array.isArray(payload)) return { layers: payload, ui: {} };
    return payload;
  } catch {
    return null;
  }
}

// ── Warning toast ─────────────────────────────────────────────────────────────

export function showWarning(msg) {
  let el = document.getElementById('hydra-warning');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hydra-warning';
    el.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: rgba(220,60,60,0.92); color: #fff;
      padding: 8px 18px; border-radius: 4px;
      font-size: 11px; font-family: monospace; letter-spacing: 0.02em;
      z-index: 99999; pointer-events: none;
      transition: opacity 0.4s;
    `;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 4000);
}
