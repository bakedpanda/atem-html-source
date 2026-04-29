# Admin Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-bus admin panel with a preview/program dual-bus workflow, a white/minimal visual theme, collapsible controls, URL history, colour presets, and content presets.

**Architecture:** The server maintains two independent config states — `previewConfig` (staged, shown in admin preview iframe) and `programConfig` (live HDMI, shown in admin program iframe and applied to `display.html`). All WS message types are replaced. The admin panel is a complete HTML rewrite; `display.html` gets a minimal update to respond to the new message type.

**Tech Stack:** Node.js/Express, WebSocket (`ws`), vanilla JS, CSS custom properties, `localStorage` for UI state.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server.js` | Modify | Dual bus state, new WS message handlers, new DEFAULT_CONFIG fields |
| `public/display.html` | Modify | Respond to `programUpdate` / `init` instead of `config` |
| `public/admin.html` | Full rewrite | New layout, dual bus iframes, all controls |

---

## Task 1: Extend server config schema

**Files:**
- Modify: `server.js:15-27`

- [ ] **Step 1: Add new fields to DEFAULT_CONFIG**

Replace the `DEFAULT_CONFIG` block in `server.js` (lines 15–27):

```js
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
};
```

- [ ] **Step 2: Verify server starts cleanly**

```bash
node server.js
```

Expected: server starts, prints admin/display URLs, no errors.

- [ ] **Step 3: Verify new fields appear in config response**

```bash
curl http://localhost:3000/api/config
```

Expected: JSON includes `"urlHistory":[]`, `"colourPresets":[]`, `"contentPresets":[]`.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: extend config schema with urlHistory, colourPresets, contentPresets"
```

---

## Task 2: Server — dual bus architecture

**Files:**
- Modify: `server.js:48-74` (state + WS handler)

The content fields that flow through the preview/program bus are distinct from global settings (resolution, framerate, showIdle, urlHistory, etc.).

- [ ] **Step 1: Add the CONTENT_FIELDS constant and split state**

Replace lines 48–56 in `server.js` (the `currentConfig` declaration and `broadcast` function):

```js
const CONTENT_FIELDS = ['mode', 'html', 'customCss', 'url', 'imageUrl', 'imageFit', 'backgroundColor'];

function pickContent(cfg) {
  const out = {};
  CONTENT_FIELDS.forEach(k => { out[k] = cfg[k]; });
  return out;
}

let programConfig = loadConfig();
let previewConfig = { ...programConfig };

function broadcast(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}
```

- [ ] **Step 2: Replace the WS connection handler**

Replace the entire `wss.on('connection', ...)` block (lines 58–74):

```js
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', previewConfig, programConfig }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'updatePreview') {
        const update = {};
        CONTENT_FIELDS.forEach(k => { if (msg.config[k] !== undefined) update[k] = msg.config[k]; });
        previewConfig = { ...previewConfig, ...update };

        // Append URL to history when URL mode is pushed to preview
        if (msg.config.mode === 'url' && msg.config.url) {
          const h = [msg.config.url, ...(programConfig.urlHistory || []).filter(u => u !== msg.config.url)].slice(0, 20);
          programConfig = { ...programConfig, urlHistory: h };
          saveConfig(programConfig);
        }

        broadcast({ type: 'previewUpdate', config: previewConfig, urlHistory: programConfig.urlHistory });

      } else if (msg.type === 'cut') {
        programConfig = { ...programConfig, ...pickContent(previewConfig) };
        saveConfig(programConfig);
        broadcast({ type: 'programUpdate', config: programConfig });

      } else if (msg.type === 'clearPreview') {
        CONTENT_FIELDS.forEach(k => { previewConfig[k] = DEFAULT_CONFIG[k]; });
        broadcast({ type: 'previewUpdate', config: previewConfig, urlHistory: programConfig.urlHistory });

      } else if (msg.type === 'updateGlobal') {
        const allowed = ['showIdle', 'colourPresets', 'contentPresets'];
        const update = {};
        allowed.forEach(k => { if (msg.config[k] !== undefined) update[k] = msg.config[k]; });
        if (msg.config.framerate != null) update.framerate = String(msg.config.framerate);
        programConfig = { ...programConfig, ...update };
        saveConfig(programConfig);
        broadcast({ type: 'programUpdate', config: programConfig });
      }

    } catch (e) {
      console.error('WS error:', e.message);
    }
  });
});
```

- [ ] **Step 3: Update the REST endpoints to use programConfig**

Replace lines 79–89 in `server.js`:

```js
app.get('/api/config', (req, res) => res.json(programConfig));
app.get('/api/info', (req, res) => res.json({ hostname: os.hostname(), port: PORT }));

app.post('/api/config', (req, res) => {
  const body = { ...req.body };
  if (body.framerate != null) body.framerate = String(body.framerate);
  programConfig = { ...programConfig, ...body };
  saveConfig(programConfig);
  broadcast({ type: 'programUpdate', config: programConfig });
  res.json({ ok: true, config: programConfig });
});
```

Also update the `/api/resolution` handler (line 101–103) to use `programConfig`:

```js
  programConfig = { ...programConfig, resolution, framerate, interlaced: !!interlaced };
  saveConfig(programConfig);
  broadcast({ type: 'programUpdate', config: programConfig });
```

- [ ] **Step 4: Verify with wscat or browser console**

```bash
node server.js
```

Open browser console at `http://localhost:3000/display`, run:
```js
const ws = new WebSocket('ws://localhost:3000');
ws.onmessage = e => console.log(JSON.parse(e.data));
```

Expected: first message is `{ type: 'init', previewConfig: {...}, programConfig: {...} }`.

Then send:
```js
ws.send(JSON.stringify({ type: 'updatePreview', config: { mode: 'color', backgroundColor: '#ff0000' } }));
```
Expected: broadcast with `type: 'previewUpdate'`, previewConfig.backgroundColor = '#ff0000'.

```js
ws.send(JSON.stringify({ type: 'cut' }));
```
Expected: broadcast with `type: 'programUpdate'`, programConfig.backgroundColor = '#ff0000'.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: dual bus architecture — previewConfig + programConfig, new WS message types"
```

---

## Task 3: Update display.html for dual bus

**Files:**
- Modify: `public/display.html:132-136` (WS message handler), `public/display.html:147` (initial fetch)

- [ ] **Step 1: Update WS message handler**

In `display.html`, replace the `ws.onmessage` handler (lines 132–137):

```js
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'programUpdate') applyConfig(msg.config);
      if (msg.type === 'init') applyConfig(msg.programConfig);
    } catch {}
  };
```

- [ ] **Step 2: Verify display.html still works**

Load `http://localhost:3000/display` in a browser. It should show the current program output.

