# Arash Terminal

A web-based terminal you can access from your phone or any browser. Gives you a real shell session (PowerShell on Windows, bash on Linux/macOS) with password authentication, HTTPS, and rate limiting.

![Login → Terminal](https://img.shields.io/badge/stack-Node.js%20%2B%20xterm.js-blue)

## Prerequisites

- **Node.js** (v18 or later)
- **OpenSSL** (for generating HTTPS certificates — comes pre-installed on macOS/Linux, install via [Git for Windows](https://gitforwindows.org/) or [Win64 OpenSSL](https://slproweb.com/products/Win32OpenSSL.html) on Windows)
- **Build tools** for `node-pty` native compilation:
  - **Windows:** `npm install -g windows-build-tools` or install Visual Studio Build Tools with the "Desktop development with C++" workload
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Linux:** `sudo apt install build-essential python3` (Debian/Ubuntu)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-username/arash-terminal.git
cd arash-terminal
npm install
```

### 2. Generate HTTPS certificates

```bash
npm run gen-cert
```

Creates self-signed certs in `certs/`. Your browser will show a security warning on first visit — click through it to proceed.

### 3. Set a password

Generate a bcrypt hash for your password:

```bash
npm run hash-password -- yourpassword
```

Create a `.env` file in the project root and paste the hash:

```env
TERMINAL_PASSWORD_HASH=$2b$10$xxxYourHashHerexxx
```

### 4. Start the server

```bash
npm start
```

Output:

```
Arash Terminal running on HTTPS:
  Local:   https://localhost:5000
  Network: https://192.168.1.x:5000
  IP allow: all (no restriction)
```

Open the **Network** URL on your phone (same Wi-Fi network) or the **Local** URL on the host machine.

## Remote Access (Public URL)

To access the terminal from outside your local network:

```bash
npm run tunnel
```

This uses [localtunnel](https://github.com/localtunnel/localtunnel) to create a public URL. The tunnel URL will be printed to the console.

## Configuration

All configuration goes in the `.env` file.

| Variable | Required | Default | Description |
|---|---|---|---|
| `TERMINAL_PASSWORD_HASH` | Yes | — | Bcrypt hash of your login password |
| `JWT_SECRET` | No | Auto-generated | Secret key for signing session tokens |
| `PORT` | No | `5000` | Server port |
| `ALLOWED_IPS` | No | All allowed | Comma-separated IPs or CIDRs to allow |

### IP Allowlisting

Restrict access to specific IPs or subnets:

```env
ALLOWED_IPS=192.168.1.0/24,10.0.0.5,127.0.0.1
```

Leave it unset or empty to allow connections from any IP.

## Security

- **Password hashing** — bcrypt with salt rounds
- **Session tokens** — JWT with 1-hour expiration
- **Rate limiting** — 5 failed login attempts locks out the IP for 15 minutes
- **IP allowlisting** — optional CIDR-based filtering
- **HTTPS/TLS** — encrypted connections with self-signed certificates
- **Environment filtering** — `TERMINAL_PASSWORD_HASH`, `JWT_SECRET`, and `ALLOWED_IPS` are stripped from the shell environment

## Mobile Features

The terminal includes a toolbar with special keys for mobile use:

| Button | Action |
|---|---|
| **Esc** | Escape key |
| **Tab** | Tab completion |
| **Ctrl** | Toggle — next key press sends Ctrl+key |
| **Arrows** | Navigate command history and cursor |
| **C-c** | Send interrupt (Ctrl+C) |

Touch scrolling through terminal history is also supported.

## npm Scripts

| Script | Description |
|---|---|
| `npm start` | Start the HTTPS server |
| `npm run tunnel` | Start with a public localtunnel URL |
| `npm run gen-cert` | Generate self-signed TLS certificates |
| `npm run hash-password -- <pass>` | Generate a bcrypt hash for a password |

## Project Structure

```
arash-terminal/
├── server.js          # Express + WebSocket server, auth, PTY spawning
├── public/
│   ├── index.html     # Login screen + terminal container
│   ├── client.js      # xterm.js setup, WebSocket client, mobile controls
│   └── style.css      # Dark theme styling
├── certs/             # TLS certificates (gitignored)
├── .env               # Environment config (gitignored)
└── package.json
```

## Troubleshooting

**`npm install` fails on `node-pty`**
This is a native module that needs C++ build tools. See the [Prerequisites](#prerequisites) section.

**Browser shows "Your connection is not private"**
Expected with self-signed certificates. Click "Advanced" → "Proceed" (Chrome) or "Accept the Risk" (Firefox).

**Can't connect from phone**
Make sure both devices are on the same Wi-Fi network and use the Network URL (not localhost). If you have a firewall, allow inbound connections on the configured port (default 5000).

**"Too many failed attempts" error**
Wait 15 minutes for the rate limit to reset, or restart the server to clear it immediately.
