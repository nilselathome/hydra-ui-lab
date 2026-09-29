# MIDI Device Support — Implementation Plan

## Context

The user wants to control Hydra Playground parameters live with a physical MIDI
controller (knobs/faders) for performance fun. This is a "remember for later"
plan — not being implemented now.

The naive design (per-parameter "MIDI Learn", storing a CC number on each
param's `animate` object) was rejected in favor of a simpler **active-pane**
model, proposed by the user: physical knobs always control whichever
transform/mod "pane" is currently marked active in the UI. This avoids any
per-param MIDI state entirely — nothing about this feature needs to be saved
to scene state (URL / bank slots). It mirrors how `src/audio.js`'s mic/tab
device selection is also never persisted.

**Confirmed scope:** transforms + mods only — matches the existing `animate`
system's own scope exactly. A layer's own base params (e.g. oscillator's
`freq`/`sync`) have no animate mechanism today and stay out of scope here too.

## How it works

1. Each transform folder and mod folder gets a small target-icon button in its
   Tweakpane title bar (like the existing `addCollapseAllCtrl` fold-all
   controls). Clicking it makes that folder the **active target** — highlighted
   with a CSS class, and the *only* thing MIDI knobs currently drive.
2. A MIDI knob turn (Control Change message) maps to a **slot index** =
   `cc - baseCC`, where `baseCC` is a small user-set number (calibrated once
   by touching knob 1 and reading "last CC seen" in the MIDI pane).
3. Slot index `N` writes directly into the **Nth currently-visible static
   (non-animated) param** of the active folder — the same fields the on-screen
   sliders are bound to. If a param's own animate is enabled, it has no static
   slider and is skipped, so the slot list is just whatever's currently on
   screen, in order.
4. No new field is added to `animate`. No per-param CC mapping is ever saved.
   Switching which pane is "active" is itself pure UI state — lost on reload,
   re-picked with one click.

## Files to touch

### 1. `src/midi.js` (new)

Mirrors `src/audio.js`'s shape/pattern (status string, `setStatusCallback`,
async `connect()` wrapped in try/catch). Public API:

- `status` — `'none' | 'unsupported' | 'connected'`
- `setStatusCallback(cb)`
- `connect()` — calls `navigator.requestMIDIAccess()`; if unsupported
  (`!navigator.requestMIDIAccess`, true in Safari/Firefox without flags),
  sets `status = 'unsupported'` and returns without throwing, same
  graceful-degradation pattern `audio.js`/`ui.js` use via `showWarning`.
  Requires a secure context — fine for `npm run dev` (localhost) and the
  GitHub Pages deploy (https), worth a one-line note in the UI if unsupported.
- On success, attaches `onmidimessage` to every entry in `midiAccess.inputs`
  (multi-device, omni-channel for v1 — no per-channel filtering).
- `setMessageHandler(cb)` — `cb({ cc, channel, value7bit, value01 })` fires on
  every Control Change message (`status & 0xF0 === 0xB0`; `channel = status &
  0x0F`; `cc = data[1]`; `value7bit = data[2]`; `value01 = value7bit / 127`).

This module knows nothing about Tweakpane, transforms, or "active target" —
same separation of concerns as `audio.js` knowing nothing about `animate`.

### 2. `src/ui.js`

- **`initMidiPane(container)`** — new small Tweakpane pane (or folded into the
  existing Audio pane): Connect button, status text, a live "last message:
  CC {n}, ch {c}, val {v}" readout (for calibrating `baseCC`), and a `baseCC`
  number field (plain integer input, defaults to 0, kept in a standalone
  `localStorage` key — never in scene/bank state, matching the audio-device
  precedent).
