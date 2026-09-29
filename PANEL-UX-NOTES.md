# Panel scroll/UX notes

Notes from the session that added scroll-anchoring across scene switches,
scroll-snap, and per-scene UI-fold persistence to the `#ui` Tweakpane
panel. Kept mainly so the scroll-anchor bug's root cause (and the false
leads that looked plausible but weren't it) doesn't have to be
rediscovered later.

## What changed

- **Scroll-snap** (`index.html`, `#ui` / `#ui > .tp-rotv`) — snaps to the
  top of each top-level pane (Audio/Scenes/Add Layer/Layers) while
  actively wheel/touch-scrolling. Settled on `proximity` after trying
  `none`/`proximity`/`mandatory` side by side.
- **Scroll-anchor on scene switch** (`src/ui.js`, `captureScrollAnchor` /
  `buildLayersUIInner`'s `restoreScroll`) — `goToScene`/`switchBank`/paste/
  clear all swap in a different layer stack, so the old pixel `scrollTop`
  points at arbitrary content afterward. Instead: capture which top-level
  pane (and, if it's Layers, which layer folder by position) was in view
  *before* the swap, and re-anchor to the same one afterward (clamped if
  the new scene has fewer layers). In-place edits (toggle a fold, drag a
  slider) still just preserve the raw scrollTop as before.
- **Fade+blur+scale transition** (`src/ui.js`, `fadeLayersPane`) — since
  there's no meaningful way to animate *between* two unrelated layer
  stacks, the Layers pane fades/blurs/shrinks out (300ms), rebuilds while
  invisible, then reverses back in (250ms).
- **Per-scene pane-fold state** (`src/ui.js`, `getPaneUiState` /
  `applyPaneUiState`) — which of the 4 top-level panes are expanded now
  rides along with each saved scene (bank slots, exports, presets), not
  just the transient full share URL. Deliberately *not* merged with
  `getBankSettings()` (audio track/loop/scene-player settings) — those
  stay per-bank on purpose, see the comment on `getContentEncoded`.
- **`overscroll-behavior-y: contain`** on `#ui` — kills the elastic
  bounce past the top/bottom edge and stops scroll-chaining to the canvas
  behind it. VSCode-sidebar-style hard edge, not a springy one.
- **`padding-bottom: 400px`** on `#ui` — headroom so a scroll-anchor
  target near the end of a short pane/layer list can actually be reached;
  otherwise the browser clamps `scrollTop` to `scrollHeight - clientHeight`
  before it gets there.

## The scroll-anchor bug's actual root cause

Symptom: after a scene switch, scrollTop would reset to the top (or
whatever pane happens to render first) instead of anchoring to where the
user had actually scrolled to.

**Real cause**: `applyPaneUiState(data.ui)` — the per-scene pane-fold
state above — was being called *before* the scroll anchor was captured,
inside `goToScene`/`switchBank`/paste. Expanding/collapsing a top-level
pane to match the target scene's saved layout instantly changes the
content height above the Layers pane, which can shift/clamp `scrollTop`
as a side effect — so by the time the anchor was captured, it was reading
an already-disturbed position, not what the user actually had. Fix:
capture the anchor at the very top of each of those four functions,
before *any* state mutation, and thread it through `rebuild({resetScroll,
anchor})` instead of computing it lazily inside the rebuild.

**Two red herrings ruled out along the way** (real, minor issues — worth
keeping the fixes — but neither was the actual cause):

1. **CSS scroll-snap re-settling asynchronously.** Suspicion: snap could
   silently correct `scrollTop` toward the nearest snap point on some
   idle timer, well after the user stopped scrolling. Verified with a
   live browser (chrome-devtools MCP) that scrollTop held steady through
   an 800ms idle wait — not what was happening. Kept the fix anyway
   (`buildLayersUIInner`'s `restoreScroll` suspends `scroll-snap-type`
   around its own jump, since a layer folder isn't itself a registered
   snap point and could otherwise get "corrected" away from a short
   scene's nearest real snap point).
2. **Click-driven focus scrolling.** Suspicion: clicking a scene button
   focuses it, and if it's scrolled out of view the browser auto-scrolls
   to reveal the focused element, before any of our own JS runs. This
   *is* real browser behavior (confirmed via the page's a11y snapshot
   showing the clicked button as `focused`), so the fix is still in place
   (`mousedown` → `preventDefault()` on the scene grid / Paste / Clear
   buttons, which suppresses mouse-driven focus without affecting
   keyboard/Tab focus) — but it wasn't the actual cause of the reported
   bug either.

**A testing artifact, not a real bug**: the chrome-devtools MCP's own
`click` tool appears to scroll its target into view before dispatching
the click (standard CDP/Puppeteer-style behavior), which made early
repro attempts through that tool show a reset to `scrollTop: 0` even
*before* `applyPaneUiState` was fixed — misleadingly matching the
reported symptom. Switching the repro to a raw `element.click()` via
`evaluate_script` (no automation-driven pre-scroll) is what surfaced the
real bug correctly. Worth remembering if this needs re-debugging with
that tool again: prefer `evaluate_script`'s `el.click()` over the `click`
tool when scroll position matters to the test.

## Verified

Live in a browser via chrome-devtools MCP: scrolled deep into a 6-layer
scene (scrollTop 1800, landing on layer folder index 4), switched to a
saved 2-layer scene, confirmed it lands at the analogous layer folder's
position (332px, clamped to the last available layer) instead of
resetting to 0.
