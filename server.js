require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pty = require('node-pty');
const os = require('os');

const app = express();

const certPath = path.join(__dirname, 'certs', 'cert.pem');
const keyPath = path.join(__dirname, 'certs', 'key.pem');
let server;
let useHTTPS = false;

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  server = https.createServer({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  }, app);
  useHTTPS = true;
} else {
  server = http.createServer(app);
}

const wss = new WebSocketServer({ server });

const PASSWORD_HASH = process.env.TERMINAL_PASSWORD_HASH || '';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const PORT = process.env.PORT || 5000;
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

// IP Allowlisting: comma-separated IPs or CIDRs (e.g. "192.168.1.0/24,10.0.0.5")
// Leave ALLOWED_IPS empty or unset to allow all
const ALLOWED_IPS = process.env.ALLOWED_IPS
  ? process.env.ALLOWED_IPS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

function parseIPv4(ip) {
  // Strip IPv6-mapped prefix (::ffff:192.168.1.1 -> 192.168.1.1)
  const cleaned = ip.replace(/^.*:/, '');
  const parts = cleaned.split('.');
  if (parts.length !== 4) return null;
  return parts.reduce((num, octet) => (num << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isIPAllowed(ip) {
  if (ALLOWED_IPS.length === 0) return true;
  const ipNum = parseIPv4(ip);
  if (ipNum === null) return false;

  for (const entry of ALLOWED_IPS) {
    if (entry.includes('/')) {
      const [subnet, bits] = entry.split('/');
      const subnetNum = parseIPv4(subnet);
      const mask = bits === '0' ? 0 : (~0 << (32 - parseInt(bits, 10))) >>> 0;
      if ((ipNum & mask) === (subnetNum & mask)) return true;
    } else {
      if (ipNum === parseIPv4(entry)) return true;
    }
  }
  return false;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failedAttempts = new Map();

function isRateLimited(ip) {
  const record = failedAttempts.get(ip);
  if (!record) return false;
  if (Date.now() - record.lastAttempt > LOCKOUT_MS) {
    failedAttempts.delete(ip);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const record = failedAttempts.get(ip) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  failedAttempts.set(ip, record);
}

function clearFailures(ip) {
  failedAttempts.delete(ip);
}

app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  if (!isIPAllowed(ip)) {
    console.log(`Blocked IP: ${ip}`);
    return res.status(403).end();
  }
  next();
});

app.use(express.json());
app.use(express.static('public'));

app.post('/api/auth', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }

  const { password } = req.body;
  const valid = await bcrypt.compare(password || '', PASSWORD_HASH);

  if (!valid) {
    recordFailure(ip);
    const record = failedAttempts.get(ip);
    console.log(`Auth failed from ${ip} (attempt ${record.count}/${MAX_ATTEMPTS})`);
    return res.status(401).json({ error: 'Wrong password' });
  }

  clearFailures(ip);
  const token = jwt.sign({ ip }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

  if (!isIPAllowed(ip)) {
    console.log(`Blocked WebSocket from IP: ${ip}`);
    ws.close();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  try {
    jwt.verify(token, JWT_SECRET);
  } catch (e) {
    ws.send(JSON.stringify({ type: 'auth_failed' }));
    ws.close();
    return;
  }

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || process.env.USERPROFILE,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        !['TERMINAL_PASSWORD_HASH', 'JWT_SECRET', 'ALLOWED_IPS'].includes(key)
      )
    ),
  });

  ptyProcess.onData((data) => {
    try {
      ws.send(JSON.stringify({ type: 'output', data }));
    } catch (e) {}
  });

  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === 'input') {
        ptyProcess.write(parsed.data);
      } else if (parsed.type === 'resize') {
        ptyProcess.resize(parsed.cols, parsed.rows);
      }
    } catch (e) {}
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
  const proto = useHTTPS ? 'https' : 'http';
  console.log(`Arash Terminal running on ${useHTTPS ? 'HTTPS' : 'HTTP (no certs found, run: npm run gen-cert)'}:`);
  console.log(`  Local:   ${proto}://localhost:${PORT}`);
  console.log(`  Network: ${proto}://${lanIP}:${PORT}`);
  console.log(`  IP allow: ${ALLOWED_IPS.length ? ALLOWED_IPS.join(', ') : 'all (no restriction)'}`);

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
