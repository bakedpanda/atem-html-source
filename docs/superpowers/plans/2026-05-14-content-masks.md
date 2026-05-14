# Content Masks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add support for multiple rectangular masks over display content, controllable via a Masks tab in the admin panel, saved with content config and following the preview/program cut workflow.

**Architecture:** Masks are stored as a `masks` array (fraction-based coordinates) in the existing config object. On the display page, a `#masks` div container sits above content in the canvas z-stack and is repopulated on every config apply. In the admin panel a new Masks tab holds per-mask cards with sliders and number inputs; mask overlays are drawn directly on the monitor-box elements for preview/program feedback.

**Tech Stack:** Vanilla JS, HTML/CSS, Node.js/Express, WebSocket (ws). No new dependencies.

---

## File Map

| File | Change |
|---|---|
| `server.js` | Add `masks: []` to `DEFAULT_CONFIG`; add `'masks'` to `CONTENT_FIELDS` |
| `public/display.html` | Add `#masks` CSS + DOM element; update `_applyConfig` to render mask divs |
| `public/admin.html` | Add Masks tab + panel HTML; CSS for mask cards; JS for mask management |

---

### Task 1: Server — expose masks in config

**Files:**
- Modify: `server.js:32-46` (DEFAULT_CONFIG)
- Modify: `server.js:67` (CONTENT_FIELDS)

- [ ] **Step 1: Add `masks` to DEFAULT_CONFIG**

In `server.js`, find the `DEFAULT_CONFIG` object (line 32). Add `masks: []` after `contentPresets: []`:

```javascript
const DEFAULT_CONFIG = {
  mode: 'color',
  html: '<h1 style="color:white;font-family:sans-serif;font-size:80px;margin:0;">Live</h1>',
  customCss: 'body { background: transparent; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; overflow: hidden; }',
  url: '',
  imageUrl: '',
  imageFit: 'cover',
  backgroundColor: '#000000',
  resolution: '1920x1080',
  framerate: '25',
  interlaced: false,
  showIdle: true,
  urlHistory: [],
  colourPresets: [],
  contentPresets: [],
  masks: [],
};
```

- [ ] **Step 2: Add `'masks'` to CONTENT_FIELDS**

Find line 67:
```javascript
const CONTENT_FIELDS = ['mode', 'html', 'customCss', 'url', 'imageUrl', 'imageFit', 'backgroundColor'];
```

Replace with:
```javascript
const CONTENT_FIELDS = ['mode', 'html', 'customCss', 'url', 'imageUrl', 'imageFit', 'backgroundColor', 'masks'];
```

This ensures masks are included when preview is cut to program, and when program is swapped back to preview.

- [ ] **Step 3: Commit**

```bash
git add public/server.js server.js
git commit -m "feat: add masks array to config CONTENT_FIELDS and defaults"
```

---

### Task 2: Display page — render mask layer

**Files:**
- Modify: `public/display.html`

- [ ] **Step 1: Add `#masks` CSS**

Inside the `<style>` block in `display.html`, after the rule for `#fade-overlay` (around line 66), add:

```css
#masks { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
```

- [ ] **Step 2: Add `#masks` DOM element**

Inside `#canvas` in the HTML body (around line 78), after the closing `</div>` of `#content` and before `</div>` that closes `#canvas`, add:

```html
    <div id="masks"></div>
```

The structure should look like:
```html
<div id="canvas">
  <div id="bg"></div>
  <style id="user-css"></style>
  <div id="content">
    ...
  </div>
  <div id="masks"></div>
</div>
```

- [ ] **Step 3: Render masks in `_applyConfig`**

In the `_applyConfig` function (around line 127), after the line:
```javascript
document.getElementById('user-css').textContent = cfg.customCss || '';
```

