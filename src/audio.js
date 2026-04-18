// Manages audio input and populates window.a.fft for the engine.
// Supports mic, tab/screen capture, and audio file playback.

const BAND_COUNT = 4;

let audioCtx     = null;
let analyser     = null;
let activeStream = null; // MediaStream (mic or tab)
let activeEl     = null; // HTMLAudioElement (file)
let rafId        = null;
let currentFile  = null; // File reference — persisted across stop()
let loopA        = null; // A-B loop start time (seconds)
let loopB        = null; // A-B loop end time (seconds)

// Ensure window.a.fft exists — Hydra may not create it with detectAudio:false
if (!window.a)       window.a      = {};
if (!window.a.fft)   window.a.fft  = Array(BAND_COUNT).fill(0);

export let status = 'none'; // 'none' | 'mic' | 'tab' | 'file' | 'file-paused'
let onStatusChange   = null;
let onPlaybackUpdate = null;

export function setStatusCallback(fn)   { onStatusChange   = fn; }
export function setPlaybackCallback(fn) { onPlaybackUpdate = fn; }

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

function teardownAnalyser() {
  if (rafId)    { cancelAnimationFrame(rafId); rafId = null; }
  if (analyser) { analyser.disconnect(); analyser = null; }
  window.a.fft.fill(0);
}

function teardownStream() {
  if (activeStream) { activeStream.getTracks().forEach(t => t.stop()); activeStream = null; }
}

function teardownFile() {
  if (activeEl) { activeEl.pause(); activeEl.src = ''; activeEl.remove(); activeEl = null; }
  currentFile = null;
  loopA = null;
  loopB = null;
}

function teardown() {
  teardownAnalyser();
  teardownStream();
  teardownFile();
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

function notifyPlayback() {
  onPlaybackUpdate?.({
    hasFile:     !!currentFile,
    fileName:    currentFile?.name ?? null,
    currentTime: activeEl?.currentTime ?? 0,
    duration:    isFinite(activeEl?.duration) ? activeEl.duration : 0,
    paused:      activeEl?.paused ?? true,
    loopA,
    loopB,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function connectMic() {
  teardown();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  activeStream = stream;
  attachAnalyser(getCtx().createMediaStreamSource(stream));
  notify('mic');
  notifyPlayback();
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
    notifyPlayback();
  });
  attachAnalyser(getCtx().createMediaStreamSource(stream));
  notify('tab');
  notifyPlayback();
}

export async function connectUrl(url) {
  teardownAnalyser();
  teardownStream();
  teardownFile();

  const ctx = getCtx();
  const el  = new Audio();
  el.crossOrigin = 'anonymous';
  el.src    = url;
  el.loop   = true;
  document.body.appendChild(el);
  activeEl    = el;
  currentFile = { name: url.split('/').pop() || url };

  const source = ctx.createMediaElementSource(el);
  source.connect(ctx.destination);
  attachAnalyser(source);

  el.addEventListener('timeupdate', () => {
    if (loopA !== null && loopB !== null) {
      const a = Math.min(loopA, loopB);
      const b = Math.max(loopA, loopB);
      if (el.currentTime > b) el.currentTime = a;
    }
    notifyPlayback();
  });

  let autoplaySucceeded = false;
  try {
    await el.play();
    autoplaySucceeded = true;
  } catch {
    // autoplay was blocked; user can press play
  }
  notify('file', currentFile.name);
  notifyPlayback();
  return autoplaySucceeded;
}

export async function connectFile(file) {
  teardownAnalyser();
  teardownStream();
  teardownFile();

  const ctx = getCtx();
  const el  = new Audio();
  el.src    = URL.createObjectURL(file);
  el.loop   = true;
  document.body.appendChild(el);
  activeEl    = el;
  currentFile = file;

  const src = ctx.createMediaElementSource(el);
  src.connect(ctx.destination); // so the user can hear it
  attachAnalyser(src);

  // A-B loop enforcement + UI updates
  el.addEventListener('timeupdate', () => {
    if (loopA !== null && loopB !== null) {
      const a = Math.min(loopA, loopB);
      const b = Math.max(loopA, loopB);
      if (el.currentTime > b) el.currentTime = a;
    }
    notifyPlayback();
  });

  let autoplaySucceeded = false;
  try {
    await el.play();
    autoplaySucceeded = true;
  } catch {
    // autoplay was blocked; user can press play
  }
  notify('file', file.name);
  notifyPlayback();
  return autoplaySucceeded;
}

// Pause file playback but keep everything loaded
export function stop() {
  if (currentFile && activeEl) {
    activeEl.pause();
    notify('file-paused', currentFile.name);
    notifyPlayback();
  } else {
    teardown();
    notify('none');
    notifyPlayback();
  }
}

// Fully remove the file
export function ejectFile() {
  teardown();
  notify('none');
  notifyPlayback();
}

export function playFile() {
  if (!activeEl) return;
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  activeEl.play();
  notify('file', currentFile?.name ?? '');
  notifyPlayback();
}

export function pauseFile() {
  if (!activeEl) return;
  activeEl.pause();
  notify('file-paused', currentFile?.name ?? '');
  notifyPlayback();
}

export function seekFile(t) {
  if (!activeEl) return;
  activeEl.currentTime = Math.max(0, Math.min(t, isFinite(activeEl.duration) ? activeEl.duration : 0));
  notifyPlayback();
}

export function setLoopA() {
  if (!activeEl) return;
  loopA = activeEl.currentTime;
  if (loopA !== null && loopB !== null) activeEl.loop = false;
  notifyPlayback();
}

export function setLoopB() {
  if (!activeEl) return;
  loopB = activeEl.currentTime;
  if (loopA !== null && loopB !== null) activeEl.loop = false;
  notifyPlayback();
}

export function clearLoop() {
  loopA = null;
  loopB = null;
  if (activeEl) activeEl.loop = true;
  notifyPlayback();
}

export function setSmoothing(v) {
  if (analyser) analyser.smoothingTimeConstant = Math.max(0, Math.min(1, v));
}