Open another tab to `http://localhost:3000` (the old admin), push a change. Expected: display.html does NOT update (old admin still sends `update` type which the new server ignores gracefully — the server will just ignore unknown message types).

- [ ] **Step 3: Commit**

```bash
git add public/display.html
git commit -m "fix: display.html responds to programUpdate and init messages only"
```

---

## Task 4: Admin — HTML structure and CSS

**Files:**
- Rewrite: `public/admin.html`

This task creates the complete HTML and CSS with placeholder content (no JavaScript yet). The page should look correct visually.

- [ ] **Step 1: Write the new admin.html (HTML + CSS only)**

Replace the entire contents of `public/admin.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ATEM HTML Source — Admin</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap');

:root {
  --bg:            #080808;
  --bg-raised:     #141414;
  --bg-input:      #1e1e1e;
  --border:        #282828;
  --text:          #f0f0f0;
  --text-muted:    #555;
  --text-sec:      #888;
  --accent:        #ffffff;
  --preview-color: #aaaaaa;
  --program-color: #ff4444;
  --dot-live:      #47ff8a;
  --danger:        #ff4444;
  --font: 'IBM Plex Mono', 'Fira Code', monospace;
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 12px; min-height: 100vh; }

/* ── Header ─────────────────────────────────────── */
.app-header {
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
  padding: 10px 16px;
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px;
  position: sticky; top: 0; z-index: 50;
}
.logo { color: var(--accent); letter-spacing: 0.08em; font-weight: 600; }
.logo span { color: var(--text-muted); font-weight: 400; }
.conn-status { display: flex; align-items: center; gap: 6px; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--danger); display: inline-block; transition: background 0.3s; }
.status-dot.live { background: var(--dot-live); box-shadow: 0 0 5px var(--dot-live); }
#ws-label { color: var(--text-muted); font-size: 10px; }

/* ── Panel ──────────────────────────────────────── */
.panel {
  max-width: 900px;
  margin: 0 auto;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
  min-height: calc(100vh - 41px);
}

/* ── Bus row ────────────────────────────────────── */
.bus-row {
  display: grid;
  grid-template-columns: 1fr 110px 1fr;
  border-bottom: 1px solid var(--border);
  background: #0e0e0e;
}
.bus-monitor { padding: 10px; min-width: 0; }
.bus-label {
  font-size: 9px; letter-spacing: 0.15em; text-transform: uppercase;
  margin-bottom: 6px; display: flex; align-items: center; gap: 6px;
}
.badge { font-size: 8px; padding: 1px 5px; border-radius: 2px; }
.preview-label { color: var(--preview-color); }
.preview-label .badge { background: #1e1e1e; color: var(--preview-color); }
.program-label { color: var(--program-color); }
.program-label .badge { background: #2a0808; color: var(--program-color); }

.monitor-box {
  aspect-ratio: 16/9;
  background: #000;
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}
.preview-screen { border: 1px solid #333; }
.program-screen { border: 1px solid #ff444433; }

.monitor-box iframe {
  position: absolute; top: 0; left: 0;
  width: 1920px; height: 1080px;
  border: none;
  transform-origin: top left;
  pointer-events: none;
}
.monitor-offline {
  display: none;
  position: absolute; inset: 0; z-index: 10;
  background: rgba(0,0,0,0.8);
  align-items: center; justify-content: center;
  flex-direction: column; gap: 6px;
  color: var(--text-muted); font-size: 10px; letter-spacing: 0.08em;
}
.monitor-offline .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--danger); }
.monitor-box.offline .monitor-offline { display: flex; }

.live-status {
  margin-top: 5px;
  background: #111; border: 1px solid var(--border);
  border-radius: 3px; padding: 3px 7px;
  font-size: 9px; display: flex; align-items: center; gap: 5px; overflow: hidden;
}
.live-badge { font-size: 8px; font-weight: 700; letter-spacing: 0.1em; color: var(--program-color); flex-shrink: 0; }
.live-content { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Cut column ─────────────────────────────────── */
.cut-col {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px;
  border-left: 1px solid var(--border); border-right: 1px solid var(--border);
  background: var(--bg); padding: 10px 8px;
}
.cut-btn {
  background: var(--accent); color: #000; border: none; border-radius: 4px;
  font-family: var(--font); font-size: 13px; font-weight: 700; letter-spacing: 0.12em;
  padding: 10px 0; width: 100%; text-align: center; cursor: pointer;
}
.cut-btn:active { opacity: 0.85; }
.preview-send-btn {
  background: transparent; border: 1px solid var(--border); color: var(--text-muted);
  border-radius: 4px; font-family: var(--font); font-size: 9px;
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 6px 0; width: 100%; text-align: center; cursor: pointer;
}
.preview-send-btn:hover { border-color: #444; color: #aaa; }

/* ── Editor row ─────────────────────────────────── */
.editor-row {
  display: grid;
  grid-template-columns: 1fr 240px;
}
.editor-col {
  padding: 14px;
  border-right: 1px solid var(--border);
  min-width: 0;
}
.controls-col {
  min-width: 0;
  display: flex; flex-direction: column;
  border-top: none;
}

/* ── Mode tabs ──────────────────────────────────── */
.tab-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.mode-tabs {
  display: flex; gap: 2px; background: var(--bg-input);
  padding: 3px; border-radius: 5px; width: fit-content;
}
.mode-tab {
  padding: 5px 14px; border-radius: 3px; border: none; cursor: pointer;
  font-family: var(--font); font-size: 10px; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--text-muted); background: transparent;
}
.mode-tab.active { background: var(--accent); color: #000; font-weight: 600; }
.mode-panel { display: none; }
.mode-panel.active { display: block; }

.clear-btn {
  background: transparent; border: 1px solid var(--border); color: var(--text-muted);
  border-radius: 3px; font-family: var(--font); font-size: 9px;
  letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 9px; cursor: pointer;
}
.clear-btn:hover { border-color: #444; color: #aaa; }

/* ── Editor areas ───────────────────────────────── */
textarea, input[type=text], input[type=url], input[type=number], select {
  background: var(--bg-input); border: 1px solid var(--border);
  color: var(--text); font-family: var(--font); font-size: 11px;
  border-radius: 3px; outline: none;
}
textarea:focus, input:focus, select:focus { border-color: #444; }
input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
textarea { resize: vertical; padding: 8px; width: 100%; }
input[type=text], input[type=url] { padding: 5px 8px; height: 26px; width: 100%; display: block; }
input[type=number] { padding: 4px; text-align: center; }
select { padding: 4px 6px; height: 26px; }

#html-editor { min-height: 90px; font-size: 11px; tab-size: 2; line-height: 1.5; }
#css-editor  { min-height: 44px; font-size: 11px; tab-size: 2; line-height: 1.5; }

.css-section { margin-top: 8px; }
.field-label {
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--text-sec); margin-bottom: 5px; display: block;
}

/* image fit select */
#image-fit { width: 100%; margin-top: 6px; font-size: 11px; }

/* ── Controls column ────────────────────────────── */
.ctrl-section { border-bottom: 1px solid var(--border); }
.ctrl-section:last-of-type { border-bottom: none; }

.section-toggle {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 9px 14px; cursor: pointer;
  background: transparent; border: none; color: var(--text-sec);
  font-family: var(--font); font-size: 9px; letter-spacing: 0.15em; text-transform: uppercase;
  text-align: left;
}
.section-toggle:hover { color: #bbb; }
.chevron { font-size: 10px; color: #444; display: inline-block; transition: transform 0.15s; }
.ctrl-section.open .chevron { transform: rotate(180deg); }
.section-body { display: none; padding: 0 14px 12px; }
.ctrl-section.open .section-body { display: block; }

/* ── Colour controls ────────────────────────────── */
.color-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.color-swatch-preview {
  width: 26px; height: 26px; border-radius: 3px; border: 1px solid var(--border);
  flex-shrink: 0; background: #000;
}
.color-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 4px;
}
.color-grid-label {
  font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--text-muted); text-align: center; padding: 2px 0;
}
.color-grid input[type=number] { width: 100%; font-size: 10px; }
.color-swatch-row { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
.swatch {
  width: 22px; height: 22px; border-radius: 3px; border: 1px solid #333; cursor: pointer;
  flex-shrink: 0;
}
.swatch.active { outline: 2px solid var(--accent); outline-offset: 1px; }
.swatch-add {
  width: 22px; height: 22px; border-radius: 3px; border: 1px dashed #333;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: #333; cursor: pointer; flex-shrink: 0;
}
.swatch-add:hover { border-color: #555; color: #555; }

/* ── Presets ────────────────────────────────────── */
.preset-list { display: flex; flex-direction: column; gap: 3px; }
.preset-item {
  display: flex; align-items: center; gap: 5px;
  background: #111; border: 1px solid var(--border); border-radius: 3px; padding: 4px 7px;
}
.preset-icon { font-size: 11px; flex-shrink: 0; }
.preset-name { flex: 1; font-size: 10px; color: #ccc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preset-tags { display: flex; gap: 3px; }
.preset-tag {
  font-size: 7px; letter-spacing: 0.08em; text-transform: uppercase;
  background: var(--bg-input); border: 1px solid var(--border); color: var(--text-muted);
  border-radius: 2px; padding: 1px 4px; flex-shrink: 0;
}
.preset-load {
  background: transparent; border: 1px solid var(--border); color: var(--text-muted);
  border-radius: 3px; font-family: var(--font); font-size: 9px; padding: 2px 7px;
  cursor: pointer; flex-shrink: 0;
}
.preset-load:hover { border-color: #444; }
.preset-delete { color: #444; font-size: 13px; cursor: pointer; flex-shrink: 0; padding: 0 2px; line-height: 1; }
.preset-delete:hover { color: var(--danger); }
.save-preset-btn {
  background: transparent; border: 1px dashed var(--border); color: var(--text-muted);
  border-radius: 3px; font-family: var(--font); font-size: 9px;
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 5px; width: 100%; text-align: center; cursor: pointer; margin-top: 6px;
}
.save-preset-btn:hover { border-color: #444; }
.preset-form {
  background: #111; border: 1px solid var(--border); border-radius: 4px;
  padding: 8px; margin-top: 6px; display: none; flex-direction: column; gap: 6px;
}
.preset-form.open { display: flex; }
.preset-form input[type=text] { width: 100%; }
.check-row { display: flex; align-items: center; gap: 6px; font-size: 9px; color: #888; cursor: pointer; }
.check-row input { accent-color: var(--accent); cursor: pointer; }
.form-actions { display: flex; gap: 5px; margin-top: 2px; }
.btn-confirm {
  background: var(--accent); color: #000; border: none; border-radius: 3px;
  font-family: var(--font); font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; padding: 4px 10px; cursor: pointer;
}
.btn-cancel {
  background: transparent; border: 1px solid var(--border); color: var(--text-muted);
  border-radius: 3px; font-family: var(--font); font-size: 9px;
  padding: 4px 8px; cursor: pointer;
}

/* ── HDMI / System shared buttons ───────────────── */
.ctrl-btn {
  background: transparent; border: 1px solid var(--border); color: var(--text-muted);
  border-radius: 4px; font-family: var(--font); font-size: 10px;
  letter-spacing: 0.06em; text-transform: uppercase; padding: 6px;
  cursor: pointer; width: 100%; text-align: center; margin-top: 6px;
}
.ctrl-btn:hover { border-color: #444; color: #aaa; }
.ctrl-btn.danger { color: var(--danger); border-color: #ff444433; }
.ctrl-btn.danger:hover { border-color: var(--danger); }
.sys-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.apply-note { font-size: 9px; color: var(--text-muted); margin-top: 5px; min-height: 13px; }

/* ── Open display link ──────────────────────────── */
.open-link {
  display: block; text-align: center; padding: 8px 14px;
  color: #444; font-size: 10px; cursor: pointer;
  text-decoration: none; border-top: 1px solid var(--border);
  margin-top: auto;
}
.open-link:hover { color: #888; }

/* ── Utility ────────────────────────────────────── */
.hide-idle-btn {
  background: transparent; border: 1px solid var(--border); color: var(--text-muted);
  border-radius: 3px; font-family: var(--font); font-size: 9px;
  letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 8px;
  cursor: pointer; width: 100%; text-align: center; margin-top: 8px;
}

/* ── Scrollbar ──────────────────────────────────── */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* ── Responsive ─────────────────────────────────── */
@media (max-width: 620px) {
  .bus-row { grid-template-columns: 1fr 90px 1fr; }
  .editor-row { grid-template-columns: 1fr; }
  .editor-col { border-right: none; border-bottom: 1px solid var(--border); }
}
@media (max-width: 420px) {
  .bus-row { grid-template-columns: 1fr; }
  .cut-col {
    flex-direction: row;
    border-left: none; border-right: none;
    border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
    padding: 8px 14px;
  }
  .cut-btn, .preview-send-btn { flex: 1; }
}
</style>
</head>
<body>

<header class="app-header">
  <div class="logo">ATEM <span>/ HTML Source</span></div>
  <div class="conn-status">
    <span class="status-dot" id="dot"></span>
    <span id="ws-label">connecting…</span>
  </div>
</header>

<div class="panel">

  <!-- Bus row -->
  <div class="bus-row">
    <div class="bus-monitor">
      <div class="bus-label preview-label">Preview <span class="badge">staged</span></div>
      <div class="monitor-box preview-screen" id="preview-box">
        <iframe id="preview-frame" allowtransparency="true" sandbox="allow-scripts allow-same-origin"></iframe>
        <div class="monitor-offline"><div class="dot"></div><div>OFFLINE</div></div>
      </div>
    </div>

    <div class="cut-col">
      <button class="cut-btn" id="cut-btn">CUT</button>
      <button class="preview-send-btn" id="preview-btn">Preview</button>
    </div>

    <div class="bus-monitor">
      <div class="bus-label program-label">Program <span class="badge">live · HDMI</span></div>
      <div class="monitor-box program-screen" id="program-box">
        <iframe id="program-frame" allowtransparency="true" sandbox="allow-scripts allow-same-origin"></iframe>
      </div>
      <div class="live-status">
        <span class="live-badge">LIVE</span>
        <span class="live-content" id="live-content">—</span>
      </div>
    </div>
  </div>

  <!-- Editor + Controls -->
  <div class="editor-row">
    <div class="editor-col">
      <div class="tab-header">
        <div class="mode-tabs">
          <button class="mode-tab active" data-mode="html">HTML</button>
          <button class="mode-tab" data-mode="url">URL</button>
          <button class="mode-tab" data-mode="image">Image</button>
        </div>
        <button class="clear-btn" id="clear-btn">Clear preview</button>
      </div>

      <div class="mode-panel active" id="panel-html">
        <textarea id="html-editor" spellcheck="false" placeholder="<h1>Your content</h1>"></textarea>
      </div>
      <div class="mode-panel" id="panel-url">
        <input type="url" id="url-input" list="url-history-list" placeholder="https://example.com">
        <datalist id="url-history-list"></datalist>
      </div>
      <div class="mode-panel" id="panel-image">
        <input type="url" id="image-url" placeholder="https://example.com/image.jpg">
        <select id="image-fit">
          <option value="cover">Cover — fill frame, crop edges</option>
          <option value="contain">Contain — whole image, background fills gaps</option>
          <option value="fill">Fill — stretch to frame</option>
          <option value="none">Actual size — no scaling</option>
        </select>
      </div>

      <div class="css-section">
        <span class="field-label">Custom CSS</span>
        <textarea id="css-editor" spellcheck="false" placeholder="body { background: transparent; }"></textarea>
      </div>
    </div>

    <div class="controls-col">

      <!-- Presets -->
      <div class="ctrl-section open" id="section-presets">
        <button class="section-toggle" data-section="presets">
          Presets <span class="chevron">▾</span>
        </button>
        <div class="section-body">
          <div class="preset-list" id="preset-list"></div>
          <button class="save-preset-btn" id="save-preset-btn">+ Save current as preset</button>
          <div class="preset-form" id="preset-form">
            <input type="text" id="preset-name" placeholder="Preset name…">
            <label class="check-row"><input type="checkbox" id="preset-chk-content" checked> Content (HTML / URL / image)</label>
            <label class="check-row"><input type="checkbox" id="preset-chk-bg"> Background colour</label>
            <label class="check-row"><input type="checkbox" id="preset-chk-css"> Custom CSS</label>
            <div class="form-actions">
              <button class="btn-confirm" id="preset-save-confirm">Save</button>
              <button class="btn-cancel" id="preset-save-cancel">Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Background colour -->
      <div class="ctrl-section open" id="section-bg">
        <button class="section-toggle" data-section="bg">
          Background colour <span class="chevron">▾</span>
        </button>
        <div class="section-body">
          <div class="color-row">
            <div class="color-swatch-preview" id="bg-swatch"></div>
            <input type="text" id="bg-hex" placeholder="#000000">
          </div>
          <div class="color-grid">
            <div class="color-grid-label">R</div>
            <div class="color-grid-label">G</div>
            <div class="color-grid-label">B</div>
            <input type="number" id="bg-r" min="0" max="255" value="0">
            <input type="number" id="bg-g" min="0" max="255" value="0">
            <input type="number" id="bg-b" min="0" max="255" value="0">
            <div class="color-grid-label">H</div>
            <div class="color-grid-label">S</div>
            <div class="color-grid-label">L</div>
            <input type="number" id="bg-h" min="0" max="360" value="0">
            <input type="number" id="bg-s" min="0" max="100" value="0">
            <input type="number" id="bg-l" min="0" max="100" value="0">
          </div>
          <div class="color-swatch-row" id="swatch-row"></div>
          <button class="hide-idle-btn" id="show-idle-btn">Show web UI URL</button>
        </div>
      </div>

      <!-- HDMI output -->
      <div class="ctrl-section" id="section-hdmi">
        <button class="section-toggle" data-section="hdmi">
          HDMI output <span class="chevron">▾</span>
        </button>
        <div class="section-body">
          <select id="output-mode-select" style="width:100%;"></select>
          <button class="ctrl-btn" id="apply-btn">Apply instantly</button>
          <div class="apply-note" id="apply-note"></div>
        </div>
      </div>

      <!-- System -->
      <div class="ctrl-section" id="section-system">
        <button class="section-toggle" data-section="system">
          System <span class="chevron">▾</span>
        </button>
        <div class="section-body">
          <div class="sys-row">
            <button class="ctrl-btn" id="reboot-btn">Reboot</button>
            <button class="ctrl-btn danger" id="shutdown-btn">Shutdown</button>
          </div>
          <div class="apply-note" id="system-note"></div>
        </div>
      </div>

      <a class="open-link" href="/display" target="_blank">↗ Open display in new tab</a>
    </div>
  </div>

</div>

<script>
// JavaScript added in subsequent tasks
</script>
</body>
</html>
```

