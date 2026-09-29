// End-to-end test helpers: runs the real Electron app against a temporary
// data folder and a local fake TMDB, and drives its window through the
// Chrome DevTools Protocol (no extra dependencies: Node's own http, fetch and
// WebSocket). See app.e2e.js.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const electronPath = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 'YYYY-MM-DD' in local time, `offset` days from today.
function dayOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ---------- Fake TMDB ---------- */

// `routes` maps a path (without /3 and query string) to a JSON body. Every
// request is recorded, with its Authorization header.
async function startFakeTmdb(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname.replace(/^\/3/, '');
    requests.push({ path: route, auth: req.headers.authorization || null });
    const body = routes[route];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body || { status_message: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/3`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/* ---------- Data folder ---------- */

// Writes a data folder like %APPDATA%\peliculas-app: `files` maps a relative
// path to a JSON value.
function makeUserData(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peliculas-e2e-'));
  Object.entries(files).forEach(([rel, value]) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  });
  return dir;
}

function readUserDataJson(dir, rel) {
  return JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
}

/* ---------- DevTools protocol ---------- */

class Page {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.problems = [];
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
  }

  onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      this.pending.get(msg.id)(msg);
      this.pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      this.problems.push(`exception: ${d.exception ? d.exception.description : d.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      this.problems.push(`console.error: ${msg.params.args.map((a) => a.value || a.description).join(' ')}`);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      // Failed image loads (no posters in the fixtures) aren't problems.
      if (!/Failed to load resource/.test(msg.params.entry.text)) this.problems.push(`log: ${msg.params.entry.text}`);
    }
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      this.nextId += 1;
      this.pending.set(this.nextId, resolve);
      this.ws.send(JSON.stringify({ id: this.nextId, method, params }));
    });
  }

  // Runs `fn(...args)` in the page (args must be JSON) and returns its
  // (awaited) result.
  async eval(fn, ...args) {
    const res = await this.send('Runtime.evaluate', {
      expression: `(${fn.toString()})(...${JSON.stringify(args)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.result.exceptionDetails) {
      const d = res.result.exceptionDetails;
      throw new Error(`In page: ${d.exception ? d.exception.description : d.text}`);
    }
    return res.result.result.value;
  }

  async waitFor(fn, { timeout = 15000, args = [], message = 'condition' } = {}) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeout) {
      try {
        last = await this.eval(fn, ...args);
        if (last) return last;
      } catch (err) {
        last = err.message;
      }
      await sleep(150);
    }
    throw new Error(`Timed out waiting for ${message} (last: ${JSON.stringify(last)})`);
  }
}

/* ---------- App ---------- */

async function waitForFile(file, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim()) return fs.readFileSync(file, 'utf8');
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

// Starts the app on `userDataDir`. Returns { page, output(), exited(), close() }.
async function launchApp({ userDataDir, tmdbUrl, args = [] }) {
  const env = { ...process.env, PELICULAS_E2E: '1', PELICULAS_TMDB_API_URL: tmdbUrl };
  // Even set to '', this makes Electron start as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, ['.', `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', ...args], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let exited = false;
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('exit', () => { exited = true; });

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const port = (await waitForFile(portFile, 30000)).split('\n')[0].trim();
  let target = null;
  const start = Date.now();
  while (!target && Date.now() - start < 30000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
    } catch {
      // DevTools endpoint not up yet
    }
    if (!target) await sleep(150);
  }
  if (!target) throw new Error('App window never showed up');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const page = new Page(ws);
  await page.send('Runtime.enable');
  await page.send('Log.enable');

  return {
    page,
    output: () => output,
    exited: () => exited,
    // Closes the window like its X button does (see main.js, E2E_MODE).
    closeWindow: () => page.eval(() => { window.e2e.closeWindow(); }),
    // Notifications the app showed (printed in test mode).
    notifications: () => output.split(/\r?\n/)
      .filter((l) => l.startsWith('[notify] '))
      .map((l) => JSON.parse(l.slice('[notify] '.length))),
    async close() {
      try { ws.close(); } catch { /* already closed */ }
      if (!exited) {
        if (process.platform === 'win32') {
          try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
        } else {
          child.kill('SIGKILL');
        }
        const t = Date.now();
        while (!exited && Date.now() - t < 10000) await sleep(100);
      }
    },
  };
}

module.exports = { dayOffset, startFakeTmdb, makeUserData, readUserDataJson, launchApp, sleep };
