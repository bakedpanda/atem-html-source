# ATEM HTML Source — Full Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the ATEM HTML Source Pi kiosk from scratch with a one-command installer, URL/webpage display mode, global background keying colour, image fit options, and runtime resolution switching via xrandr.

**Architecture:** Node.js/Express/WebSocket server serves admin and display pages. Admin pushes content config (mode, HTML, URL, image, background colour) via WebSocket; a separate `/api/resolution` endpoint handles HDMI mode changes via xrandr (progressive, instant) or config.txt + reboot (interlaced). An `install.sh` script configures the entire Pi from a fresh Raspberry Pi OS Desktop (Trixie, 32-bit) image.

**Tech Stack:** Node.js 20, Express 4, ws (WebSocket), Chromium kiosk with `--disable-web-security`, Openbox + LightDM, xrandr, systemd.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server.js` | Rewrite | Express + WebSocket server; `/api/resolution`; `/api/reboot` |
| `public/display.html` | Rewrite | HDMI output page: URL iframe, HTML, image (with fit), colour |
| `public/admin.html` | Rewrite | Admin panel: all modes, global bg colour, resolution apply |
| `kiosk-launch.sh` | Rewrite | Chromium kiosk flags including `--disable-web-security` |
| `atem-html-source.service` | Rewrite | systemd unit with `USERNAME`/`REPO_DIR` placeholders |
| `atem-set-hdmi.sh` | Create | sudoers wrapper: edits `hdmi_group`/`hdmi_mode` in config.txt |
| `install.sh` | Create | Full Pi setup script — run once on fresh OS |
| `SETUP.md` | Rewrite | Updated docs: git clone + install.sh flow |
| `.gitignore` | Verify | `node_modules/` and `config.json` excluded |

---

## Task 1: Base files — .gitignore, service file, atem-set-hdmi.sh

**Files:**
- Modify: `.gitignore`
- Rewrite: `atem-html-source.service`
- Create: `atem-set-hdmi.sh`

- [ ] **Write `.gitignore`**

```
node_modules/
config.json
```

- [ ] **Write `atem-html-source.service`** (USERNAME and REPO_DIR are substituted by install.sh)

```ini
[Unit]
Description=ATEM HTML Source Server
After=network.target

[Service]
Type=simple
User=USERNAME
WorkingDirectory=REPO_DIR
ExecStart=/usr/bin/env node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production PORT=3000

[Install]
WantedBy=multi-user.target
```

- [ ] **Write `atem-set-hdmi.sh`**

```bash
#!/bin/bash
# Usage: sudo atem-set-hdmi GROUP MODE
# Edits hdmi_group and hdmi_mode in /boot/firmware/config.txt
set -e
GROUP=$1
MODE=$2
CONFIG=/boot/firmware/config.txt

if [[ -z "$GROUP" || -z "$MODE" ]]; then
  echo "Usage: atem-set-hdmi GROUP MODE" >&2
  exit 1
fi

sed -i "s/^hdmi_group=.*/hdmi_group=${GROUP}/" "$CONFIG"
sed -i "s/^hdmi_mode=.*/hdmi_mode=${MODE}/" "$CONFIG"
echo "Set hdmi_group=${GROUP} hdmi_mode=${MODE}"
```

- [ ] **Make atem-set-hdmi.sh executable**

```bash
chmod +x atem-set-hdmi.sh
```

- [ ] **Commit**

```bash
git add .gitignore atem-html-source.service atem-set-hdmi.sh
git commit -m "chore: base config files and hdmi mode setter script"
```

---

## Task 2: Rewrite server.js

**Files:**
- Rewrite: `server.js`

The server adds two new endpoints: `POST /api/resolution` (runs xrandr for progressive, writes config.txt via atem-set-hdmi for all) and `POST /api/reboot`. Overlay fields are removed from DEFAULT_CONFIG. New fields: `url`, `imageFit`, `interlaced`.

- [ ] **Write `server.js`**

```javascript
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const CONFIG_FILE = path.join(__dirname, 'config.json');

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
  interlaced: false
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch (e) {
    console.error('Failed to load config:', e.message);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let currentConfig = loadConfig();

function broadcast(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'config', config: currentConfig }));
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'update') {
        currentConfig = { ...currentConfig, ...msg.config };
        saveConfig(currentConfig);
        broadcast({ type: 'config', config: currentConfig });
      }
    } catch (e) {
      console.error('WS error:', e.message);
    }
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/config', (req, res) => res.json(currentConfig));

app.post('/api/config', (req, res) => {
  currentConfig = { ...currentConfig, ...req.body };
  saveConfig(currentConfig);
  broadcast({ type: 'config', config: currentConfig });
  res.json({ ok: true, config: currentConfig });
});

app.post('/api/resolution', (req, res) => {
  const { resolution, framerate, interlaced, hdmiGroup, hdmiMode } = req.body;
  if (!resolution || !framerate || hdmiGroup == null || hdmiMode == null) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  currentConfig = { ...currentConfig, resolution, framerate, interlaced: !!interlaced };
  saveConfig(currentConfig);
  broadcast({ type: 'config', config: currentConfig });

  exec(`sudo atem-set-hdmi ${parseInt(hdmiGroup)} ${parseInt(hdmiMode)}`, (err) => {
    if (err) console.error('atem-set-hdmi error:', err.message);
  });

  if (interlaced) {
    return res.json({ ok: true, requiresReboot: true });
  }

  const [w, h] = resolution.split('x');
  const rate = parseFloat(framerate);

  function tryXrandr(output, cb) {
    exec(`DISPLAY=:0 xrandr --output ${output} --mode ${w}x${h} --rate ${rate}`, cb);
  }

  tryXrandr('HDMI-1', (err) => {
    if (!err) return res.json({ ok: true, requiresReboot: false });
    tryXrandr('HDMI-A-1', (err2) => {
      if (err2) {
        console.error('xrandr failed:', err2.message);
        return res.json({ ok: true, requiresReboot: true });
      }
      res.json({ ok: true, requiresReboot: false });
    });
  });
});