Add:
```javascript
  const masksEl = document.getElementById('masks');
  masksEl.innerHTML = '';
  for (const mask of cfg.masks ?? []) {
    const div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.left   = (mask.x      * 1920) + 'px';
    div.style.top    = (mask.y      * 1080) + 'px';
    div.style.width  = (mask.width  * 1920) + 'px';
    div.style.height = (mask.height * 1080) + 'px';
    div.style.background = mask.color ?? cfg.backgroundColor ?? '#000';
    masksContainer.appendChild(div);
  }
```

Wait — use `masksEl` consistently:
```javascript
  const masksEl = document.getElementById('masks');
  masksEl.innerHTML = '';
  for (const mask of cfg.masks ?? []) {
    const div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.left   = (mask.x      * 1920) + 'px';
    div.style.top    = (mask.y      * 1080) + 'px';
    div.style.width  = (mask.width  * 1920) + 'px';
    div.style.height = (mask.height * 1080) + 'px';
    div.style.background = mask.color ?? cfg.backgroundColor ?? '#000';
    masksEl.appendChild(div);
  }
```

- [ ] **Step 4: Verify display page manually**

Start the server (`node server.js`), open `/display` in a browser. Open the browser console and run:

```javascript
applyConfig({ mode: 'color', backgroundColor: '#00b140', masks: [
  { id: 'm1', x: 0.1, y: 0.1, width: 0.3, height: 0.2, color: null },
  { id: 'm2', x: 0.6, y: 0.5, width: 0.2, height: 0.3, color: '#ff0000' }
]});
```

Expected: two rectangles visible — one green (background colour), one red.

- [ ] **Step 5: Commit**

```bash
git add public/display.html
git commit -m "feat: add mask rendering layer to display page"
```

---

### Task 3: Admin page — Masks tab HTML and CSS

**Files:**
- Modify: `public/admin.html`

- [ ] **Step 1: Add Masks tab button**

Find the `.mode-tabs` div (around line 424):
```html
<div class="mode-tabs">
  <button class="mode-tab active" data-mode="html">HTML</button>
  <button class="mode-tab" data-mode="url">URL</button>
  <button class="mode-tab" data-mode="image">Image</button>
</div>
```

Add the Masks tab after Image:
```html
<div class="mode-tabs">
  <button class="mode-tab active" data-mode="html">HTML</button>
  <button class="mode-tab" data-mode="url">URL</button>
  <button class="mode-tab" data-mode="image">Image</button>
  <button class="mode-tab" data-mode="masks">Masks</button>
</div>
```

- [ ] **Step 2: Add Masks panel HTML**

After the closing `</div>` of `#panel-image` (around line 447), add:

```html
      <div class="mode-panel" id="panel-masks">
        <div id="masks-list"></div>
        <p class="masks-empty" id="masks-empty">No masks — click below to add one.</p>
        <button class="add-mask-btn" id="add-mask-btn">+ Add mask</button>
      </div>
```

- [ ] **Step 3: Add CSS for mask card components**

Inside the `<style>` block, before the closing `</style>` tag, add:

```css
/* ── Masks panel ────────────────────────────────── */
.add-mask-btn {
  background: transparent; border: 1px dashed var(--border); color: var(--text-muted);
  border-radius: 3px; font-family: var(--font); font-size: 9px;
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 5px; width: 100%; text-align: center; cursor: pointer; margin-top: 4px;
}
.add-mask-btn:hover { border-color: #444; }
.masks-empty {
  font-size: 10px; color: var(--text-muted); text-align: center;
  padding: 10px 0 6px; display: none;
}
.mask-card {
  background: #111; border: 1px solid var(--border); border-radius: 4px;
  padding: 8px; margin-bottom: 6px;
}
.mask-card-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
}
.mask-card-title { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-sec); }
.mask-remove { color: #444; font-size: 14px; cursor: pointer; padding: 0 2px; line-height: 1; }
.mask-remove:hover { color: var(--danger); }
.mask-row {
  display: grid; grid-template-columns: 22px 1fr 48px;
  align-items: center; gap: 5px; margin-bottom: 4px;
}
.mask-row-label { font-size: 9px; color: var(--text-muted); text-align: right; }
.mask-slider { width: 100%; accent-color: var(--accent); cursor: pointer; }
.mask-num { width: 100%; font-size: 10px; text-align: center; padding: 2px 4px; }
.mask-color-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.mask-color-picker {
  width: 28px; height: 22px; padding: 1px; border: 1px solid var(--border);
  border-radius: 3px; cursor: pointer; background: none; flex-shrink: 0;
}
.mask-color-picker:disabled { opacity: 0.4; cursor: default; }
.mask-color-label { font-size: 9px; color: var(--text-muted); display: flex; align-items: center; gap: 5px; cursor: pointer; }
.mask-outline-row { margin-top: 5px; }
.mask-outline-label { font-size: 9px; color: var(--text-muted); display: flex; align-items: center; gap: 5px; cursor: pointer; }
.mask-overlay { position: absolute; pointer-events: none; z-index: 5; }
```

