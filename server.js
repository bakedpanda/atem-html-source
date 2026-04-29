const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');

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
  interlaced: false,
  showIdle: true,
  urlHistory: [],
  colourPresets: [],
  contentPresets: [],
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
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e.message);
  }
}

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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

app.post('/api/resolution', (req, res) => {
  const { resolution, framerate, interlaced, hdmiGroup, hdmiMode } = req.body;
  if (!resolution || !framerate || hdmiGroup == null || hdmiMode == null) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  if (!/^\d+x\d+$/.test(resolution) || !/^[\d.]+$/.test(String(framerate))) {
    return res.status(400).json({ ok: false, error: 'Invalid resolution or framerate format' });
  }

  programConfig = { ...programConfig, resolution, framerate, interlaced: !!interlaced };
  saveConfig(programConfig);
  broadcast({ type: 'programUpdate', config: programConfig });

  exec(`sudo atem-set-hdmi ${parseInt(hdmiGroup)} ${parseInt(hdmiMode)}`, { timeout: 5000 }, (err) => {
    if (err) console.error('atem-set-hdmi error:', err.message);
  });

  if (interlaced) {
    return res.json({ ok: true, requiresReboot: true });
  }

  const [w, h] = resolution.split('x');
  const rate = parseFloat(framerate);

  function tryXrandr(output, cb) {
    exec(`DISPLAY=:0 xrandr --output ${output} --mode ${w}x${h} --rate ${rate}`, { timeout: 5000 }, cb);
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

app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true });
  setTimeout(() => exec('sudo poweroff'), 500);
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
