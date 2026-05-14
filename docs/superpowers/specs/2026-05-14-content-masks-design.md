# Content Masks — Design Spec

**Date:** 2026-05-14  
**Branch:** feature/admin-redesign  
**Status:** Approved

## Overview

Add support for placing multiple rectangular masks over displayed content (URL, image, HTML, or colour modes). Masks are filled with a configurable colour (defaulting to the current background colour) and can be precisely positioned and sized. They are saved as part of the content configuration and follow it through the preview/program cut workflow.

Primary use case: hiding parts of a loaded image or URL source using the chroma key background colour, so the masked region keys out cleanly in the ATEM switcher.

---

## Data Model

Masks are stored as a `masks` array at the top level of the config object, alongside `mode`, `url`, `imageUrl`, etc.

```json
{
  "masks": [
    {
      "id": "m1",
      "x": 0.75,
      "y": 0.0,
      "width": 0.25,
      "height": 1.0,
      "color": null
    }
  ]
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier (e.g. `m1`, `m2`) for UI tracking |
| `x` | number (0.0–1.0) | Left edge as fraction of output width |
| `y` | number (0.0–1.0) | Top edge as fraction of output height |
| `width` | number (0.0–1.0) | Width as fraction of output width |
| `height` | number (0.0–1.0) | Height as fraction of output height |
| `color` | string or null | Hex colour string, or `null` to inherit `backgroundColor` |

Coordinates are stored as fractions (not pixels) so they remain correct if the output resolution changes. The display page converts to canvas pixels by multiplying by 1920 / 1080 respectively.

---

## Display Page (`display.html`)

### Layer Structure

A `<div id="masks">` container is added inside `#canvas`, absolutely positioned to fill the full 1920×1080 area:

```
#canvas
  #bg              z-index: 0   background colour
  #url-frame-a     z-index: 1   URL iframe A
  #url-frame-b     z-index: 1   URL iframe B
  #html-frame      z-index: 1   HTML iframe
  #image-content   z-index: 1   image layer
  #masks           z-index: 2   mask overlay  ← new
  #fade-overlay    z-index: 3   cut fade (existing, stays on top)
```

### Rendering

When `applyConfig()` runs, the masks container is cleared and repopulated from `config.masks`:

```javascript
masksContainer.innerHTML = '';
for (const mask of config.masks ?? []) {
  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.left   = (mask.x * 1920) + 'px';
  div.style.top    = (mask.y * 1080) + 'px';
  div.style.width  = (mask.width  * 1920) + 'px';
  div.style.height = (mask.height * 1080) + 'px';
  div.style.background = mask.color ?? config.backgroundColor ?? '#000';
  div.style.pointerEvents = 'none';
  masksContainer.appendChild(div);
}
```

`pointer-events: none` ensures masks do not interfere with iframe interaction. When `backgroundColor` changes, masks with `color: null` update automatically because they read it at render time.

---

## Admin UI — Masks Tab

### Tab Placement

A "Masks" tab is added to the admin panel tab bar alongside the existing mode tabs. It is always visible regardless of the current content mode.

### Tab Contents

- **Add mask** button — appends a new mask with defaults: `x:0, y:0, width:0.2, height:0.2, color:null`
- **Mask list** — one collapsible card per mask, labelled "Mask 1", "Mask 2", etc.
- Empty state message when no masks are defined

### Per-Mask Card Controls

| Control | Range | Detail |
|---|---|---|
| X | 0 – outputWidth px | Slider + numeric input |
| Y | 0 – outputHeight px | Slider + numeric input |
| Width | 1 – outputWidth px | Slider + numeric input |
| Height | 1 – outputHeight px | Slider + numeric input |
| Colour | hex picker | Checkbox: "Use background colour" locks `color` to `null` |
| Show outline | checkbox | Preview-only: adds a visible border to locate the mask while positioning |
| Remove | button | Deletes the mask from the list |

### Resolution Scaling

Slider ranges and displayed numeric values are expressed in the current output resolution's pixel space (e.g. 0–1280 / 0–720 for 720p). On read, stored fractions are multiplied by output dimensions. On write, pixel values are divided by output dimensions before storing. The current output resolution is already available in the admin config (`resolution` field, e.g. `"1920x1080"`).

### Outline Mode

The "Show outline" checkbox is UI state only — it adds a CSS border to the mask div in the **preview iframe** so the operator can see mask edges while positioning. It is never included in the config object and is never sent to program output.

### Live Updates

Any change to a mask control fires an `updatePreview` WebSocket message immediately, giving live feedback in the preview iframe. Masks follow the standard cut workflow — they move to program only when the operator presses CUT.

---

## Out of Scope

- Non-rectangular mask shapes
- Mask opacity / feathering
- Rotation
- Drag-to-position in the preview iframe
- Per-mask labels or naming
