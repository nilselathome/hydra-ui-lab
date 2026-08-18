import { TRANSFORM_TYPES, MOD_FNS } from './layerDefs.js';

// ── Serialization ─────────────────────────────────────────────────────────────

function serializeTransform(t) {
  const animate = {};
  Object.entries(t.animate).forEach(([k, v]) => {
    animate[k] = { enabled: v.enabled, mode: v.mode, speed: v.speed, min: v.min, max: v.max, band: v.band ?? 0, bezier: v.bezier ?? [0.5, 0, 0.5, 1], steps: v.steps ?? [], division: v.division ?? 4, _expanded: v._expanded };
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
    animate: { enabled: m.animate.enabled, mode: m.animate.mode, speed: m.animate.speed, min: m.animate.min, max: m.animate.max, band: m.animate.band ?? 0, bezier: m.animate.bezier ?? [0.5, 0, 0.5, 1], steps: m.animate.steps ?? [], division: m.animate.division ?? 4, _expanded: m.animate._expanded },
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
  if (layer.type === 'glsl')  out.glslCode  = layer._glslCode  ?? '';
  if (layer.type === 'three') out.threeCode = layer._threeCode ?? '';
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
      steps:     saved.steps     ?? [],
      division:  saved.division  ?? 4,
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
      steps:     data.animate?.steps     ?? [],
      division:  data.animate?.division  ?? 4,
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

const GLOBAL_AUDIO_KEY = 'hydra-global-audio';

// Audio track/loop/BPM are global (shared across all scenes), not part of any scene slot.
export function saveGlobalAudioState(state) {
  try { localStorage.setItem(GLOBAL_AUDIO_KEY, JSON.stringify(state)); } catch {}
}

export function loadGlobalAudioState() {
  try {
    const raw = localStorage.getItem(GLOBAL_AUDIO_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── Scene banks ───────────────────────────────────────────────────────────────
// A bank is a named collection of SCENES_PER_BANK scene slots. Scenes used to be
// one flat set of slots; banks let that set be duplicated, exported/imported as a
// file, and swapped wholesale (see migrateLegacyScenes for the one-time upgrade).

const BANKS_KEY = 'hydra-banks';
const ACTIVE_BANK_KEY = 'hydra-active-bank';
const LEGACY_SCENE_KEY = (n) => `hydra-scene-${n}`;
export const SCENES_PER_BANK = 16;

export function sceneKey(bankId, n) {
  return `hydra-bank-${bankId}-scene-${n}`;
}

function readBanks() {
  try {
    const raw = localStorage.getItem(BANKS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeBanks(banks) {
  localStorage.setItem(BANKS_KEY, JSON.stringify(banks));
}

// Runs once: wraps any pre-existing flat hydra-scene-N slots into a "Bank 1" bank.
function migrateLegacyScenes() {
  if (readBanks()) return;
  const id = 'default';
  for (let i = 0; i < SCENES_PER_BANK; i++) {
    const raw = localStorage.getItem(LEGACY_SCENE_KEY(i));
    if (raw !== null) {
      localStorage.setItem(sceneKey(id, i), raw);
      localStorage.removeItem(LEGACY_SCENE_KEY(i));
    }
  }
  writeBanks([{ id, name: 'Bank 1' }]);
  localStorage.setItem(ACTIVE_BANK_KEY, id);
}

export function listBanks() {
  migrateLegacyScenes();
  return readBanks() ?? [];
}

export function getActiveBankId() {
  const banks = listBanks();
  const stored = localStorage.getItem(ACTIVE_BANK_KEY);
  if (stored && banks.some(b => b.id === stored)) return stored;
  return banks[0]?.id ?? null;
}

export function setActiveBankId(id) {
  localStorage.setItem(ACTIVE_BANK_KEY, id);
}

function genBankId() {
  return Math.random().toString(36).slice(2, 10);
}

function uniqueBankName(name) {
  const existing = new Set(listBanks().map(b => b.name));
  if (!existing.has(name)) return name;
  let i = 2;
  while (existing.has(`${name} (${i})`)) i++;
  return `${name} (${i})`;
}

export function createBank(name) {
  const banks = listBanks();
  const id = genBankId();
  banks.push({ id, name: uniqueBankName(name) });
  writeBanks(banks);
  return id;
}

export function renameBank(id, name) {
  const banks = listBanks();
  const bank = banks.find(b => b.id === id);
  if (!bank) return;
  bank.name = uniqueBankName(name);
  writeBanks(banks);
}

export function duplicateBank(id) {
  const banks = listBanks();
  const src = banks.find(b => b.id === id);
  if (!src) return null;
  const newId = genBankId();
  banks.push({ id: newId, name: uniqueBankName(`${src.name} copy`) });
  writeBanks(banks);
  for (let i = 0; i < SCENES_PER_BANK; i++) {
    const raw = localStorage.getItem(sceneKey(id, i));
    if (raw !== null) localStorage.setItem(sceneKey(newId, i), raw);
  }
  return newId;
}

// Refuses to delete the last remaining bank. Returns the id of the bank that
// should now be active (unchanged unless the deleted bank was the active one).
export function deleteBank(id) {
  const banks = listBanks();
  if (banks.length <= 1) return null;
  const idx = banks.findIndex(b => b.id === id);
  if (idx === -1) return getActiveBankId();
  banks.splice(idx, 1);
  writeBanks(banks);
  for (let i = 0; i < SCENES_PER_BANK; i++) localStorage.removeItem(sceneKey(id, i));
  if (localStorage.getItem(ACTIVE_BANK_KEY) === id) setActiveBankId(banks[0].id);
  return getActiveBankId();
}

export function resetAllBanks() {
  listBanks().forEach(b => {
    for (let i = 0; i < SCENES_PER_BANK; i++) localStorage.removeItem(sceneKey(b.id, i));
  });
  localStorage.removeItem(BANKS_KEY);
  localStorage.removeItem(ACTIVE_BANK_KEY);
}

// Bundles the exporter's current global audio state (Library track/BPM/loop —
// see saveGlobalAudioState) alongside the scenes, so a showcase link can carry
// its own soundtrack. Only Library-selected tracks are captured this way
// (uploads/typed URLs aren't shareable or persisted today either).
export function exportBank(id) {
  const bank = listBanks().find(b => b.id === id);
  const scenes = [];
  for (let i = 0; i < SCENES_PER_BANK; i++) scenes.push(localStorage.getItem(sceneKey(id, i)));
  return { type: 'hydra-bank', version: 2, name: bank?.name ?? 'Bank', scenes, audio: loadGlobalAudioState() };
}

// Creates a new bank from an exported/preset bank object and writes its scenes.
// Always additive — never overwrites an existing bank.
export function importBankFile(data) {
  if (!data || data.type !== 'hydra-bank' || !Array.isArray(data.scenes)) {
    throw new Error('Not a valid bank file');
  }
  const id = createBank(data.name || 'Imported bank');
  data.scenes.slice(0, SCENES_PER_BANK).forEach((raw, i) => {
    if (raw !== null && raw !== undefined) localStorage.setItem(sceneKey(id, i), raw);
  });
  return id;
}

// Fetches a bundled repo preset (see vite.config.js's presetBanksPlugin) for
// read-only preview — never touches localStorage.
export async function loadPresetBank(name) {
  const res = await fetch(`${import.meta.env.BASE_URL}presets/${name}.json`);
  if (!res.ok) throw new Error(`Preset "${name}" not found`);
  const data = await res.json();
  if (!data || data.type !== 'hydra-bank' || !Array.isArray(data.scenes)) {
    throw new Error('Invalid preset file');
  }
  return data;
}

// Shared decode for a single encoded scene slot value (base64 JSON, possibly a
// bare layers array from older saves).
export function decodeEncodedScene(raw) {
  try {
    const payload = JSON.parse(decodeURIComponent(atob(raw)));
    return Array.isArray(payload) ? { layers: payload } : payload;
  } catch {
    return null;
  }
}

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

export async function buildShareUrl(layers, uiState = {}) {
  const payload = { layers: layers.map(serializeLayer), ui: uiState };
  const encoded = await compressPayload(payload);
  return location.origin + location.pathname + `#z=${encoded}`;
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
  // Short scene URL: #scene=N (1-based, scoped to the active bank)
  const sceneMatch = location.hash.match(/^#scene=(\d+)$/);
  if (sceneMatch) {
    const slot = parseInt(sceneMatch[1], 10) - 1;
    const stored = localStorage.getItem(sceneKey(getActiveBankId(), slot));
    if (!stored) return { sceneSlot: slot, layers: [], ui: {} };
    const data = decodeEncodedScene(stored);
    if (!data) return { sceneSlot: slot, layers: [], ui: {} };
    return { layers: data.layers ?? [], ui: data.ui ?? {}, sceneSlot: slot };
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

export function showSuccess(msg) {
  _showToast(msg, 'rgba(40,160,100,0.95)');
}

export function showWarning(msg) {
  _showToast(msg, 'rgba(220,60,60,0.92)');
}

function _showToast(msg, bg) {
  let el = document.getElementById('hydra-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hydra-toast';
    el.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      color: #fff; padding: 8px 18px; border-radius: 4px;
      font-size: 11px; font-family: monospace; letter-spacing: 0.02em;
      z-index: 99999; pointer-events: none;
      transition: opacity 0.4s, background 0.15s;
    `;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = bg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 4000);
}
