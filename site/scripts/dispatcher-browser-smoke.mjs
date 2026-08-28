import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const HOST = '127.0.0.1';
const TARGET_PATH = '/Dagonizer/examples/the-dispatcher/';
const REQUIRED_SELECTORS = ['main', '.dispatcher-runner', '.backend-picker', '.diagram-frame'];
const HYDRATION_MISMATCH = 'Hydration completed but contains mismatches';
const TIMEOUT_MS = 30_000;
const LOG_LIMIT = 16_384;
const CHROME_PATHS = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const candidate of CHROME_PATHS[process.platform] ?? []) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Chrome not found for ${process.platform}; set CHROME_PATH to its executable`);
}

async function availablePort(start) {
  for (let port = start; port < start + 1_000; port += 1) {
    const free = await new Promise((resolve) => {
      const server = createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen(port, HOST, () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`No loopback port available from ${start}`);
}

function startProcess(command, args, cwd, name) {
  const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = { name, stdout: '', stderr: '', error: null };
  for (const stream of ['stdout', 'stderr']) {
    child[stream].on('data', (chunk) => {
      logs[stream] = `${logs[stream]}${chunk}`.slice(-LOG_LIMIT);
    });
  }
  child.once('error', (error) => {
    logs.error = error;
  });
  return { child, logs };
}

function processLogs(logs) {
  const output = [logs.stdout && `${logs.name} stdout:\n${logs.stdout.trimEnd()}`,
    logs.stderr && `${logs.name} stderr:\n${logs.stderr.trimEnd()}`].filter(Boolean);
  if (logs.error) output.push(`${logs.name} error: ${logs.error.message}`);
  return output.join('\n\n') || `${logs.name} emitted no logs`;
}

async function stopProcess(processState) {
  if (!processState || processState.child.exitCode !== null) return;
  const { child } = processState;
  const pid = child.pid === undefined ? undefined : -child.pid;
  if (pid === undefined) return;
  const waitForExit = (milliseconds) => Promise.race([
    new Promise((resolve) => {
      child.once('exit', resolve);
      child.once('error', resolve);
    }),
    setTimeout(milliseconds),
  ]);
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  await waitForExit(3_000);
  if (child.exitCode !== null) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return;
  }
  await waitForExit(3_000);
}

async function waitForHttp(url, preview) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (preview.logs.error || preview.child.exitCode !== null) {
      throw new Error(`Preview failed before startup\n${processLogs(preview.logs)}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview socket is not ready yet.
    }
    await setTimeout(200);
  }
  throw new Error(`Preview did not serve ${url}\n${processLogs(preview.logs)}`);
}

class CdpClient {
  #socket;
  #nextId = 0;
  #pending = new Map();
  #listeners = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (typeof message.id === 'number') {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.#listeners.get(message.method) ?? []) listener(message.params ?? {});
    });
  }

  send(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.#listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(method, listeners);
  }

  once(method) {
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => reject(new Error(`CDP ${method} event timed out`)), TIMEOUT_MS);
      const listener = (params) => {
        clearTimeout(timer);
        this.#listeners.get(method)?.delete(listener);
        resolve(params);
      };
      this.on(method, listener);
    });
  }

  close() {
    for (const pending of this.#pending.values()) clearTimeout(pending.timer);
    this.#pending.clear();
    this.#listeners.clear();
    this.#socket.close();
  }
}

async function connectToChrome(chrome, port) {
  const endpoint = `http://${HOST}:${port}/json/list`;
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (chrome.logs.error || chrome.child.exitCode !== null) {
      throw new Error(`Chrome failed before CDP startup\n${processLogs(chrome.logs)}`);
    }
    try {
      const pages = await fetch(endpoint).then((response) => response.json());
      const page = pages.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener('open', resolve, { once: true });
          socket.addEventListener('error', reject, { once: true });
        });
        return new CdpClient(socket);
      }
    } catch {
      // Chrome has not published its page endpoint yet.
    }
    await setTimeout(200);
  }
  throw new Error(`Chrome CDP did not start\n${processLogs(chrome.logs)}`);
}