- [ ] **Step 2: Verify the page renders correctly**

Load `http://localhost:3000`. The page should:
- Show the white/minimal header with "ATEM / HTML Source"
- Show the bus row with two 16:9 monitor boxes and a CUT/Preview column
- Show the editor column with 3 mode tabs and a Clear preview button
- Show the controls column with collapsible section headers (clicking does nothing yet)
- Be visually correct at full width and narrower widths

- [ ] **Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin panel — new HTML structure and white/minimal CSS"
```

---

## Task 5: Admin — WebSocket connection and init handling

**Files:**
- Modify: `public/admin.html` — replace the empty `<script>` tag

- [ ] **Step 1: Add WebSocket and init handling to the script block**

Replace `<script>\n// JavaScript added in subsequent tasks\n</script>` with:

```html
<script>
const WS_URL = `ws://${location.host}`;
let ws;
let previewConfig = {};
let programConfig = {};

// ── WebSocket ─────────────────────────────────────
function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    document.getElementById('dot').classList.add('live');
    document.getElementById('ws-label').textContent = 'connected';
    document.querySelectorAll('.monitor-offline').forEach(el => el.parentElement.classList.remove('offline'));
  };

  ws.onclose = () => {
    document.getElementById('dot').classList.remove('live');
    document.getElementById('ws-label').textContent = 'reconnecting…';
    document.getElementById('preview-box').classList.add('offline');
    setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'init') {
      previewConfig = msg.previewConfig;
      programConfig = msg.programConfig;
      renderPreviewIframe(previewConfig);
      renderProgramIframe(programConfig);
      populateEditorFromPreview(previewConfig);
      populateColourFields(programConfig.backgroundColor || '#000000');
      renderSwatches(programConfig.colourPresets || []);
      renderPresets(programConfig.contentPresets || []);
      populateUrlHistory(programConfig.urlHistory || []);
      updateLiveStatus(programConfig);
      syncOutputSelect(programConfig);
      updateShowIdleBtn(programConfig.showIdle);
    } else if (msg.type === 'previewUpdate') {
      previewConfig = msg.config;
      renderPreviewIframe(previewConfig);
      if (msg.urlHistory) populateUrlHistory(msg.urlHistory);
    } else if (msg.type === 'programUpdate') {
      programConfig = msg.config;
      renderProgramIframe(programConfig);
      updateLiveStatus(programConfig);
      renderSwatches(programConfig.colourPresets || []);
      renderPresets(programConfig.contentPresets || []);
      updateShowIdleBtn(programConfig.showIdle);
    }
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