app.post('/api/reboot', (req, res) => {
  res.json({ ok: true });
  setTimeout(() => exec('sudo reboot'), 500);
});

app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ATEM HTML Source`);
  console.log(`  Admin:   http://localhost:${PORT}/`);
  console.log(`  Display: http://localhost:${PORT}/display\n`);
});
```

- [ ] **Start the server and verify it starts**

```bash
node server.js
```

Expected output:
```
  ATEM HTML Source
  Admin:   http://localhost:3000/
  Display: http://localhost:3000/display
```

- [ ] **Verify GET /api/config returns defaults**

```bash
curl -s http://localhost:3000/api/config | python3 -m json.tool
```

Expected: JSON with `mode: "color"`, `url: ""`, `imageFit: "cover"`, no overlay fields.

- [ ] **Verify POST /api/resolution validates input**

```bash
curl -s -X POST http://localhost:3000/api/resolution \
  -H 'Content-Type: application/json' \
  -d '{}' | python3 -m json.tool
```

Expected: `{"ok": false, "error": "Missing required fields"}`

- [ ] **Verify POST /api/resolution accepts valid progressive mode**

```bash
curl -s -X POST http://localhost:3000/api/resolution \
  -H 'Content-Type: application/json' \
  -d '{"resolution":"1920x1080","framerate":"25","interlaced":false,"hdmiGroup":1,"hdmiMode":33}' \
  | python3 -m json.tool
```

Expected: `{"ok": true, "requiresReboot": ...}` (requiresReboot may be true if not on Pi)

- [ ] **Verify POST /api/resolution marks interlaced as requiresReboot**

```bash
curl -s -X POST http://localhost:3000/api/resolution \
  -H 'Content-Type: application/json' \
  -d '{"resolution":"1920x1080","framerate":"50","interlaced":true,"hdmiGroup":1,"hdmiMode":20}' \
  | python3 -m json.tool
```

Expected: `{"ok": true, "requiresReboot": true}`

- [ ] **Stop server (Ctrl+C) and commit**

```bash
git add server.js
git commit -m "feat: rewrite server with resolution and reboot endpoints"
```

---

## Task 3: Rewrite display.html

**Files:**
- Rewrite: `public/display.html`

The display page has a background div (z-index 0) filled with the key colour, and a content layer (z-index 1) that shows one of: iframe (URL mode), innerHTML div (HTML mode), or image with configurable object-fit (image mode). Overlay is removed entirely.

- [ ] **Write `public/display.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ATEM Display Output</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
  #bg { position: fixed; inset: 0; z-index: 0; }
  #content { position: fixed; inset: 0; z-index: 1; overflow: hidden; }
  #user-css {}
  #url-frame {
    width: 100%; height: 100%;
    border: none;
    background: transparent;
    display: none;
  }
  #html-content { width: 100%; height: 100%; display: none; }
  #image-content {
    width: 100%; height: 100%;
    display: none;
    align-items: center;
    justify-content: center;
  }
  #image-content img { width: 100%; height: 100%; object-position: center; }
</style>
</head>
<body>
<div id="bg"></div>
<style id="user-css"></style>
<div id="content">
  <iframe id="url-frame" allowtransparency="true"></iframe>
  <div id="html-content"></div>
  <div id="image-content"><img id="image-el" src="" alt=""></div>
</div>

<script>
const WS_URL = `ws://${location.host}`;
let ws, reconnectTimer;

function applyConfig(cfg) {
  document.getElementById('bg').style.background = cfg.backgroundColor || '#000';
  document.getElementById('user-css').textContent = cfg.customCss || '';

  const frame = document.getElementById('url-frame');
  const htmlDiv = document.getElementById('html-content');
  const imgDiv = document.getElementById('image-content');
  const img = document.getElementById('image-el');

  frame.style.display = 'none';
  htmlDiv.style.display = 'none';
  imgDiv.style.display = 'none';

  if (cfg.mode === 'url' && cfg.url) {
    if (frame.src !== cfg.url) frame.src = cfg.url;
    frame.style.display = 'block';
  } else if (cfg.mode === 'html') {
    htmlDiv.innerHTML = cfg.html || '';
    htmlDiv.style.display = 'block';
  } else if (cfg.mode === 'image' && cfg.imageUrl) {
    img.src = cfg.imageUrl;
    img.style.objectFit = cfg.imageFit || 'cover';
    imgDiv.style.display = 'flex';
  }
}

function connect() {
  ws = new WebSocket(WS_URL);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'config') applyConfig(msg.config);
    } catch {}
  };
  ws.onclose = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
}

