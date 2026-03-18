import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';
import { LAYER_TYPES, BLEND_MODES, MOD_SOURCES, MOD_FNS } from './layerDefs.js';
import { getLayers, addLayer, removeLayer, moveLayer, createMod, resetModSrcParams } from './layers.js';
import { render } from './engine.js';

let addPane = null;
let layersPane = null;

export function initUI(container) {
  addPane = new Pane({ container, title: 'Add Layer' });
  Object.entries(LAYER_TYPES).forEach(([type, def]) => {
    addPane.addButton({ title: def.label }).on('click', () => {
      addLayer(type);
      rebuild();
    });
  });

  layersPane = new Pane({ container, title: 'Layers' });
  buildLayersUI();
}

function onChange() {
  render(getLayers());
}

function rebuild() {
  buildLayersUI();
  render(getLayers());
}

function buildLayersUI() {
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

    const f = layersPane.addFolder({ title: layer.name, expanded: true });

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
        .on('change', () => { mod._expanded = true; rebuild(); });

      modFolder.addBinding(mod, 'src', { label: 'Source', options: srcOptions })
        .on('change', (ev) => {
          mod._expanded = true;
          resetModSrcParams(mod, ev.value);
          rebuild();
        });

      const fnCfg = MOD_FNS[mod.fn];
      modFolder.addBinding(mod, 'amount', {
        label: 'Amount', min: fnCfg.min, max: fnCfg.max, step: fnCfg.step,
      }).on('change', onChange);

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
}
