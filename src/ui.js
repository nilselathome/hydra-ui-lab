import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';
import { LAYER_TYPES, BLEND_MODES } from './layerDefs.js';
import { getLayers, addLayer, removeLayer, moveLayer } from './layers.js';
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