fetch('/api/config').then(r => r.json()).then(applyConfig).catch(() => {});
connect();
</script>
</body>
</html>
```

- [ ] **Start server and open http://localhost:3000/display in a browser**

Expected: black page (colour mode, default background #000000). No errors in browser console.

- [ ] **Test URL mode via API**

```bash
curl -s -X POST http://localhost:3000/api/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"url","url":"https://example.com"}' > /dev/null
```

Expected: display page shows example.com in an iframe. Note: `--disable-web-security` is only active on the Pi kiosk; in a desktop browser the iframe may be blocked by X-Frame-Options — this is expected and correct behaviour.

- [ ] **Test image mode with fit options**

```bash
curl -s -X POST http://localhost:3000/api/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"image","imageUrl":"https://picsum.photos/800/600","imageFit":"contain","backgroundColor":"#00FF00"}' > /dev/null
```

Expected: image displayed with contain fit, green background visible in letterbox areas.

- [ ] **Test HTML mode**

```bash
curl -s -X POST http://localhost:3000/api/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"html","html":"<h1 style=\"color:white\">Test</h1>","customCss":"body{background:transparent;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}","backgroundColor":"#00FF00"}' > /dev/null
```

Expected: white "Test" heading on green background.

- [ ] **Commit**

```bash
git add public/display.html
git commit -m "feat: rewrite display page with URL iframe, image fit, no overlay"
```

---

## Task 4: Rewrite admin.html

**Files:**
- Rewrite: `public/admin.html`

Key changes from the old version: URL mode tab added, overlay section removed, background colour moved to a global section (visible in all modes), image fit selector added, resolution/framerate replaced with a single combined select (built from MODES array) plus an Apply button whose label changes for interlaced modes.

The Push button sends only content config (mode, html, customCss, url, imageUrl, imageFit, backgroundColor). Resolution is sent separately via the Apply button to `/api/resolution`.

- [ ] **Write `public/admin.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ATEM HTML Source — Admin</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
  :root {
    --bg: #0e0e0e; --surface: #1a1a1a; --surface2: #242424; --border: #2e2e2e;
    --accent: #e8ff47; --text: #f0f0f0; --muted: #888;
    --danger: #ff4747; --success: #47ff8a;
    --font: 'IBM Plex Mono', 'Fira Code', monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; min-height: 100vh; }
  header {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 16px 24px; display: flex; align-items: center; justify-content: space-between;
    position: sticky; top: 0; z-index: 50;
  }
  .logo { font-size: 14px; font-weight: 500; letter-spacing: 0.08em; color: var(--accent); text-transform: uppercase; }
  .logo span { color: var(--muted); font-weight: 400; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); display: inline-block; margin-right: 8px; transition: background 0.3s; }
  .status-dot.live { background: var(--success); box-shadow: 0 0 6px var(--success); }
  .ws-status { color: var(--muted); font-size: 11px; display: flex; align-items: center; gap: 8px; }
  .saved-flash { color: var(--success); font-size: 11px; opacity: 0; transition: opacity 0.3s; margin-left: 12px; }
  .saved-flash.show { opacity: 1; }
  main { display: grid; grid-template-columns: 1fr 340px; height: calc(100vh - 57px); }
  .panel-left { padding: 24px; overflow-y: auto; border-right: 1px solid var(--border); }
  .panel-right { padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
  .section { margin-bottom: 28px; }
  .section-label {
    font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase;
    color: var(--accent); margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
  }
  .section-label::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .field { margin-bottom: 14px; }
  label { display: block; color: var(--muted); font-size: 11px; letter-spacing: 0.06em; margin-bottom: 6px; }
  input[type=text], input[type=url], input[type=color], select, textarea {
    width: 100%; background: var(--surface2); border: 1px solid var(--border);
    color: var(--text); font-family: var(--font); font-size: 12px;
    padding: 8px 10px; border-radius: 4px; outline: none; transition: border-color 0.15s;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--accent); }
  textarea { resize: vertical; min-height: 80px; line-height: 1.5; }
  #html-editor { min-height: 200px; font-size: 11px; tab-size: 2; }
  #css-editor { min-height: 80px; font-size: 11px; }
  input[type=color] { padding: 3px; height: 36px; cursor: pointer; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .mode-tabs { display: flex; gap: 2px; background: var(--surface2); padding: 3px; border-radius: 6px; margin-bottom: 16px; }
  .mode-tab {
    flex: 1; padding: 7px; text-align: center; border-radius: 4px; cursor: pointer;
    font-family: var(--font); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
    border: none; color: var(--muted); background: transparent; transition: all 0.15s;
  }
  .mode-tab.active { background: var(--accent); color: #000; font-weight: 500; }
  .mode-panel { display: none; }
  .mode-panel.active { display: block; }
  .btn {
    width: 100%; padding: 12px; border: none; border-radius: 4px;
    font-family: var(--font); font-size: 12px; font-weight: 500;
    letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
  }
  .btn:hover { opacity: 0.88; }
  .btn:active { transform: scale(0.98); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .btn-primary { background: var(--accent); color: #000; }
  .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--text); }
  .preview-box { background: #000; border: 1px solid var(--border); border-radius: 4px; aspect-ratio: 16/9; overflow: hidden; position: relative; }
  .preview-box iframe { width: 100%; height: 100%; border: none; }
  .preview-label { font-size: 10px; color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
  .res-badge { position: absolute; bottom: 6px; right: 6px; background: rgba(0,0,0,0.7); color: var(--muted); font-size: 9px; padding: 2px 6px; border-radius: 3px; }
  .launch-link {
    display: block; text-align: center; padding: 10px; background: var(--surface2);
    border: 1px solid var(--border); border-radius: 4px; color: var(--muted);
    text-decoration: none; font-size: 11px; letter-spacing: 0.06em; transition: border-color 0.15s;
  }
  .launch-link:hover { border-color: var(--accent); color: var(--accent); }
  .apply-note { font-size: 10px; color: var(--muted); margin-top: 6px; min-height: 14px; }
  select option { background: var(--surface2); }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
</style>
</head>
<body>

<header>
  <div class="logo">ATEM <span>/ HTML Source</span></div>
  <div class="ws-status">
    <span class="status-dot" id="dot"></span>
    <span id="ws-label">connecting...</span>
    <span class="saved-flash" id="saved">SAVED</span>
  </div>
</header>

<main>
  <div class="panel-left">

    <div class="section">
      <div class="section-label">Output mode</div>
      <div class="mode-tabs">
        <button class="mode-tab active" data-mode="html">HTML</button>
        <button class="mode-tab" data-mode="url">URL</button>
        <button class="mode-tab" data-mode="image">Image</button>
        <button class="mode-tab" data-mode="color">Colour</button>
      </div>

      <div class="mode-panel active" id="panel-html">
        <div class="field">
          <label>HTML content</label>
          <textarea id="html-editor" spellcheck="false" placeholder="<h1>Your content</h1>"></textarea>
        </div>
        <div class="field">
          <label>Custom CSS</label>
          <textarea id="css-editor" spellcheck="false" placeholder="body { background: transparent; display:flex; align-items:center; justify-content:center; height:100vh; }"></textarea>
        </div>
      </div>

      <div class="mode-panel" id="panel-url">
        <div class="field">
          <label>Page URL</label>
          <input type="url" id="url-input" placeholder="https://example.com">
        </div>
      </div>

      <div class="mode-panel" id="panel-image">
        <div class="field">
          <label>Image URL</label>
          <input type="url" id="image-url" placeholder="https://...">
        </div>
        <div class="field">
          <label>Fit mode</label>
          <select id="image-fit">
            <option value="cover">Cover — fill frame, crop edges</option>
            <option value="contain">Contain — whole image, background fills gaps</option>
            <option value="fill">Fill — stretch to frame</option>
            <option value="none">Actual size — no scaling</option>
          </select>
        </div>
      </div>

      <div class="mode-panel" id="panel-color">
        <p style="color:var(--muted);font-size:11px;padding:4px 0;">Solid background fill. Set the colour below.</p>
      </div>
    </div>

    <div class="section">
      <div class="section-label">Background colour</div>
      <div class="field">
        <label>Key colour (shown behind all content — set to chroma/luma key colour)</label>
        <div class="row">
          <input type="color" id="bg-picker" value="#000000">
          <input type="text" id="bg-hex" value="#000000" placeholder="#000000">
        </div>
      </div>
    </div>

    <button class="btn btn-primary" id="push-btn">Push to output</button>

  </div>

  <div class="panel-right">

    <div>
      <div class="preview-label">Live preview</div>
      <div class="preview-box">
        <iframe id="preview-frame" src="/display" scrolling="no"></iframe>
        <div class="res-badge" id="res-badge">1920×1080</div>
      </div>
    </div>

    <a class="launch-link" href="/display" target="_blank">↗ Open display in new tab</a>

    <div class="section" style="margin-bottom:0;">
      <div class="section-label">HDMI output</div>
      <div class="field">
        <label>Resolution / framerate</label>
        <select id="output-mode-select"></select>
      </div>
      <button class="btn btn-secondary" id="apply-btn">Apply instantly</button>
      <div class="apply-note" id="apply-note"></div>
    </div>

  </div>
</main>

<script>
const WS_URL = `ws://${location.host}`;
let ws, config = {};

// ── Mode table ─────────────────────────────────────────────
const MODES = [
  // Progressive
  { res:'1920x1080', fps:'23.98', i:false, label:'1080p23.98',           g:1, m:32 },
  { res:'1920x1080', fps:'24',    i:false, label:'1080p24',               g:1, m:32 },
  { res:'1920x1080', fps:'25',    i:false, label:'1080p25',               g:1, m:33 },
  { res:'1920x1080', fps:'29.97', i:false, label:'1080p29.97',            g:1, m:34 },
  { res:'1920x1080', fps:'30',    i:false, label:'1080p30',               g:1, m:34 },
  { res:'1920x1080', fps:'50',    i:false, label:'1080p50',               g:1, m:31 },
  { res:'1920x1080', fps:'59.94', i:false, label:'1080p59.94',            g:1, m:16 },
  { res:'1920x1080', fps:'60',    i:false, label:'1080p60',               g:1, m:16 },
  { res:'1280x720',  fps:'25',    i:false, label:'720p25',                g:1, m:61 },
  { res:'1280x720',  fps:'29.97', i:false, label:'720p29.97',             g:1, m:62 },
  { res:'1280x720',  fps:'50',    i:false, label:'720p50',                g:1, m:19 },
  { res:'1280x720',  fps:'59.94', i:false, label:'720p59.94',             g:1, m:47 },
  { res:'1280x720',  fps:'60',    i:false, label:'720p60',                g:1, m:4  },
  { res:'720x576',   fps:'50',    i:false, label:'576p50 — PAL SD',       g:1, m:18 },
  { res:'720x480',   fps:'59.94', i:false, label:'480p59.94 — NTSC SD',   g:1, m:3  },
  // Interlaced
  { res:'1920x1080', fps:'50',    i:true,  label:'1080i50',               g:1, m:20 },
  { res:'1920x1080', fps:'59.94', i:true,  label:'1080i59.94 — NTSC',     g:1, m:5  },
  { res:'1920x1080', fps:'60',    i:true,  label:'1080i60',               g:1, m:5  },
  { res:'720x576',   fps:'50',    i:true,  label:'576i50 — PAL SD',       g:1, m:17 },
  { res:'720x480',   fps:'59.94', i:true,  label:'480i59.94 — NTSC SD',   g:1, m:6  },
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

function syncOutputSelectToConfig(cfg) {
  const sel = document.getElementById('output-mode-select');
  const idx = MODES.findIndex(m =>
    m.res === cfg.resolution &&
    m.fps === cfg.framerate &&
    m.i === !!cfg.interlaced
  );
  if (idx >= 0) sel.value = idx;
  updateApplyBtn();
}

function updateApplyBtn() {
  const idx = parseInt(document.getElementById('output-mode-select').value);
  const m = MODES[idx];
  const btn = document.getElementById('apply-btn');
  const note = document.getElementById('apply-note');
  const badge = document.getElementById('res-badge');
  if (!m) return;
  if (m.i) {
    btn.textContent = 'Apply & Reboot';
    note.textContent = 'Interlaced — Pi will reboot (~45s), kiosk returns automatically';
  } else {
    btn.textContent = 'Apply instantly';
    note.textContent = '';
  }
  badge.textContent = m.res.replace('x', '×');
}

// ── WebSocket ──────────────────────────────────────────────
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    document.getElementById('dot').classList.add('live');
    document.getElementById('ws-label').textContent = 'connected';
  };
  ws.onclose = () => {
    document.getElementById('dot').classList.remove('live');
    document.getElementById('ws-label').textContent = 'reconnecting...';
    setTimeout(connect, 2000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'config') populateUI(msg.config);
  };
}

// ── Populate UI ────────────────────────────────────────────
function populateUI(cfg) {
  config = cfg;
  document.querySelectorAll('.mode-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.mode === cfg.mode));
  document.querySelectorAll('.mode-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'panel-' + cfg.mode));
  document.getElementById('html-editor').value = cfg.html || '';
  document.getElementById('css-editor').value = cfg.customCss || '';
  document.getElementById('url-input').value = cfg.url || '';
  document.getElementById('image-url').value = cfg.imageUrl || '';
  document.getElementById('image-fit').value = cfg.imageFit || 'cover';
  document.getElementById('bg-picker').value = cfg.backgroundColor || '#000000';
  document.getElementById('bg-hex').value = cfg.backgroundColor || '#000000';
  syncOutputSelectToConfig(cfg);
}

// ── Collect content config (no resolution) ─────────────────
function collectConfig() {
  const mode = document.querySelector('.mode-tab.active')?.dataset.mode || 'color';
  return {
    mode,
    html: document.getElementById('html-editor').value,
    customCss: document.getElementById('css-editor').value,
    url: document.getElementById('url-input').value,
    imageUrl: document.getElementById('image-url').value,
    imageFit: document.getElementById('image-fit').value,
    backgroundColor: document.getElementById('bg-hex').value,
  };
}

function pushConfig() {
  const cfg = collectConfig();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'update', config: cfg }));
  } else {
    fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(cfg) });
  }
  flashSaved();
}

