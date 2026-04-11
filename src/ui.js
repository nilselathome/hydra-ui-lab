import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';
import { LAYER_TYPES, BLEND_MODES, MOD_SOURCES, MOD_FNS, TRANSFORM_TYPES } from './layerDefs.js';
import { getLayers, addLayer, removeLayer, moveLayer, createMod, resetModSrcParams, createTransform, createTransformAnimate, drawTextCanvas, applyState } from './layers.js';
import { render } from './engine.js';
import { saveToUrl, saveSceneToUrl, showWarning, encodeState, deserializeLayers } from './state.js';
import { storeImage } from './imageStore.js';
import * as Audio from './audio.js';

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

function save() {
  const encoded = getLayersEncoded();
  const isSaved = activeSlot !== null && _cleanEncoded !== null && encoded === _cleanEncoded;
  if (isSaved) {
    saveSceneToUrl(activeSlot);
  } else {
    saveToUrl(getLayers(), { addPane: addPaneExpanded, audioPane: audioPaneExpanded, layersPane: layersPaneExpanded, scenesPane: scenesPaneExpanded });
  }
  refreshSaveBtn();
}

function refreshSaveBtn() {
  if (!_saveSceneBtn) return;
  const dirty = _cleanEncoded !== null && getLayersEncoded() !== _cleanEncoded;
  if (dirty) {
    _saveSceneBtn.style.background   = 'rgba(255,150,40,0.3)';
    _saveSceneBtn.style.borderColor  = 'rgba(255,150,40,0.7)';
    _saveSceneBtn.style.color        = 'rgba(255,190,80,0.95)';
  } else {
    _saveSceneBtn.style.background   = '';
    _saveSceneBtn.style.borderColor  = '';
    _saveSceneBtn.style.color        = '';
  }
}

// ── Scene slots ────────────────────────────────────────────────────────────────
const SCENE_COUNT = 16;
const SCENE_KEY   = (n) => `hydra-scene-${n}`;
let activeSlot    = null;   // slot index (0-based), or null
let _sceneButtons = [];     // DOM button elements, index === slot
let _saveSceneBtn  = null;
let _clearSceneBtn = null;
let _pasteSceneBtn = null;
let _clipboard     = null;
let _cleanEncoded  = null; // encoded state at last load/save — used to detect unsaved changes

function getLayersEncoded() {
  // Store layer data only (no UI pane state) so comparisons aren't thrown off by fold changes
  return encodeState(getLayers(), {});
}

function decodeStoredScene(raw) {
  try {
    const payload = JSON.parse(decodeURIComponent(atob(raw)));
    return Array.isArray(payload) ? { layers: payload } : payload;
  } catch {
    return null;
  }
}

function applySlotStyle(btn, filled, active) {
  const base = 'width:100%;border-radius:2px;cursor:pointer;font-size:9px;font-family:inherit;font-weight:bold;padding:5px 0;border:1px solid;transition:background 0.15s,border-color 0.15s,color 0.15s;';
  if (active) {
    btn.style.cssText = base + 'background:rgba(100,200,120,0.3);border-color:rgba(100,200,120,0.7);color:rgba(140,230,160,0.95)';
  } else if (filled) {
    btn.style.cssText = base + 'background:rgba(100,160,255,0.15);border-color:rgba(100,160,255,0.4);color:rgba(140,190,255,0.9)';
  } else {
    btn.style.cssText = base + 'background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.1);color:rgba(255,255,255,0.25)';
  }
}

