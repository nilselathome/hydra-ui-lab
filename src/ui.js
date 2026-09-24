import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';
import { LAYER_TYPES, BLEND_MODES, MOD_SOURCES, MOD_FNS, TRANSFORM_TYPES } from './layerDefs.js';
import { getLayers, addLayer, removeLayer, duplicateLayer, moveLayer, createMod, resetModSrcParams, createTransform, createTransformAnimate, drawTextCanvas, setTextBankIndex, isTextBankPlaying, startTextBankPlayer, stopTextBankPlayer, snapshotTextEntry, parseTextBankTimings, applyState, registerGlsl, reloadThree, THREE_PRESETS } from './layers.js';
import { render } from './engine.js';
import {
  saveToUrl, saveSceneToUrl, buildShareUrl, showWarning, showSuccess, encodeState, encodeStateForDirtyCheck, deserializeLayers,
  getCompressedUrlLength, saveGlobalAudioState, sceneKey, thumbKey, listBanks, getActiveBankId, setActiveBankId,
  createBank, renameBank, duplicateBank, deleteBank, resetAllBanks, exportBank, importBankFile,
  decodeEncodedScene, SCENES_PER_BANK,
} from './state.js';
import { storeImage } from './imageStore.js';
import * as Audio from './audio.js';
import { tracks as libraryTracks } from './audioLibrary.js';
import PRESET_IMAGES from 'virtual:preset-images';
import PRESET_BANKS from 'virtual:preset-banks';

function formatTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

let addPane = null;
let layersPane = null;
let uiContainer = null;
let addPaneExpanded    = true;
let audioPaneExpanded  = true;
let layersPaneExpanded = true;
let scenesPaneExpanded = true;
let audioLibraryTrack  = null; // filename of active library track, or null

// Set by initScenesPane once the scene player closure exists — lets
// restartEverything() below reach into it without hoisting all that state
// to module scope.
let restartScenePlayer = () => {};

// Set by initScenesPane once goToScene exists — lets the ArrowLeft/ArrowRight
// hotkeys (see initUI) step the active scene without hoisting that state.
let stepScene = () => {};

// ── UI show/hide (Tab) ──────────────────────────────────────────────────────
// Lets a performer tuck the whole Tweakpane stack out of the way for a clean
// screen capture. A floating indicator survives the hide so an accidental Tab
// press (easy to fat-finger) never strands the panel with no way back.
let uiVisible = true;
let uiHiddenIndicator = null;

function setUiVisible(visible) {
  uiVisible = visible;
  // visibility, not display: none — keeps the panel's scroll position (and
  // Tweakpane's own internal layout) intact across a hide/show round-trip.
  if (uiContainer) uiContainer.style.visibility = visible ? '' : 'hidden';
  if (uiHiddenIndicator) uiHiddenIndicator.style.display = visible ? 'none' : 'flex';
}

function ensureUiHiddenIndicator() {
  if (uiHiddenIndicator) return;
  const el = document.createElement('button');
  el.textContent = '☰ Show UI (Tab)';
  el.title = 'Show UI (Tab)';
  el.style.cssText = `
    position: fixed; top: 12px; right: 12px; z-index: 9999; display: none;
    align-items: center; background: rgba(20,20,20,0.75);
    border: 1px solid rgba(255,255,255,0.25); border-radius: 4px;
    color: rgba(255,255,255,0.8); font-size: 11px; font-family: monospace;
    padding: 6px 10px; cursor: pointer;
  `;
  el.addEventListener('click', () => setUiVisible(true));
  document.body.appendChild(el);
  uiHiddenIndicator = el;
}

function refreshUrlGauge() {
  if (!_urlGaugeFill) return;
  clearTimeout(_urlGaugeTimer);
  _urlGaugeTimer = setTimeout(async () => {
    const len = await getCompressedUrlLength(getLayers(), {});
    const pct = Math.min(len / URL_GAUGE_MAX * 100, 100);
    _urlGaugeFill.style.width = pct + '%';
    _urlGaugeFill.style.background =
      pct > 80 ? '#e05050' : pct > 55 ? '#d08030' : '#40a878';
    _urlGaugeLabel.textContent = `${len} / ${URL_GAUGE_MAX}`;
  }, 250);
}

// Audio track/loop are global — shared across all scenes, not owned by any one of them.
function getGlobalAudioState() {
  const { loopA, loopB } = Audio.getLoop();
  return { audioTrack: audioLibraryTrack, loopA, loopB };
}

function getUiState() {
  return {
    addPane:    addPaneExpanded,
    audioPane:  audioPaneExpanded,
    layersPane: layersPaneExpanded,
    scenesPane: scenesPaneExpanded,
    ...getGlobalAudioState(),
  };
}

function save() {
  saveGlobalAudioState(getGlobalAudioState());
  if (isPreview()) {
    // Read-only preset preview: never touch localStorage or the #z=/#scene= URL
    // forms — just keep ?preset=&scene= in sync with whatever's on screen.
    if (activeSlot !== null) savePreviewSceneToUrl(activeSlot);
    refreshSaveBtn();
    refreshUrlGauge();
    return;
  }
  const isSaved = activeSlot !== null && _cleanEncoded !== null && getDirtyCheckEncoded() === _cleanEncoded;
  if (isSaved) {
    saveSceneToUrl(activeSlot);
  } else {
    saveToUrl(getLayers(), getUiState(), activeSlot);
  }
  refreshSaveBtn();
  refreshUrlGauge();
}

// Snaps every running timing system back to a shared t=0 — Hydra's own
// animation clock (drives every transform/mod Animate function), any
// currently-playing text banks, the scene player, and the loaded audio
// track's playhead (to the A-B loop's start if one's set, otherwise 0) — so
// a performer can hit this and have everything, including custom timings,
// actually line back up instead of drifting apart on separate schedules.
function restartEverything() {
  if (typeof window.time === 'number') window.time = 0;
  const { loopA, loopB } = Audio.getLoop();
  Audio.seekFile(loopA !== null && loopB !== null ? Math.min(loopA, loopB) : 0);
  getLayers().forEach(layer => {
    if (layer.type === 'text' && isTextBankPlaying(layer)) {
      setTextBankIndex(layer, 0);
      startTextBankPlayer(layer);
    }
  });
  restartScenePlayer();
  save();
  showSuccess('Restarted');
}

function savePreviewSceneToUrl(slot) {
  const params = new URLSearchParams(location.search);
  params.set('scene', String(slot + 1));
  history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
}

function applyOrangeTint(btn, active) {
  if (!btn) return;
  if (active) {
    btn.style.background   = 'rgba(255,150,40,0.3)';
    btn.style.borderColor  = 'rgba(255,150,40,0.7)';
    btn.style.color        = 'rgba(255,190,80,0.95)';
  } else {
    // Clearing to '' falls through to the browser's default button styling
    // (white) instead of the app's dark buttons — restore btnBaseStyle's
    // actual values instead (see btnBaseStyle in initScenesPane).
    btn.style.background   = 'rgba(255,255,255,0.04)';
    btn.style.borderColor  = 'rgba(255,255,255,0.1)';
    btn.style.color        = 'rgba(255,255,255,0.3)';
  }
}

function refreshSaveBtn() {
  if (!_saveSceneBtn) return;
  const dirty = _cleanEncoded !== null && getDirtyCheckEncoded() !== _cleanEncoded;
  applyOrangeTint(_saveSceneBtn, dirty);
  applyOrangeTint(_saveAsBtn, dirty || _saveAsArmed);
}

// ── Scene slots / banks ──────────────────────────────────────────────────────────
const SCENE_COUNT = SCENES_PER_BANK;
let activeBankId  = null;   // active bank id, or null while previewing a preset
let previewBank   = null;   // { name, scenes: [...] } when previewing a read-only preset
let activeSlot    = null;   // slot index (0-based), or null
let _sceneButtons = [];     // DOM button elements, index === slot
let _bankSelect    = null;
let _copySceneBtn  = null;
let _saveSceneBtn  = null;
let _clearSceneBtn = null;
let _pasteSceneBtn = null;
let _saveAsBtn     = null;
let _saveAsArmed   = false;
let _clipboard     = null;
let _cleanEncoded  = null; // encoded state at last load/save — used to detect unsaved changes
let _urlGaugeFill  = null;
let _urlGaugeLabel = null;
let _urlGaugeTimer = null;
const URL_GAUGE_MAX = 8000;

// "Show scene thumbnails" toggle — a device-local display preference, stored
// directly in localStorage like the scenes themselves (not routed through
// uiState/the share URL, so it doesn't affect how a shared link looks for
// someone else). Named to avoid clashing with isPreview()'s unrelated sense
// of "viewing a read-only preset bank".
const THUMB_PREVIEW_KEY = 'hydra-scene-thumb-preview';
let thumbPreviewEnabled = localStorage.getItem(THUMB_PREVIEW_KEY) !== '0'; // default on

function isPreview() {
  return previewBank !== null;
}

// Reads a slot's raw encoded value from whichever source is active: the real
// (localStorage-backed) bank, or an in-memory read-only preset preview.
function slotRaw(slot) {
  if (isPreview()) return previewBank.scenes[slot] ?? null;
  return localStorage.getItem(sceneKey(activeBankId, slot));
}

function slotFilled(slot) {
  return slotRaw(slot) !== null;
}

function slotThumb(slot) {
  if (isPreview()) return previewBank.thumbs?.[slot] ?? null;
  return localStorage.getItem(thumbKey(activeBankId, slot));
}

const THUMB_W = 120, THUMB_H = 90;

// Grabs a small preview off the live canvas for the scene grid. Deferred to
// the next animation frame: this can run at an arbitrary point between
// Hydra's own rAF-driven draws, and reading a WebGL canvas right then risks
// catching it just after the browser's presented/cleared it. Scheduling our
// read via rAF orders it after Hydra's next draw call within the same frame,
// so it reliably sees fresh pixels.
function writeSlotThumb(slot) {
  const src = document.getElementById('hydraCanvas');
  if (!src || !src.width || !src.height) return;
  const bankId = activeBankId;
  requestAnimationFrame(() => {
    try {
      const c = document.createElement('canvas');
      c.width = THUMB_W; c.height = THUMB_H;
      c.getContext('2d').drawImage(src, 0, 0, THUMB_W, THUMB_H);
      localStorage.setItem(thumbKey(bankId, slot), c.toDataURL('image/webp', 0.6));
    } catch {} // e.g. a cross-origin image source tainted the canvas — thumbnail is best-effort
    // The capture above lands a frame after writeSlot()'s own refreshSceneButtons()
    // call already ran, so the button would otherwise keep showing its old/no
    // thumbnail until some later, unrelated refresh (e.g. switching scenes).
    refreshSceneButtons();
  });
}

function writeSlot(slot, encoded) {
  if (isPreview()) return; // UI disables writes while previewing
  localStorage.setItem(sceneKey(activeBankId, slot), encoded);
  writeSlotThumb(slot);
}

function clearSlotStorage(slot) {
  if (isPreview()) return;
  localStorage.removeItem(sceneKey(activeBankId, slot));
  localStorage.removeItem(thumbKey(activeBankId, slot));
}

function getContentEncoded() {
  // Scenes are layers only — audio is global (see getGlobalAudioState) and
  // deliberately excluded so switching/saving/copying a scene never touches playback.
  return encodeState(getLayers());
}

// Same as getContentEncoded, but ignores a playing text bank's own
// autoplay drift (see encodeStateForDirtyCheck). Only for detecting
// unsaved changes — actual saves always use getContentEncoded().
function getDirtyCheckEncoded() {
  return encodeStateForDirtyCheck(getLayers());
}

const decodeStoredScene = decodeEncodedScene;

// Accepts either plain JSON (current clipboard format) or legacy base64 (older
// copies, scene slots, share-URL fragments).
function parseSceneText(text) {
  if (!text) return null;
  try {
    const payload = JSON.parse(text);
    return Array.isArray(payload) ? { layers: payload } : payload;
  } catch {}
  return decodeStoredScene(text);
}

function injectBlinkStyle() {
  if (document.getElementById('scene-blink-style')) return;
  const style = document.createElement('style');
  style.id = 'scene-blink-style';
  style.textContent = '@keyframes scene-slot-blink { 0%,100% { border-color:rgba(255,255,255,0.1); color:rgba(255,255,255,0.25); } 50% { border-color:rgba(255,150,40,0.9); color:rgba(255,180,60,0.95); } }';
  document.head.appendChild(style);
}