connect();
</script>
```

Stub functions referenced above (add after `connect();`):

```js
function renderPreviewIframe(cfg) { /* Task 7 */ }
function renderProgramIframe(cfg) { /* Task 6 */ }
function populateEditorFromPreview(cfg) { /* Task 8 */ }
function populateColourFields(hex) { /* Task 9 */ }
function renderSwatches(presets) { /* Task 9 */ }
function renderPresets(presets) { /* Task 11 */ }
function populateUrlHistory(history) { /* Task 10 */ }
function updateLiveStatus(cfg) { /* Task 6 */ }
function syncOutputSelect(cfg) { /* Task 12 */ }
function updateShowIdleBtn(showIdle) { /* Task 9 */ }
```

- [ ] **Step 2: Verify WebSocket connects**

Load `http://localhost:3000`. Expected:
- Status dot turns green
- Label reads "connected"

Open browser console — no errors.

- [ ] **Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin — WebSocket connection and init message handling"
```

---

## Task 6: Admin — Program iframe and live status strip

**Files:**
- Modify: `public/admin.html` — implement `renderProgramIframe` and `updateLiveStatus`

- [ ] **Step 1: Add iframe scaling helper and renderProgramIframe**

Add these functions (replace the stubs from Task 5):

```js
function buildConfigDoc(cfg) {
  if (cfg.mode === 'url' && cfg.url) {
    return null; // use src= instead of srcdoc
  }
  const bg = cfg.backgroundColor || '#000000';
  const css = cfg.customCss || '';
  const body = cfg.mode === 'html' ? (cfg.html || '') :
               cfg.mode === 'image' && cfg.imageUrl ?
                 `<img src="${cfg.imageUrl}" style="width:100%;height:100%;object-fit:${cfg.imageFit||'cover'};display:block;">` : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;}html,body{width:100%;height:100%;overflow:hidden;background:${bg};}${css}</style></head><body>${body}</body></html>`;
}

function applyConfigToIframe(cfg, iframe) {
  if (cfg.mode === 'url' && cfg.url) {
    if (iframe.src !== cfg.url) iframe.src = cfg.url;
    iframe.removeAttribute('srcdoc');
  } else {
    const doc = buildConfigDoc(cfg);
    if (doc !== null) iframe.srcdoc = doc;
  }
}

function scaleMonitor(boxId, frameId) {
  const box = document.getElementById(boxId);
  const frame = document.getElementById(frameId);
  if (!box || !frame) return;
  const scale = box.clientWidth / 1920;
  frame.style.transform = `scale(${scale})`;
}

function renderProgramIframe(cfg) {
  applyConfigToIframe(cfg, document.getElementById('program-frame'));
  scaleMonitor('program-box', 'program-frame');
}

function updateLiveStatus(cfg) {
  const el = document.getElementById('live-content');
  let summary = '—';
  if (cfg.mode === 'html') summary = `html · ${(cfg.html || '').slice(0, 60)}`;
  else if (cfg.mode === 'url') summary = `url · ${cfg.url || ''}`;
  else if (cfg.mode === 'image') summary = `img · ${cfg.imageUrl || ''}`;
  else if (cfg.mode === 'color') summary = `colour · ${cfg.backgroundColor || ''}`;
  el.textContent = summary;
}
```

