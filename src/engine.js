import { LAYER_TYPES, MOD_FNS, TRANSFORM_TYPES } from './layerDefs.js';

function animatedValue(animate, min, max) {
  const range = max - min;
  if (animate.mode === 'audio')
    return () => min + (a.fft[animate.band ?? 0] ?? 0) * range;
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
  const visible = layers.filter(l => l.visible);
  if (visible.length === 0) { solid(0, 0, 0).out(o0); return; }

  // Composite all layers inline — no intermediate output buffers needed.
  // Each buildLayer() returns a Hydra chain node; compositing them directly
  // compiles to a single GLSL shader pass, removing the o1-o3 buffer limit.
  let composite = buildLayer(visible[0]);
  for (let i = 1; i < visible.length; i++) {
    const layer = visible[i];
    composite = composite[layer.blendMode](buildLayer(visible[i]), layer.opacity);
  }
  composite.out(o0);
}
