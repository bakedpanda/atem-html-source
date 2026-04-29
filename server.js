const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const CONFIG_FILE = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  mode: 'html',          // 'html' | 'image' | 'color'
  html: '<h1 style="color:white;font-family:sans-serif;font-size:80px;margin:0;">Live</h1>',
  imageUrl: '',
  backgroundColor: '#000000',
  resolution: '1920x1080',
  framerate: '25',
  customCss: 'body { background: #000; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; overflow: hidden; }',
  overlayEnabled: false,
  overlayText: '',
  overlayPosition: 'bottom-left',
  overlayStyle: 'color:white;font-family:sans-serif;font-size:36px;padding:20px;background:rgba(0,0,0,0.5);'
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch (e) {
    console.error('Failed to load config, using defaults:', e.message);
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

wss.on('connection', (ws, req) => {
  // Send current config immediately on connect
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
      console.error('WS message error:', e.message);
    }
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// REST fallback for config
app.get('/api/config', (req, res) => res.json(currentConfig));

app.post('/api/config', (req, res) => {
  currentConfig = { ...currentConfig, ...req.body };
  saveConfig(currentConfig);
  broadcast({ type: 'config', config: currentConfig });
  res.json({ ok: true, config: currentConfig });
});

// Serve display page (shown on HDMI output)
app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

// Serve admin page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ATEM HTML Source running`);
  console.log(`  Admin UI:    http://localhost:${PORT}/admin`);
  console.log(`  Display URL: http://localhost:${PORT}/display`);
  console.log(`\n  Open the Display URL in Chromium kiosk mode on the Pi.\n`);
});
