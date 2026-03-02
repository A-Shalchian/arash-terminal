require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PASSWORD = process.env.TERMINAL_PASSWORD || 'changeme';
const PORT = process.env.PORT || 3000;
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

app.use(express.static('public'));

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (token !== PASSWORD) {
    ws.send(JSON.stringify({ type: 'auth_failed' }));
    ws.close();
    return;
  }

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || process.env.USERPROFILE,
    env: process.env,
  });

  ptyProcess.onData((data) => {
    try {
      ws.send(JSON.stringify({ type: 'output', data }));
    } catch (e) {
      // WebSocket closed
    }
  });

  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === 'input') {
        ptyProcess.write(parsed.data);
      } else if (parsed.type === 'resize') {
        ptyProcess.resize(parsed.cols, parsed.rows);
      }
    } catch (e) {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    ptyProcess.kill();
  });

  console.log('Terminal session started');
});

server.listen(PORT, '0.0.0.0', async () => {
  const interfaces = os.networkInterfaces();
  let lanIP = 'unknown';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        lanIP = iface.address;
        break;
      }
    }
  }
  console.log(`Arash Terminal running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${lanIP}:${PORT}`);

  if (process.argv.includes('--tunnel')) {
    try {
      const localtunnel = require('localtunnel');
      const tunnel = await localtunnel({ port: PORT });
      console.log(`  Tunnel:  ${tunnel.url}`);
      tunnel.on('close', () => console.log('Tunnel closed'));
    } catch (e) {
      console.error('Tunnel failed:', e.message);
    }
  }
});
