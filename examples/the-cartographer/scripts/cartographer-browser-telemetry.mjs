import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const PREVIEW_HOST = '127.0.0.1';
const DEFAULT_PREVIEW_PORT = 5175;
const DEFAULT_CHROME_DEBUG_PORT = 9222;
const TELEMETRY_KEY = '__cartographerTelemetry';
const TRACE_CATEGORIES = [
  '-*',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-v8.cpu_profiler',
  'disabled-by-default-v8.cpu_profiler.hires',
];
const CHILD_LOG_LIMIT = 16_384;

function createChildLogBuffer(name) {
  return {
    name,
    stdout: '',
    stderr: '',
  };
}

function appendChildLog(buffer, stream, chunk) {
  const next = `${buffer[stream]}${chunk.toString()}`;
  buffer[stream] = next.length <= CHILD_LOG_LIMIT
    ? next
    : next.slice(next.length - CHILD_LOG_LIMIT);
}

function formatChildLogs(buffer) {
  const parts = [];
  if (buffer.stdout !== '') {
    parts.push(`${buffer.name} stdout:\n${buffer.stdout.trimEnd()}`);
  }
  if (buffer.stderr !== '') {
    parts.push(`${buffer.name} stderr:\n${buffer.stderr.trimEnd()}`);
  }
  return parts.length === 0 ? `${buffer.name} emitted no logs` : parts.join('\n\n');
}

function parseArgs(argv) {
  const args = {
    totalEvents: 1000,
    poolSize: 4,
    batchCapacity: 1000,
    loadTopology: false,
    trace: false,
    tracePath: '.orchestration/perf/cartographer-browser-trace.json',
    timeoutMs: 180000,
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    previewPort: DEFAULT_PREVIEW_PORT,
    chromeDebugPort: DEFAULT_CHROME_DEBUG_PORT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    switch (key) {
      case '--total-events':
        if (value !== undefined) args.totalEvents = Math.max(1, Math.min(1_000_000, Number.parseInt(value, 10) || args.totalEvents));
        i++;
        break;
      case '--pool-size':
        if (value !== undefined) args.poolSize = Math.max(1, Math.min(32, Number.parseInt(value, 10) || args.poolSize));
        i++;
        break;
      case '--batch-capacity':
        if (value !== undefined) args.batchCapacity = Math.max(1, Math.min(10_000, Number.parseInt(value, 10) || args.batchCapacity));
        i++;
        break;
      case '--timeout-ms':
        if (value !== undefined) args.timeoutMs = Math.max(1000, Number.parseInt(value, 10) || args.timeoutMs);
        i++;
        break;
      case '--trace-path':
        if (value !== undefined) args.tracePath = value;
        i++;
        break;
      case '--chrome-path':
        if (value !== undefined) args.chromePath = value;
        i++;
        break;
      case '--preview-port':
        if (value !== undefined) args.previewPort = Math.max(1, Number.parseInt(value, 10) || args.previewPort);
        i++;
        break;
      case '--chrome-debug-port':
        if (value !== undefined) args.chromeDebugPort = Math.max(1, Number.parseInt(value, 10) || args.chromeDebugPort);
        i++;
        break;
      case '--load-topology':
        args.loadTopology = true;
        break;
      case '--trace':
        args.trace = true;
        break;
      default:
        break;
    }
  }

  return args;
}

async function findAvailablePort(startPort) {
  let candidate = startPort;
  while (candidate < startPort + 1000) {
    const free = await new Promise((resolve) => {
      const server = createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen(candidate, PREVIEW_HOST, () => {
        server.close(() => resolve(true));
      });
    });
    if (free) return candidate;
    candidate += 1;
  }
  throw new Error(`Unable to find an available port starting from ${startPort}`);
}

async function ensureBuilt() {
  await stat(new URL('../dist/index.html', import.meta.url));
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
}

function startPreviewServer(port) {
  const child = spawn(
    'npm',
    ['run', 'preview', '--', '--host', PREVIEW_HOST, '--port', String(port), '--strictPort'],
    {
      cwd: new URL('..', import.meta.url),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const logs = createChildLogBuffer('preview');
  child.stdout.on('data', (chunk) => {
    appendChildLog(logs, 'stdout', chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    appendChildLog(logs, 'stderr', chunk);
    process.stderr.write(chunk);
  });
  return { child, logs };
}

function startChrome(chromePath, userDataDir, targetUrl, debugPort) {
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${String(debugPort)}`,
      `--remote-debugging-address=${PREVIEW_HOST}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-renderer-backgrounding',
      '--disable-extensions',
      '--disable-sync',
      '--metrics-recording-only',
      '--enable-logging=stderr',
      '--v=1',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      targetUrl,
    ],
    {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const logs = createChildLogBuffer('chrome');
  child.stdout.on('data', (chunk) => {
    appendChildLog(logs, 'stdout', chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    appendChildLog(logs, 'stderr', chunk);
    process.stderr.write(chunk);
  });
  return { child, logs };
}

class CdpClient {
  #ws;
  #id = 0;
  #pending = new Map();
  #eventWaiters = new Map();

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (typeof message.id === 'number') {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        if ('error' in message) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const waiters = this.#eventWaiters.get(message.method);
      if (waiters === undefined || waiters.length === 0) return;
      for (const waiter of waiters.splice(0)) waiter(message.params ?? {});
    });
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolve) => {
      const waiters = this.#eventWaiters.get(method) ?? [];
      waiters.push(resolve);
      this.#eventWaiters.set(method, waiters);
    });
  }

  close() {
    this.#ws.close();
  }
}