function flashSaved() {
  const el = document.getElementById('saved');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1500);
}

// ── Apply resolution ───────────────────────────────────────
async function applyResolution() {
  const idx = parseInt(document.getElementById('output-mode-select').value);
  const m = MODES[idx];
  const btn = document.getElementById('apply-btn');
  const note = document.getElementById('apply-note');
  btn.disabled = true;
  btn.textContent = 'Applying...';
  note.textContent = '';

  try {
    const r = await fetch('/api/resolution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: m.res, framerate: m.fps, interlaced: m.i, hdmiGroup: m.g, hdmiMode: m.m })
    });
    const data = await r.json();
    if (data.requiresReboot) {
      btn.textContent = 'Rebooting...';
      note.textContent = 'Rebooting — reconnecting in ~45s';
      await fetch('/api/reboot', { method: 'POST' });
    } else {
      btn.textContent = 'Applied ✓';
      setTimeout(() => { btn.textContent = 'Apply instantly'; btn.disabled = false; }, 2000);
    }
  } catch (e) {
    btn.textContent = 'Error — try again';
    note.textContent = String(e);
    btn.disabled = false;
  }
}

// ── Events ─────────────────────────────────────────────────
document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.mode-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.mode).classList.add('active');
  });
});

document.getElementById('push-btn').addEventListener('click', pushConfig);
document.getElementById('apply-btn').addEventListener('click', applyResolution);
document.getElementById('output-mode-select').addEventListener('change', updateApplyBtn);