function refreshSceneButtons() {
  _sceneButtons.forEach((btn, slot) => {
    const filled = localStorage.getItem(SCENE_KEY(slot)) !== null;
    applySlotStyle(btn, filled, activeSlot === slot);
  });
  const label = activeSlot !== null ? ` ${activeSlot + 1}` : '';
  if (_saveSceneBtn)  _saveSceneBtn.textContent  = `Save${label}`;
  if (_clearSceneBtn) _clearSceneBtn.textContent = `Clear${label}`;
  if (_pasteSceneBtn) {
    const hasClip = _clipboard !== null;
    _pasteSceneBtn.style.opacity = hasClip ? '1' : '0.35';
    _pasteSceneBtn.style.cursor  = hasClip ? 'pointer' : 'default';
  }
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
    localStorage.removeItem(SCENE_KEY(currentSlot));
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

function initScenesPane(container, uiState = {}, initialSceneSlot = null) {
  scenesPaneExpanded = uiState.scenesPane ?? true;
  const pane = new Pane({ container, title: 'Scenes', expanded: scenesPaneExpanded });
  pane.element.style.marginBottom = '1rem';
  pane.on('fold', (ev) => { scenesPaneExpanded = ev.expanded; save(); });

  const contextMenu = createSceneContextMenu();

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,1fr);gap:3px;padding:6px 4px 4px';

  _sceneButtons = [];

  for (let slot = 0; slot < SCENE_COUNT; slot++) {
    const btn    = document.createElement('button');
    btn.textContent = String(slot + 1); // display 1-16, index 0-15
    const filled = localStorage.getItem(SCENE_KEY(slot)) !== null;
    applySlotStyle(btn, filled, false);

    btn.addEventListener('click', () => {
      if (activeSlot === slot) return; // already active, nothing to do

      const dirty = _cleanEncoded !== null && getLayersEncoded() !== _cleanEncoded;

      const stored = localStorage.getItem(SCENE_KEY(slot));
      if (stored) {
        if (dirty && !confirm('Discard unsaved changes?')) return;
        const data = decodeStoredScene(stored);
        if (!data) { showWarning(`Scene ${slot + 1} could not be loaded.`); return; }
        applyState(deserializeLayers(data.layers ?? data));
      } else if (dirty) {
        // Empty slot + unsaved changes → save current scene here instead of blanking
        const encoded = getLayersEncoded();
        localStorage.setItem(SCENE_KEY(slot), encoded);
      } else {
        applyState([]); // empty slot, nothing dirty → blank canvas
      }

      activeSlot = slot;
      rebuild();
      _cleanEncoded = getLayersEncoded();
      refreshSceneButtons();
      refreshSaveBtn();
    });

    btn.addEventListener('contextmenu', (e) => {
      if (!localStorage.getItem(SCENE_KEY(slot))) return; // nothing to do on empty slots
      e.preventDefault();
      contextMenu.show(slot, e.clientX, e.clientY);
    });

    _sceneButtons.push(btn);
    grid.appendChild(btn);
  }

  // Inject grid into the pane's collapsible content area
  const content = pane.element.querySelector('.tp-rotv_c') ?? pane.element;
  content.appendChild(grid);

  activeSlot = initialSceneSlot ?? 0;
  if (initialSceneSlot !== null) _cleanEncoded = getLayersEncoded();
  refreshSceneButtons();

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
  clearBtn.textContent = 'Clear localStorage';
  clearBtn.style.cssText = btnBaseStyle;
  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all saved scenes? This cannot be undone.')) return;
    for (let i = 0; i < SCENE_COUNT; i++) localStorage.removeItem(SCENE_KEY(i));
    activeSlot = 0;
    refreshSceneButtons();
  });

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset all';
  resetBtn.style.cssText = btnBaseStyle;
  resetBtn.addEventListener('click', () => {
    for (let i = 0; i < SCENE_COUNT; i++) localStorage.removeItem(SCENE_KEY(i));
    history.replaceState(null, '', location.pathname);
    location.reload();
  });

  btnRow1.appendChild(clearBtn);
  btnRow1.appendChild(resetBtn);

  // Row 2: per-scene actions
  const btnRow2 = document.createElement('div');
  btnRow2.style.cssText = btnRowStyle;

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.style.cssText = btnBaseStyle;
  copyBtn.addEventListener('click', () => {
    _clipboard = getLayersEncoded();
    refreshSceneButtons();
  });

  _pasteSceneBtn = document.createElement('button');
  _pasteSceneBtn.textContent = 'Paste';
  _pasteSceneBtn.style.cssText = btnBaseStyle;
  _pasteSceneBtn.addEventListener('click', () => {
    if (!_clipboard) return;
    if (getLayers().length > 0 && !confirm('Are you sure?')) return;
    const data = decodeStoredScene(_clipboard);
    if (!data) return;
    applyState(deserializeLayers(data.layers ?? data));
    rebuild();
    refreshSceneButtons();
  });

  _saveSceneBtn = document.createElement('button');
  _saveSceneBtn.style.cssText = btnBaseStyle;
  _saveSceneBtn.addEventListener('click', () => {
    if (activeSlot === null) return;
    const encoded = getLayersEncoded();
    localStorage.setItem(SCENE_KEY(activeSlot), encoded);
    _cleanEncoded = encoded;
    refreshSceneButtons();
    refreshSaveBtn();
    saveSceneToUrl(activeSlot);
  });

  _clearSceneBtn = document.createElement('button');
  _clearSceneBtn.style.cssText = btnBaseStyle;
  _clearSceneBtn.addEventListener('click', () => {
    if (activeSlot === null) return;
    if (!confirm('Are you sure?')) return;
    localStorage.removeItem(SCENE_KEY(activeSlot));
    applyState([]);
    rebuild();
    _cleanEncoded = getLayersEncoded();
    refreshSceneButtons();
    refreshSaveBtn();
  });

  btnRow2.appendChild(copyBtn);
  btnRow2.appendChild(_pasteSceneBtn);
  btnRow2.appendChild(_saveSceneBtn);
  btnRow2.appendChild(_clearSceneBtn);

  content.appendChild(btnRow1);
  content.appendChild(btnRow2);
  refreshSceneButtons(); // set initial labels
}

