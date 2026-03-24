import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';
import { LAYER_TYPES, BLEND_MODES, MOD_SOURCES, MOD_FNS, TRANSFORM_TYPES } from './layerDefs.js';
import { getLayers, addLayer, removeLayer, moveLayer, createMod, resetModSrcParams, createTransform, createTransformAnimate } from './layers.js';
import { render, MAX_LAYERS } from './engine.js';
import { saveToUrl, showWarning } from './state.js';
import * as Audio from './audio.js';

function formatTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

let addPane = null;
let layersPane = null;
let addButtons = [];
let uiContainer = null;
let addPaneExpanded   = true;
let audioPaneExpanded = true;
let layersPaneExpanded = true;

function save() {
  saveToUrl(getLayers(), { addPane: addPaneExpanded, audioPane: audioPaneExpanded, layersPane: layersPaneExpanded });
}

export function initUI(container, uiState = {}) {
  uiContainer = container;
  addPaneExpanded    = uiState.addPane    ?? true;
  layersPaneExpanded = uiState.layersPane ?? true;

  addPane = new Pane({ container, title: 'Add Layer', expanded: addPaneExpanded });
  addPane.on('fold', (ev) => { addPaneExpanded = ev.expanded; save(); });
  addButtons = [];
  Object.entries(LAYER_TYPES).forEach(([type, def]) => {
    if (def.noLayer) return;
    const btn = addPane.addButton({ title: def.shortLabel ?? def.label }).on('click', () => {
      addLayer(type);
      rebuild();
    });
    addButtons.push(btn);
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

  initAudioPane(container, uiState);

  layersPane = new Pane({ container, title: 'Layers', expanded: layersPaneExpanded });
  layersPane.element.style.marginTop = '1rem';
  layersPane.on('fold', (ev) => { layersPaneExpanded = ev.expanded; save(); });
  buildLayersUI();
}

function initAudioPane(container, uiState = {}) {
  audioPaneExpanded = uiState.audioPane ?? true;
  const pane = new Pane({ container, title: 'Audio', expanded: audioPaneExpanded });
  pane.element.style.marginTop = '1rem';
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
  zone.textContent = layer._hydraSource ? '↓ Drop image or click to browse' : '⚠ No source slots available';

  if (!layer._hydraSource) { content.appendChild(zone); return; }

  // URL input
  const urlRow = document.createElement('div');
  urlRow.style.cssText = 'display:flex; gap:4px; margin: 4px 4px 0;';
  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.placeholder = 'https://image-url…';
  urlInput.value = layer.imgUrl || '';
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
    layer.imgUrl = url;
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

  const loadFile = (file) => {
    if (!file?.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    layer._hydraSource.initImage(url);
    zone.textContent = `✓ ${file.name}`;
    render(getLayers());
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

function updateAddButtons() {
  const atLimit = getLayers().length >= MAX_LAYERS;
  addButtons.forEach(btn => { btn.disabled = atLimit; });
}

function onChange() {
  render(getLayers());
  save();
}

function rebuild() {
  buildLayersUI();
  updateAddButtons();
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

    // Image drop zone
    if (layer.type === 'img') addImageDropZone(f, layer);

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
            label: 'Mode', options: { 'Ramp': 'loop', 'Sine': 'sin', 'Audio': 'audio' },
          }).on('change', () => { anim._expanded = true; rebuild(); });
          if (anim.mode === 'audio') {
            tAnimFolder.addBinding(anim, 'band', {
              label: 'Band', options: { 'Bass': 0, 'Low Mid': 1, 'High Mid': 2, 'Treble': 3 },
            }).on('change', onChange);
          } else {
            tAnimFolder.addBinding(anim, 'speed', { label: 'Speed', min: 0.01, max: 5, step: 0.01 })
              .on('change', onChange);
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
          label: 'Mode', options: { 'Ramp': 'loop', 'Sine': 'sin', 'Audio': 'audio' },
        }).on('change', () => { mod.animate._expanded = true; rebuild(); });
        if (mod.animate.mode === 'audio') {
          animFolder.addBinding(mod.animate, 'band', {
            label: 'Band', options: { 'Bass': 0, 'Low Mid': 1, 'High Mid': 2, 'Treble': 3 },
          }).on('change', onChange);
        } else {
          animFolder.addBinding(mod.animate, 'speed', { label: 'Speed', min: 0.01, max: 5, step: 0.01 })
            .on('change', onChange);
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
