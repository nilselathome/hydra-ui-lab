import { TRANSFORM_TYPES, MOD_FNS } from './layerDefs.js';

const URL_LENGTH_LIMIT = 8000;

// ── Serialization ─────────────────────────────────────────────────────────────

function serializeTransform(t) {
  const animate = {};
  Object.entries(t.animate).forEach(([k, v]) => {
    animate[k] = { enabled: v.enabled, mode: v.mode, speed: v.speed, min: v.min, max: v.max, _expanded: v._expanded };
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
    animate: { enabled: m.animate.enabled, mode: m.animate.mode, speed: m.animate.speed, min: m.animate.min, max: m.animate.max, _expanded: m.animate._expanded },
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
  if (layer.type === 'img') out.imgUrl = layer.imgUrl || '';
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

export function encodeState(layers, uiState = {}) {
  const payload = { layers: layers.map(serializeLayer), ui: uiState };
  return btoa(encodeURIComponent(JSON.stringify(payload)));
}

export function saveToUrl(layers, uiState = {}) {
  const encoded = encodeState(layers, uiState);
  const hash    = `#s=${encoded}`;
  const fullUrl = location.origin + location.pathname + hash;

  if (fullUrl.length > URL_LENGTH_LIMIT) {
    showWarning(`URL too long to share (${fullUrl.length} chars). Shorten image URLs or reduce layer count.`);
    return;
  }

  history.replaceState(null, '', location.pathname + hash);
}

export function loadFromUrl() {
  const match = location.hash.match(/^#s=(.+)$/);
  if (!match) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(atob(match[1])));
    // Support old format (bare array) and new format ({ layers, ui })
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