- [ ] **Step 4: Commit**

```bash
git add public/admin.html
git commit -m "feat: add Masks tab HTML and CSS to admin panel"
```

---

### Task 4: Admin page — mask management JavaScript

**Files:**
- Modify: `public/admin.html` (script section)

- [ ] **Step 1: Add mask state and helper functions**

At the top of the `<script>` block, after `let programConfig = {};`, add:

```javascript
let maskIdSeq = 0;
function newMaskId() { return 'm' + Date.now() + (++maskIdSeq); }

function getOutputDimensions() {
  const res = (programConfig.resolution || '1920x1080').split('x');
  return { w: parseInt(res[0]) || 1920, h: parseInt(res[1]) || 1080 };
}
```

- [ ] **Step 2: Add `renderMaskOverlays` function**

Add after the helper functions above:

```javascript
function getMaskOutlineStates() {
  const states = {};
  document.querySelectorAll('.mask-card').forEach(card => {
    const id = card.dataset.maskId;
    const chk = card.querySelector('.mask-outline-chk');
    if (id && chk) states[id] = chk.checked;
  });
  return states;
}

function renderMaskOverlays(cfg, boxId, isPreview) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.querySelectorAll('.mask-overlay').forEach(el => el.remove());
  const bw = box.clientWidth;
  const bh = box.clientHeight;
  const masks = cfg.masks || [];
  const outlines = isPreview ? getMaskOutlineStates() : {};
  masks.forEach(mask => {
    const div = document.createElement('div');
    div.className = 'mask-overlay';
    div.style.left   = (mask.x      * bw) + 'px';
    div.style.top    = (mask.y      * bh) + 'px';
    div.style.width  = (mask.width  * bw) + 'px';
    div.style.height = (mask.height * bh) + 'px';
    div.style.background = mask.color ?? cfg.backgroundColor ?? '#000';
    if (isPreview && outlines[mask.id]) {
      div.style.outline = '2px dashed rgba(255,255,255,0.75)';
      div.style.outlineOffset = '-2px';
    }
    box.appendChild(div);
  });
}
```

- [ ] **Step 3: Add `collectMasks` function**

```javascript
function collectMasks() {
  const { w, h } = getOutputDimensions();
  const masks = [];
  document.querySelectorAll('.mask-card').forEach(card => {
    const x      = (parseFloat(card.querySelector('.mask-x-num').value) || 0) / w;
    const y      = (parseFloat(card.querySelector('.mask-y-num').value) || 0) / h;
    const width  = (parseFloat(card.querySelector('.mask-w-num').value) || 1) / w;
    const height = (parseFloat(card.querySelector('.mask-h-num').value) || 1) / h;
    const usesBg = card.querySelector('.mask-use-bg').checked;
    const color  = usesBg ? null : card.querySelector('.mask-color-picker').value;
    masks.push({
      id:     card.dataset.maskId,
      x:      Math.max(0, Math.min(1, x)),
      y:      Math.max(0, Math.min(1, y)),
      width:  Math.max(0.0005, Math.min(1, width)),
      height: Math.max(0.0005, Math.min(1, height)),
      color,
    });
  });
  return masks;
}
```

- [ ] **Step 4: Add `onMaskChange` function**