const bgPicker = document.getElementById('bg-picker');
const bgHex = document.getElementById('bg-hex');
bgPicker.addEventListener('input', () => bgHex.value = bgPicker.value);
bgHex.addEventListener('input', () => {
  if (/^#[0-9a-fA-F]{6}$/.test(bgHex.value)) bgPicker.value = bgHex.value;
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') pushConfig();
});

buildOutputSelect();
connect();
</script>
</body>
</html>
```

- [ ] **Open http://localhost:3000/ in a browser (server must be running)**

Check:
- Four mode tabs: HTML, URL, Image, Colour
- URL tab shows a single URL input field
- Image tab shows URL + fit mode selector
- Colour tab shows only the "Set the colour below" note
- Background colour picker is visible below all modes
- Right panel shows a single combined resolution dropdown with two optgroups
- Selecting an interlaced mode changes Apply button to "Apply & Reboot"
- Selecting a progressive mode shows "Apply instantly"
- Ctrl+Enter triggers push
- No overlay section anywhere

- [ ] **Commit**

```bash
git add public/admin.html
git commit -m "feat: rewrite admin panel with URL mode, image fit, global bg colour, no overlay"
```

---

## Task 5: Rewrite kiosk-launch.sh

**Files:**
- Rewrite: `kiosk-launch.sh`

- [ ] **Write `kiosk-launch.sh`**

```bash
#!/bin/bash
xset s off
xset -dpms
xset s noblank

until curl -sf http://localhost:3000/api/config > /dev/null; do
  sleep 1
done

chromium \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --password-store=basic \
  --disable-features=PasswordCheck,TranslateUI \
  --disable-component-update \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  --disable-web-security \
  --user-data-dir=/tmp/chromekiosk \
  http://localhost:3000/display
```

- [ ] **Make executable**

```bash
chmod +x kiosk-launch.sh
```

- [ ] **Commit**

```bash
git add kiosk-launch.sh
git commit -m "feat: update kiosk launcher with disable-web-security flag"
```

---

## Task 6: Write install.sh

**Files:**
- Create: `install.sh`

This is the one-command setup script. It runs on the Pi as the kiosk user (not root). It prompts for hostname confirmation and default resolution, then configures everything non-interactively.

- [ ] **Write `install.sh`**

```bash
#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CURRENT_USER="$(whoami)"
CURRENT_HOST="$(hostname)"

echo ""
echo "=============================="
echo " ATEM HTML Source — Installer"
echo "=============================="
echo ""
echo "Running as user: $CURRENT_USER"
echo ""

# ── Prompt 1: Hostname ─────────────────────────────────────
read -p "Hostname [$CURRENT_HOST]: " INPUT_HOST
CHOSEN_HOST="${INPUT_HOST:-$CURRENT_HOST}"

# ── Prompt 2: Default resolution ──────────────────────────
echo ""
echo "Default HDMI output:"
echo "  1) 1080p25  (PAL)  [default]"
echo "  2) 1080p50  (PAL)"
echo "  3) 1080p29.97 (NTSC)"
echo "  4) 1080p59.94 (NTSC)"
echo "  5) 1080p60"
echo "  6) 720p50"
echo "  7) 720p59.94"
echo ""
read -p "Choice [1]: " RES_CHOICE

case "${RES_CHOICE:-1}" in
  2) HDMI_GROUP=1; HDMI_MODE=31; DEFAULT_RES="1920x1080"; DEFAULT_FPS="50"   ;;
  3) HDMI_GROUP=1; HDMI_MODE=34; DEFAULT_RES="1920x1080"; DEFAULT_FPS="29.97";;
  4) HDMI_GROUP=1; HDMI_MODE=16; DEFAULT_RES="1920x1080"; DEFAULT_FPS="59.94";;
  5) HDMI_GROUP=1; HDMI_MODE=16; DEFAULT_RES="1920x1080"; DEFAULT_FPS="60"   ;;
  6) HDMI_GROUP=1; HDMI_MODE=19; DEFAULT_RES="1280x720";  DEFAULT_FPS="50"   ;;
  7) HDMI_GROUP=1; HDMI_MODE=47; DEFAULT_RES="1280x720";  DEFAULT_FPS="59.94";;
  *) HDMI_GROUP=1; HDMI_MODE=33; DEFAULT_RES="1920x1080"; DEFAULT_FPS="25"   ;;
