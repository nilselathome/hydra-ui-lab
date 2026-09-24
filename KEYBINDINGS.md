# Keybindings

Global hotkeys for the playground. All of them are skipped while typing in a
text field, `<select>`, or code editor — except Ctrl+R and Ctrl+S/Ctrl+Shift+S,
which always fire (there's nothing useful for the browser's own reload/save
dialogs to do in this app, so those are blocked outright).

| Key             | Action                                                              |
|-----------------|----------------------------------------------------------------------|
| `Ctrl+R`        | Restart everything — resets Hydra's animation clock, restarts any playing text bank / the scene player from step 0, and seeks the loaded audio track to 0 (or its A-B loop start) |
| `Tab`           | Show/hide the whole Tweakpane UI (e.g. for a clean screen capture). A "Show UI" indicator appears in the corner while hidden |
| `←` / `→`       | Step the active scene by one slot (same as clicking a scene button — prompts to discard unsaved changes if needed) |
| `Ctrl+S`        | Save Scene                                                          |
| `Ctrl+Shift+S`  | Save As (arms it — click/press again on a slot to pick where)      |
| `Ctrl+C`        | Copy the current scene to the clipboard                            |
| `Ctrl+V`        | Paste a scene from the clipboard                                   |
| `Escape`        | Close an open dropdown/preset picker, or cancel an armed Save As    |

Note: `Ctrl` only — `Cmd` is deliberately left alone on macOS so these don't
clobber real browser shortcuts (Cmd+R reload, Cmd+S save-page, etc).