Also add a resize listener to keep monitor iframes scaled:

```js
function scaleAllMonitors() {
  scaleMonitor('preview-box', 'preview-frame');
  scaleMonitor('program-box', 'program-frame');
}
window.addEventListener('resize', scaleAllMonitors);
```

- [ ] **Step 2: Verify program iframe renders**

Load `http://localhost:3000`. The right monitor box should render the current program config. The live status strip below it should show `LIVE · colour · #000000` (or whatever is live).

- [ ] **Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin — program iframe and live status strip"
```

---

## Task 7: Admin — Preview iframe and Preview/CUT buttons

**Files:**
- Modify: `public/admin.html` — implement `renderPreviewIframe`, wire CUT and Preview buttons

- [ ] **Step 1: Implement renderPreviewIframe**

Replace the stub:

```js
function renderPreviewIframe(cfg) {
  applyConfigToIframe(cfg, document.getElementById('preview-frame'));
  scaleMonitor('preview-box', 'preview-frame');
}
```

- [ ] **Step 2: Add collectPreviewConfig and wire the buttons**

```js
function collectPreviewConfig() {
  const mode = document.querySelector('.mode-tab.active')?.dataset.mode || 'color';
  return {
    mode,
    html: document.getElementById('html-editor').value,
    customCss: document.getElementById('css-editor').value,
    url: document.getElementById('url-input').value,
    imageUrl: document.getElementById('image-url').value,
    imageFit: document.getElementById('image-fit').value,
    backgroundColor: document.getElementById('bg-hex').value || '#000000',
  };
}

document.getElementById('preview-btn').addEventListener('click', () => {
  send({ type: 'updatePreview', config: collectPreviewConfig() });
});

document.getElementById('cut-btn').addEventListener('click', () => {
  send({ type: 'cut' });
});

document.getElementById('clear-btn').addEventListener('click', () => {
  send({ type: 'clearPreview' });
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    send({ type: 'updatePreview', config: collectPreviewConfig() });
  }
});
```

- [ ] **Step 3: Verify the flow**

1. Type `<h1 style="color:red">Hello</h1>` in the HTML editor
2. Click **Preview** — preview iframe should show the red heading
3. Click **CUT** — program iframe should update to match; live status strip should update
4. Click **Clear preview** — preview iframe should go back to black

- [ ] **Step 4: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin — preview iframe, Preview and CUT buttons wired"
```