esac

echo ""
echo "Starting installation..."
echo ""

# ── 1. System update ───────────────────────────────────────
echo "[1/11] Updating system packages..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# ── 2. Node.js ─────────────────────────────────────────────
echo "[2/11] Checking Node.js..."
NODE_OK=false
if command -v node &>/dev/null; then
  NODE_VER=$(node -e "console.log(parseInt(process.version.slice(1)))" 2>/dev/null || echo 0)
  [[ "$NODE_VER" -ge 18 ]] && NODE_OK=true
fi
if [[ "$NODE_OK" == false ]]; then
  echo "       Installing Node.js 20 via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - -qq
  sudo apt-get install -y nodejs -qq
fi
echo "       Node $(node -v) ready."

# ── 3. npm install ─────────────────────────────────────────
echo "[3/11] Installing Node.js dependencies..."
cd "$REPO_DIR"
npm install --production --silent

# ── 4. LightDM ─────────────────────────────────────────────
echo "[4/11] Configuring LightDM autologin..."
sudo tee /etc/lightdm/lightdm.conf > /dev/null <<EOF
[LightDM]

[Seat:*]
autologin-user=${CURRENT_USER}
autologin-user-timeout=0
user-session=openbox
autologin-session=openbox
xserver-command=X -nocursor

[XDMCPServer]

[VNCServer]
EOF

# ── 5. Openbox autostart ───────────────────────────────────
echo "[5/11] Configuring Openbox autostart..."
mkdir -p "$HOME/.config/openbox"
tee "$HOME/.config/openbox/autostart" > /dev/null <<EOF
xsetroot -solid black &
xset s off &
xset -dpms &
xset s noblank &
bash ${REPO_DIR}/kiosk-launch.sh &
EOF

