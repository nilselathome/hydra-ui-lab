import { getLayers, applyState, reloadThree } from './layers.js';
import { render } from './engine.js';
import { initUI } from './ui.js';
import { loadFromUrl, deserializeLayers, loadGlobalAudioState } from './state.js';

const canvas = document.getElementById('hydraCanvas');
const dpr = window.devicePixelRatio || 1;
canvas.width  = window.innerWidth  * dpr;
canvas.height = window.innerHeight * dpr;

// makeGlobal: true injects osc, shape, voronoi, noise, gradient, src, o0-o3, etc. into window
new Hydra({ canvas, detectAudio: false, makeGlobal: true, pb: true });

// Hydra needs a tick before the GL context is ready to accept chains
setTimeout(async () => {
  const savedData = await loadFromUrl();
  // #z=/#s= links are self-contained snapshots (may embed audio for sharing).
  // #scene=N and the blank/slot-0 fallback below use global audio instead.
  const isShareLink = savedData != null && savedData.sceneSlot == null;

  // No URL params → load slot 0 from localStorage so scene 1 isn't a blank highlight
  let effectiveData = savedData;
  if (!effectiveData) {
    const raw = localStorage.getItem('hydra-scene-0');
    if (raw) {
      try {
        const payload = JSON.parse(decodeURIComponent(atob(raw)));
        effectiveData = Array.isArray(payload)
          ? { layers: payload, sceneSlot: 0 }
          : { ...payload, sceneSlot: 0 };
      } catch {}
    }
  }

  if (effectiveData) applyState(deserializeLayers(effectiveData.layers ?? effectiveData));

  let uiState = effectiveData?.ui ?? {};
  if (!isShareLink) {
    // Scene slots no longer own audio — ignore any legacy embedded audioTrack/bpm/loop
    // and apply the global audio/tempo state instead.
    const { audioTrack, bpm, loopA, loopB, ...rest } = uiState;
    uiState = { ...rest, ...(loadGlobalAudioState() ?? {}) };
  }

  initUI(document.getElementById('ui'), uiState, effectiveData?.sceneSlot ?? null);
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