function consoleText(argument) {
  if (Object.hasOwn(argument, 'value')) {
    if (typeof argument.value === 'string') return argument.value;
    return JSON.stringify(argument.value) ?? String(argument.value);
  }
  return argument.description ?? argument.type ?? '';
}

async function waitForClient(client) {
  const deadline = Date.now() + TIMEOUT_MS;
  let state = null;
  const expression = `(() => {
    const selectors = ${JSON.stringify(REQUIRED_SELECTORS)};
    const missing = selectors.filter((selector) => document.querySelector(selector) === null);
    const runner = document.querySelector('.dispatcher-runner');
    const island = runner?.closest('astro-island');
    return { missing, ready: document.readyState === 'complete' && missing.length === 0 && (!island || !island.hasAttribute('ssr')) };
  })()`;
  while (Date.now() < deadline) {
    const result = await client.send('Runtime.evaluate', { expression, returnByValue: true });
    state = result.result?.value ?? null;
    if (state?.ready) return;
    await setTimeout(200);
  }
  throw new Error(`Dispatcher client did not start; state=${JSON.stringify(state)}`);
}

async function main() {
  await stat(new URL('../dist/index.html', import.meta.url));
  await stat(new URL('../dist/examples/the-dispatcher/index.html', import.meta.url));
  const previewPort = await availablePort(4_400);
  const debugPort = await availablePort(9_500);
  const profile = await mkdtemp(join(tmpdir(), 'dispatcher-browser-smoke-'));
  let preview = null;
  let chrome = null;
  let client = null;
  let cleanupPromise = null;
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      client?.close();
      await stopProcess(chrome);
      await stopProcess(preview);
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    })();
    return cleanupPromise;
  };
  const onSignal = () => cleanup().then(() => process.exit(1), () => process.exit(1));
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    preview = startProcess('pnpm', ['exec', 'astro', 'preview', '--host', HOST, '--port', String(previewPort), '--strictPort'], new URL('..', import.meta.url), 'preview');
    await waitForHttp(`http://${HOST}:${previewPort}/Dagonizer/`, preview);
    chrome = startProcess(chromePath(), [
      '--headless=new', `--remote-debugging-port=${debugPort}`, `--remote-debugging-address=${HOST}`,
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', '--disable-extensions', '--disable-sync', 'about:blank',
    ], process.cwd(), 'chrome');
    client = await connectToChrome(chrome, debugPort);

    const consoleMessages = [];
    const logErrors = [];
    const exceptions = [];
    client.on('Runtime.consoleAPICalled', (event) => {
      consoleMessages.push({ type: event.type, text: (event.args ?? []).map(consoleText).join(' ') });
    });
    client.on('Runtime.exceptionThrown', (event) => {
      exceptions.push(event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text ?? 'Unknown exception');
    });
    client.on('Log.entryAdded', (event) => {
      if (event.entry?.level === 'error') logErrors.push(event.entry.text ?? 'Unknown log error');
    });
    await Promise.all([client.send('Runtime.enable'), client.send('Log.enable'), client.send('Page.enable')]);

    const targetUrl = `http://${HOST}:${previewPort}${TARGET_PATH}`;
    const loaded = client.once('Page.loadEventFired');
    await client.send('Page.navigate', { url: targetUrl });
    await loaded;
    await waitForClient(client);
    await setTimeout(250);

    const hydrationWarnings = consoleMessages.filter(({ text }) => text.includes(HYDRATION_MISMATCH));
    const consoleErrors = consoleMessages.filter(({ type }) => type === 'error');
    if (hydrationWarnings.length || consoleErrors.length || logErrors.length || exceptions.length) {
      throw new Error(`Browser diagnostics failed:\n${JSON.stringify({ hydrationWarnings, consoleErrors, logErrors, exceptions }, null, 2)}`);
    }
    console.log(`dispatcher-browser-smoke: PASS ${targetUrl}; selectors=${REQUIRED_SELECTORS.join(',')}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`dispatcher-browser-smoke: FAIL\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