# ── 6. systemd service ─────────────────────────────────────
echo "[6/11] Installing systemd service..."
sed \
  -e "s|USERNAME|${CURRENT_USER}|g" \
  -e "s|REPO_DIR|${REPO_DIR}|g" \
  "${REPO_DIR}/atem-html-source.service" \
  | sudo tee /etc/systemd/system/atem-html-source.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable atem-html-source

# ── 7. /boot/firmware/config.txt ──────────────────────────
echo "[7/11] Configuring /boot/firmware/config.txt..."
CONFIG_TXT="/boot/firmware/config.txt"
# Remove lines we'll set ourselves (avoid duplicates)
sudo sed -i '/^hdmi_force_hotplug/d' "$CONFIG_TXT"
sudo sed -i '/^disable_overscan/d' "$CONFIG_TXT"
sudo sed -i '/^disable_splash/d' "$CONFIG_TXT"
sudo sed -i '/^hdmi_group/d' "$CONFIG_TXT"
sudo sed -i '/^hdmi_mode/d' "$CONFIG_TXT"
sudo tee -a "$CONFIG_TXT" > /dev/null <<EOF

# ATEM HTML Source
hdmi_force_hotplug=1
disable_overscan=1
disable_splash=1
hdmi_group=${HDMI_GROUP}
hdmi_mode=${HDMI_MODE}
EOF

# ── 8. /boot/firmware/cmdline.txt ─────────────────────────
echo "[8/11] Configuring /boot/firmware/cmdline.txt..."
CMDLINE_TXT="/boot/firmware/cmdline.txt"
sudo sed -i 's/ splash\b//g' "$CMDLINE_TXT"
sudo sed -i 's/ quiet\b//g' "$CMDLINE_TXT"
sudo sed -i 's/ loglevel=[0-9]\+//g' "$CMDLINE_TXT"
sudo sed -i 's/$/ quiet loglevel=0/' "$CMDLINE_TXT"

# ── 9. Plymouth ────────────────────────────────────────────
echo "[9/11] Disabling Plymouth splash..."
sudo systemctl disable plymouth.service 2>/dev/null || true
sudo systemctl disable plymouth-start.service 2>/dev/null || true

# ── 10. atem-set-hdmi + sudoers ───────────────────────────
echo "[10/11] Installing atem-set-hdmi and sudoers rules..."
sudo cp "${REPO_DIR}/atem-set-hdmi.sh" /usr/local/bin/atem-set-hdmi
sudo chmod 755 /usr/local/bin/atem-set-hdmi
sudo chown root:root /usr/local/bin/atem-set-hdmi

echo "${CURRENT_USER} ALL=(ALL) NOPASSWD: /usr/local/bin/atem-set-hdmi" \
  | sudo tee /etc/sudoers.d/atem-hdmi > /dev/null
echo "${CURRENT_USER} ALL=(ALL) NOPASSWD: /sbin/reboot" \
  | sudo tee /etc/sudoers.d/atem-reboot > /dev/null
sudo chmod 440 /etc/sudoers.d/atem-hdmi /etc/sudoers.d/atem-reboot

# ── 11. Initial config.json ────────────────────────────────
echo "[11/11] Writing initial config..."
tee "${REPO_DIR}/config.json" > /dev/null <<EOF
{
  "mode": "color",
  "html": "",
  "customCss": "",
  "url": "",
  "imageUrl": "",
  "imageFit": "cover",
  "backgroundColor": "#000000",
  "resolution": "${DEFAULT_RES}",
  "framerate": "${DEFAULT_FPS}",
  "interlaced": false
}
EOF

echo ""
echo "=============================="
echo " Installation complete!"
echo "=============================="
echo ""
echo " Admin panel (after reboot):"
echo "   http://${CHOSEN_HOST}.local:3000"
echo ""
echo " Rebooting in 5 seconds... (Ctrl+C to cancel)"
sleep 5
sudo reboot
```

- [ ] **Make executable**

```bash
chmod +x install.sh
```

- [ ] **Dry-run syntax check**

```bash
bash -n install.sh && echo "Syntax OK"
```

Expected: `Syntax OK`

- [ ] **Commit**

```bash
git add install.sh
git commit -m "feat: add one-command install script"
```

---

## Task 7: Rewrite SETUP.md

**Files:**
- Rewrite: `SETUP.md`

- [ ] **Write `SETUP.md`**

```markdown
# ATEM HTML Source — Setup Guide

Turns a Raspberry Pi into a fullscreen HDMI source for a Blackmagic ATEM switcher.
Display webpages, HTML graphics, images, or solid key colours — all controlled from a web admin panel.

---

## Hardware

- Raspberry Pi 3B+ (or any Pi with desktop-capable GPU)
- HDMI cable to an ATEM switcher input
- Network connection (ethernet recommended)

---

## Step 1 — Image the SD card

Download and flash **Raspberry Pi OS Desktop (32-bit, Trixie)** using Raspberry Pi Imager.

In the imager's **OS Customisation** screen, set:
- Hostname (e.g. `atemhtml`)
- Username and password
- SSH enabled
- Wi-Fi (if not using ethernet)

---

## Step 2 — Install

Boot the Pi, SSH in, then run:

```bash
git clone https://github.com/YOUR_USERNAME/atem-html-source.git
cd atem-html-source
chmod +x install.sh && ./install.sh
```

The script asks two questions:
1. Confirm hostname
2. Choose default HDMI output resolution/framerate

Then it configures everything and reboots. Allow ~5 minutes for the full run on a 3B+.