```javascript
function onMaskChange() {
  const cfg = collectPreviewConfig();
  renderMaskOverlays(cfg, 'preview-box', true);
  send({ type: 'updatePreview', config: cfg });
}
```

- [ ] **Step 5: Add `buildMaskCard` function**

```javascript
function buildMaskCard(mask, index) {
  const { w, h } = getOutputDimensions();
  const xPx = Math.round((mask.x      || 0)   * w);
  const yPx = Math.round((mask.y      || 0)   * h);
  const wPx = Math.round((mask.width  || 0.1) * w);
  const hPx = Math.round((mask.height || 0.1) * h);
  const colorVal = mask.color || '#000000';
  const usesBg   = mask.color === null || mask.color === undefined;

  const card = document.createElement('div');
  card.className = 'mask-card';
  card.dataset.maskId = mask.id;

  card.innerHTML = `
    <div class="mask-card-header">
      <span class="mask-card-title">Mask ${index + 1}</span>
      <span class="mask-remove" title="Remove mask">×</span>
    </div>
    <div class="mask-row">
      <span class="mask-row-label">X</span>
      <input type="range"  class="mask-slider mask-x-slider" min="0" max="${w}" value="${xPx}">
      <input type="number" class="mask-num mask-x-num"       min="0" max="${w}" value="${xPx}">
    </div>
    <div class="mask-row">
      <span class="mask-row-label">Y</span>
      <input type="range"  class="mask-slider mask-y-slider" min="0" max="${h}" value="${yPx}">
      <input type="number" class="mask-num mask-y-num"       min="0" max="${h}" value="${yPx}">
    </div>
    <div class="mask-row">
      <span class="mask-row-label">W</span>
      <input type="range"  class="mask-slider mask-w-slider" min="1" max="${w}" value="${wPx}">
      <input type="number" class="mask-num mask-w-num"       min="1" max="${w}" value="${wPx}">
    </div>
    <div class="mask-row">
      <span class="mask-row-label">H</span>
      <input type="range"  class="mask-slider mask-h-slider" min="1" max="${h}" value="${hPx}">
      <input type="number" class="mask-num mask-h-num"       min="1" max="${h}" value="${hPx}">
    </div>
    <div class="mask-color-row">
      <input type="color" class="mask-color-picker" value="${colorVal}" ${usesBg ? 'disabled' : ''}>
      <label class="mask-color-label">
        <input type="checkbox" class="mask-use-bg" ${usesBg ? 'checked' : ''}> Use background colour
      </label>
    </div>
    <div class="mask-outline-row">
      <label class="mask-outline-label">
        <input type="checkbox" class="mask-outline-chk"> Show outline in preview
      </label>
    </div>
  `;

  // Slider ↔ number input sync
  [['x', w], ['y', h], ['w', w], ['h', h]].forEach(([axis, max]) => {
    const slider = card.querySelector(`.mask-${axis}-slider`);
    const num    = card.querySelector(`.mask-${axis}-num`);
    slider.addEventListener('input', () => { num.value = slider.value; onMaskChange(); });
    num.addEventListener('input', () => {
      const v = Math.max(0, Math.min(max, parseFloat(num.value) || 0));
      num.value = v; slider.value = v; onMaskChange();
    });
  });

  // Use-background-colour checkbox
  const useBgChk    = card.querySelector('.mask-use-bg');
  const colorPicker = card.querySelector('.mask-color-picker');
  useBgChk.addEventListener('change', () => {
    colorPicker.disabled = useBgChk.checked;
    if (useBgChk.checked) colorPicker.value = document.getElementById('bg-hex').value || '#000000';
    onMaskChange();
  });
  colorPicker.addEventListener('input', onMaskChange);

  // Outline toggle
  card.querySelector('.mask-outline-chk').addEventListener('change', onMaskChange);

  // Remove
  card.querySelector('.mask-remove').addEventListener('click', () => {
    card.remove();
    updateMaskCardTitles();
    onMaskChange();
  });

  return card;
}
```

