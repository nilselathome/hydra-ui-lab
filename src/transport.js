// BPM clock for visual sequencing. Uses Tone.js Transport (loaded from CDN as window.Tone).
// Tap tempo feeds setBpm(); startTransport() starts the beat counter for future animate modes.

const TAP_TIMEOUT = 3000; // ms — reset tap history after silence this long
const MAX_TAPS    = 8;

let _bpm         = 120;
let _running     = false;
let _taps        = [];
let _onBpmChange = null;
let _beatHandle  = null;

export let beats = 0; // quarter-note beat counter, increments while transport runs

export function setOnBpmChange(fn) { _onBpmChange = fn; }
export function getBpm()    { return _bpm; }
export function isRunning() { return _running; }

export function setBpm(val) {
  _bpm = Math.max(20, Math.min(300, Math.round(val)));
  if (window.Tone) Tone.Transport.bpm.value = _bpm;
  _onBpmChange?.(_bpm);
  return _bpm;
}

export function tap() {
  const now = performance.now();
  if (_taps.length > 0 && now - _taps[_taps.length - 1] > TAP_TIMEOUT) _taps = [];
  _taps.push(now);
  if (_taps.length > MAX_TAPS) _taps.shift();
  if (_taps.length < 2) return _bpm;
  let sum = 0;
  for (let i = 1; i < _taps.length; i++) sum += _taps[i] - _taps[i - 1];
  return setBpm(60000 / (sum / (_taps.length - 1)));
}

export async function startTransport() {
  if (!window.Tone) return;
  await Tone.start();
  beats = 0;
  Tone.Transport.bpm.value = _bpm;
  if (_beatHandle !== null) { Tone.Transport.clear(_beatHandle); _beatHandle = null; }
  _beatHandle = Tone.Transport.scheduleRepeat(() => { beats++; }, '4n');
  Tone.Transport.start();
  _running = true;
}

export function stopTransport() {
  if (!window.Tone) return;
  Tone.Transport.stop();
  if (_beatHandle !== null) { Tone.Transport.clear(_beatHandle); _beatHandle = null; }
  _running = false;
  beats = 0;
}