function applySlotStyle(btn, labelEl, filled, active, blinking = false, thumb = null) {
  const preview = thumbPreviewEnabled;
  const base = preview
    ? 'width:100%;aspect-ratio:4/3;position:relative;overflow:hidden;border-radius:3px;cursor:pointer;font-size:9px;font-family:inherit;font-weight:bold;border:2px solid;transition:border-color 0.15s,color 0.15s;background-size:cover;background-position:center;'
    : 'width:100%;position:relative;border-radius:2px;cursor:pointer;font-size:9px;font-family:inherit;font-weight:bold;padding:5px 0;border:1px solid;transition:background 0.15s,border-color 0.15s,color 0.15s;text-align:center;';
  let style;
  if (active) {
    style = base + (preview ? 'border-color:rgba(100,200,120,0.9);color:rgba(140,230,160,0.95)'
                             : 'background:rgba(100,200,120,0.3);border-color:rgba(100,200,120,0.7);color:rgba(140,230,160,0.95)');
  } else if (filled) {
    style = base + (preview ? 'border-color:rgba(100,160,255,0.4);color:rgba(140,190,255,0.9)'
                             : 'background:rgba(100,160,255,0.15);border-color:rgba(100,160,255,0.4);color:rgba(140,190,255,0.9)');
  } else {
    style = base + (preview ? 'border-color:rgba(255,255,255,0.15);color:rgba(255,255,255,0.25)'
                             : 'background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.1);color:rgba(255,255,255,0.25)');
  }
  if (preview) {
    style += thumb
      ? `;background-image:url(${thumb});background-color:#101010`
      : `;background-color:${active ? 'rgba(100,200,120,0.3)' : filled ? 'rgba(100,160,255,0.15)' : 'rgba(255,255,255,0.04)'}`;
  }
  if (blinking) style += ';animation:scene-slot-blink 0.9s ease-in-out infinite';
  btn.style.cssText = style;
  labelEl.style.cssText = preview
    ? 'position:absolute;left:3px;bottom:2px;padding:1px 3px;border-radius:2px;background:rgba(0,0,0,0.55);pointer-events:none;'
    : 'pointer-events:none;';
}

function refreshSceneButtons() {
  _sceneButtons.forEach((btn, slot) => {
    const filled = slotFilled(slot);
    applySlotStyle(btn, btn._label, filled, activeSlot === slot, _saveAsArmed && !filled, slotThumb(slot));
  });
  const label = activeSlot !== null ? ` ${activeSlot + 1}` : '';
  if (_saveSceneBtn)  _saveSceneBtn.textContent  = `Save${label}`;
  if (_clearSceneBtn) _clearSceneBtn.textContent = `Clear${label}`;
  if (_pasteSceneBtn) {
    _pasteSceneBtn.style.opacity = '1';
    _pasteSceneBtn.style.cursor  = 'pointer';
  }
  if (_saveAsBtn) _saveAsBtn.textContent = _saveAsArmed ? 'Pick a slot…' : 'Save As';
  refreshSaveBtn();
}

// ── Scene context menu (singleton) ────────────────────────────────────────────
function createSceneContextMenu() {
  const menu = document.createElement('div');
  menu.style.cssText = `
    position: fixed; z-index: 99999; display: none;
    background: rgba(30,30,30,0.97); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 3px; padding: 3px 0; min-width: 160px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5); font-family: inherit;
  `;

  const makeItem = (label) => {
    const item = document.createElement('button');
    item.textContent = label;
    item.style.cssText = `
      display: block; width: 100%; text-align: left;
      background: none; border: none; color: rgba(255,255,255,0.8);
      font-size: 10px; font-family: inherit; padding: 5px 12px;
      cursor: pointer;
    `;
    item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.1)'; });
    item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
    return item;
  };

  const clearItem = makeItem('Clear slot');
  menu.append(clearItem);
  document.body.appendChild(menu);

  let currentSlot = null;

  const hide = () => { menu.style.display = 'none'; currentSlot = null; };

  const show = (slot, x, y) => {
    currentSlot = slot;
    menu.style.display = 'block';
    // Clamp to viewport
    const mw = menu.offsetWidth  || 160;
    const mh = menu.offsetHeight || 48;
    menu.style.left = `${Math.min(x, window.innerWidth  - mw - 8)}px`;
    menu.style.top  = `${Math.min(y, window.innerHeight - mh - 8)}px`;
  };

  clearItem.addEventListener('click', () => {
    if (currentSlot === null) return;
    clearSlotStorage(currentSlot);
    if (activeSlot === currentSlot) activeSlot = null;
    refreshSceneButtons();
    hide();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target)) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });

  return { show, hide };
}

