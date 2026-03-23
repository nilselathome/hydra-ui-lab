import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';
import { LAYER_TYPES, BLEND_MODES, MOD_SOURCES, MOD_FNS, TRANSFORM_TYPES } from './layerDefs.js';
import { getLayers, addLayer, removeLayer, moveLayer, createMod, resetModSrcParams, createTransform, createTransformAnimate } from './layers.js';
import { render } from './engine.js';
import { saveToUrl, showWarning } from './state.js';

let addPane = null;
let layersPane = null;
let uiContainer = null;

export function initUI(container) {
  uiContainer = container;
  addPane = new Pane({ container, title: 'Add Layer' });
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

  layersPane = new Pane({ container, title: 'Layers' });
  buildLayersUI();
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
    saveToUrl(getLayers());
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

function onChange() {
  render(getLayers());
  saveToUrl(getLayers());
}

function rebuild() {
  buildLayersUI();
  render(getLayers());
  saveToUrl(getLayers());
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
    f.on('fold', (ev) => { layer._expanded = ev.expanded; });

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
      tFolder.on('fold', (ev) => { transform._expanded = ev.expanded; });

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
        tAnimFolder.on('fold', (ev) => { anim._expanded = ev.expanded; });
        tAnimFolder.addBinding(anim, 'enabled', { label: 'Enable' })
          .on('change', () => { transform._expanded = true; anim._expanded = true; rebuild(); });
        if (anim.enabled) {
          const step = p.step ?? 0.01;
          tAnimFolder.addBinding(anim, 'min', { label: 'Min', min: p.min, max: p.max, step })
            .on('change', onChange);
          tAnimFolder.addBinding(anim, 'max', { label: 'Max', min: p.min, max: p.max, step })
            .on('change', onChange);
          tAnimFolder.addBinding(anim, 'mode', {
            label: 'Mode', options: { 'Ramp': 'loop', 'Sine': 'sin' },
          }).on('change', onChange);
          tAnimFolder.addBinding(anim, 'speed', { label: 'Speed', min: 0.01, max: 5, step: 0.01 })
            .on('change', onChange);
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
      modFolder.on('fold', (ev) => { mod._expanded = ev.expanded; });

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
      animFolder.on('fold', (ev) => { mod.animate._expanded = ev.expanded; });
      animFolder.addBinding(mod.animate, 'enabled', { label: 'Enable' })
        .on('change', () => { mod._expanded = true; mod.animate._expanded = true; rebuild(); });
      if (mod.animate.enabled) {
        animFolder.addBinding(mod.animate, 'min', { label: 'Min', min: fnCfg.min, max: fnCfg.max, step: fnCfg.step })
          .on('change', onChange);
        animFolder.addBinding(mod.animate, 'max', { label: 'Max', min: fnCfg.min, max: fnCfg.max, step: fnCfg.step })
          .on('change', onChange);
        animFolder.addBinding(mod.animate, 'mode', {
          label: 'Mode', options: { 'Loop (0→max)': 'loop', 'Sine (↕)': 'sin' },
        }).on('change', onChange);
        animFolder.addBinding(mod.animate, 'speed', { label: 'Speed', min: 0.01, max: 5, step: 0.01 })
          .on('change', onChange);
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
