import { getLayers, applyState } from './layers.js';
import { render } from './engine.js';
import { initUI } from './ui.js';
import { loadFromUrl, deserializeLayers } from './state.js';

const canvas = document.getElementById('hydraCanvas');

// makeGlobal: true injects osc, shape, voronoi, noise, gradient, src, o0-o3, etc. into window
new Hydra({ canvas, detectAudio: false, makeGlobal: true });

// Hydra needs a tick before the GL context is ready to accept chains
setTimeout(() => {
  const savedData = loadFromUrl();
  if (savedData) applyState(deserializeLayers(savedData));

  initUI(document.getElementById('ui'));
  render(getLayers());
}, 500);