function initScenesPane(container, uiState = {}, initialSceneSlot = null, previewData = null, initialEditingSlot = null) {
  scenesPaneExpanded = uiState.scenesPane ?? true;
  const pane = new Pane({ container, title: 'Scenes', expanded: scenesPaneExpanded });
  pane.element.style.marginBottom = '1rem';
  pane.on('fold', (ev) => { scenesPaneExpanded = ev.expanded; save(); });

  const content = pane.element.querySelector('.tp-rotv_c') ?? pane.element;

  previewBank = previewData ? { name: previewData.name, scenes: previewData.scenes, thumbs: previewData.thumbs ?? null, audio: previewData.audio ?? null } : null;
  if (previewBank) {
    activeBankId = null;
    // app.js already resolved which scene to open (?scene=N, or the first non-empty one)
    let slot = initialSceneSlot;
    if (slot == null) slot = previewBank.scenes.findIndex(s => s != null);
    activeSlot = slot !== -1 ? slot : null;
    _cleanEncoded = getDirtyCheckEncoded(); // layers already applied during boot
  } else {
    activeBankId = getActiveBankId();
    if (initialSceneSlot !== null) {
      // #scene=N — the canvas already shows exactly this slot's saved content.
      activeSlot = initialSceneSlot;
      _cleanEncoded = getDirtyCheckEncoded();
    } else if (initialEditingSlot !== null) {
      // Reloaded on a dirty #z= URL that remembers which scene these edits
      // started from (see save()). The canvas shows the unsaved edits, not
      // this slot's stored content — restore the highlight/Save target
      // without touching them, and diff against what's actually stored so
      // the unsaved-changes indicator is correct right away.
      activeSlot = initialEditingSlot;
      const raw = slotRaw(initialEditingSlot);
      const stored = raw ? decodeStoredScene(raw) : null;
      if (stored) _cleanEncoded = encodeStateForDirtyCheck(deserializeLayers(stored.layers ?? stored));
      showWarning(`Restored unsaved edits for Scene ${initialEditingSlot + 1} — remember to Save.`);
    } else {
      activeSlot = 0;
    }
  }

  const contextMenu = createSceneContextMenu();
  injectBlinkStyle();

  // ── Bank switcher ───────────────────────────────────────────────────────────
  const bankBtnStyle = `
    flex: none; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 2px; color: rgba(255,255,255,0.5); font-size: 10px;
    font-family: inherit; padding: 3px 6px; cursor: pointer;
  `;

  const bankRow = document.createElement('div');
  bankRow.style.cssText = 'display:flex; align-items:center; gap:3px; margin:6px 4px 4px;';

  _bankSelect = document.createElement('select');
  _bankSelect.style.cssText = `
    flex: 1; min-width: 0; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: #fff; font-size: 10px; font-family: monospace; padding: 3px 4px;
  `;
  _bankSelect.addEventListener('change', () => switchBank(_bankSelect.value));

  const newBankBtn = document.createElement('button');
  newBankBtn.textContent = '+';
  newBankBtn.title = 'New bank';
  newBankBtn.style.cssText = bankBtnStyle;
  newBankBtn.addEventListener('click', () => {
    const name = prompt('New bank name', `Bank ${listBanks().length + 1}`);
    if (!name || !name.trim()) return;
    switchBank(createBank(name.trim()));
  });

  const renameBankBtn = document.createElement('button');
  renameBankBtn.textContent = '✎';
  renameBankBtn.title = 'Rename bank';
  renameBankBtn.style.cssText = bankBtnStyle;
  renameBankBtn.addEventListener('click', () => {
    if (activeBankId === null) return;
    const current = listBanks().find(b => b.id === activeBankId);
    const name = prompt('Rename bank', current?.name ?? '');
    if (!name || !name.trim()) return;
    renameBank(activeBankId, name.trim());
    refreshBankSelect();
  });

  const dupBankBtn = document.createElement('button');
  dupBankBtn.textContent = '⧉';
  dupBankBtn.title = 'Duplicate bank';
  dupBankBtn.style.cssText = bankBtnStyle;
  dupBankBtn.addEventListener('click', () => {
    if (activeBankId === null) return;
    const id = duplicateBank(activeBankId);
    if (id) switchBank(id);
  });

  const delBankBtn = document.createElement('button');
  delBankBtn.textContent = '✕';
  delBankBtn.title = 'Delete bank';
  delBankBtn.style.cssText = bankBtnStyle;
  delBankBtn.addEventListener('click', () => {
    if (activeBankId === null || listBanks().length <= 1) return;
    const current = listBanks().find(b => b.id === activeBankId);
    if (!confirm(`Delete bank "${current?.name ?? ''}" and all its scenes? This cannot be undone.`)) return;
    stopScenePlayer();
    const nextId = deleteBank(activeBankId);
    activeBankId = null; // force switchBank to actually reload
    switchBank(nextId, { force: true });
  });

  const saveCopyBtn = document.createElement('button');
  saveCopyBtn.textContent = 'Save a copy';
  saveCopyBtn.style.cssText = bankBtnStyle + ';flex:1;display:none;';
  saveCopyBtn.addEventListener('click', () => {
    if (!isPreview()) return;
    const keepSlot = activeSlot;
    const bundledAudio = previewBank.audio;
    const id = importBankFile({ type: 'hydra-bank', version: 2, name: previewBank.name, scenes: previewBank.scenes, thumbs: previewBank.thumbs });
    // Carry over the preset's soundtrack so it doesn't cut out on exiting preview.
    if (bundledAudio) saveGlobalAudioState(bundledAudio);
    previewBank = null;
    activeBankId = id;
    setActiveBankId(id);
    activeSlot = keepSlot;
    _cleanEncoded = getDirtyCheckEncoded(); // canvas already shows this slot's content
    refreshBankSelect();
    refreshSceneButtons();
    refreshSaveBtn();
    showSuccess('Saved a local copy — now editable');
  });

  bankRow.append(_bankSelect, newBankBtn, renameBankBtn, dupBankBtn, delBankBtn, saveCopyBtn);
  content.appendChild(bankRow);

  if (PRESET_BANKS.length) {
    const presetsRow = document.createElement('div');
    presetsRow.style.cssText = 'display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin:0 4px 6px;';
    const presetsLabel = document.createElement('span');
    presetsLabel.textContent = 'presets:';
    presetsLabel.style.cssText = 'font-size:9px; font-family:monospace; color:rgba(255,255,255,0.25);';
    presetsRow.appendChild(presetsLabel);
    PRESET_BANKS.forEach(name => {
      const btn = document.createElement('button');
      btn.textContent = name;
      btn.style.cssText = bankBtnStyle;
      btn.addEventListener('click', () => {
        const dirty = _cleanEncoded !== null && getDirtyCheckEncoded() !== _cleanEncoded;
        if (dirty && !confirm('Discard unsaved changes?')) return;
        location.href = `${location.pathname}?preset=${encodeURIComponent(name)}`;
      });
      presetsRow.appendChild(btn);
    });
    content.appendChild(presetsRow);
  }

  function refreshBankSelect() {
    _bankSelect.innerHTML = '';
    if (isPreview()) {
      const opt = document.createElement('option');
      opt.textContent = `${previewBank.name} (preview)`;
      _bankSelect.appendChild(opt);
      _bankSelect.disabled = true;
    } else {
      _bankSelect.disabled = false;
      listBanks().forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name;
        opt.selected = b.id === activeBankId;
        _bankSelect.appendChild(opt);
      });
    }
    refreshPreviewLock();
  }

  function refreshPreviewLock() {
    const preview = isPreview();
    [newBankBtn, renameBankBtn, dupBankBtn, delBankBtn].forEach(btn => { btn.style.display = preview ? 'none' : ''; });
    saveCopyBtn.style.display = preview ? '' : 'none';
    if (!preview) {
      const onlyOne = listBanks().length <= 1;
      delBankBtn.disabled = onlyOne;
      delBankBtn.style.opacity = onlyOne ? '0.3' : '';
    }
    [_saveSceneBtn, _clearSceneBtn, _saveAsBtn, clearBtn, exportBtn, importBtn].forEach(btn => {
      if (!btn) return;
      btn.disabled = preview;
      btn.style.opacity = preview ? '0.3' : '';
      btn.style.pointerEvents = preview ? 'none' : '';
    });
  }

  const previewToggleRow = document.createElement('label');
  previewToggleRow.style.cssText = 'display:flex; align-items:center; gap:5px; margin:2px 4px 4px; cursor:pointer;';
  const previewToggle = document.createElement('input');
  previewToggle.type = 'checkbox';
  previewToggle.checked = thumbPreviewEnabled;
  previewToggle.style.cssText = 'cursor:pointer; margin:0; accent-color: rgb(84 84 88);';
  const previewToggleLabel = document.createElement('span');
  previewToggleLabel.textContent = 'Preview';
  previewToggleLabel.style.cssText = 'font-size:9px; font-family:monospace; color:rgba(255,255,255,0.4);';
  previewToggle.addEventListener('change', () => {
    thumbPreviewEnabled = previewToggle.checked;
    localStorage.setItem(THUMB_PREVIEW_KEY, thumbPreviewEnabled ? '1' : '0');
    updateGridColumns();
    refreshSceneButtons();
  });
  previewToggleRow.append(previewToggle, previewToggleLabel);
  content.appendChild(previewToggleRow);

  const grid = document.createElement('div');
  function updateGridColumns() {
    grid.style.cssText = thumbPreviewEnabled
      ? 'display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:6px 4px 4px'
      : 'display:grid;grid-template-columns:repeat(8,1fr);gap:3px;padding:6px 4px 4px';
  }
  updateGridColumns();

  _sceneButtons = [];

  for (let slot = 0; slot < SCENE_COUNT; slot++) {
    const btn    = document.createElement('button');
    const label  = document.createElement('span');
    label.textContent = String(slot + 1); // display 1-16, index 0-15
    btn._label = label;
    btn.appendChild(label);
    applySlotStyle(btn, label, slotFilled(slot), false, false, slotThumb(slot));

    btn.addEventListener('click', () => {
      if (_saveAsArmed) { handleSaveAsTarget(slot); return; }
      stopScenePlayer();
      goToScene(slot);
    });

    btn.addEventListener('contextmenu', (e) => {
      if (isPreview() || !slotFilled(slot)) return; // nothing to do on empty/read-only slots
      e.preventDefault();
      contextMenu.show(slot, e.clientX, e.clientY);
    });

    _sceneButtons.push(btn);
    grid.appendChild(btn);
  }

  content.appendChild(grid);
  refreshSceneButtons();

  // ── Save As: arm-then-pick-a-slot flow ─────────────────────────────────────
  function armSaveAs() {
    _saveAsArmed = true;
    refreshSceneButtons();
  }

  function disarmSaveAs() {
    if (!_saveAsArmed) return;
    _saveAsArmed = false;
    refreshSceneButtons();
  }

  function handleSaveAsTarget(slot) {
    if (isPreview()) return;
    const existing = slotFilled(slot);
    if (existing && !confirm(`Overwrite existing scene ${slot + 1}?`)) return; // stay armed, pick again
    writeSlot(slot, getContentEncoded());
    _cleanEncoded = getDirtyCheckEncoded();
    activeSlot = slot;
    disarmSaveAs();
    rebuild();
    refreshSceneButtons();
    refreshSaveBtn();
    saveSceneToUrl(slot);
    showSuccess(`Saved to scene ${slot + 1}`);
  }

  document.addEventListener('pointerdown', (e) => {
    if (!_saveAsArmed) return;
    if (_saveAsBtn && _saveAsBtn.contains(e.target)) return; // toggle button handles its own click
    if (grid.contains(e.target)) return; // slot buttons handle their own click
    disarmSaveAs();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') disarmSaveAs();
  });

  function goToScene(slot, { silent = false } = {}) {
    if (activeSlot === slot) return;
    const dirty = _cleanEncoded !== null && getDirtyCheckEncoded() !== _cleanEncoded;
    const raw = slotRaw(slot);
    if (raw) {
      if (dirty && !silent && !confirm('Discard unsaved changes?')) return;
      const data = decodeStoredScene(raw);
      if (!data) { showWarning(`Scene ${slot + 1} could not be loaded.`); return; }
      applyState(deserializeLayers(data.layers ?? data));
    } else if (dirty && !silent && !isPreview()) {
      // Empty slot + unsaved changes → save current scene here instead of blanking
      writeSlot(slot, getContentEncoded());
    } else {
      applyState([]); // empty slot, nothing dirty (or read-only preview) → blank canvas
    }
    activeSlot = slot;
    _cleanEncoded = getDirtyCheckEncoded();
    rebuild();
    refreshSceneButtons();
    refreshSaveBtn();
  }

  // Hooked up to the ArrowLeft/ArrowRight hotkeys (see initUI) — steps by one
  // slot, clamped at the bank's edges rather than wrapping. Works in preset
  // previews too, for flipping through a showcase link's scenes.
  stepScene = (delta) => {
    if (activeSlot === null) return;
    const target = activeSlot + delta;
    if (target < 0 || target >= SCENE_COUNT) return;
    goToScene(target);
  };

  function switchBank(id, { force = false } = {}) {
    if (isPreview() || id === null || id === activeBankId) { refreshBankSelect(); return; }
    if (!force) {
      const dirty = _cleanEncoded !== null && getDirtyCheckEncoded() !== _cleanEncoded;
      if (dirty && !confirm('Discard unsaved changes?')) { refreshBankSelect(); return; }
    }
    stopScenePlayer();
    activeBankId = id;
    setActiveBankId(id);
    const raw = slotRaw(0);
    if (raw) {
      const data = decodeStoredScene(raw);
      applyState(data ? deserializeLayers(data.layers ?? data) : []);
    } else {
      applyState([]);
    }
    activeSlot = 0;
    _cleanEncoded = getDirtyCheckEncoded();
    rebuild();
    refreshBankSelect();
    refreshSceneButtons();
    refreshSaveBtn();
  }

  // ── Scene player: auto-advance through saved scenes ───────────────────────
  let scenePlayerRunning = false;
  let scenePlayerTimer   = null;
  let scenePlayerStep    = 0;

  const getFilledSlots = () => {
    const result = [];
    for (let i = 0; i < SCENE_COUNT; i++) if (slotFilled(i)) result.push(i);
    return result;
  };

  const parseTimingList = () => timingInput.value
    .split(',')
    .map(s => parseFloat(s.trim()))
    .filter(n => isFinite(n) && n > 0);

  const durationForStep = (step) => {
    const list = parseTimingList();
    return list.length ? list[step % list.length] : intervalSlider.valueAsNumber;
  };

  function updatePlayBtn() {
    if (scenePlayerRunning) {
      playBtn.textContent = '■ Stop';
      playBtn.style.background  = 'rgba(100,220,130,0.15)';
      playBtn.style.borderColor = 'rgba(100,220,130,0.5)';
      playBtn.style.color       = 'rgba(130,240,160,0.9)';
    } else {
      playBtn.textContent = '▶ Play';
      playBtn.style.background  = 'rgba(255,255,255,0.04)';
      playBtn.style.borderColor = 'rgba(255,255,255,0.1)';
      playBtn.style.color       = 'rgba(255,255,255,0.6)';
    }
  }

  function stopScenePlayer() {
    if (!scenePlayerRunning) return;
    scenePlayerRunning = false;
    clearTimeout(scenePlayerTimer);
    scenePlayerTimer = null;
    updatePlayBtn();
  }

  function tick() {
    const filled = getFilledSlots();
    if (filled.length < 2) { stopScenePlayer(); return; }
    const idx = filled.indexOf(activeSlot);
    const nextSlot = filled[(idx + 1 + filled.length) % filled.length];
    goToScene(nextSlot, { silent: true });
    const dur = durationForStep(scenePlayerStep);
    scenePlayerStep++;
    scenePlayerTimer = setTimeout(tick, Math.max(0.1, dur) * 1000);
  }

  function startScenePlayer() {
    const filled = getFilledSlots();
    if (filled.length < 2) { showWarning('Save at least 2 scenes to play.'); return; }
    scenePlayerRunning = true;
    scenePlayerStep = 0;
    updatePlayBtn();
    const dur = durationForStep(scenePlayerStep);
    scenePlayerStep++;
    scenePlayerTimer = setTimeout(tick, Math.max(0.1, dur) * 1000);
  }

  // Hooked up to the global "Restart everything" action (see restartEverything)
  // — jumps back to the first filled scene and restarts the interval/custom
  // timings schedule from step 0, same idea as the text-bank restart.
  restartScenePlayer = () => {
    if (!scenePlayerRunning) return;
    const filled = getFilledSlots();
    if (filled.length < 2) { stopScenePlayer(); return; }
    clearTimeout(scenePlayerTimer);
    scenePlayerStep = 0;
    goToScene(filled[0], { silent: true });
    const dur = durationForStep(scenePlayerStep);
    scenePlayerStep++;
    scenePlayerTimer = setTimeout(tick, Math.max(0.1, dur) * 1000);
  };

  const playerWrap = document.createElement('div');
  playerWrap.style.cssText = 'margin: 2px 4px 8px; display:flex; flex-direction:column; gap:5px;';

  const playBtn = document.createElement('button');
  playBtn.style.cssText = `
    width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 2px; color: rgba(255,255,255,0.6); font-size: 10px;
    font-family: inherit; font-weight: bold; padding: 6px; cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  `;
  playBtn.addEventListener('click', () => {
    if (scenePlayerRunning) stopScenePlayer();
    else startScenePlayer();
  });

  const intervalRow = document.createElement('div');
  intervalRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
  const intervalLabel = document.createElement('span');
  intervalLabel.textContent = 'interval';
  intervalLabel.style.cssText = 'font-size:9px; font-family:monospace; color:rgba(255,255,255,0.3); flex-shrink:0;';
  const intervalSlider = document.createElement('input');
  intervalSlider.type = 'range'; intervalSlider.min = '0.5'; intervalSlider.max = '60'; intervalSlider.step = '0.5'; intervalSlider.value = '5';
  intervalSlider.style.cssText = 'flex:1; accent-color: rgba(255,255,255,0.6); cursor:pointer; height:3px;';
  const intervalValue = document.createElement('span');
  intervalValue.style.cssText = 'font-size:9px; font-family:monospace; color:rgba(255,255,255,0.4); flex-shrink:0; min-width:28px; text-align:right;';
  intervalValue.textContent = `${intervalSlider.value}s`;
  intervalSlider.addEventListener('input', () => { intervalValue.textContent = `${intervalSlider.value}s`; });
  intervalRow.append(intervalLabel, intervalSlider, intervalValue);

  const timingInput = document.createElement('input');
  timingInput.type = 'text';
  timingInput.placeholder = 'custom timings (s), comma-separated — overrides interval';
  timingInput.style.cssText = `
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: #fff; font-size: 9px; font-family: monospace;
    padding: 4px 6px; outline: none;
  `;

  playerWrap.append(playBtn, intervalRow, timingInput);
  content.appendChild(playerWrap);
  updatePlayBtn();

  const btnRowStyle = `
    display: flex; gap: 4px; margin: 4px 4px 6px;
  `;
  const btnBaseStyle = `
    flex: 1; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 2px; color: rgba(255,255,255,0.3); font-size: 9px;
    font-family: inherit; padding: 4px; cursor: pointer;
  `;

  // Row 1: utility actions
  const btnRow1 = document.createElement('div');
  btnRow1.style.cssText = btnRowStyle;

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear bank';
  clearBtn.style.cssText = btnBaseStyle;
  clearBtn.addEventListener('click', () => {
    if (isPreview()) return;
    if (!confirm('Clear all scenes in this bank? This cannot be undone.')) return;
    stopScenePlayer();
    for (let i = 0; i < SCENE_COUNT; i++) clearSlotStorage(i);
    activeSlot = 0;
    refreshSceneButtons();
  });

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset everything';
  resetBtn.style.cssText = btnBaseStyle;
  resetBtn.addEventListener('click', () => {
    if (!confirm('Delete ALL banks and scenes and reset the app? This cannot be undone.')) return;
    stopScenePlayer();
    resetAllBanks();
    history.replaceState(null, '', location.pathname);
    location.reload();
  });

  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export';
  exportBtn.style.cssText = btnBaseStyle;
  exportBtn.addEventListener('click', () => {
    if (isPreview() || activeBankId === null) return;
    const data = exportBank(activeBankId);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.name.replace(/[^a-z0-9_-]+/gi, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showSuccess('Bank exported');
  });

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.style.display = 'none';
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const id = importBankFile(data);
      switchBank(id);
      showSuccess(`Imported "${data.name ?? 'bank'}"`);
    } catch (e) {
      showWarning('Could not import bank file');
      console.error(e);
    }
  });
  document.body.appendChild(importInput);

  const importBtn = document.createElement('button');
  importBtn.textContent = 'Import';
  importBtn.style.cssText = btnBaseStyle;
  importBtn.addEventListener('click', () => importInput.click());

  btnRow1.appendChild(clearBtn);
  btnRow1.appendChild(resetBtn);
  btnRow1.appendChild(exportBtn);
  btnRow1.appendChild(importBtn);

  // Row 2: per-scene actions
  const btnRow2 = document.createElement('div');
  btnRow2.style.cssText = btnRowStyle;

  _copySceneBtn = document.createElement('button');
  _copySceneBtn.textContent = 'Copy';
  _copySceneBtn.style.cssText = btnBaseStyle;
  _copySceneBtn.addEventListener('click', async () => {
    const decoded = decodeStoredScene(getContentEncoded());
    _clipboard = JSON.stringify(decoded, null, 2);
    try { await navigator.clipboard.writeText(_clipboard); } catch {}
    refreshSceneButtons();
    showSuccess('Scene copied to clipboard');
  });

  _pasteSceneBtn = document.createElement('button');
  _pasteSceneBtn.textContent = 'Paste';
  _pasteSceneBtn.style.cssText = btnBaseStyle;
  _pasteSceneBtn.addEventListener('click', async () => {
    let text = _clipboard;
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) text = clip;
    } catch {}
    if (!text) return;
    if (getLayers().length > 0 && !confirm('Are you sure?')) return;
    const data = parseSceneText(text);
    if (!data) { showWarning('Nothing valid to paste'); return; }
    _clipboard = text;
    applyState(deserializeLayers(data.layers ?? data));
    rebuild();
    refreshSceneButtons();
  });

  _saveSceneBtn = document.createElement('button');
  _saveSceneBtn.style.cssText = btnBaseStyle;
  _saveSceneBtn.addEventListener('click', () => {
    if (isPreview() || activeSlot === null) return;
    writeSlot(activeSlot, getContentEncoded());
    _cleanEncoded = getDirtyCheckEncoded();
    refreshSceneButtons();
    refreshSaveBtn();
    saveSceneToUrl(activeSlot);
    showSuccess(`Saved to scene ${activeSlot + 1}`);
  });

  _clearSceneBtn = document.createElement('button');
  _clearSceneBtn.style.cssText = btnBaseStyle;
  _clearSceneBtn.addEventListener('click', () => {
    if (isPreview() || activeSlot === null) return;
    if (!confirm('Are you sure?')) return;
    stopScenePlayer();
    clearSlotStorage(activeSlot);
    applyState([]);
    rebuild();
    _cleanEncoded = getDirtyCheckEncoded();
    refreshSceneButtons();
    refreshSaveBtn();
  });

  _saveAsBtn = document.createElement('button');
  _saveAsBtn.textContent = 'Save As';
  _saveAsBtn.style.cssText = btnBaseStyle;
  _saveAsBtn.addEventListener('click', () => {
    if (isPreview()) return;
    stopScenePlayer();
    if (_saveAsArmed) disarmSaveAs();
    else armSaveAs();
  });

  btnRow2.appendChild(_copySceneBtn);
  btnRow2.appendChild(_pasteSceneBtn);
  btnRow2.appendChild(_saveSceneBtn);
  btnRow2.appendChild(_saveAsBtn);
  btnRow2.appendChild(_clearSceneBtn);

  // Row 3: share
  const btnRow3 = document.createElement('div');
  btnRow3.style.cssText = btnRowStyle;

  const shareBtn = document.createElement('button');
  shareBtn.textContent = 'Share URL';
  shareBtn.style.cssText = btnBaseStyle;
  shareBtn.addEventListener('click', async () => {
    try {
      const url = await buildShareUrl(getLayers(), getUiState());
      await navigator.clipboard.writeText(url);
      showSuccess('Share URL copied to clipboard');
    } catch {
      showWarning('Could not copy to clipboard');
    }
  });

  btnRow3.appendChild(shareBtn);

  content.appendChild(btnRow1);
  content.appendChild(btnRow2);
  content.appendChild(btnRow3);
  refreshSceneButtons(); // set initial labels
  refreshBankSelect();

  // URL size gauge
  const gaugeWrap = document.createElement('div');
  gaugeWrap.style.cssText = 'padding:4px 6px 7px;';

  const gaugeHeader = document.createElement('div');
  gaugeHeader.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:3px';

  const gaugeTitle = document.createElement('span');
  gaugeTitle.textContent = 'url size';
  gaugeTitle.style.cssText = 'font-size:8px;font-family:monospace;color:rgba(255,255,255,0.2)';

  _urlGaugeLabel = document.createElement('span');
  _urlGaugeLabel.textContent = '—';
  _urlGaugeLabel.style.cssText = 'font-size:8px;font-family:monospace;color:rgba(255,255,255,0.35)';

  gaugeHeader.appendChild(gaugeTitle);
  gaugeHeader.appendChild(_urlGaugeLabel);

  const gaugeTrack = document.createElement('div');
  gaugeTrack.style.cssText = `
    width:100%; height:4px; border-radius:2px;
    background:rgba(255,255,255,0.07);
    position:relative; overflow:hidden;
  `;
  _urlGaugeFill = document.createElement('div');
  _urlGaugeFill.style.cssText = `
    position:absolute; top:0; left:0; bottom:0;
    width:0%; background:#40a878; border-radius:2px;
    transition:width 0.35s ease, background 0.35s ease;
  `;
  gaugeTrack.appendChild(_urlGaugeFill);

  gaugeWrap.appendChild(gaugeHeader);
  gaugeWrap.appendChild(gaugeTrack);
  content.appendChild(gaugeWrap);

  refreshUrlGauge();
  addCollapseAllCtrl(pane);
}

