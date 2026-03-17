import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';
import { LAYER_TYPES, BLEND_MODES, MOD_SOURCES, MOD_FNS } from './layerDefs.js';
import { getLayers, addLayer, removeLayer, moveLayer, resetModSrcParams } from './layers.js';
import { render } from './engine.js';

let pane = null;

export function initUI(container) {
  pane = new Pane({ container });
  buildUI();
}

function onChange() {
  render(getLayers());
}

function rebuild() {
  buildUI();
  render(getLayers());
}

function buildUI() {
  // Clear all existing pane children
  while (pane.children.length > 0) {
    pane.remove(pane.children[0]);
  }

  // ── Add Layer ──────────────────────────────────────────────
  const addFolder = pane.addFolder({ title: 'Add Layer', expanded: true });
  Object.entries(LAYER_TYPES).forEach(([type, def]) => {
    addFolder.addButton({ title: def.label }).on('click', () => {
      addLayer(type);
      rebuild();
    });
  });

  // ── Layer list (Photoshop order: top of panel = front of stack) ──
  const layers = getLayers();
  const displayOrder = [...layers].reverse(); // index 0 = front (last rendered)

  displayOrder.forEach((layer) => {
    const arrayIdx = layers.indexOf(layer);
    const isBase = arrayIdx === 0;
    const atFront = arrayIdx === layers.length - 1;

    const f = pane.addFolder({ title: layer.name, expanded: true });

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

    // Type-specific params
    LAYER_TYPES[layer.type].params.forEach(p => {
      const opts = { label: p.label, min: p.min, max: p.max };
      if (p.step) opts.step = p.step;
      f.addBinding(layer.params, p.key, opts).on('change', onChange);
    });

    // ── Modulate ──────────────────────────────────────────────
    const modFolder = f.addFolder({ title: 'Modulate', expanded: layer.mod._expanded });
    modFolder.on('fold', (ev) => { layer.mod._expanded = ev.expanded; });

    modFolder.addBinding(layer.mod, 'enabled', { label: 'Enable' }).on('change', onChange);

    const fnOptions = Object.fromEntries(
      Object.entries(MOD_FNS).map(([k, v]) => [v.label, k])
    );
    modFolder.addBinding(layer.mod, 'fn', { label: 'Type', options: fnOptions })
      .on('change', () => {
        layer.mod._expanded = true;
        rebuild();
      });

    const srcOptions = Object.fromEntries(
      MOD_SOURCES.map(k => [LAYER_TYPES[k].label, k])
    );
    modFolder.addBinding(layer.mod, 'src', { label: 'Source', options: srcOptions })
      .on('change', (ev) => {
        layer.mod._expanded = true;
        resetModSrcParams(layer, ev.value);
        rebuild();
      });

    const fnCfg = MOD_FNS[layer.mod.fn];
    modFolder.addBinding(layer.mod, 'amount', {
      label: 'Amount', min: fnCfg.min, max: fnCfg.max, step: fnCfg.step,
    }).on('change', onChange);

    LAYER_TYPES[layer.mod.src].params.forEach(p => {
      const opts = { label: p.label, min: p.min, max: p.max };
      if (p.step) opts.step = p.step;
      modFolder.addBinding(layer.mod.srcParams, p.key, opts).on('change', onChange);
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
      controls.addButton({ title: '✕ Remove' }).on('click', () => {
        removeLayer(layer.id);
        rebuild();
      });
    }
  });
}
