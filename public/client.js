const loginScreen = document.getElementById('login-screen');
const terminalScreen = document.getElementById('terminal-screen');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const errorMsg = document.getElementById('error-msg');
const ctrlBtn = document.getElementById('ctrl-btn');

let ws = null;
let term = null;
let fitAddon = null;
let ctrlActive = false;

function connect(password) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/?token=${encodeURIComponent(password)}`);

  ws.onopen = () => {
    loginScreen.classList.add('hidden');
    terminalScreen.classList.remove('hidden');
    initTerminal();
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'output') {
      term.write(msg.data);
    } else if (msg.type === 'auth_failed') {
      errorMsg.textContent = 'Wrong password';
      ws.close();
    }
  };

  ws.onclose = () => {
    if (term) {
      term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
    }
  };
}

function initTerminal() {
  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    scrollback: 5000,
    theme: {
      background: '#1a1a2e',
      foreground: '#e0e0e0',
      cursor: '#e0e0e0',
      selectionBackground: '#44475a',
    },
  });

  fitAddon = new FitAddon.FitAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  term.open(document.getElementById('terminal'));
  fitAddon.fit();

  term.onData((data) => {
    if (ctrlActive) {
      // Convert to ctrl character: 'a' -> \x01, 'c' -> \x03, etc.
      const char = data.toLowerCase();
      if (char >= 'a' && char <= 'z') {
        data = String.fromCharCode(char.charCodeAt(0) - 96);
      }
      ctrlActive = false;
      ctrlBtn.classList.remove('active');
    }
    ws.send(JSON.stringify({ type: 'input', data }));
  });

  term.onResize(({ cols, rows }) => {
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  });

  window.addEventListener('resize', () => fitAddon.fit());

  // Custom touch scrolling for mobile
  const termEl = document.getElementById('terminal');
  let touchStartY = null;
  let touchAccum = 0;
  const LINE_HEIGHT = 20; // approx pixels per scroll line

  termEl.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      touchAccum = 0;
    }
  }, { passive: true });

  termEl.addEventListener('touchmove', (e) => {
    if (touchStartY === null || e.touches.length !== 1) return;
    e.preventDefault();
    const deltaY = touchStartY - e.touches[0].clientY;
    touchStartY = e.touches[0].clientY;
    touchAccum += deltaY;

    const lines = Math.trunc(touchAccum / LINE_HEIGHT);
    if (lines !== 0) {
      term.scrollLines(lines);
      touchAccum -= lines * LINE_HEIGHT;
    }
  }, { passive: false });

  termEl.addEventListener('touchend', () => {
    touchStartY = null;
    touchAccum = 0;
  }, { passive: true });

  // Tap terminal to focus
  termEl.addEventListener('click', () => {
    term.focus();
  });

  term.focus();
  sendResize();
}

function sendResize() {
  if (fitAddon && ws && ws.readyState === WebSocket.OPEN) {
    fitAddon.fit();
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }
}

// Login handlers
loginBtn.addEventListener('click', () => connect(passwordInput.value));
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connect(passwordInput.value);
});

// Toolbar button handlers
document.querySelectorAll('#toolbar button[data-key]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: btn.dataset.key }));
    }
    term?.focus();
  });
});

// Ctrl toggle
ctrlBtn.addEventListener('click', (e) => {
  e.preventDefault();
  ctrlActive = !ctrlActive;
  ctrlBtn.classList.toggle('active', ctrlActive);
  term?.focus();
});

// Handle orientation change on mobile
window.addEventListener('orientationchange', () => {
  setTimeout(sendResize, 200);
});

// Handle iOS Safari address bar resize
window.visualViewport?.addEventListener('resize', () => {
  sendResize();
});