- [ ] **Step 6: Add `renderMasksPanel` and `updateMaskCardTitles` functions**

```javascript
function updateMaskCardTitles() {
  document.querySelectorAll('.mask-card').forEach((card, i) => {
    card.querySelector('.mask-card-title').textContent = 'Mask ' + (i + 1);
  });
  const empty = document.getElementById('masks-empty');
  if (empty) empty.style.display = document.querySelectorAll('.mask-card').length === 0 ? 'block' : 'none';
}

function renderMasksPanel(masks) {
  const list = document.getElementById('masks-list');
  if (!list) return;
  list.innerHTML = '';
  (masks || []).forEach((mask, i) => list.appendChild(buildMaskCard(mask, i)));
  updateMaskCardTitles();
}
```

- [ ] **Step 7: Wire up the Add mask button**

Find the existing event listeners section (after `initSections()`). Add:

```javascript
document.getElementById('add-mask-btn').addEventListener('click', () => {
  const list = document.getElementById('masks-list');
  const count = list.querySelectorAll('.mask-card').length;
  list.appendChild(buildMaskCard({ id: newMaskId(), x: 0, y: 0, width: 0.2, height: 0.2, color: null }, count));
  updateMaskCardTitles();
  onMaskChange();
});
```

- [ ] **Step 8: Commit**

```bash
git add public/admin.html
git commit -m "feat: add mask management JS to admin panel"
```

---

### Task 5: Admin page — wire masks into existing flows

**Files:**
- Modify: `public/admin.html` (script section — existing functions)

- [ ] **Step 1: Update `collectPreviewConfig` to include masks**

Find `collectPreviewConfig` (around line 1017). Replace the entire function:

```javascript
function collectPreviewConfig() {
  const activeTabMode = document.querySelector('.mode-tab.active')?.dataset.mode;
  const mode = (activeTabMode && activeTabMode !== 'masks')
    ? activeTabMode
    : (previewConfig.mode || 'color');
  return {
    mode,
    html:            document.getElementById('html-editor').value,
    customCss:       document.getElementById('css-editor').value,
    url:             document.getElementById('url-input').value,
    imageUrl:        document.getElementById('image-url').value,
    imageFit:        document.getElementById('image-fit').value,
    backgroundColor: document.getElementById('bg-hex').value || '#000000',
    masks:           collectMasks(),
  };
}
```

The `activeTabMode !== 'masks'` guard prevents the Masks tab from overriding the current content mode.

- [ ] **Step 2: Update `populateEditorFromPreview` to populate masks panel**

Find `populateEditorFromPreview` (around line 680). At the end of the function body, after:
```javascript
  document.getElementById('image-fit').value = cfg.imageFit || 'cover';
```

Add:
```javascript
  renderMasksPanel(cfg.masks || []);
```

- [ ] **Step 3: Update `renderPreviewIframe` to show mask overlays**

Find `renderPreviewIframe` (around line 634). Replace:

```javascript
function renderPreviewIframe(cfg) {
  applyConfigToIframe(cfg, document.getElementById('preview-frame'));
  scaleMonitor('preview-box', 'preview-frame');
}
```

With:

```javascript
function renderPreviewIframe(cfg) {
  applyConfigToIframe(cfg, document.getElementById('preview-frame'));
  scaleMonitor('preview-box', 'preview-frame');
  renderMaskOverlays(cfg, 'preview-box', true);
}
```

- [ ] **Step 4: Update `renderProgramIframe` to show mask overlays**

Find `renderProgramIframe` (around line 675). Replace:

```javascript
function renderProgramIframe(cfg) {
  applyConfigToIframe(cfg, document.getElementById('program-frame'));
  scaleMonitor('program-box', 'program-frame');
}
```

With:

```javascript
function renderProgramIframe(cfg) {
  applyConfigToIframe(cfg, document.getElementById('program-frame'));
  scaleMonitor('program-box', 'program-frame');
  renderMaskOverlays(cfg, 'program-box', false);
}
```