- **Module-level state:** `let midiActiveTarget = null` (direct object
  reference to a `transform` or `mod` object — these have no stable `id`, but
  survive in place across `rebuild()`/`buildLayersUI()` calls unless
  explicitly removed, so reference equality is safe); `let midiActiveSlots =
  []` (ordered list of `{ binding, obj, key, min, max }` for the active
  folder's currently-static params).
- **`addMidiTargetCtrl(folderEl, onClick)`** — new helper modeled directly on
  `addCollapseAllCtrl` (`src/ui.js` ~2365-2392): injects an absolutely
  positioned icon span into `.tp-fldv_b`, using the existing `ph-bold`
  phosphor-icons convention (e.g. `ph-crosshair-simple`) already used
  elsewhere (~line 1226).
- **In `buildLayersUI()`**, for each `tFolder` (~2509) and `modFolder`
  (~2580): as each static param binding is added (the `if (!anim.enabled)`
  branch for transform params; the equivalent guard for `mod.amount` and
  always for `mod.srcParams`), push `{ binding, obj, key, min, max }` onto a
  local `slots` array in definition order. After the folder is fully built,
  if this transform/mod `=== midiActiveTarget`, replace `midiActiveSlots =
  slots` and add the `.hydra-midi-active` class to that folder's `.tp-fldv_b`.
  At the end of `buildLayersUI()`, if `midiActiveTarget` wasn't found in any
  layer's transforms/mods this pass, clear it (`midiActiveTarget = null;
  midiActiveSlots = []`) — handles the "active pane got removed" case.
- **The message handler**, registered once via `midi.setMessageHandler(...)`:
  ```js
  midi.setMessageHandler(({ cc, value01 }) => {
    const i = cc - baseCC;
    const slot = midiActiveSlots[i];
    if (!slot) return;
    slot.obj[slot.key] = slot.min + value01 * (slot.max - slot.min);
    slot.binding.refresh();       // Tweakpane BindingApi — syncs the visible
                                   // slider after an external mutation
                                   // (verify .refresh() exists in Tweakpane
                                   // v4 at implementation time)
    render(getLayers());          // immediate visual feedback, every message
    saveDebounced();              // see below — NOT save() directly
  });
  ```
- **`saveDebounced()`** — new tiny helper, trailing debounce (~250ms):
  ```js
  let saveTimer = null;
  function saveDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
  }
  ```
  Important: do **not** reuse the existing `onChange()` (which also does
  `Promise.all(...drawTextCanvas...)` and calls `save()` synchronously) for
  MIDI messages — a knob turn can fire dozens of CC messages/second, and
  hammering `localStorage`/`btoa(JSON.stringify(...))` on every one is a real
  CPU/battery cost worth avoiding here.

### 3. `index.html`

Add `.hydra-midi-active` next to the existing `.hydra-layer-title` rule
(~line 39-43) — a highlight on the active folder's title bar. Suggest
something in the same dim-green family as this session's bezier-editor
playhead, for visual consistency, e.g. a left border + faint background tint;
not prescriptive, adjust to taste at implementation time.

## Explicitly out of scope for v1 (note, don't build)

- Per-channel MIDI filtering (v1 is omni).
- Extending animate/MIDI control to base layer params (osc `freq`, etc.) —
  would require adding the whole `animate` wrapper to a code path
  (`buildLayer` in `src/engine.js`) that's never had it.
- Auto-detecting knob CC order (rejected in favor of the simpler, deterministic
  `baseCC` calibration — order-detection is ambiguous unless every knob is
  touched at least once).
- Per-controller-model persisted `baseCC` profiles (just one global local
  setting for v1).

## Future idea (not scoped, just a note)

Pairing a hardware/software synth's audio output with MIDI sync to the
browser could be interesting — the synth would drive visuals both sonically
(via the existing `src/audio.js` fft analysis) and via MIDI CC/clock at the
same time. Outcome depends heavily on the specific synth's parameter/CC
layout, so this needs real investigation before it's a plan, not just a
feature. Worth looking into open-source software synths/players for this —
including a MOD-player (Amiga-style tracker module playback) as one option.
Revisit this as its own exploration later.

## Verification (no automated tests exist in this project)

1. Run `npm run dev`, open in a Chromium-based browser (Web MIDI isn't
   supported in Safari/Firefox without flags — confirm the pane shows
   "unsupported" gracefully there instead).
2. No physical controller handy? On macOS, enable the IAC Driver in Audio
   MIDI Setup (Window → Show MIDI Studio → IAC Driver → enable "Device is
   online"), then use any simple CC-sending tool (a small virtual MIDI
   keyboard/controller app, or a script sending raw CC bytes) routed to the
   IAC bus as a stand-in input device.
3. Connect MIDI in the new pane, confirm status updates and "last message"
   readout moves when a knob/fader is touched.
4. Click the target icon on a transform folder — confirm the highlight
   appears and turning the knob moves that transform's on-screen slider live
   and updates the Hydra output.
5. Click the target icon on a different transform or a mod folder — confirm
   control instantly follows, old folder's highlight clears.
6. Confirm rapid knob movement doesn't visibly stutter the render, and check
   DevTools → Application → Local Storage to confirm writes are debounced
   (not firing on every single CC message).
7. Confirm reloading the page, or copying the share URL, is completely
   unaffected by any MIDI activity in the session — diff `encodeState()`
   output before/after a MIDI-only session with no other edits; it should be
   identical.
