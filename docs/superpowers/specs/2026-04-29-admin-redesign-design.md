# Admin Panel Redesign — Design Spec

**Date:** 2026-04-29
**Scope:** Dual bus architecture, UI redesign (white/minimal theme), URL history, colour presets

---

## Overview

Replace the current single-bus admin panel with a proper preview/program dual-bus workflow — matching the mental model of a video switcher. A full visual redesign accompanies this, adopting a white/minimal theme and a more structured layout.

---

## 1. Dual Bus Architecture

### Concept

The server maintains two independent config states:

- **previewConfig** — what the operator is composing. Shown in a preview iframe within the admin panel.
- **programConfig** — what is live on the HDMI output. Shown in a program iframe (or indicator) within the admin panel, and broadcast to `display.html`.

`display.html` only ever responds to `programConfig`. Changes to `previewConfig` do not affect the HDMI output until a CUT is performed.

### Server Changes

**State:**
```js
let previewConfig = { ...DEFAULT_CONFIG };
let programConfig = { ...DEFAULT_CONFIG };
```

Config is persisted to disk. On startup, `programConfig` is loaded from disk and `previewConfig` is initialised to a copy of it.

**New WebSocket message types (client → server):**

| Message | Action |
|---|---|
| `{ type: 'updatePreview', config }` | Merge config into `previewConfig`; broadcast preview update to all admin clients |
| `{ type: 'cut' }` | Copy `previewConfig` → `programConfig`; broadcast program update to all clients including `display.html` |

**Broadcast directions:**

- `previewConfig` changes: broadcast to admin clients only (type `'previewUpdate'`)
- `programConfig` changes: broadcast to all clients (type `'programUpdate'`) — `display.html` applies this

**Existing `updateConfig` message** is removed/replaced by `updatePreview`. The flow is now always: edit → Preview → CUT.

### display.html Changes

`display.html` ignores `previewUpdate` messages and only applies `programUpdate` messages. The shape of the config payload is unchanged.

---

## 2. Admin Panel Layout

### Structure

```
┌─────────────────────────────────────────────┐
│  ATEM / HTML Source          ● connected     │  ← header
├──────────────────┬──────────┬────────────────┤
│  PREVIEW         │   CUT    │  PROGRAM       │
│  [16:9 iframe]   │ [button] │  [16:9 iframe] │  ← bus row
│                  │ [Preview]│                │
├──────────────────┴──────────┴────────────────┤
│  [HTML | URL | Image | Colour]  │ Controls   │
│  [editor area]                  │ column     │
│  [Custom CSS]                   │ (260px)    │
└─────────────────────────────────────────────┘
```

**Bus row** (`display: grid; grid-template-columns: 1fr 110px 1fr`):

- Left cell: Preview monitor (label: `PREVIEW · staged`, green-tinted border)
- Centre cell: CUT button (primary, full-width) + Preview button (secondary, below CUT)
- Right cell: Program monitor (label: `PROGRAM · live · HDMI`, red-tinted border)

Both monitors are `<iframe>` elements rendered at 16:9 aspect ratio. Each iframe renders its config directly (via `srcdoc` for HTML mode, `src` for URL mode, etc.) — the same rendering approach used in `display.html`. The preview iframe renders `previewConfig`; the program iframe renders `programConfig`. Live HDMI capture is out of scope.

**Editor row** (`display: grid; grid-template-columns: 1fr 260px`):

- Left: mode tabs (HTML / URL / Image / Colour) + content editor + Custom CSS editor
- Right: controls column (background colour, HDMI output, system, open-display link)

**Button behaviour:**

- **Preview button**: sends `updatePreview` with the current editor content → updates preview iframe only
- **CUT button**: sends `cut` → copies preview to program, updates both iframes and the HDMI output

---

## 3. Visual Theme — White / Minimal

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#080808` | Panel background |
| `--bg-raised` | `#141414` | Header, section backgrounds |
| `--bg-input` | `#1e1e1e` | Inputs, selects, editor areas |
| `--border` | `#282828` | All borders and dividers |
| `--text` | `#f0f0f0` | Primary text |
| `--text-muted` | `#555` | Secondary text, labels |
| `--accent` | `#ffffff` | Active tab, CUT button, outline |
| `--preview-color` | `#aaaaaa` | Preview bus label |
| `--program-color` | `#ff4444` | Program bus label |
| `--connected-dot` | `#47ff8a` | Connection status dot |

Active mode tab: white background, black text, bold.
Section labels: `#888`, small caps, with a horizontal rule extending to the right.
CUT button: white background, black text, bold — most prominent element on the page.
Preview button: ghost style (transparent background, `#282828` border, `#666` text).

---

## 4. URL History

When the operator applies a URL, it is appended to a persisted URL history list (max 20 entries, newest first, duplicates moved to top rather than duplicated).

The URL input in URL mode renders with a `<datalist>` element populated from the history list. This provides browser-native autocomplete — the user can click the dropdown arrow or start typing to filter.

**Storage:** URL history is stored as a `urlHistory` array in the server's persisted config JSON (`config.json`). It is sent to admin clients as part of the config broadcast and is not applied to `display.html`.

---

## 5. Colour Presets

A row of colour swatches sits below the hex/RGB/HSL inputs in the Background Colour section.

**Built-in presets (always present, not editable):**

| Name | Hex |
|---|---|
| Black | `#000000` |
| BMD Green | `#00b140` |
| White | `#ffffff` |
| Blue | `#0000ff` |
| Red | `#ff0000` |

**Custom presets:** A `+` button at the end of the swatch row saves the current background colour as a custom preset. Custom presets are persisted in `config.json` as a `colourPresets` array (`[{ name, hex }]`). There is no individual delete in the first version — custom presets can be cleared via a "Clear custom" option later if needed.

Clicking a swatch sets the background colour and updates all three colour inputs (hex, RGB, HSL) immediately. It does not auto-push to preview or program — the operator still presses Preview then CUT.

The active swatch (matching the current background) is indicated with a white outline.

---

## 6. Colour Inputs

Three inputs displayed in a 3-column grid:

- **Hex**: `#rrggbb` format; auto-prepends `#` if a bare 6-digit hex is entered
- **RGB**: three number inputs (R 0–255, G 0–255, B 0–255)
- **HSL**: three number inputs (H 0–360, S 0–100, L 0–100)

Canonical internal format is hex. When any input is changed, the other two are recalculated and populated. A colour swatch preview (small square) shows the current colour.

---

## 7. Files Changed

| File | Change |
|---|---|
| `server.js` | Split config into `previewConfig` + `programConfig`; handle `updatePreview` and `cut` messages; persist both; add `urlHistory` and `colourPresets` to config |
| `public/admin.html` | Full layout rebuild: dual bus row, white/minimal theme, Preview/CUT buttons, URL datalist, colour presets swatches, preview iframe |
| `public/display.html` | Only apply `programUpdate` messages (ignore `previewUpdate`) |
| `config.json` schema | Add `urlHistory: []`, `colourPresets: []` |

No changes to `kiosk-launch.sh` or `install.sh` in this feature.

---

## 8. Out of Scope

- Live HDMI capture in the preview/program iframes (X11 grab) — deferred, requires hardware upgrade
- Individual deletion of custom colour presets
- Transition effects between preview and program (dissolve, wipe, etc.)
- Multi-user conflict resolution for simultaneous admin sessions
