import { getLayers, applyState, reloadThree } from './layers.js';
import { render } from './engine.js';
import { initUI } from './ui.js';
import { loadFromUrl, deserializeLayers } from './state.js';

const canvas = document.getElementById('hydraCanvas');
const dpr = window.devicePixelRatio || 1;
canvas.width  = window.innerWidth  * dpr;
canvas.height = window.innerHeight * dpr;

// makeGlobal: true injects osc, shape, voronoi, noise, gradient, src, o0-o3, etc. into window
new Hydra({ canvas, detectAudio: false, makeGlobal: true, pb: true });

// Hydra needs a tick before the GL context is ready to accept chains
setTimeout(async () => {
  const savedData = await loadFromUrl();
  if (savedData) applyState(deserializeLayers(savedData.layers ?? savedData));

  initUI(document.getElementById('ui'), savedData?.ui ?? {}, savedData?.sceneSlot ?? null);
  render(getLayers());

  // Re-evaluate Three.js layers after Hydra has rendered its first frame.
  // Without this, evalThreeCode runs before the canvas has any content — any
  // scene.environment = hydraTexture call produces a black PMREM cube map that
  // Three.js caches and never updates, leaving reflections permanently black.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    getLayers().filter(l => l.type === 'three').forEach(l => {
      if (l._threeScene) l._threeScene.environment = null; // bust stale PMREM
      reloadThree(l);
    });
  }));
}, 500);