export function initUI(container, uiState = {}, initialSceneSlot = null, previewData = null, initialEditingSlot = null) {
  uiContainer = container;
  addPaneExpanded    = uiState.addPane    ?? true;
  layersPaneExpanded = uiState.layersPane ?? true;

  ensureUiHiddenIndicator();

  document.addEventListener('keydown', (e) => {
    // Ctrl+R — "restart everything" (see restartEverything), not a page
    // reload. Deliberately Ctrl only, not Cmd — Cmd+R is too close to muscle
    // memory for an actual browser reload on macOS. This is meant to be
    // pressed in the same instant as restarting an external audio track, so
    // it needs to work no matter what's focused.
    if (e.ctrlKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      restartEverything();
      return;
    }
    // Tab — toggle the whole panel out of the way (e.g. for a clean screen
    // capture). Skipped while focus is in a text field/select, where Tab is
    // still needed for its usual job (moving focus, or inserting an actual
    // tab in the code editors).
    if (e.key === 'Tab') {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      e.preventDefault();
      setUiVisible(!uiVisible);
      return;
    }
    // ArrowLeft/ArrowRight — step the active scene by one slot. Skipped in
    // text fields/selects/sliders, where the arrows already have a job
    // (cursor movement, changing a range/select value).
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      e.preventDefault();
      stepScene(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    // Ctrl+S / Ctrl+Shift+S — same as clicking Save/Save As (triggers the
    // real buttons, so behavior stays identical, arm-then-pick-a-slot flow
    // included). Not guarded by focused element, same reasoning as Ctrl+R:
    // nobody wants the browser's own Save-Page dialog.
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (e.shiftKey) _saveAsBtn?.click();
      else _saveSceneBtn?.click();
      return;
    }
    // Ctrl+C / Ctrl+V — same as clicking Copy/Paste. Guarded by focused
    // element so normal text copy/paste in inputs/selects keeps working.
    if (e.ctrlKey && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'v')) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      e.preventDefault();
      if (e.key.toLowerCase() === 'c') _copySceneBtn?.click();
      else _pasteSceneBtn?.click();
    }
  });

  initAudioPane(container, uiState);

  initScenesPane(container, uiState, initialSceneSlot, previewData, initialEditingSlot);

  addPane = new Pane({ container, title: 'Add Layer', expanded: addPaneExpanded });
  addPane.element.style.marginBottom = '1rem';
  addPane.on('fold', (ev) => { addPaneExpanded = ev.expanded; save(); });
  addCollapseAllCtrl(addPane);
  Object.entries(LAYER_TYPES).forEach(([type, def]) => {
    if (def.noLayer) return;
    const btn = addPane.addButton({ title: def.shortLabel ?? def.label }).on('click', () => {
      addLayer(type);
      rebuild();
    });
    if (def.icon) {
      const textEl = btn.element.querySelector('button')?.firstElementChild;
      if (textEl) {
        const i = document.createElement('i');
        i.className = `ph-bold ${def.icon}`;
        i.style.cssText = 'margin-right: 6px; vertical-align: middle;';
        textEl.prepend(i);
      }
    }
  });

  layersPane = new Pane({ container, title: 'Layers', expanded: layersPaneExpanded });
  layersPane.element.style.marginBottom = '1rem';
  layersPane.on('fold', (ev) => { layersPaneExpanded = ev.expanded; save(); });
  addCollapseAllCtrl(layersPane);
  buildLayersUI();
}