---

## Task 8: Admin — Mode tabs and editor population

**Files:**
- Modify: `public/admin.html` — wire mode tabs, implement `populateEditorFromPreview`

- [ ] **Step 1: Wire mode tab switching**

```js
document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.mode-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.mode).classList.add('active');
  });
});
```

- [ ] **Step 2: Implement populateEditorFromPreview**

Replace the stub:

```js
function populateEditorFromPreview(cfg) {
  const mode = cfg.mode || 'color';
  const activeMode = ['html', 'url', 'image'].includes(mode) ? mode : 'html';
  document.querySelectorAll('.mode-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.mode === activeMode));
  document.querySelectorAll('.mode-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'panel-' + activeMode));
  document.getElementById('html-editor').value = cfg.html || '';
  document.getElementById('css-editor').value = cfg.customCss || '';
  document.getElementById('url-input').value = cfg.url || '';
  document.getElementById('image-url').value = cfg.imageUrl || '';
  document.getElementById('image-fit').value = cfg.imageFit || 'cover';
}
```

- [ ] **Step 3: Verify tab switching and population**

1. Switch to URL tab — URL input should appear
2. Switch to Image tab — image URL and fit select should appear
3. Open the page fresh — tabs and editors should reflect the current previewConfig

- [ ] **Step 4: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin — mode tabs and editor population"
```

---

## Task 9: Admin — Background colour section

**Files:**
- Modify: `public/admin.html` — colour conversions, input wiring, swatches, show/hide URL

- [ ] **Step 1: Add colour conversion functions**

```js
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function hexToRgb(hex) {
  return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0, l = (max+min)/2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    if (max === r) h = ((g-b)/d + (g<b?6:0))/6;
    else if (max === g) h = ((b-r)/d + 2)/6;
    else h = ((r-g)/d + 4)/6;
  }
  return { h: Math.round(h*360), s: Math.round(s*100), l: Math.round(l*100) };
}
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h/30) % 12;
  const a = s * Math.min(l, 1-l);
  const f = n => Math.round((l - a * Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)))) * 255);
  return { r: f(0), g: f(8), b: f(4) };
}
```

- [ ] **Step 2: Implement populateColourFields**

Replace the stub:

```js
function populateColourFields(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  document.getElementById('bg-swatch').style.background = hex;
  document.getElementById('bg-hex').value = hex;
  document.getElementById('bg-r').value = r;
  document.getElementById('bg-g').value = g;
  document.getElementById('bg-b').value = b;
  document.getElementById('bg-h').value = h;
  document.getElementById('bg-s').value = s;
  document.getElementById('bg-l').value = l;
  highlightActiveSwatch(hex);
}

function highlightActiveSwatch(hex) {
  document.querySelectorAll('.swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.hex === hex));
}
```

- [ ] **Step 3: Wire colour inputs**

```js
document.getElementById('bg-hex').addEventListener('input', () => {
  let val = document.getElementById('bg-hex').value.trim();
  if (/^[0-9a-fA-F]{6}$/.test(val)) val = '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(val)) populateColourFields(val);
});

['bg-r','bg-g','bg-b'].forEach(id => document.getElementById(id).addEventListener('input', () => {
  const r = Math.min(255, Math.max(0, parseInt(document.getElementById('bg-r').value)||0));
  const g = Math.min(255, Math.max(0, parseInt(document.getElementById('bg-g').value)||0));
  const b = Math.min(255, Math.max(0, parseInt(document.getElementById('bg-b').value)||0));
  populateColourFields(rgbToHex(r, g, b));
}));

['bg-h','bg-s','bg-l'].forEach(id => document.getElementById(id).addEventListener('input', () => {
  const h = Math.min(360, Math.max(0, parseInt(document.getElementById('bg-h').value)||0));
  const s = Math.min(100, Math.max(0, parseInt(document.getElementById('bg-s').value)||0));
  const l = Math.min(100, Math.max(0, parseInt(document.getElementById('bg-l').value)||0));
  const { r, g, b } = hslToRgb(h, s, l);
  populateColourFields(rgbToHex(r, g, b));
}));
```

- [ ] **Step 4: Implement renderSwatches with built-ins and custom**

Replace the stub:

```js
const BUILTIN_SWATCHES = [
  { hex: '#000000', name: 'Black' },
  { hex: '#00b140', name: 'BMD Green' },
  { hex: '#ffffff', name: 'White' },
  { hex: '#0000ff', name: 'Blue' },
  { hex: '#ff0000', name: 'Red' },
];

function renderSwatches(customPresets) {
  const row = document.getElementById('swatch-row');
  row.innerHTML = '';
  [...BUILTIN_SWATCHES, ...customPresets].forEach(({ hex, name }) => {
    const el = document.createElement('div');
    el.className = 'swatch';
    el.dataset.hex = hex;
    el.title = name || hex;
    el.style.background = hex;
    if (hex === '#ffffff') el.style.borderColor = '#444';
    el.addEventListener('click', () => populateColourFields(hex));
    row.appendChild(el);
  });
  const addBtn = document.createElement('div');
  addBtn.className = 'swatch-add';
  addBtn.title = 'Save current colour as preset';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => {
    const hex = document.getElementById('bg-hex').value;
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    const name = prompt('Name for this colour preset:', hex);
    if (!name) return;
    const updated = [...(programConfig.colourPresets || []), { hex, name }];
    send({ type: 'updateGlobal', config: { colourPresets: updated } });
  });
  row.appendChild(addBtn);
  highlightActiveSwatch(document.getElementById('bg-hex').value);
}
```

- [ ] **Step 5: Implement updateShowIdleBtn**

Replace the stub:

```js
function updateShowIdleBtn(showIdle) {
  document.getElementById('show-idle-btn').textContent =
    showIdle === false ? 'Show web UI URL' : 'Hide web UI URL';
}

document.getElementById('show-idle-btn').addEventListener('click', () => {
  send({ type: 'updateGlobal', config: { showIdle: programConfig.showIdle === false } });
});
```

- [ ] **Step 6: Verify colour section**

1. Enter `ff0000` in hex input — should auto-prepend `#`, turn swatch red, populate RGB (255,0,0) and HSL (0,100,50)
2. Click a built-in colour swatch — all inputs should update
3. Toggle "Hide web UI URL" — HDMI display should show/hide the URL overlay

