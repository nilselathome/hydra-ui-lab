import { LAYER_TYPES } from './layerDefs.js';

// Hydra only has 4 output buffers. Visible layers beyond 4 are silently ignored.
const MAX_LAYERS = 4;

// o0-o3 are Hydra globals injected after new Hydra({ makeGlobal: true })
const getOutputs = () => [o0, o1, o2, o3];

export function render(layers) {
  const visible = layers.filter(l => l.visible).slice(0, MAX_LAYERS);
  if (visible.length === 0) return;

  // Single layer: render directly to screen, no buffer needed
  if (visible.length === 1) {
    LAYER_TYPES[visible[0].type].build(visible[0].params).out();
    return;
  }

  const outs = getOutputs();

  // Render each layer into its own output buffer
  visible.forEach((layer, i) => {
    LAYER_TYPES[layer.type].build(layer.params).out(outs[i]);
  });

  // Composite bottom → top
  let composite = src(outs[0]);
  for (let i = 1; i < visible.length; i++) {
    const layer = visible[i];
    composite = composite[layer.blendMode](src(outs[i]), layer.opacity);
  }
  composite.out();
}
