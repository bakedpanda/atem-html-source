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
  interlaced: false,
  showIdle: true
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
        const update = { ...msg.config };
        if (update.framerate != null) update.framerate = String(update.framerate);
        currentConfig = { ...currentConfig, ...update };
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
  const body = { ...req.body };
  if (body.framerate != null) body.framerate = String(body.framerate);
  currentConfig = { ...currentConfig, ...body };
  saveConfig(currentConfig);
  broadcast({ type: 'config', config: currentConfig });
  res.json({ ok: true, config: currentConfig });
});

app.post('/api/resolution', (req, res) => {
  const { resolution, framerate, interlaced, hdmiGroup, hdmiMode } = req.body;
  if (!resolution || !framerate || hdmiGroup == null || hdmiMode == null) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  if (!/^\d+x\d+$/.test(resolution) || !/^[\d.]+$/.test(String(framerate))) {
    return res.status(400).json({ ok: false, error: 'Invalid resolution or framerate format' });
  }

  currentConfig = { ...currentConfig, resolution, framerate, interlaced: !!interlaced };
  saveConfig(currentConfig);
  broadcast({ type: 'config', config: currentConfig });

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