function initAudioPane(container, uiState = {}) {
  audioPaneExpanded = uiState.audioPane ?? false;
  const pane = new Pane({ container, title: 'Audio', expanded: audioPaneExpanded });
  pane.element.style.marginBottom = '1rem';
  pane.on('fold', (ev) => { audioPaneExpanded = ev.expanded; save(); });

  const smoothingObj = { smoothing: 0.8 };

  const runAsync = async (fn) => {
    try { await fn(); }
    catch (e) { showWarning(e.message ?? 'Audio error'); }
  };

  const clearLibraryTrack = () => { audioLibraryTrack = null; save(); };

  pane.addButton({ title: '⟲ Restart Everything (Ctrl+R)' }).on('click', restartEverything);

  pane.addButton({ title: 'Mic' }).on('click', () => { clearLibraryTrack(); runAsync(Audio.connectMic); });
  pane.addButton({ title: 'Tab / Screen audio' }).on('click', () => { clearLibraryTrack(); runAsync(Audio.connectTab); });
  pane.addButton({ title: 'Stop' }).on('click', () => { clearLibraryTrack(); Audio.stop(); });

  pane.addBinding(smoothingObj, 'smoothing', { label: 'Smoothing', min: 0, max: 1, step: 0.01 })
    .on('change', () => Audio.setSmoothing(smoothingObj.smoothing));

  // ── File drop zone ────────────────────────────────────────────────────────
  const zone = document.createElement('div');
  zone.style.cssText = `
    border: 1px dashed rgba(255,255,255,0.2); border-radius: 2px;
    padding: 10px 8px; margin: 4px 4px 2px;
    text-align: center; color: rgba(255,255,255,0.35);
    font-size: 10px; font-family: inherit; cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  `;
  zone.textContent = '↓ Drop audio file or click to browse';

  const highlightZone = (on) => {
    zone.style.borderColor = on ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)';
    zone.style.color       = on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
  };
  const loadFile = (file) => {
    if (!file?.type.startsWith('audio/')) { showWarning('Please drop an audio file.'); return; }
    clearLibraryTrack();
    Audio.connectFile(file);
  };

  zone.addEventListener('dragover',  (e) => { e.preventDefault(); highlightZone(true); });
  zone.addEventListener('dragleave', ()  => highlightZone(false));
  zone.addEventListener('drop',      (e) => { e.preventDefault(); highlightZone(false); loadFile(e.dataTransfer.files[0]); });
  zone.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'audio/*';
    input.onchange = (e) => loadFile(e.target.files[0]);
    input.click();
  });
  pane.element.appendChild(zone);

  // ── Library select ────────────────────────────────────────────────────────
  let libRow = null;
  if (libraryTracks.length > 0) {
    libRow = document.createElement('div');
    libRow.style.cssText = 'margin: 2px 4px;';
    const libSelect = document.createElement('select');
    libSelect.style.cssText = `
      width: 100%; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15);
      border-radius: 2px; color: rgba(255,255,255,0.7); font-size: 10px; font-family: inherit;
      padding: 4px 6px; outline: none; cursor: pointer; box-sizing: border-box;
    `;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Library —';
    placeholder.disabled = true;
    placeholder.selected = true;
    libSelect.appendChild(placeholder);
    for (const filename of libraryTracks) {
      const opt = document.createElement('option');
      opt.value = /^https?:\/\//.test(filename) ? filename : import.meta.env.BASE_URL + filename;
      opt.textContent = filename.replace(/^.*\//, '').replace(/\.mp3$/i, '').replace(/_/g, ' ');
      libSelect.appendChild(opt);
    }
    libSelect.addEventListener('change', () => {
      const filename = libraryTracks[libSelect.selectedIndex - 1]; // -1 for placeholder
      const url = libSelect.value;
      libSelect.value = '';
      if (!url) return;
      audioLibraryTrack = filename;
      save();
      runAsync(() => Audio.connectUrl(url));
    });
    libRow.appendChild(libSelect);
    pane.element.appendChild(libRow);
  }

  // ── URL input ─────────────────────────────────────────────────────────────
  const urlRow = document.createElement('div');
  urlRow.style.cssText = 'display:flex; gap:4px; margin: 2px 4px 4px;';
  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.placeholder = 'https://audio-url…';
  urlInput.style.cssText = `
    flex: 1; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: #fff; font-size: 10px; font-family: inherit;
    padding: 4px 6px; outline: none;
  `;
  const urlLoadBtn = document.createElement('button');
  urlLoadBtn.textContent = 'Load';
  urlLoadBtn.style.cssText = `
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    border-radius: 2px; color: #fff; font-size: 10px; font-family: inherit;
    padding: 4px 8px; cursor: pointer;
  `;
  const applyAudioUrl = () => {
    const url = urlInput.value.trim();
    if (!url) return;
    clearLibraryTrack();
    runAsync(() => Audio.connectUrl(url));
  };
  urlLoadBtn.addEventListener('click', applyAudioUrl);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyAudioUrl(); });
  urlRow.append(urlInput, urlLoadBtn);
  pane.element.appendChild(urlRow);

  // ── Playback controls (shown when file is loaded) ─────────────────────────
  const css = (el, styles) => Object.assign(el.style, styles);
  const btn = (label, title) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (title) b.title = title;
    css(b, {
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '2px', color: 'rgba(255,255,255,0.8)', fontSize: '10px',
      fontFamily: 'inherit', padding: '3px 7px', cursor: 'pointer', flexShrink: '0',
    });
    b.addEventListener('mouseenter', () => { b.style.background = 'rgba(255,255,255,0.16)'; });
    b.addEventListener('mouseleave', () => { b.style.background = 'rgba(255,255,255,0.08)'; });
    return b;
  };

  const controls = document.createElement('div');
  css(controls, { display: 'none', flexDirection: 'column', gap: '5px', margin: '4px 4px 2px', userSelect: 'none' });

  // File name row
  const nameRow = document.createElement('div');
  css(nameRow, { display: 'flex', alignItems: 'center', gap: '4px' });
  const nameLabel = document.createElement('span');
  css(nameLabel, { flex: '1', fontSize: '10px', fontFamily: 'inherit', color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  const ejectBtn = btn('✕', 'Eject file');
  css(ejectBtn, { padding: '2px 5px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)' });
  ejectBtn.addEventListener('mouseenter', () => { ejectBtn.style.color = 'rgba(255,255,255,0.8)'; });
  ejectBtn.addEventListener('mouseleave', () => { ejectBtn.style.color = 'rgba(255,255,255,0.35)'; });
  ejectBtn.addEventListener('click', () => { clearLibraryTrack(); Audio.ejectFile(); });
  nameRow.append(nameLabel, ejectBtn);

  // Seek bar row
  const seekRow = document.createElement('div');
  css(seekRow, { display: 'flex', alignItems: 'center', gap: '6px' });
  const seekBar = document.createElement('input');
  seekBar.type = 'range'; seekBar.min = '0'; seekBar.max = '100'; seekBar.value = '0'; seekBar.step = '0.05';
  css(seekBar, { flex: '1', accentColor: 'rgba(255,255,255,0.6)', cursor: 'pointer', height: '3px' });
  const timeLabel = document.createElement('span');
  css(timeLabel, { fontSize: '10px', fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', flexShrink: '0', minWidth: '65px', textAlign: 'right' });
  timeLabel.textContent = '0:00 / 0:00';
  seekRow.append(seekBar, timeLabel);

  // Transport row
  const transportRow = document.createElement('div');
  css(transportRow, { display: 'flex', alignItems: 'center', gap: '4px' });
  const playPauseBtn = btn('▶', 'Play / Pause');
  transportRow.appendChild(playPauseBtn);

  // A-B loop row
  const abRow = document.createElement('div');
  css(abRow, { display: 'flex', alignItems: 'center', gap: '4px', marginTop: '1px' });
  const setBtnA  = btn('A', 'Set loop start');
  const setBtnB  = btn('B', 'Set loop end');
  const clearBtn = btn('✕ loop', 'Clear A-B loop');
  const abLabel  = document.createElement('span');
  css(abLabel, { fontSize: '10px', fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', marginLeft: '2px' });
  abRow.append(setBtnA, setBtnB, clearBtn, abLabel);

  controls.append(nameRow, seekRow, transportRow, abRow);
  pane.element.appendChild(controls);

  // ── Wiring ─────────────────────────────────────────────────────────────────
  let isSeeking = false;
  seekBar.addEventListener('pointerdown', () => { isSeeking = true; });
  seekBar.addEventListener('pointerup',   () => { isSeeking = false; Audio.seekFile(parseFloat(seekBar.value)); });
  seekBar.addEventListener('input',       () => { if (isSeeking) Audio.seekFile(parseFloat(seekBar.value)); });

  playPauseBtn.addEventListener('click', () => {
    if (Audio.status === 'file') Audio.pauseFile();
    else Audio.playFile();
  });

  setBtnA.addEventListener('click',  () => { Audio.setLoopA();  save(); });
  setBtnB.addEventListener('click',  () => { Audio.setLoopB();  save(); });
  clearBtn.addEventListener('click', () => { Audio.clearLoop(); save(); });

  // ── Callbacks ──────────────────────────────────────────────────────────────
  Audio.setStatusCallback((st, label) => {
    if (st === 'file' || st === 'file-paused') {
      zone.style.display    = 'none';
      urlRow.style.display  = 'none';
      if (libRow) libRow.style.display = 'none';
      controls.style.display = 'flex';
    } else {
      zone.style.display    = '';
      urlRow.style.display  = '';
      if (libRow) libRow.style.display = '';
      controls.style.display = 'none';
      if (st === 'none') zone.textContent = '↓ Drop audio file or click to browse';
      else zone.textContent = label;
    }
  });

  Audio.setPlaybackCallback(({ hasFile, fileName, currentTime, duration, paused, loopA, loopB }) => {
    if (!hasFile) return;

    nameLabel.textContent = `♪ ${fileName}`;
    playPauseBtn.textContent = paused ? '▶' : '⏸';

    if (!isSeeking && duration > 0) {
      seekBar.max   = String(duration);
      seekBar.value = String(currentTime);
    }
    timeLabel.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;

    // A-B label
    const hasA = loopA !== null;
    const hasB = loopB !== null;
    const abActive = hasA && hasB;
    css(setBtnA, { borderColor: hasA ? 'rgba(100,200,255,0.7)' : 'rgba(255,255,255,0.18)', color: hasA ? 'rgba(100,200,255,0.9)' : 'rgba(255,255,255,0.8)' });
    css(setBtnB, { borderColor: hasB ? 'rgba(100,200,255,0.7)' : 'rgba(255,255,255,0.18)', color: hasB ? 'rgba(100,200,255,0.9)' : 'rgba(255,255,255,0.8)' });
    clearBtn.style.display = abActive ? '' : 'none';
    if (abActive) {
      const a = Math.min(loopA, loopB);
      const b = Math.max(loopA, loopB);
      abLabel.textContent = `${formatTime(a)} → ${formatTime(b)}`;
    } else if (hasA) {
      abLabel.textContent = `A: ${formatTime(loopA)}`;
    } else {
      abLabel.textContent = '';
    }
  });

  // ── Auto-connect library track from saved state ───────────────────────────
  if (uiState.audioTrack && libraryTracks.includes(uiState.audioTrack)) {
    audioLibraryTrack = uiState.audioTrack;
    const url = /^https?:\/\//.test(uiState.audioTrack) ? uiState.audioTrack : import.meta.env.BASE_URL + uiState.audioTrack;
    (async () => {
      try {
        const ok = await Audio.connectUrl(url);
        if (uiState.loopA != null && uiState.loopB != null) Audio.restoreLoop(uiState.loopA, uiState.loopB);
        _cleanEncoded = getDirtyCheckEncoded();
        if (!ok) showAutoplayOverlay();
      } catch (e) {
        showWarning(e.message ?? 'Audio error');
      }
    })();
  }
  addCollapseAllCtrl(pane);
}

function showAutoplayOverlay() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    background: rgba(0,0,0,0.8);
  `;
  const label = document.createElement('div');
  label.style.cssText = `
    font-family: monospace; font-size: 13px; color: rgba(255,255,255,0.65);
    letter-spacing: 0.06em; pointer-events: none;
  `;
  label.textContent = '▶  click to play audio';
  overlay.appendChild(label);
  overlay.addEventListener('click', () => { Audio.playFile(); overlay.remove(); });
  document.body.appendChild(overlay);
}

// ── Preset image picker (thumbnail grid dialog) ────────────────────────────
// One shared overlay reused across all image layers — built lazily on first
// open, rebound with a fresh onPick callback + current-selection highlight
// each time it's opened, rather than rebuilt on every layer-panel rebuild.
let _presetPickerEl    = null;
let _presetPickerCells = null; // name → { cell, img }
let _presetPickerOnPick = null;

function ensurePresetPicker() {
  if (_presetPickerEl) return _presetPickerEl;

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 100000;
    background: rgba(0,0,0,0.75);
    display: none; align-items: center; justify-content: center;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: rgba(24,24,24,0.98); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px; padding: 12px; width: min(560px, 92vw);
    max-height: 80vh; display: flex; flex-direction: column; gap: 8px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.6);
  `;

  const header = document.createElement('div');
  header.style.cssText = 'display:flex; align-items:center; justify-content:space-between;';
  const title = document.createElement('span');
  title.textContent = 'Preset Images';
  title.style.cssText = 'font-size:12px; font-family:inherit; color:rgba(255,255,255,0.75); font-weight:600;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: rgba(255,255,255,0.7); font-size: 11px;
    font-family: inherit; padding: 3px 7px; cursor: pointer;
  `;
  closeBtn.addEventListener('click', closePresetPicker);
  header.append(title, closeBtn);

  const grid = document.createElement('div');
  grid.style.cssText = `
    display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 8px; overflow-y: auto; padding: 2px;
  `;

  _presetPickerCells = new Map();
  PRESET_IMAGES.forEach(({ name, thumb }) => {
    const cell = document.createElement('div');
    cell.style.cssText = 'cursor:pointer; display:flex; flex-direction:column; gap:3px;';

    const img = document.createElement('img');
    img.src = `${import.meta.env.BASE_URL}${thumb}`;
    img.loading = 'lazy';
    img.style.cssText = `
      width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 3px;
      border: 2px solid rgba(255,255,255,0.1); transition: border-color 0.1s;
    `;
    cell.addEventListener('mouseenter', () => { if (img.dataset.selected !== '1') img.style.borderColor = 'rgba(255,255,255,0.6)'; });
    cell.addEventListener('mouseleave', () => { if (img.dataset.selected !== '1') img.style.borderColor = 'rgba(255,255,255,0.1)'; });

    const label = document.createElement('span');
    label.textContent = name;
    label.style.cssText = `
      font-size: 8px; font-family: inherit; color: rgba(255,255,255,0.4);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center;
    `;

    cell.addEventListener('click', () => {
      _presetPickerOnPick?.(name);
      closePresetPicker();
    });

    cell.append(img, label);
    grid.appendChild(cell);
    _presetPickerCells.set(name, img);
  });

  dialog.append(header, grid);
  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePresetPicker(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') closePresetPicker();
  });

  document.body.appendChild(overlay);
  _presetPickerEl = overlay;
  return overlay;
}

function openPresetPicker(currentName, onPick) {
  const overlay = ensurePresetPicker();
  _presetPickerOnPick = onPick;
  _presetPickerCells.forEach((img, name) => {
    const selected = name === currentName;
    img.dataset.selected = selected ? '1' : '0';
    img.style.borderColor = selected ? 'rgba(120,190,255,0.9)' : 'rgba(255,255,255,0.1)';
  });
  overlay.style.display = 'flex';
}

function closePresetPicker() {
  if (_presetPickerEl) _presetPickerEl.style.display = 'none';
  _presetPickerOnPick = null;
}

function addImageDropZone(folder, layer) {
  const content = folder.element.querySelector('.tp-fldv_c') ?? folder.element;

  const zone = document.createElement('div');
  zone.style.cssText = `
    border: 1px dashed rgba(255,255,255,0.2);
    border-radius: 2px;
    padding: 12px 8px;
    margin: 4px 4px 2px;
    text-align: center;
    color: rgba(255,255,255,0.35);
    font-size: 10px;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  `;
  zone.textContent = layer._hydraSource
    ? (layer.imgName ? `✓ ${layer.imgName}` : '↓ Drop image or click to browse')
    : '⚠ No source slots available';

  if (!layer._hydraSource) { content.appendChild(zone); return; }

  // Preset images — thumbnail grid dialog. List is generated at build/dev
  // time from public/ (see vite.config.js).
  const presetBtn = document.createElement('button');
  presetBtn.textContent = 'Browse preset images…';
  presetBtn.style.cssText = `
    display: block; width: calc(100% - 8px); margin: 4px 4px 0; box-sizing: border-box;
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: #fff; font-size: 10px; font-family: inherit;
    padding: 5px 6px; outline: none; cursor: pointer;
  `;
  presetBtn.addEventListener('click', () => {
    openPresetPicker(layer.imgName, (name) => {
      const url = `${import.meta.env.BASE_URL}${name}`;
      layer.imgUrl  = url;
      layer.imgName = name;
      layer._hydraSource.initImage(url);
      zone.textContent = `✓ ${name}`;
      render(getLayers());
      save();
    });
  });
  content.appendChild(presetBtn);

  // URL input
  const urlRow = document.createElement('div');
  urlRow.style.cssText = 'display:flex; gap:4px; margin: 4px 4px 0;';
  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.placeholder = 'https://image-url…';
  urlInput.value = (layer.imgUrl && !layer.imgUrl.startsWith('idb:')) ? layer.imgUrl : '';
  urlInput.style.cssText = `
    flex: 1; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: #fff; font-size: 10px; font-family: inherit;
    padding: 4px 6px; outline: none;
  `;
  const loadBtn = document.createElement('button');
  loadBtn.textContent = 'Load';
  loadBtn.style.cssText = `
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    border-radius: 2px; color: #fff; font-size: 10px; font-family: inherit;
    padding: 4px 8px; cursor: pointer;
  `;
  const applyUrl = async () => {
    const url = urlInput.value.trim();
    if (!url) return;
    if (url.startsWith('data:')) {
      showWarning('Data URIs are not supported — use an external image URL.');
      return;
    }
    if (url.length > 500) {
      showWarning('Image URL is very long and may make sharing impractical.');
    }
    layer.imgUrl  = url;
    layer.imgName = '';
    // Fetch as blob so external images are same-origin — avoids CORS canvas taint
    // that would prevent Three.js from reading the Hydra canvas as a texture.
    let loadUrl = url;
    try {
      const res = await fetch(url);
      if (res.ok) loadUrl = URL.createObjectURL(await res.blob());
    } catch (_) { /* cross-origin or network failure — fall back to direct URL */ }
    layer._hydraSource.initImage(loadUrl);
    zone.textContent = `✓ ${url.split('/').pop() || url}`;
    render(getLayers());
    save();
  };
  loadBtn.addEventListener('click', applyUrl);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyUrl(); });
  urlRow.append(urlInput, loadBtn);
  content.appendChild(urlRow);

  const highlight = (on) => {
    zone.style.borderColor = on ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)';
    zone.style.color       = on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
  };

  const loadFile = async (file) => {
    if (!file?.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      if (!confirm(`This image is ${mb} MB. Large images may slow down the playground. Continue?`)) return;
    }
    const idbRef = await storeImage(file);
    layer.imgUrl  = idbRef;
    layer.imgName = file.name;
    layer._hydraSource.initImage(URL.createObjectURL(file));
    zone.textContent = `✓ ${file.name}`;
    render(getLayers());
    save();
  };

  zone.addEventListener('dragover',  (e) => { e.preventDefault(); highlight(true); });
  zone.addEventListener('dragleave', ()  => highlight(false));
  zone.addEventListener('drop',      (e) => { e.preventDefault(); highlight(false); loadFile(e.dataTransfer.files[0]); });
  zone.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => loadFile(e.target.files[0]);
    input.click();
  });

  content.appendChild(zone);
}

const TEXT_FONTS = [
  'Bebas Neue', 'Anton', 'Abril Fatface', 'Oswald', 'Righteous',
  'Lobster', 'Pacifico', 'Raleway', 'Montserrat', 'Poppins',
  'Playfair Display', 'Merriweather', 'Space Grotesk', 'DM Sans', 'Nunito',
  'Ubuntu', 'Lato', 'Open Sans', 'Roboto', 'Roboto Condensed',
  'PT Sans', 'Press Start 2P', 'Roboto Mono', 'Source Code Pro', 'Inconsolata',
];

// Text-bank entries carry their own font/size/position/color (see
// snapshotTextEntry/setTextBankIndex in layers.js) — these are the
// LAYER_TYPES.text.params keys among those, used to keep the active entry in
// sync when their generic sliders change.
const TEXT_BANK_STYLE_KEYS = ['size', 'x', 'y'];

function rgbToHex(r, g, b) {
  const toHex = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function addTextControls(folder, layer) {
  const content = folder.element.querySelector('.tp-fldv_c') ?? folder.element;
  // Tweakpane inserts each new blade at its own internally-tracked index —
  // it has no idea about raw DOM nodes we appendChild ourselves, so any
  // blade added to this folder *after* this call (Layer/Blend/params/...)
  // would otherwise get spliced in ahead of these rows regardless of when we
  // appended them. Building everything into one wrapper lets the caller move
  // it into place with a plain DOM `.before()`/`.after()` once every blade
  // for this layer exists, sidestepping that entirely.
  const wrap = document.createElement('div');

  const sharedInputStyle = `
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: #fff; font-size: 10px; font-family: inherit;
    padding: 4px 6px; outline: none;
  `;

  // Paste multiline — splits clipboard text on line breaks into one text-bank
  // entry per line, replacing whatever's currently in the bank.
  const pasteBtn = document.createElement('button');
  pasteBtn.textContent = 'Paste multiline';
  pasteBtn.style.cssText = `
    width: calc(100% - 8px); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 2px; color: rgba(255,255,255,0.6); font-size: 10px;
    font-family: inherit; font-weight: bold; padding: 5px; cursor: pointer;
    margin: 2px 4px 4px; box-sizing: border-box;
  `;
  pasteBtn.addEventListener('click', async () => {
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      alert('Could not read the clipboard.');
      return;
    }
    // Blank lines between two text lines are kept as their own (empty-text)
    // bank entry — lyrics/poems often use them to mark a pause, and having a
    // dedicated step there makes that pause easy to time via custom timings.
    // Leading/trailing blank lines are just clipboard noise, so those are dropped.
    const lines = text.split(/\r\n|\r|\n/).map(l => l.trim());
    while (lines.length && lines[0] === '') lines.shift();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines.length < 2) {
      alert('Clipboard does not contain multiline text.');
      return;
    }
    const hasContent = layer.textBank.some(e => e.text?.trim());
    if (hasContent && !confirm('Overwrite existing text bank?')) return;

    layer.textBank = lines.map(text => snapshotTextEntry(layer, text));
    setTextBankIndex(layer, 0);
    rebuild();
  });
  wrap.appendChild(pasteBtn);

  // Text bank — a poem/speech's worth of lines. The select switches which
  // entry is "live"; the input below edits whichever one is selected.
  const bankRow = document.createElement('div');
  bankRow.style.cssText = 'display:flex; gap:4px; margin: 4px 4px 0;';

  const bankSelect = document.createElement('select');
  bankSelect.style.cssText = `flex:1; min-width:0; cursor:pointer; ${sharedInputStyle}`;

  const smallBtnStyle = `
    flex: none; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 2px; color: rgba(255,255,255,0.5); font-size: 10px;
    font-family: inherit; padding: 3px 8px; cursor: pointer;
  `;
  const addEntryBtn = document.createElement('button');
  addEntryBtn.textContent = '+';
  addEntryBtn.title = 'Add line after current';
  addEntryBtn.style.cssText = smallBtnStyle;

  const removeEntryBtn = document.createElement('button');
  removeEntryBtn.textContent = '✕';
  removeEntryBtn.title = 'Remove current line';
  removeEntryBtn.style.cssText = smallBtnStyle;

  bankRow.append(bankSelect, addEntryBtn, removeEntryBtn);
  wrap.appendChild(bankRow);

  // Text content input — edits layer.textBank[layer.textBankIndex]
  const textRow = document.createElement('div');
  textRow.style.cssText = 'display:flex; gap:4px; margin: 4px 4px 0;';
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.placeholder = 'Enter text…';
  textInput.value = layer.textContent ?? '';
  textInput.style.cssText = `flex: 1; ${sharedInputStyle}`;
  textRow.appendChild(textInput);
  wrap.appendChild(textRow);

  function refreshBankSelect() {
    bankSelect.innerHTML = '';
    layer.textBank.forEach((entry, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      const preview = entry.text.trim() ? entry.text.trim().slice(0, 28) : '(empty)';
      opt.textContent = `${i + 1}: ${preview}`;
      if (i === layer.textBankIndex) opt.selected = true;
      bankSelect.appendChild(opt);
    });
  }
  refreshBankSelect();

  textInput.addEventListener('input', async () => {
    layer.textContent = textInput.value;
    layer.textBank[layer.textBankIndex].text = textInput.value;
    refreshBankSelect();
    await drawTextCanvas(layer);
    render(getLayers());
    save();
  });

  // Switching entries changes font/size/position/color too (see
  // setTextBankIndex) — rebuild so every control (Font, Color, and the
  // generic Size/X/Y sliders built elsewhere in this panel) picks up the
  // newly active entry's values, not just the canvas.
  bankSelect.addEventListener('change', () => {
    setTextBankIndex(layer, parseInt(bankSelect.value, 10));
    rebuild();
  });

  addEntryBtn.addEventListener('click', () => {
    // New line starts as a copy of the current entry's style — just clear the text.
    layer.textBank.splice(layer.textBankIndex + 1, 0, { ...layer.textBank[layer.textBankIndex], text: '' });
    setTextBankIndex(layer, layer.textBankIndex + 1);
    rebuild();
  });

  removeEntryBtn.addEventListener('click', () => {
    if (layer.textBank.length <= 1) return;
    layer.textBank.splice(layer.textBankIndex, 1);
    setTextBankIndex(layer, layer.textBankIndex);
    rebuild();
  });

  // Font family selector
  const fontRow = document.createElement('div');
  fontRow.style.cssText = 'display:flex; align-items:center; gap:4px; margin: 4px 4px 2px;';
  const fontLabel = document.createElement('span');
  fontLabel.textContent = 'Font';
  fontLabel.style.cssText = 'font-size:10px; font-family:inherit; color:rgba(255,255,255,0.5); flex-shrink:0;';
  const fontSelect = document.createElement('select');
  fontSelect.style.cssText = `flex:1; cursor:pointer; ${sharedInputStyle}`;
  TEXT_FONTS.forEach(font => {
    const opt = document.createElement('option');
    opt.value = font;
    opt.textContent = font;
    if (font === layer.fontFamily) opt.selected = true;
    fontSelect.appendChild(opt);
  });
  fontSelect.addEventListener('change', async () => {
    layer.fontFamily = fontSelect.value;
    layer.textBank[layer.textBankIndex].fontFamily = fontSelect.value;
    await drawTextCanvas(layer);
    render(getLayers());
    save();
  });
  fontRow.append(fontLabel, fontSelect);
  wrap.appendChild(fontRow);

  // Color picker — opens the browser's native color selector
  const colorRow = document.createElement('div');
  colorRow.style.cssText = 'display:flex; align-items:center; gap:4px; margin: 4px 4px 2px;';
  const colorLabel = document.createElement('span');
  colorLabel.textContent = 'Color';
  colorLabel.style.cssText = 'font-size:10px; font-family:inherit; color:rgba(255,255,255,0.5); flex-shrink:0;';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = rgbToHex(layer.params.r, layer.params.g, layer.params.b);
  colorInput.style.cssText = `flex:1; height:22px; cursor:pointer; ${sharedInputStyle}`;
  colorInput.addEventListener('input', async () => {
    const { r, g, b } = hexToRgb(colorInput.value);
    layer.params.r = r;
    layer.params.g = g;
    layer.params.b = b;
    const entry = layer.textBank[layer.textBankIndex];
    entry.r = r; entry.g = g; entry.b = b;
    await drawTextCanvas(layer);
    render(getLayers());
    save();
  });
  colorRow.append(colorLabel, colorInput);
  wrap.appendChild(colorRow);

  // Auto-advance through the bank — same interval/custom-timings UX as the
  // Scenes pane's player (src/ui.js initScenesPane), scoped to this layer.
  const playerWrap = document.createElement('div');
  playerWrap.style.cssText = 'margin: 6px 4px 2px; display:flex; flex-direction:column; gap:5px;';

  const playBtn = document.createElement('button');
  playBtn.style.cssText = `
    width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 2px; color: rgba(255,255,255,0.6); font-size: 10px;
    font-family: inherit; font-weight: bold; padding: 6px; cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  `;
  function updatePlayBtn() {
    if (isTextBankPlaying(layer)) {
      playBtn.textContent = '■ Stop';
      playBtn.style.background  = 'rgba(100,220,130,0.15)';
      playBtn.style.borderColor = 'rgba(100,220,130,0.5)';
      playBtn.style.color       = 'rgba(130,240,160,0.9)';
    } else {
      playBtn.textContent = '▶ Play';
      playBtn.style.background  = 'rgba(255,255,255,0.04)';
      playBtn.style.borderColor = 'rgba(255,255,255,0.1)';
      playBtn.style.color       = 'rgba(255,255,255,0.6)';
    }
  }
  playBtn.addEventListener('click', () => {
    if (isTextBankPlaying(layer)) {
      stopTextBankPlayer(layer);
    } else {
      if (layer.textBank.length < 2) { showWarning('Add at least 2 lines to play.'); return; }
      startTextBankPlayer(layer);
    }
    updatePlayBtn();
    save();
  });

  const intervalRow = document.createElement('div');
  intervalRow.style.cssText = 'display:flex; align-items:center; gap:6px;';
  const intervalLabel = document.createElement('span');
  intervalLabel.textContent = 'interval';
  intervalLabel.style.cssText = 'font-size:9px; font-family:monospace; color:rgba(255,255,255,0.3); flex-shrink:0;';
  const intervalSlider = document.createElement('input');
  intervalSlider.type = 'range'; intervalSlider.min = '0.5'; intervalSlider.max = '60'; intervalSlider.step = '0.5';
  intervalSlider.value = String(layer.textBankInterval ?? 5);
  intervalSlider.style.cssText = 'flex:1; accent-color: rgba(255,255,255,0.6); cursor:pointer; height:3px;';
  const intervalValue = document.createElement('span');
  intervalValue.style.cssText = 'font-size:9px; font-family:monospace; color:rgba(255,255,255,0.4); flex-shrink:0; min-width:28px; text-align:right;';
  intervalValue.textContent = `${intervalSlider.value}s`;
  intervalSlider.addEventListener('input', () => {
    intervalValue.textContent = `${intervalSlider.value}s`;
    layer.textBankInterval = intervalSlider.valueAsNumber;
    save();
  });
  intervalRow.append(intervalLabel, intervalSlider, intervalValue);

  const timingInput = document.createElement('input');
  timingInput.type = 'text';
  timingInput.placeholder = 'custom timings (s), comma-separated — overrides interval';
  timingInput.value = layer.textBankTimings ?? '';
  const timingBaseStyle = `
    border-radius: 2px; color: #fff; font-size: 9px; font-family: monospace;
    padding: 4px 6px; outline: none; transition: background 0.12s, border-color 0.12s;
  `;
  const timingNeutralColors = 'background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15);';
  // Custom timings wrap around (see textBankDurationForStep), so a step-count
  // mismatch never breaks anything — this is just a quick visual nudge, shown
  // only while actively editing, that the timings don't line up 1:1 with the
  // bank's lines. Reverts to the neutral look on blur so it doesn't linger.
  function updateTimingValidity() {
    const raw = timingInput.value.trim();
    let colors;
    if (!raw) {
      colors = timingNeutralColors; // falls back to interval
    } else if (parseTextBankTimings(raw).length === layer.textBank.length) {
      colors = 'background: rgba(100,200,120,0.1); border: 1px solid rgba(100,200,120,0.5);'; // OK — one timing per line
    } else {
      colors = 'background: rgba(220,60,60,0.1); border: 1px solid rgba(220,60,60,0.55);'; // too few/too many steps
    }
    timingInput.style.cssText = timingBaseStyle + colors;
  }
  timingInput.style.cssText = timingBaseStyle + timingNeutralColors;
  timingInput.addEventListener('focus', updateTimingValidity);
  timingInput.addEventListener('input', () => {
    layer.textBankTimings = timingInput.value;
    updateTimingValidity();
    save();
  });
  timingInput.addEventListener('blur', () => {
    timingInput.style.cssText = timingBaseStyle + timingNeutralColors;
  });

  playerWrap.append(playBtn, intervalRow, timingInput);
  wrap.appendChild(playerWrap);
  updatePlayBtn();

  // While the bank auto-advances (startTextBankPlayer, in layers.js), the
  // active index/text/font/color change on their own timer — poll for that
  // and mirror it here instead of leaving the panel showing a stale entry.
  // Self-terminating: once this panel is rebuilt away, `wrap` is no longer
  // attached and the loop stops rescheduling itself.
  let lastLiveIndex = layer.textBankIndex;
  function pollLiveBank() {
    if (!document.body.contains(wrap)) return; // panel rebuilt away — stop polling
    if (isTextBankPlaying(layer) && layer.textBankIndex !== lastLiveIndex) {
      lastLiveIndex = layer.textBankIndex;
      refreshBankSelect();
      textInput.value = layer.textContent ?? '';
      fontSelect.value = layer.fontFamily;
      colorInput.value = rgbToHex(layer.params.r, layer.params.g, layer.params.b);
    }
    setTimeout(pollLiveBank, 200);
  }
  setTimeout(pollLiveBank, 200); // first check runs after `wrap` is attached below

  content.appendChild(wrap);
  return wrap;
}

// ── Three.js code editor ──────────────────────────────────────────────────────
function addThreeEditor(folder, layer) {
  const content = folder.element.querySelector('.tp-fldv_c') ?? folder.element;

  const SELECT_CSS = `
    display: block; width: calc(100% - 8px); margin: 4px 4px 0; box-sizing: border-box;
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: #fff; font-size: 10px; font-family: inherit;
    padding: 4px 6px; outline: none; cursor: pointer;
  `;

  const presetSelect = document.createElement('select');
  presetSelect.style.cssText = SELECT_CSS;
  const blankOpt = document.createElement('option');
  blankOpt.value = '';
  blankOpt.textContent = '— load preset —';
  presetSelect.appendChild(blankOpt);
  Object.keys(THREE_PRESETS).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    presetSelect.appendChild(opt);
  });
  content.appendChild(presetSelect);

  const textarea = document.createElement('textarea');
  textarea.value      = layer._threeCode ?? '';
  textarea.spellcheck = false;
  textarea.style.cssText = `
    display: block; width: calc(100% - 8px); margin: 4px 4px 2px;
    min-height: 150px; resize: vertical;
    background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: rgba(255,255,255,0.85);
    font-size: 10px; font-family: 'Roboto Mono', 'Source Code Pro', monospace;
    line-height: 1.55; padding: 6px; outline: none;
    tab-size: 2; box-sizing: border-box;
  `;

  presetSelect.addEventListener('change', () => {
    const code = THREE_PRESETS[presetSelect.value];
    if (!code) return;
    textarea.value = code;
    layer._threeCode = code;
    reloadThree(layer);
    save();
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = textarea.selectionStart, end = textarea.selectionEnd;
    textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = s + 2;
  });

  let debounce = null;
  textarea.addEventListener('input', () => {
    presetSelect.value = ''; // custom edits clear the preset label
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      layer._threeCode = textarea.value;
      reloadThree(layer);
      save();
    }, 600);
  });

  content.appendChild(textarea);
}

// ── GLSL code editor ─────────────────────────────────────────────────────────
function addGlslEditor(folder, layer) {
  const content = folder.element.querySelector('.tp-fldv_c') ?? folder.element;

  const textarea = document.createElement('textarea');
  textarea.value     = layer._glslCode ?? '';
  textarea.spellcheck = false;
  textarea.style.cssText = `
    display: block; width: calc(100% - 8px); margin: 4px 4px 2px;
    min-height: 150px; resize: vertical;
    background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: rgba(255,255,255,0.85);
    font-size: 10px; font-family: 'Roboto Mono', 'Source Code Pro', monospace;
    line-height: 1.55; padding: 6px; outline: none;
    tab-size: 2; box-sizing: border-box;
  `;

  // Tab key inserts two spaces instead of leaving the field
  textarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = textarea.selectionStart, end = textarea.selectionEnd;
    textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = s + 2;
  });

  let debounce = null;
  textarea.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      layer._glslCode = textarea.value;
      registerGlsl(layer);
      render(getLayers());
      save();
    }, 400);
  });

  content.appendChild(textarea);
}

// ── Bezier curve editor ───────────────────────────────────────────────────────
// Injects a small canvas + preset buttons into a Tweakpane folder element.
// `anim`     — the animate object whose `bezier` array ([x1,y1,x2,y2]) is mutated
// `folderEl` — the Tweakpane folder's DOM element to append into
// `onchange` — called after each control-point move
function buildBezierEditor(anim, folderEl, onchange) {
  const W = 112, H = 80, PAD = 8, R = 5;
  // Y axis allows slight overshoot: bezier Y maps [−0.5, 1.5] → canvas [H, 0]
  const Y_MIN = -0.5, Y_MAX = 1.5, Y_RANGE = Y_MAX - Y_MIN;

  const toCanvas  = (bx, by) => [(bx * (W - PAD*2)) + PAD, ((Y_MAX - by) / Y_RANGE) * (H - PAD*2) + PAD];
  const fromCanvas = (cx, cy) => [
    Math.max(0, Math.min(1,       (cx - PAD) / (W - PAD*2))),
    Math.max(Y_MIN, Math.min(Y_MAX, Y_MAX - (cy - PAD) / (H - PAD*2) * Y_RANGE)),
  ];

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin: 2px 4px 4px; user-select: none;';

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  canvas.style.cssText = `display:block; width:${W}px; height:${H}px; cursor:crosshair;
    background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.1); border-radius:2px;`;

  function draw() {
    const [x1, y1, x2, y2] = anim.bezier;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // Guide lines from anchors to handles
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    const [ax0, ay0] = toCanvas(0, 0);
    const [ax3, ay3] = toCanvas(1, 1);
    const [hx1, hy1] = toCanvas(x1, y1);
    const [hx2, hy2] = toCanvas(x2, y2);
    ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.lineTo(hx1, hy1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax3, ay3); ctx.lineTo(hx2, hy2); ctx.stroke();
    ctx.setLineDash([]);

    // Bezier curve (40 samples)
    ctx.strokeStyle = 'rgba(100,200,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t  = i / 40;
      const bx = 3*(1-t)*(1-t)*t*x1 + 3*(1-t)*t*t*x2 + t*t*t;
      const by = 3*(1-t)*(1-t)*t*y1 + 3*(1-t)*t*t*y2 + t*t*t;
      const [cx, cy] = toCanvas(bx, by);
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Anchor dots (fixed)
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    [[0,0],[1,1]].forEach(([bx,by]) => {
      const [cx,cy] = toCanvas(bx,by);
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI*2); ctx.fill();
    });

    // Handle dots (draggable)
    [[x1,y1,'rgba(255,180,60,0.95)'],[x2,y2,'rgba(80,220,120,0.95)']].forEach(([bx,by,col]) => {
      const [cx,cy] = toCanvas(bx,by);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.fill();
    });
  }

  // Drag logic
  let dragging = null; // 0 = P1, 1 = P2
  function hitTest(cx, cy) {
    const pts = [[anim.bezier[0], anim.bezier[1]], [anim.bezier[2], anim.bezier[3]]];
    for (let i = 0; i < 2; i++) {
      const [hx, hy] = toCanvas(pts[i][0], pts[i][1]);
      if (Math.hypot(cx - hx, cy - hy) <= R + 3) return i;
    }
    return null;
  }
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return [src.clientX - rect.left, src.clientY - rect.top];
  }
  function onDown(e)  { e.preventDefault(); const [cx,cy] = getPos(e); dragging = hitTest(cx,cy); }
  function onMove(e)  {
    if (dragging === null) return;
    e.preventDefault();
    const [cx,cy] = getPos(e);
    const [bx,by] = fromCanvas(cx,cy);
    if (dragging === 0) { anim.bezier[0] = bx; anim.bezier[1] = by; }
    else                { anim.bezier[2] = bx; anim.bezier[3] = by; }
    draw();
    onchange();
  }
  function onUp() { dragging = null; }

  const ac = new AbortController();
  const sig = { signal: ac.signal };
  canvas.addEventListener('mousedown',  onDown);
  canvas.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('mousemove',  onMove, sig);
  window.addEventListener('touchmove',  onMove, { ...sig, passive: false });
  window.addEventListener('mouseup',    onUp,   sig);
  window.addEventListener('touchend',   onUp,   sig);
  // Clean up when the canvas is removed from the DOM (on rebuild)
  new MutationObserver(() => { if (!canvas.isConnected) ac.abort(); })
    .observe(document.body, { childList: true, subtree: true });

  // Preset buttons
  const presets = [
    { label: 'Linear',   v: [0, 0, 1, 1] },
    { label: 'Ease In',  v: [0.42, 0, 1, 1] },
    { label: 'Ease Out', v: [0, 0, 0.58, 1] },
    { label: 'Ease',     v: [0.42, 0, 0.58, 1] },
  ];
  const presetRow = document.createElement('div');
  presetRow.style.cssText = 'display:flex; gap:3px; margin-top:4px; flex-wrap:wrap;';
  presets.forEach(({ label, v }) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      flex:1; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.15);
      border-radius:2px; color:rgba(255,255,255,0.7); font-size:9px; font-family:inherit;
      padding:3px 4px; cursor:pointer; min-width:0;
    `;
    btn.addEventListener('click', () => {
      anim.bezier = [...v];
      draw();
      onchange();
    });
    presetRow.appendChild(btn);
  });

  wrap.appendChild(canvas);
  wrap.appendChild(presetRow);

  const content = folderEl.querySelector('.tp-fldv_c') ?? folderEl;
  content.appendChild(wrap);

  draw();
}

function buildStepsEditor(anim, folderEl, onChange) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; align-items:center; gap:6px; margin:2px 4px 4px;';

  const label = document.createElement('span');
  label.textContent = 'Values';
  label.style.cssText = 'font-size:10px; font-family:inherit; color:rgba(255,255,255,0.5); flex-shrink:0; width:52px;';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '1, 2, 4, 8';
  input.value = (anim.steps ?? []).join(', ');
  input.style.cssText = `
    flex: 1; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: #fff; font-size: 10px; font-family: inherit;
    padding: 4px 6px; outline: none;
  `;

  const apply = () => {
    const vals = input.value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    if (vals.length > 0) { anim.steps = vals; onChange(); }
  };
  input.addEventListener('change', apply);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });

  row.append(label, input);
  const content = folderEl.querySelector('.tp-fldv_c') ?? folderEl;
  content.appendChild(row);
}