- [ ] **Step 5: Update `scaleAllMonitors` to re-render overlays after resize**

Find `scaleAllMonitors` (around line 670). Replace:

```javascript
function scaleAllMonitors() {
  scaleMonitor('preview-box', 'preview-frame');
  scaleMonitor('program-box', 'program-frame');
}
```

With:

```javascript
function scaleAllMonitors() {
  scaleMonitor('preview-box', 'preview-frame');
  scaleMonitor('program-box', 'program-frame');
  renderMaskOverlays(previewConfig, 'preview-box', true);
  renderMaskOverlays(programConfig, 'program-box', false);
}
```

- [ ] **Step 6: Commit**

```bash
git add public/admin.html
git commit -m "feat: wire masks into admin preview/program flows"
```

---

### Task 6: Manual end-to-end test

**No automated test infrastructure exists in this project — verify manually.**

- [ ] **Step 1: Start the server**

```bash
node server.js
```

Open `http://localhost:3000/` in a browser for admin, and `http://localhost:3000/display` in a second tab.

- [ ] **Step 2: Test mask creation and preview**

1. Click the **Masks** tab in the admin panel
2. Click **+ Add mask**
3. Expected: a mask card appears with X/Y/W/H sliders and number inputs
4. Adjust the X slider — expected: mask overlay appears immediately in the Preview monitor
5. Check **Show outline in preview** — expected: a dashed white border appears on the mask overlay in Preview monitor but NOT in Program monitor

- [ ] **Step 3: Test color options**

1. In the mask card, uncheck **Use background colour**
2. Pick a bright colour (e.g. red `#ff0000`)
3. Expected: mask overlay in Preview monitor turns red
4. Re-check **Use background colour** — expected: reverts to background colour

- [ ] **Step 4: Test cut behaviour**

1. Set background colour to BMD Green (`#00b140`)
2. Add a mask covering the top-right corner (X≈1500, Y≈0, W≈420, H≈300 at 1080p)
3. Click **Preview** button to push to preview
4. Observe Preview monitor: mask visible as green rectangle
5. Click **CUT**
6. Expected:
   - Program monitor now shows the green mask
   - Display tab shows the green mask over the HDMI output
   - Previous program content (no mask) moves to Preview

- [ ] **Step 5: Test multiple masks**

1. Add three masks with different positions
2. Set one to a custom colour, leave others on background colour
3. Click Preview, then CUT
4. Expected: all three masks appear correctly on display and program monitor

- [ ] **Step 6: Test resolution scaling**

1. Change output resolution to 720p (1280×720) in HDMI Output settings
2. Open the Masks tab — slider ranges should still be 0–1920/0–1080 (note: resolution change only applies to actual HDMI output, not browser preview; slider ranges use `programConfig.resolution` which updates after the resolution POST completes)
3. Add a mask — verify position/size are correct proportionally

- [ ] **Step 7: Test persistence**

1. Add masks, cut them to program
2. Reload the admin page
3. Expected: masks from config.json are restored in the Masks tab panel

- [ ] **Step 8: Final commit**

```bash
git add public/admin.html public/display.html server.js
git commit -m "feat: content masks — complete implementation"
```

---

## Spec Coverage Checklist

| Requirement | Task |
|---|---|
| Multiple rectangular masks | Task 4 (buildMaskCard + add button) |
| Saved with content config, follow cut workflow | Task 1 (CONTENT_FIELDS) |
| Default to background colour, custom colour option | Task 4 (mask-use-bg checkbox + color picker) |
| Show outline checkbox (preview-only) | Task 4 (mask-outline-chk), Task 5 (renderMaskOverlays) |
| Sliders + numeric inputs | Task 4 (mask-row with range + number) |
| Fraction-based coordinates for resolution independence | Tasks 4 + 2 |
| Separate Masks tab | Task 3 |
| Display page renders masks | Task 2 |
| Admin preview/program monitors show masks | Task 5 |
| Masks re-scale correctly on window resize | Task 5 (scaleAllMonitors) |