---

## Step 3 — Use it

After reboot, open the admin panel from any device on the same network:

```
http://atemhtml.local:3000
```

### Display modes

| Mode | Description |
|------|-------------|
| HTML | Write any HTML/CSS. Use `background: transparent` to key over video. |
| URL | Paste any webpage URL — loads in a fullscreen embedded browser. |
| Image | Display an image from a URL. Choose fit mode (cover/contain/fill/actual). |
| Colour | Solid fill — for hold colour or key colour reference. |

### Background colour

The **background colour** setting (visible in all modes) fills the display behind all content. Set this to your chroma or luma key colour. In the ATEM, use **Linear Key** or **Luma Key** — a flat digital colour from the Pi keys better than physical green screen.

For transparent HTML or URL content, the background colour shows through and can be keyed.

### Resolution and framerate

Select from the **HDMI output** dropdown in the right panel:

- **Progressive modes** (1080p, 720p, SD) — applied instantly, no reboot
- **Interlaced modes** (1080i, 576i, 480i) — click **Apply & Reboot**, Pi returns in ~45 seconds

### Ctrl+Enter

Keyboard shortcut to push current settings to the output instantly.

---

## Troubleshooting

**Server not starting:**
```bash
sudo systemctl status atem-html-source
sudo journalctl -u atem-html-source -n 50
```

**HDMI not outputting / ATEM not seeing signal:**
- Confirm `hdmi_force_hotplug=1` is in `/boot/firmware/config.txt`
- Try a different HDMI mode from the admin panel

**GPU errors in terminal (`GLES3 is unsupported`):**
Harmless on 3B+. Chromium falls back to software rendering automatically.

**Chromium not found:**
The binary is `chromium` on Trixie. Check with `which chromium`.

**Pi 3B+ performance tips:**
- Stick to 1080p or 720p
- Avoid canvas-heavy animations
- If rendering is slow, add `--disable-gpu-compositing` to the Chromium flags in `kiosk-launch.sh`

---

## File structure

```
atem-html-source/
├── server.js                  # Node.js server
├── package.json
├── config.json                # Runtime config (gitignored)
├── atem-html-source.service   # systemd unit
├── kiosk-launch.sh            # Chromium kiosk launcher
├── atem-set-hdmi.sh           # Sudoers wrapper for HDMI mode changes
├── install.sh                 # One-command setup script
├── SETUP.md                   # This file
└── public/
    ├── admin.html             # Admin control panel
    └── display.html           # Fullscreen HDMI output page
```
```

- [ ] **Commit**

```bash
git add SETUP.md
git commit -m "docs: rewrite SETUP.md for new install flow"
```

---

## Task 8: Final verification

- [ ] **Start server and run a full smoke test**

```bash
node server.js &
SERVER_PID=$!

# 1. Default config
echo "--- GET /api/config ---"
curl -s http://localhost:3000/api/config | python3 -m json.tool

# 2. Push HTML mode
curl -s -X POST http://localhost:3000/api/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"html","html":"<p>test</p>","backgroundColor":"#FF0000"}' > /dev/null
echo "HTML mode pushed"

# 3. Push URL mode
curl -s -X POST http://localhost:3000/api/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"url","url":"https://example.com"}' > /dev/null
echo "URL mode pushed"

# 4. Resolution — progressive
echo "--- POST /api/resolution (progressive) ---"
curl -s -X POST http://localhost:3000/api/resolution \
  -H 'Content-Type: application/json' \
  -d '{"resolution":"1920x1080","framerate":"25","interlaced":false,"hdmiGroup":1,"hdmiMode":33}' \
  | python3 -m json.tool

# 5. Resolution — interlaced
echo "--- POST /api/resolution (interlaced) ---"
curl -s -X POST http://localhost:3000/api/resolution \
  -H 'Content-Type: application/json' \
  -d '{"resolution":"1920x1080","framerate":"50","interlaced":true,"hdmiGroup":1,"hdmiMode":20}' \
  | python3 -m json.tool

# 6. Admin and display pages load
curl -sf http://localhost:3000/ > /dev/null && echo "Admin page OK"
curl -sf http://localhost:3000/display > /dev/null && echo "Display page OK"

kill $SERVER_PID
```

Expected:
- Config shows `mode: "color"`, no overlay fields
- HTML and URL pushes return no errors
- Progressive resolution returns `{"ok": true, "requiresReboot": ...}`
- Interlaced resolution returns `{"ok": true, "requiresReboot": true}`
- Both pages return HTTP 200

- [ ] **Verify no overlay references remain in any file**

```bash
grep -r "overlay" public/ server.js --include="*.html" --include="*.js" -l
```

Expected: no output (no files match).

- [ ] **Final commit**

```bash
git add -A
git status
git commit -m "chore: final smoke test and cleanup"
```

---

## On-Pi checklist (run after install.sh)

After the Pi reboots and the kiosk appears, verify:

1. Chromium opens fullscreen with no desktop or cursor visible
2. Admin panel accessible at `http://atemhtml.local:3000` from another device
3. Pushing each mode (HTML, URL, Image, Colour) updates the display within 1 second
4. Background colour change updates immediately
5. Setting a URL (e.g. `https://example.com`) loads the page fullscreen
6. Image contain mode shows background colour in letterbox areas
7. Selecting a progressive resolution and clicking Apply — no reboot, badge updates
8. Selecting an interlaced mode shows "Apply & Reboot" button
9. ATEM detects signal on the correct input
