import { getLayers, applyState, reloadThree } from './layers.js';
import { render } from './engine.js';
import { initUI } from './ui.js';
import {
  loadFromUrl, deserializeLayers, loadGlobalAudioState,
  loadPresetBank, decodeEncodedScene, sceneKey, getActiveBankId, showWarning,
} from './state.js';

const canvas = document.getElementById('hydraCanvas');
const dpr = window.devicePixelRatio || 1;
canvas.width  = window.innerWidth  * dpr;
canvas.height = window.innerHeight * dpr;

// makeGlobal: true injects osc, shape, voronoi, noise, gradient, src, o0-o3, etc. into window
new Hydra({ canvas, detectAudio: false, makeGlobal: true, pb: true });

// Hydra needs a tick before the GL context is ready to accept chains
setTimeout(async () => {
  // ?preset=name loads a bundled repo bank (public/presets/name.json) as a
  // read-only preview — for showcase/share links that never touch localStorage.
  const presetName = new URLSearchParams(location.search).get('preset');
  let previewPreset = null;
  let effectiveData = null;
  let isShareLink = false;

  if (presetName) {
    try {
      previewPreset = await loadPresetBank(presetName);
      previewPreset.name = previewPreset.name || presetName;
      // ?scene=N (1-based, same numbering as #scene=N) picks a specific scene
      // in the preset; falls back to the first non-empty one.
      const requestedSlot = parseInt(new URLSearchParams(location.search).get('scene'), 10) - 1;
      const targetIdx = previewPreset.scenes[requestedSlot] != null
        ? requestedSlot
        : previewPreset.scenes.findIndex(s => s != null);
      if (targetIdx !== -1) {
        const payload = decodeEncodedScene(previewPreset.scenes[targetIdx]);
        effectiveData = { layers: payload?.layers ?? [], sceneSlot: targetIdx };
      }
    } catch (e) {
      console.error(e);
      showWarning(`Preset "${presetName}" could not be loaded.`);
      previewPreset = null;
    }
  }

  if (!previewPreset) {
    const savedData = await loadFromUrl();
    // #z=/#s= links are self-contained snapshots (may embed audio for sharing).
    // #scene=N and the blank/slot-0 fallback below use global audio instead.
    isShareLink = savedData != null && savedData.sceneSlot == null;
    effectiveData = savedData;

    // No URL params → load slot 0 of the active bank so scene 1 isn't a blank highlight
    if (!effectiveData) {
      const raw = localStorage.getItem(sceneKey(getActiveBankId(), 0));
      if (raw) {
        const payload = decodeEncodedScene(raw);
        effectiveData = payload ? { ...payload, sceneSlot: 0 } : null;
      }
    }
  }

  if (effectiveData) applyState(deserializeLayers(effectiveData.layers ?? effectiveData));

  let uiState = effectiveData?.ui ?? {};
  if (previewPreset) {
    // A bundled preset carries its own soundtrack (see exportBank in state.js) —
    // use that instead of the visitor's own saved audio prefs.
    uiState = previewPreset.audio ?? {};
  } else if (!isShareLink) {
    // Scene slots no longer own audio — ignore any legacy embedded audioTrack/bpm/loop
    // and apply the global audio/tempo state instead.
    const { audioTrack, bpm, loopA, loopB, ...rest } = uiState;
    uiState = { ...rest, ...(loadGlobalAudioState() ?? {}) };
  }

  initUI(document.getElementById('ui'), uiState, effectiveData?.sceneSlot ?? null, previewPreset);
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