async function onChange() {
  await Promise.all(getLayers().filter(l => l.type === 'text').map(drawTextCanvas));
  render(getLayers());
  save();
}

function rebuild() {
  buildLayersUI();
  render(getLayers());
  save();
}

function addCollapseAllCtrl(paneOrFolder) {
  const el = paneOrFolder.element;
  const isRoot = el.classList.contains('tp-rotv');
  const titleSel = isRoot ? '.tp-rotv_b' : '.tp-fldv_b';
  const titleBtn = el.querySelector(titleSel);
  if (!titleBtn || titleBtn.querySelector('[data-cc]')) return;

  const ctrl = document.createElement('span');
  ctrl.dataset.cc = '1';
  ctrl.style.cssText = 'position:absolute;right:26px;top:50%;transform:translateY(-50%);font-size:9px;font-family:inherit;z-index:1;user-select:none;display:inline-flex;gap:1px;';

  const mkBtn = (label, expand) => {
    const s = document.createElement('span');
    s.textContent = label;
    s.style.cssText = 'color:rgba(255,255,255,0.22);cursor:pointer;padding:1px 3px;border-radius:2px;';
    s.addEventListener('mouseenter', () => { s.style.color = 'rgba(255,255,255,0.65)'; s.style.background = 'rgba(255,255,255,0.08)'; });
    s.addEventListener('mouseleave', () => { s.style.color = 'rgba(255,255,255,0.22)'; s.style.background = ''; });
    s.addEventListener('click', (e) => {
      e.stopPropagation();
      paneOrFolder.children.forEach(c => { if ('expanded' in c) c.expanded = expand; });
    });
    return s;
  };

  ctrl.append(mkBtn('−', false), mkBtn('+', true));
  titleBtn.style.position = 'relative';
  titleBtn.appendChild(ctrl);
}