- [ ] **Step 7: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin — background colour inputs, swatches, show/hide URL toggle"
```

---

## Task 10: Admin — URL history

**Files:**
- Modify: `public/admin.html` — implement `populateUrlHistory`

- [ ] **Step 1: Implement populateUrlHistory**

Replace the stub:

```js
function populateUrlHistory(history) {
  const dl = document.getElementById('url-history-list');
  dl.innerHTML = '';
  (history || []).forEach(url => {
    const opt = document.createElement('option');
    opt.value = url;
    dl.appendChild(opt);
  });
}
```

- [ ] **Step 2: Verify URL history**

1. Switch to URL tab, enter `https://example.com`, click **Preview**
2. Clear the input, click the input — `https://example.com` should appear in the dropdown
3. Enter a second URL, click Preview — both should appear in the dropdown (newest first)

- [ ] **Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin — URL history datalist"
```

---

## Task 11: Admin — Content presets

**Files:**
- Modify: `public/admin.html` — implement `renderPresets`, save form, load/delete

- [ ] **Step 1: Implement renderPresets**

Replace the stub:

```js
const MODE_ICON = { html: '‹›', url: '🔗', image: '🖼', color: '🎨' };

function renderPresets(presets) {
  const list = document.getElementById('preset-list');
  list.innerHTML = '';
  (presets || []).forEach((preset, idx) => {
    const item = document.createElement('div');
    item.className = 'preset-item';

    const icon = document.createElement('span');
    icon.className = 'preset-icon';
    icon.textContent = MODE_ICON[preset.content?.mode] || '📋';

    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = preset.name;

    const tags = document.createElement('div');
    tags.className = 'preset-tags';
    if (preset.fields.includes('content')) {
      const t = document.createElement('span');
      t.className = 'preset-tag';
      t.textContent = preset.content?.mode || 'content';
      tags.appendChild(t);
    }
    if (preset.fields.includes('background')) {
      const t = document.createElement('span');
      t.className = 'preset-tag';
      t.textContent = 'bg';
      tags.appendChild(t);
    }
    if (preset.fields.includes('css')) {
      const t = document.createElement('span');
      t.className = 'preset-tag';
      t.textContent = 'css';
      tags.appendChild(t);
    }

    const loadBtn = document.createElement('button');
    loadBtn.className = 'preset-load';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => loadPreset(preset));

    const del = document.createElement('span');
    del.className = 'preset-delete';
    del.textContent = '×';
    del.addEventListener('click', () => {
      const updated = (programConfig.contentPresets || []).filter((_, i) => i !== idx);
      send({ type: 'updateGlobal', config: { contentPresets: updated } });
    });

    item.appendChild(icon);
    item.appendChild(name);
    item.appendChild(tags);
    item.appendChild(loadBtn);
    item.appendChild(del);
    list.appendChild(item);
  });
}

function loadPreset(preset) {
  const partial = {};
  if (preset.fields.includes('content') && preset.content) {
    Object.assign(partial, preset.content);
  }
  if (preset.fields.includes('background') && preset.background) {
    partial.backgroundColor = preset.background;
  }
  if (preset.fields.includes('css') && preset.css !== undefined) {
    partial.customCss = preset.css;
  }
  send({ type: 'updatePreview', config: partial });
  populateEditorFromPreview({ ...previewConfig, ...partial });
  if (partial.backgroundColor) populateColourFields(partial.backgroundColor);
}
```

- [ ] **Step 2: Wire the save form**

```js
document.getElementById('save-preset-btn').addEventListener('click', () => {
  document.getElementById('preset-form').classList.add('open');
  document.getElementById('preset-name').focus();
});

document.getElementById('preset-save-cancel').addEventListener('click', () => {
  document.getElementById('preset-form').classList.remove('open');
  document.getElementById('preset-name').value = '';
});

document.getElementById('preset-save-confirm').addEventListener('click', () => {
  const name = document.getElementById('preset-name').value.trim();
  if (!name) return;

  const fields = [];
  const preset = { name, fields };

  if (document.getElementById('preset-chk-content').checked) {
    fields.push('content');
    const cfg = collectPreviewConfig();
    preset.content = { mode: cfg.mode, html: cfg.html, url: cfg.url, imageUrl: cfg.imageUrl, imageFit: cfg.imageFit };
  }
  if (document.getElementById('preset-chk-bg').checked) {
    fields.push('background');
    preset.background = document.getElementById('bg-hex').value;
  }
  if (document.getElementById('preset-chk-css').checked) {
    fields.push('css');
    preset.css = document.getElementById('css-editor').value;
  }

  if (fields.length === 0) return;

  const updated = [...(programConfig.contentPresets || []), preset];
  send({ type: 'updateGlobal', config: { contentPresets: updated } });

  document.getElementById('preset-form').classList.remove('open');
  document.getElementById('preset-name').value = '';
  document.getElementById('preset-chk-content').checked = true;
  document.getElementById('preset-chk-bg').checked = false;
  document.getElementById('preset-chk-css').checked = false;
});
```

- [ ] **Step 3: Verify presets**

1. Set some HTML content, click **+ Save current as preset**, name it "Test", tick Content, click Save — preset should appear in list with `‹›` icon and `html` tag
2. Clear the editor, click **Load** on the preset — editor should repopulate and previewConfig should update
3. Click **×** — preset should be removed from the list

- [ ] **Step 4: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin — content presets (save with checkboxes, load, delete)"
```

---

## Task 12: Admin — HDMI output and System sections

**Files:**
- Modify: `public/admin.html` — MODES table, output select, apply button, reboot/shutdown

- [ ] **Step 1: Add the MODES table and buildOutputSelect**

