# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Vite dev server
npm run build    # Build to dist/
npm run preview  # Preview built app
```

Node version is pinned to v22.12.0 via `.nvmrc`.

## Architecture

This is a browser-based **Hydra Synth** playground for live coding generative visuals. It uses no framework — just Vite as a dev server/bundler, with all heavy libraries loaded from CDN:

- **[Hydra Synth](https://hydra.ojack.xyz/)** (v1.3.29) — core video synthesis engine, exposed as browser globals (`osc`, `shape`, `voronoi`, `src`, etc.)
- **[Tweakpane](https://tweakpane.github.io/docs/)** (v4.0.5) — parameter control UI panel

### Entry Points

- **`index.html`** — Main playground. Multi-layer compositing system: a base oscillator layer plus dynamically added layers (Oscillator, Shape, Voronoi). Each layer renders to a Hydra output node (`o0`–`o3`) and is composited using blend modes (add/blend/multiply/difference). Tweakpane bindings control all parameters in real time.
- **`index2.html`** — Minimal test file with a single oscillator, no UI.

### src/main.js

A separate module (loaded from `index.html`) that provides a chainable effect system on top of Hydra — defines effect metadata (osc, rotate, kaleid), builds transformation chains dynamically, and creates Tweakpane UI for adding/removing/reordering effects.

### Key patterns

- All Hydra API calls use **window globals** injected by Hydra Synth at init time — no imports needed.
- Layers are tracked as JS objects with a `params` object (bound to Tweakpane) and a `render()` function that rebuilds the Hydra chain from current param values.
- Hydra renders continuously via its internal `requestAnimationFrame` loop; no manual render loop needed.
- There are no tests in this project.


### Documentation for Hydra

- https://hydra.ojack.xyz/api/


### Hydra source code repo

- https://github.com/hydra-synth/hydra

