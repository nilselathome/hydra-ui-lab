import { LAYER_TYPES, MOD_FNS, TRANSFORM_TYPES } from './layerDefs.js';

// o0 is reserved for the final composite (it's what the canvas displays by default).
// Layers render into o1-o3 so the composite never reads its own output (no feedback loop).
export const MAX_LAYERS = 3;

const getLayerOutputs = () => [o1, o2, o3];

function animatedValue(animate, min, max) {
  const range = max - min;
  if (animate.mode === 'sin')
    return () => min + (Math.sin(time * animate.speed) * 0.5 + 0.5) * range;
  return () => min + ((time * animate.speed) % range);
}

function buildTransform(node, transform) {
  const def = TRANSFORM_TYPES[transform.type];
  const p = { ...transform.params };
  def.params.forEach(param => {
    const anim = transform.animate[param.key];
    if (anim?.enabled) p[param.key] = animatedValue(anim, anim.min, anim.max);
  });
  return def.build(node, p);
}

function modAmount(mod) {
  if (!mod.animate.enabled) return mod.amount;
  return animatedValue(mod.animate, mod.animate.min, mod.animate.max);
}

function buildLayer(layer) {
  let node = LAYER_TYPES[layer.type].build(layer.params, layer);
  for (const t of layer.transforms) {
    node = buildTransform(node, t);
  }
  for (const m of layer.mods) {
    if (m.enabled) {
      node = node[m.fn](LAYER_TYPES[m.src].build(m.srcParams), modAmount(m));
    }
  }
  return node;
}

export function render(layers) {
  const visible = layers.filter(l => l.visible).slice(0, MAX_LAYERS);
  if (visible.length === 0) return;

  const outs = getLayerOutputs();

  // Render each layer into its own buffer (o1-o3)
  visible.forEach((layer, i) => {
    buildLayer(layer).out(outs[i]);
  });

  // Composite bottom → top, write to o0 (canvas)
  let composite = src(outs[0]);
  for (let i = 1; i < visible.length; i++) {
    const layer = visible[i];
    composite = composite[layer.blendMode](src(outs[i]), layer.opacity);
  }
  composite.out(o0);
}