export function initUI(container, uiState = {}, initialSceneSlot = null) {
  uiContainer = container;
  addPaneExpanded    = uiState.addPane    ?? true;
  layersPaneExpanded = uiState.layersPane ?? true;

  initAudioPane(container, uiState);

  initScenesPane(container, uiState, initialSceneSlot);

  addPane = new Pane({ container, title: 'Add Layer', expanded: addPaneExpanded });
  addPane.element.style.marginBottom = '1rem';
  addPane.on('fold', (ev) => { addPaneExpanded = ev.expanded; save(); });
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

  pane.addButton({ title: 'Mic' }).on('click', () => runAsync(Audio.connectMic));
  pane.addButton({ title: 'Tab / Screen audio' }).on('click', () => runAsync(Audio.connectTab));
  pane.addButton({ title: 'Stop' }).on('click', () => Audio.stop());

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
  ejectBtn.addEventListener('click', () => Audio.ejectFile());
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

  setBtnA.addEventListener('click',  () => Audio.setLoopA());
  setBtnB.addEventListener('click',  () => Audio.setLoopB());
  clearBtn.addEventListener('click', () => Audio.clearLoop());

  // ── Callbacks ──────────────────────────────────────────────────────────────
  Audio.setStatusCallback((st, label) => {
    if (st === 'file' || st === 'file-paused') {
      zone.style.display = 'none';
      controls.style.display = 'flex';
    } else {
      zone.style.display = '';
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
  const applyUrl = () => {
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
    layer._hydraSource.initImage(url);
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

function addTextControls(folder, layer) {
  const content = folder.element.querySelector('.tp-fldv_c') ?? folder.element;

  const sharedInputStyle = `
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 2px; color: #fff; font-size: 10px; font-family: inherit;
    padding: 4px 6px; outline: none;
  `;

  // Text content input
  const textRow = document.createElement('div');
  textRow.style.cssText = 'display:flex; gap:4px; margin: 4px 4px 0;';
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.placeholder = 'Enter text…';
  textInput.value = layer.textContent ?? '';
  textInput.style.cssText = `flex: 1; ${sharedInputStyle}`;
  textInput.addEventListener('input', async () => {
    layer.textContent = textInput.value;
    await drawTextCanvas(layer);
    render(getLayers());
    save();
  });
  textRow.appendChild(textInput);
  content.appendChild(textRow);

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
    await drawTextCanvas(layer);
    render(getLayers());
    save();
  });
  fontRow.append(fontLabel, fontSelect);
  content.appendChild(fontRow);
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

    // Visibility toggle
    f.addBinding(layer, 'visible', { label: 'Visible' }).on('change', onChange);

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
    if (layer.type === 'img')  addImageDropZone(f, layer);
    if (layer.type === 'text') addTextControls(f, layer);

    // Type-specific params
    LAYER_TYPES[layer.type].params.forEach(p => {
      const opts = { label: p.label, min: p.min, max: p.max };
      if (p.step) opts.step = p.step;
      f.addBinding(layer.params, p.key, opts).on('change', onChange);
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
            label: 'Mode', options: { 'Ramp': 'loop', 'Sine': 'sin', 'Tangent': 'tan', 'Square': 'square', 'Random': 'random', 'Audio': 'audio', 'Bezier': 'bezier' },
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
      const modFolder = f.addFolder({ title: `Mod ${modIdx + 1}`, expanded: mod._expanded });
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
          label: 'Mode', options: { 'Ramp': 'loop', 'Sine': 'sin', 'Tangent': 'tan', 'Square': 'square', 'Random': 'random', 'Audio': 'audio', 'Bezier': 'bezier' },
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

    // Layer controls
    const controls = f.addFolder({ title: 'Layer', expanded: true });
    if (!atFront) {
      controls.addButton({ title: '▲ Move Forward' }).on('click', () => {
        moveLayer(layer.id, 1);
        rebuild();
      });
    }
    if (!isBase) {
      controls.addButton({ title: '▼ Move Back' }).on('click', () => {
        moveLayer(layer.id, -1);
        rebuild();
      });
    }
    controls.addButton({ title: '✕ Remove' }).on('click', () => {
      removeLayer(layer.id);
      rebuild();
    });
  });

  requestAnimationFrame(() => { if (uiContainer) uiContainer.scrollTop = scrollTop; });
}
