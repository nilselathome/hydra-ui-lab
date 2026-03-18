# Session Log

## Session 1 — Initial build
- Set up Vite + Hydra Synth (v1.3.29) + Tweakpane (v4.0.5) playground
- Single `index.html` with multi-layer compositing system
- Base oscillator layer + dynamically added layers (Osc, Shape, Voronoi)
- Layers render to Hydra output buffers (o0–o3), composited with blend modes
- Tweakpane UI for all params

## Session 2 — Refactor (`claude-refactor` branch → merged to main)
- Restructured into modules: `app.js`, `engine.js`, `layers.js`, `layerDefs.js`, `ui.js`
- `LAYER_TYPES` schema drives both rendering and UI — single source of truth
- Layer stack with move up/down, remove, visibility toggle, blend mode + opacity per layer
- Started with a default gradient layer on load

## Session 3 — v3-claude branch

### Modulation system
- Added `mod` object per layer: fn (modulate type), src (noise/voronoi/osc/gradient), amount
- `MOD_FNS`: Displace, Hue, Scale, Warp Rotate, Warp Kaleid
- Tweakpane UI with collapsible mod folder, dropdowns stay open on change (fold state tracked via `_expanded`)

### Multiple mods per layer
- Changed `layer.mod` → `layer.mods` (array)
- Each mod gets its own numbered folder ("Mod 1", "Mod 2"…)
- "+ Add Modulation" and "✕ Remove Mod" buttons per layer

### UI split
- Two separate Tweakpane panes: **Add Layer** (static) and **Layers** (rebuilt on change)

### Blend mode fixes
- Added missing Hydra blend modes: Subtract, Layer, Mask
- Changed default blend from `add` → `blend` (Normal) to avoid blowing out to white

### Opacity bug fix (critical)
- Root cause: `composite.out()` was routing to `o0`, which was also a layer buffer → feedback loop made opacity changes ineffective
- Fix: reserve `o0` exclusively for the final composite; layers render to `o1`–`o3` (max 3 visible layers)

### Transforms
- Added per-layer geometry transforms: **Rotate, Scale, Kaleid, Pixelate, Scroll**
- Applied in chain before mods: source → transforms → mods → buffer
- Renamed `modulateRotate` → "Warp Rotate" and `modulateKaleid` → "Warp Kaleid" to distinguish from actual rotation
- Removed default gradient on load — starts blank

### Animation
- Each transform and mod has an **Animate** section: Enable toggle, Mode (Ramp/Sine), Speed
- `animatedValue()` returns a JS function closed over `animate.speed` — Hydra evaluates it every frame
- Speed slider updates in real-time without rebuilding the chain

### Feedback
- Added `feedback` as a special source type: `build: () => src(o0)` — reads previous frame composite
- Added color blend ops to `MOD_FNS`: Blend, Add, Multiply, Difference, Subtract
- `noLayer: true` flag keeps Feedback out of the Add Layer panel
- Usage: add a mod with fn=Blend, src=Feedback, amount ~0.55 for trails/echo effect
