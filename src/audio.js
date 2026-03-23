// Manages audio input and populates window.a.fft for the engine.
// Supports mic, tab/screen capture, and audio file playback.

const BAND_COUNT = 4;

let audioCtx     = null;
let analyser     = null;
let activeStream = null; // MediaStream (mic or tab)
let activeEl     = null; // HTMLAudioElement (file)
let rafId        = null;

// Ensure window.a.fft exists — Hydra may not create it with detectAudio:false
if (!window.a)       window.a      = {};
if (!window.a.fft)   window.a.fft  = Array(BAND_COUNT).fill(0);

export let status = 'none'; // 'none' | 'mic' | 'tab' | 'file'
let onStatusChange = null;
export function setStatusCallback(fn) { onStatusChange = fn; }

const STATUS_LABELS = {
  none: 'No source',
  mic:  'Mic active',
  tab:  'Tab audio active',
};

function getCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function teardown() {
  if (rafId)        { cancelAnimationFrame(rafId); rafId = null; }
  if (analyser)     { analyser.disconnect(); analyser = null; }
  if (activeStream) { activeStream.getTracks().forEach(t => t.stop()); activeStream = null; }
  if (activeEl)     { activeEl.pause(); activeEl.remove(); activeEl = null; }
  window.a.fft.fill(0);
}

function attachAnalyser(sourceNode, smoothing = 0.8) {
  const ctx = getCtx();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = smoothing;
  sourceNode.connect(analyser);

  const data   = new Uint8Array(analyser.frequencyBinCount);
  const stride = Math.floor(data.length / BAND_COUNT);

  function tick() {
    analyser.getByteFrequencyData(data);
    for (let i = 0; i < BAND_COUNT; i++) {
      let sum = 0;
      for (let j = 0; j < stride; j++) sum += data[i * stride + j];
      window.a.fft[i] = sum / (stride * 255);
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function notify(newStatus, label) {
  status = newStatus;
  onStatusChange?.(status, label ?? STATUS_LABELS[status] ?? status);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function connectMic() {
  teardown();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  activeStream = stream;
  attachAnalyser(getCtx().createMediaStreamSource(stream));
  notify('mic');
}

export async function connectTab() {
  teardown();
  // video:true required for the "Share tab audio" checkbox to appear in Chrome
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  stream.getVideoTracks().forEach(t => t.stop());
  if (!stream.getAudioTracks().length) {
    teardown();
    throw new Error('No audio track — make sure to check "Share tab audio" in the picker.');
  }
  activeStream = stream;
  // Listen for the user ending the share via the browser's built-in stop button
  stream.getAudioTracks()[0].addEventListener('ended', () => {
    teardown();
    notify('none');
  });
  attachAnalyser(getCtx().createMediaStreamSource(stream));
  notify('tab');
}

export function connectFile(file) {
  teardown();
  const ctx = getCtx();
  const el  = new Audio();
  el.src    = URL.createObjectURL(file);
  el.loop   = true;
  document.body.appendChild(el);
  activeEl  = el;
  const src = ctx.createMediaElementSource(el);
  src.connect(ctx.destination); // so the user can hear it
  attachAnalyser(src);
  el.play();
  notify('file', `♪ ${file.name}`);
}

export function stop() {
  teardown();
  notify('none');
}

export function setSmoothing(v) {
  if (analyser) analyser.smoothingTimeConstant = Math.max(0, Math.min(1, v));
}