```js
const MODES = [
  { res:'1920x1080', fps:'23.98', i:false, label:'1080p23.98', g:1, m:32 },
  { res:'1920x1080', fps:'24',    i:false, label:'1080p24',    g:1, m:32 },
  { res:'1920x1080', fps:'25',    i:false, label:'1080p25',    g:1, m:33 },
  { res:'1920x1080', fps:'29.97', i:false, label:'1080p29.97', g:1, m:34 },
  { res:'1920x1080', fps:'30',    i:false, label:'1080p30',    g:1, m:34 },
  { res:'1920x1080', fps:'50',    i:false, label:'1080p50',    g:1, m:31 },
  { res:'1920x1080', fps:'59.94', i:false, label:'1080p59.94', g:1, m:16 },
  { res:'1920x1080', fps:'60',    i:false, label:'1080p60',    g:1, m:16 },
  { res:'1280x720',  fps:'25',    i:false, label:'720p25',     g:1, m:61 },
  { res:'1280x720',  fps:'29.97', i:false, label:'720p29.97',  g:1, m:62 },
  { res:'1280x720',  fps:'50',    i:false, label:'720p50',     g:1, m:19 },
  { res:'1280x720',  fps:'59.94', i:false, label:'720p59.94',  g:1, m:47 },
  { res:'1280x720',  fps:'60',    i:false, label:'720p60',     g:1, m:4  },
  { res:'720x576',   fps:'50',    i:false, label:'576p50 — PAL SD',      g:1, m:18 },
  { res:'720x480',   fps:'59.94', i:false, label:'480p59.94 — NTSC SD',  g:1, m:3  },
  { res:'1920x1080', fps:'50',    i:true,  label:'1080i50',               g:1, m:20 },
  { res:'1920x1080', fps:'59.94', i:true,  label:'1080i59.94 — NTSC',    g:1, m:5  },
  { res:'1920x1080', fps:'60',    i:true,  label:'1080i60',               g:1, m:5  },
  { res:'720x576',   fps:'50',    i:true,  label:'576i50 — PAL SD',       g:1, m:17 },
  { res:'720x480',   fps:'59.94', i:true,  label:'480i59.94 — NTSC SD',  g:1, m:6  },
];

function buildOutputSelect() {
  const sel = document.getElementById('output-mode-select');
  const gProg = document.createElement('optgroup');
  gProg.label = '— Progressive (apply instantly) —';
  const gInt = document.createElement('optgroup');
  gInt.label = '— Interlaced (requires reboot) —';
  MODES.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = m.label;
    (m.i ? gInt : gProg).appendChild(opt);
  });
  sel.appendChild(gProg);
  sel.appendChild(gInt);
}

function syncOutputSelect(cfg) {
  const idx = MODES.findIndex(m =>
    m.res === cfg.resolution && m.fps === cfg.framerate && m.i === !!cfg.interlaced);
  if (idx >= 0) document.getElementById('output-mode-select').value = idx;
  updateApplyBtn();
}

function updateApplyBtn() {
  const idx = parseInt(document.getElementById('output-mode-select').value);
  const m = MODES[idx];
  if (!m) return;
  const btn = document.getElementById('apply-btn');
  const note = document.getElementById('apply-note');
  btn.textContent = m.i ? 'Apply & Reboot' : 'Apply instantly';
  note.textContent = m.i ? 'Interlaced — Pi will reboot (~45s)' : '';
}

document.getElementById('output-mode-select').addEventListener('change', updateApplyBtn);

async function applyResolution() {
  const idx = parseInt(document.getElementById('output-mode-select').value);
  const m = MODES[idx];
  const btn = document.getElementById('apply-btn');
  const note = document.getElementById('apply-note');
  btn.disabled = true; btn.textContent = 'Applying…'; note.textContent = '';
  try {
    const r = await fetch('/api/resolution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: m.res, framerate: m.fps, interlaced: m.i, hdmiGroup: m.g, hdmiMode: m.m })
    });
    const data = await r.json();
    if (data.requiresReboot) {
      btn.textContent = 'Rebooting…';
      note.textContent = 'Rebooting — reconnecting in ~45s';
      await fetch('/api/reboot', { method: 'POST' });
    } else {
      btn.textContent = 'Applied ✓';
      setTimeout(() => { btn.textContent = 'Apply instantly'; btn.disabled = false; }, 2000);
    }
  } catch (e) {
    btn.textContent = 'Error — try again'; note.textContent = String(e); btn.disabled = false;
  }
}

document.getElementById('apply-btn').addEventListener('click', applyResolution);
```

- [ ] **Step 2: Wire reboot and shutdown buttons**

```js
async function systemAction(action) {
  const note = document.getElementById('system-note');
  document.getElementById('reboot-btn').disabled = true;
  document.getElementById('shutdown-btn').disabled = true;
  note.textContent = action === 'reboot' ? 'Rebooting — reconnecting in ~45s…' : 'Shutting down…';
  try { await fetch(`/api/${action}`, { method: 'POST' }); } catch {}
}

document.getElementById('reboot-btn').addEventListener('click', () => {
  if (confirm('Reboot the Pi?')) systemAction('reboot');
});
document.getElementById('shutdown-btn').addEventListener('click', () => {
  if (confirm('Shut down the Pi?')) systemAction('shutdown');
});
```

- [ ] **Step 3: Call buildOutputSelect on load**

Add `buildOutputSelect();` immediately after the `connect();` call at the bottom of the script.

- [ ] **Step 4: Verify HDMI section**

Open the HDMI output section (click its header). The select should list all resolutions. Current resolution should be pre-selected.

- [ ] **Step 5: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin — HDMI output and system sections"
```

---

## Task 13: Admin — Collapsible sections and localStorage

**Files:**
- Modify: `public/admin.html` — section toggle JS and localStorage persistence

- [ ] **Step 1: Wire section toggle buttons**

```js
const SECTION_DEFAULTS = { presets: true, bg: true, hdmi: false, system: false };

function initSections() {
  document.querySelectorAll('.section-toggle').forEach(btn => {
    const key = btn.dataset.section;
    const section = btn.closest('.ctrl-section');

    // Restore saved state; fall back to default
    const saved = localStorage.getItem('section-' + key);
    const isOpen = saved !== null ? saved === 'true' : SECTION_DEFAULTS[key] !== false;
    section.classList.toggle('open', isOpen);

    btn.addEventListener('click', () => {
      const nowOpen = section.classList.toggle('open');
      localStorage.setItem('section-' + key, String(nowOpen));
    });
  });
}

initSections();
```

- [ ] **Step 2: Verify collapse persistence**

1. Collapse the Presets section, reload the page — it should remain collapsed
2. Expand System, reload — it should remain expanded
3. Different sections should remember their state independently

- [ ] **Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin — collapsible sections with localStorage persistence"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| Dual bus architecture | Tasks 2, 3 |
| previewConfig / programConfig split | Task 2 |
| updatePreview / cut / clearPreview messages | Tasks 2, 7 |
| display.html ignores previewUpdate | Task 3 |
| Bus row layout with two iframes | Tasks 4, 6, 7 |
| CUT button + Preview button | Task 7 |
| Live status strip | Task 6 |
| Clear preview button | Tasks 4, 7 |
| Mode tabs: HTML / URL / Image (no Colour tab) | Tasks 4, 8 |
| White/minimal theme | Task 4 |
| Responsive breakpoints | Task 4 |
| Collapsible controls column | Tasks 4, 13 |
| localStorage for collapse state | Task 13 |
| Background colour: hex/RGB/HSL inputs | Task 9 |
| Background colour: built-in + custom swatches | Task 9 |
| Show/Hide web UI URL toggle | Task 9 |
| URL history (datalist, max 20) | Tasks 2, 10 |
| Content presets (save with checkboxes) | Tasks 4, 11 |
| Content presets (load / delete) | Task 11 |
| HDMI output section | Task 12 |
| System section (reboot / shutdown) | Task 12 |
| Fit-content mode tabs (not stretched) | Task 4 |
| Inputs bounded with max-width | Task 4 |
| Config schema: urlHistory, colourPresets, contentPresets | Task 1 |

All spec requirements are covered. No gaps found.