async function openCdpPageClient(timeoutMs, debugPort) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await fetch(`http://${PREVIEW_HOST}:${debugPort}/json/list`).then((response) => response.json());
      const page = list.find((entry) => entry.type === 'page' && typeof entry.webSocketDebuggerUrl === 'string');
      if (page !== undefined) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', reject, { once: true });
        });
        return new CdpClient(ws);
      }
    } catch {
      // continue polling
    }
    await sleep(250);
  }
  throw new Error('Timed out opening CDP page client');
}

async function waitForChromeDebugEndpoint(chromeChild, chromeLogs, debugPort, timeoutMs) {
  const url = `http://${PREVIEW_HOST}:${debugPort}/json/version`;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (chromeChild.exitCode !== null) {
      throw new Error(
        `Chrome exited before CDP became ready (exit=${chromeChild.exitCode ?? 'unknown'}).\n${formatChildLogs(chromeLogs)}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for Chrome CDP endpoint ${url}${lastError instanceof Error ? `: ${lastError.message}` : ''}.\n${formatChildLogs(chromeLogs)}`,
  );
}

async function collectTrace(client, enabled, tracePath) {
  if (!enabled) {
    return {
      async stop() {
        return null;
      },
    };
  }

  const events = [];
  const onData = (params) => {
    for (const value of params.value ?? []) events.push(value);
  };
  const onDataPromise = new Promise((resolve) => {
    const loop = async () => {
      while (true) {
        const params = await client.once('Tracing.dataCollected');
        onData(params);
        resolve(undefined);
      }
    };
    void loop();
  });
  void onDataPromise;

  await client.send('Tracing.start', {
    transferMode: 'ReportEvents',
    categories: TRACE_CATEGORIES.join(','),
  });

  return {
    async stop() {
      const completePromise = client.once('Tracing.tracingComplete');
      await client.send('Tracing.end');
      await completePromise;
      await mkdir(join(process.cwd(), '.orchestration', 'perf'), { recursive: true });
      await writeFile(tracePath, `${JSON.stringify({ traceEvents: events })}\n`, 'utf8');
      return tracePath;
    },
  };
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const groupPid = typeof child.pid === 'number' ? -child.pid : null;
  const killPid = groupPid ?? child.pid;
  if (killPid === undefined) return;
  try {
    process.kill(killPid, 'SIGTERM');
  } catch {
    return;
  }
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(5000).then(() => {
      if (child.exitCode !== null) return;
      try {
        process.kill(killPid, 'SIGKILL');
      } catch {
        // process already exited
      }
    }),
  ]);
}

async function waitForCompletion(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const telemetry = await client.send('Runtime.evaluate', {
      expression: `window.${TELEMETRY_KEY} ?? null`,
      returnByValue: true,
    });
    const value = telemetry.result?.value ?? null;
    if (value !== null && (value.status === 'completed' || value.status === 'failed')) {
      const metrics = await client.send('Performance.getMetrics');
      return { telemetry: value, metrics: metrics.metrics ?? [] };
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for browser telemetry after ${timeoutMs}ms`);
}

function metricMap(metrics) {
  return Object.fromEntries(metrics.map((entry) => [entry.name, entry.value]));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureBuilt();

  const previewPort = await findAvailablePort(args.previewPort);
  const chromeDebugPort = await findAvailablePort(args.chromeDebugPort);
  const preview = startPreviewServer(previewPort);
  const userDataDir = await mkdtemp(join(tmpdir(), 'cartographer-browser-'));
  const query = new URLSearchParams({
    autorun: '1',
    totalEvents: String(args.totalEvents),
    poolSize: String(args.poolSize),
    batchCapacity: String(args.batchCapacity),
    ...(args.loadTopology ? { loadTopology: '1' } : {}),
  });
  const targetUrl = `http://${PREVIEW_HOST}:${previewPort}/?${query.toString()}`;
  let chrome = null;
  let client = null;

  try {
    await waitForHttp(`http://${PREVIEW_HOST}:${previewPort}/`, 30000);
    chrome = startChrome(args.chromePath, userDataDir, targetUrl, chromeDebugPort);
    await waitForChromeDebugEndpoint(chrome.child, chrome.logs, chromeDebugPort, 30000);
    client = await openCdpPageClient(30000, chromeDebugPort);
    await client.send('Runtime.enable');
    await client.send('Performance.enable');

    const trace = await collectTrace(client, args.trace, args.tracePath);
    const { telemetry, metrics } = await waitForCompletion(client, args.timeoutMs);
    const traceFile = await trace.stop();
    const browserMetrics = metricMap(metrics);

    const result = {
      targetUrl,
      telemetry,
      browserMetrics: {
        TaskDuration: browserMetrics.TaskDuration ?? null,
        ScriptDuration: browserMetrics.ScriptDuration ?? null,
        LayoutDuration: browserMetrics.LayoutDuration ?? null,
        RecalcStyleDuration: browserMetrics.RecalcStyleDuration ?? null,
        JSHeapUsedSize: browserMetrics.JSHeapUsedSize ?? null,
        Nodes: browserMetrics.Nodes ?? null,
      },
      traceFile,
    };

    console.log(JSON.stringify(result, null, 2));

    if (telemetry.status !== 'completed') {
      throw new Error(`Cartographer browser run failed: ${telemetry.errorMessage ?? 'unknown error'}`);
    }
  } finally {
    client?.close();
    await stopChild(preview.child);
    if (chrome !== null) await stopChild(chrome.child);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}

await main();
