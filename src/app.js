import { addLayer } from './layers.js';
import { render } from './engine.js';
import { initUI } from './ui.js';
import { getLayers } from './layers.js';

const canvas = document.getElementById('hydraCanvas');

// makeGlobal: true injects osc, shape, voronoi, noise, gradient, src, o0-o3, etc. into window
new Hydra({ canvas, detectAudio: false, makeGlobal: true });

// Hydra needs a tick before the GL context is ready to accept chains
setTimeout(() => {
  initUI(document.getElementById('ui'));

  // Start with one oscillator as the base layer
  addLayer('osc');
  render(getLayers());
}, 100);