function buildLayersUI() {
  const scrollTop = uiContainer?.scrollTop ?? 0;

  while (layersPane.children.length > 0) {
    layersPane.remove(layersPane.children[0]);
  }

  const layers = getLayers();
  if (layers.length === 0) return;

  // ── Layer list (Photoshop order: top of panel = front of stack) ──
  const displayOrder = [...layers].reverse();

  displayOrder.forEach((layer) => {
    const arrayIdx = layers.indexOf(layer);
    const isBase = arrayIdx === 0;
    const atFront = arrayIdx === layers.length - 1;

    const f = layersPane.addFolder({ title: layer.name, expanded: layer._expanded });
    f.on('fold', (ev) => { layer._expanded = ev.expanded; save(); });
    addCollapseAllCtrl(f);
    // Distinguishes top-level layer folders from nested transform/mod/animate
    // folders, which share the same Tweakpane folder styling otherwise.
    f.element.querySelector('.tp-fldv_b')?.classList.add('hydra-layer-title');

    // Visibility toggle
    f.addBinding(layer, 'visible', { label: 'Visible' }).on('change', onChange);

    // Layer controls
    const controls = f.addFolder({ title: 'Layer', expanded: true });
    controls.addButton({ title: '⧉ Duplicate' }).on('click', () => {
      duplicateLayer(layer.id);
      rebuild();
    });
    if (!atFront) {
      controls.addButton({ title: '▲ Move Up' }).on('click', () => {
        moveLayer(layer.id, 1);
        rebuild();
      });
    }
    if (!isBase) {
      controls.addButton({ title: '▼ Move Down' }).on('click', () => {
        moveLayer(layer.id, -1);
        rebuild();
      });
    }
    controls.addButton({ title: '✕ Remove' }).on('click', () => {
      removeLayer(layer.id);
      rebuild();
    });

    // Blend + opacity (not relevant for the base layer)
    if (!isBase) {
      const blendOptions = Object.fromEntries(
        Object.entries(BLEND_MODES).map(([k, v]) => [v, k])
      );
      f.addBinding(layer, 'blendMode', { label: 'Blend', options: blendOptions })
        .on('change', onChange);
      f.addBinding(layer, 'opacity', { label: 'Opacity', min: 0, max: 1 })
        .on('change', onChange);
    }

    // Type-specific media controls
    if (layer.type === 'img')   addImageDropZone(f, layer);
    if (layer.type === 'glsl')  addGlslEditor(f, layer);
    if (layer.type === 'three') addThreeEditor(f, layer);

    // Type-specific params
    LAYER_TYPES[layer.type].params.forEach(p => {
      if (p.hidden) return;
      const opts = { label: p.label, min: p.min, max: p.max };
      if (p.step) opts.step = p.step;
      // Size/X/Y are part of each text-bank entry's style — keep the active
      // entry in sync so switching entries brings them back correctly.
      const isTextBankStyleParam = layer.type === 'text' && TEXT_BANK_STYLE_KEYS.includes(p.key);
      f.addBinding(layer.params, p.key, opts).on('change', () => {
        if (isTextBankStyleParam) layer.textBank[layer.textBankIndex][p.key] = layer.params[p.key];
        onChange();
      });
    });

    // ── Transforms ────────────────────────────────────────────
    const transformTypeOptions = Object.fromEntries(
      Object.entries(TRANSFORM_TYPES).map(([k, v]) => [v.label, k])
    );

    layer.transforms.forEach((transform, tIdx) => {
      const tDef = TRANSFORM_TYPES[transform.type];
      const tFolder = f.addFolder({ title: tDef.label, expanded: transform._expanded });
      tFolder.on('fold', (ev) => { transform._expanded = ev.expanded; save(); });

      tFolder.addBinding(transform, 'type', { label: 'Type', options: transformTypeOptions })
        .on('change', (ev) => {
          transform._expanded = true;
          const newDef = TRANSFORM_TYPES[ev.value];
          transform.params = {};
          newDef.params.forEach(p => { transform.params[p.key] = p.default; });
          transform.animate = createTransformAnimate(ev.value);
          rebuild();
        });

      tDef.params.forEach(p => {
        const anim = transform.animate[p.key];
        if (!anim.enabled) {
          const opts = { label: p.label, min: p.min, max: p.max };
          if (p.step) opts.step = p.step;
          tFolder.addBinding(transform.params, p.key, opts).on('change', onChange);
        }
        const animTitle = tDef.params.length > 1 ? `Animate ${p.label}` : 'Animate';
        const tAnimFolder = tFolder.addFolder({ title: animTitle, expanded: anim._expanded });
        tAnimFolder.on('fold', (ev) => { anim._expanded = ev.expanded; save(); });
        tAnimFolder.addBinding(anim, 'enabled', { label: 'Enable' })
          .on('change', () => { transform._expanded = true; anim._expanded = true; rebuild(); });
        if (anim.enabled) {
          const step = p.step ?? 0.01;
          tAnimFolder.addBinding(anim, 'min', { label: 'Min', min: p.min, max: p.max, step })
            .on('change', onChange);
          tAnimFolder.addBinding(anim, 'max', { label: 'Max', min: p.min, max: p.max, step })
            .on('change', onChange);
          tAnimFolder.addBinding(anim, 'mode', {
            label: 'Mode', options: { 'Ramp': 'loop', 'Sine': 'sin', 'Tangent': 'tan', 'Square': 'square', 'Random': 'random', 'Audio': 'audio', 'Bezier': 'bezier', 'Steps': 'steps' },
          }).on('change', () => { anim._expanded = true; rebuild(); });
          if (anim.mode === 'audio') {
            tAnimFolder.addBinding(anim, 'band', {
              label: 'Band', options: { 'Bass': 0, 'Low Mid': 1, 'High Mid': 2, 'Treble': 3 },
            }).on('change', onChange);
          } else {
            tAnimFolder.addBinding(anim, 'speed', { label: 'Speed', min: 0.01, max: 5, step: 0.01 })
              .on('change', onChange);
          }
          if (anim.mode === 'bezier') {
            buildBezierEditor(anim, tAnimFolder.element, onChange);
          }
          if (anim.mode === 'steps') {
            buildStepsEditor(anim, tAnimFolder.element, onChange);
          }
        }
      });

      tFolder.addButton({ title: '✕ Remove' }).on('click', () => {
        layer.transforms.splice(tIdx, 1);
        rebuild();
      });
    });

    f.addButton({ title: '+ Add Transform' }).on('click', () => {
      layer.transforms.push(createTransform('rotate'));
      rebuild();
    });

    // ── Modulations ───────────────────────────────────────────
    const fnOptions = Object.fromEntries(
      Object.entries(MOD_FNS).map(([k, v]) => [v.label, k])
    );
    const srcOptions = Object.fromEntries(
      MOD_SOURCES.map(k => [LAYER_TYPES[k].label, k])
    );

    layer.mods.forEach((mod, modIdx) => {
      const modFolder = f.addFolder({ title: `Mod ${modIdx + 1}: ${MOD_FNS[mod.fn]?.label ?? mod.fn}`, expanded: mod._expanded });
      modFolder.on('fold', (ev) => { mod._expanded = ev.expanded; save(); });

      modFolder.addBinding(mod, 'enabled', { label: 'Enable' }).on('change', onChange);

      modFolder.addBinding(mod, 'fn', { label: 'Type', options: fnOptions })
        .on('change', (ev) => {
          mod._expanded = true;
          const cfg = MOD_FNS[ev.value];
          mod.animate.min = cfg.min;
          mod.animate.max = cfg.max;
          rebuild();
        });

      modFolder.addBinding(mod, 'src', { label: 'Source', options: srcOptions })
        .on('change', (ev) => {
          mod._expanded = true;
          resetModSrcParams(mod, ev.value);
          rebuild();
        });

      const fnCfg = MOD_FNS[mod.fn];
      if (!mod.animate.enabled) {
        modFolder.addBinding(mod, 'amount', {
          label: 'Amount', min: fnCfg.min, max: fnCfg.max, step: fnCfg.step,
        }).on('change', onChange);
      }

      const animFolder = modFolder.addFolder({ title: 'Animate', expanded: mod.animate._expanded });
      animFolder.on('fold', (ev) => { mod.animate._expanded = ev.expanded; save(); });
      animFolder.addBinding(mod.animate, 'enabled', { label: 'Enable' })
        .on('change', () => { mod._expanded = true; mod.animate._expanded = true; rebuild(); });
      if (mod.animate.enabled) {
        animFolder.addBinding(mod.animate, 'min', { label: 'Min', min: fnCfg.min, max: fnCfg.max, step: fnCfg.step })
          .on('change', onChange);
        animFolder.addBinding(mod.animate, 'max', { label: 'Max', min: fnCfg.min, max: fnCfg.max, step: fnCfg.step })
          .on('change', onChange);
        animFolder.addBinding(mod.animate, 'mode', {
          label: 'Mode', options: { 'Ramp': 'loop', 'Sine': 'sin', 'Tangent': 'tan', 'Square': 'square', 'Random': 'random', 'Audio': 'audio', 'Bezier': 'bezier', 'Steps': 'steps' },
        }).on('change', () => { mod.animate._expanded = true; rebuild(); });
        if (mod.animate.mode === 'audio') {
          animFolder.addBinding(mod.animate, 'band', {
            label: 'Band', options: { 'Bass': 0, 'Low Mid': 1, 'High Mid': 2, 'Treble': 3 },
          }).on('change', onChange);
        } else {
          animFolder.addBinding(mod.animate, 'speed', { label: 'Speed', min: 0.01, max: 5, step: 0.01 })
            .on('change', onChange);
        }
        if (mod.animate.mode === 'bezier') {
          buildBezierEditor(mod.animate, animFolder.element, onChange);
        }
        if (mod.animate.mode === 'steps') {
          buildStepsEditor(mod.animate, animFolder.element, onChange);
        }
      }

      LAYER_TYPES[mod.src].params.forEach(p => {
        const opts = { label: p.label, min: p.min, max: p.max };
        if (p.step) opts.step = p.step;
        modFolder.addBinding(mod.srcParams, p.key, opts).on('change', onChange);
      });

      modFolder.addButton({ title: '✕ Remove Mod' }).on('click', () => {
        layer.mods.splice(modIdx, 1);
        rebuild();
      });
    });

    f.addButton({ title: '+ Add Modulation' }).on('click', () => {
      layer.mods.push(createMod());
      rebuild();
    });

    // Build text controls last (every other blade for this layer must already
    // exist — see the comment in addTextControls), then move the whole thing
    // to sit right below Visible, above the Layer controls folder.
    if (layer.type === 'text') {
      const textControls = addTextControls(f, layer);
      controls.element.before(textControls);
    }
  });

  requestAnimationFrame(() => { if (uiContainer) uiContainer.scrollTop = scrollTop; });
}
