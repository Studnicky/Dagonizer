import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

import { CartographerTelemetryContract } from '../app/CartographerTelemetryContract.ts';
import { CpuProfileAttribution } from '../app/CpuProfileAttribution.ts';

const PREVIEW_HOST = '127.0.0.1';
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
    await setTimeout(250);
  }
  throw new Error(`Timed out waiting for ${url}${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
}

function startPreviewServer(port) {
  const child = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--host', PREVIEW_HOST, '--port', String(port), '--strictPort'],
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
  });
  return { child, logs };
}

class CdpClient {
  #ws;
  #id = 0;
  #pending = new Map();
  #eventWaiters = new Map();
  #eventListeners = new Map();

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (typeof message.id === 'number') {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        clearTimeout(pending.timeout);
        if ('error' in message) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const params = message.params ?? {};
      const listeners = this.#eventListeners.get(message.method);
      if (listeners !== undefined) {
        for (const listener of listeners) listener(params);
      }
      const waiters = this.#eventWaiters.get(message.method);
      if (waiters === undefined || waiters.length === 0) return;
      for (const waiter of waiters.splice(0)) waiter(params);
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
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

  on(method, listener) {
    const listeners = this.#eventListeners.get(method) ?? new Set();
    listeners.add(listener);
    this.#eventListeners.set(method, listeners);
  }

  off(method, listener) {
    const listeners = this.#eventListeners.get(method);
    if (listeners === undefined) return;
    listeners.delete(listener);
    if (listeners.size === 0) this.#eventListeners.delete(method);
  }

  close() {
    for (const pending of this.#pending.values()) clearTimeout(pending.timeout);
    this.#pending.clear();
    this.#eventWaiters.clear();
    this.#eventListeners.clear();
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
    await setTimeout(250);
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
    await setTimeout(250);
  }

  throw new Error(
    `Timed out waiting for Chrome CDP endpoint ${url}${lastError instanceof Error ? `: ${lastError.message}` : ''}.\n${formatChildLogs(chromeLogs)}`,
  );
}

async function collectTrace(client, enabled, tracePath) {
  if (!enabled) {
    return {
      async stop() {
        return { trace: null, cpuAttribution: null };
      },
    };
  }

  const events = [];
  const onData = (params) => {
    if (!Array.isArray(params.value)) throw new TypeError('Tracing.dataCollected requires an event array');
    for (const value of params.value) events.push(value);
  };
  client.on('Tracing.dataCollected', onData);

  await client.send('Tracing.start', {
    transferMode: 'ReportEvents',
    categories: TRACE_CATEGORIES.join(','),
  });

  let stopPromise = null;
  return {
    stop() {
      if (stopPromise === null) {
        stopPromise = (async () => {
          try {
            const completePromise = client.once('Tracing.tracingComplete');
            await client.send('Tracing.end');
            await completePromise;
            const trace = await CartographerTelemetryContract.persistTrace(tracePath, events);
            const cpuAttribution = CpuProfileAttribution.compute(events);
            return { trace, cpuAttribution };
          } finally {
            client.off('Tracing.dataCollected', onData);
          }
        })();
      }
      return stopPromise;
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
    setTimeout(5000).then(() => {
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
  let probeTimeoutCount = 0;
  let lastTelemetry = null;
  while (Date.now() < deadline) {
    let telemetry;
    try {
      telemetry = await client.send('Runtime.evaluate', {
        expression: `window.${TELEMETRY_KEY} ?? null`,
        returnByValue: true,
      }, 5000);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('CDP Runtime.evaluate timed out')) throw error;
      probeTimeoutCount++;
      continue;
    }
    const value = telemetry.result?.value ?? null;
    lastTelemetry = value;
    if (value !== null && (value.status === 'completed' || value.status === 'failed')) {
      const metrics = await client.send('Performance.getMetrics');
      return { telemetry: value, metrics: metrics.metrics ?? [], probeTimeoutCount };
    }
    await setTimeout(500);
  }
  throw new Error(
    `Timed out waiting for browser telemetry after ${timeoutMs}ms ` +
    `(${probeTimeoutCount} CDP probe timeouts); last telemetry: ${JSON.stringify(lastTelemetry)}`,
  );
}

function metricMap(metrics) {
  return Object.fromEntries(metrics.map((entry) => [entry.name, entry.value]));
}

async function main() {
  const startedAt = performance.now();
  const args = CartographerTelemetryContract.parseArguments(process.argv.slice(2));
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
    reservoirIdleMs: String(args.reservoirIdleMs),
    liveFlushMs: String(args.liveFlushMs),
    ...(args.loadTopology ? { loadTopology: '1' } : {}),
  });
  const targetUrl = `http://${PREVIEW_HOST}:${previewPort}/?${query.toString()}`;
  let chrome = null;
  let client = null;
  let trace = null;

  try {
    await waitForHttp(`http://${PREVIEW_HOST}:${previewPort}/`, 30000);
    chrome = startChrome(args.chromePath, userDataDir, targetUrl, chromeDebugPort);
    await waitForChromeDebugEndpoint(chrome.child, chrome.logs, chromeDebugPort, 30000);
    client = await openCdpPageClient(30000, chromeDebugPort);
    const runtimeDiagnostics = [];
    client.on('Runtime.exceptionThrown', (params) => {
      if (runtimeDiagnostics.length >= 20) return;
      const details = params.exceptionDetails ?? {};
      runtimeDiagnostics.push({
        'kind': 'exception',
        'text': details.exception?.description ?? details.text ?? 'Unknown browser exception',
        'url':  details.url ?? '',
        'line': details.lineNumber ?? null,
      });
    });
    await client.send('Runtime.enable');
    await client.send('Performance.enable');

    trace = await collectTrace(client, args.trace, args.tracePath);
    let completion;
    try {
      completion = await waitForCompletion(client, args.timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}; runtime diagnostics: ${JSON.stringify(runtimeDiagnostics)}`);
    }
    const { telemetry, metrics, probeTimeoutCount } = completion;
    const hardwareProbe = await client.send('Runtime.evaluate', {
      expression: 'navigator.hardwareConcurrency',
      returnByValue: true,
    });
    const hardwareConcurrency = hardwareProbe.result?.value;
    if (!Number.isInteger(hardwareConcurrency) || hardwareConcurrency <= 0) {
      throw new TypeError(`navigator.hardwareConcurrency must be a positive integer, received ${hardwareConcurrency}`);
    }
    const { trace: traceEvidence, cpuAttribution } = await trace.stop();
    const rawBrowserMetrics = metricMap(metrics);
    await client.send('HeapProfiler.collectGarbage');
    const retainedMetrics = await client.send('Performance.getMetrics');
    if (!Array.isArray(retainedMetrics.metrics)) {
      throw new TypeError('Performance.getMetrics requires a metrics array');
    }
    const retainedBrowserMetrics = metricMap(retainedMetrics.metrics);

    const result = {
      targetUrl,
      hardwareConcurrency,
      telemetry,
      browserMetrics: {
        TaskDuration: rawBrowserMetrics.TaskDuration ?? null,
        ScriptDuration: rawBrowserMetrics.ScriptDuration ?? null,
        LayoutDuration: rawBrowserMetrics.LayoutDuration ?? null,
        RecalcStyleDuration: rawBrowserMetrics.RecalcStyleDuration ?? null,
        rawJSHeapUsedSize: rawBrowserMetrics.JSHeapUsedSize ?? null,
        retainedJSHeapUsedSize: retainedBrowserMetrics.JSHeapUsedSize ?? null,
        Nodes: retainedBrowserMetrics.Nodes ?? null,
      },
      probeTimeoutCount,
      trace: traceEvidence,
      cpuAttribution: args.trace ? cpuAttribution : null,
      runDurationMs: performance.now() - startedAt,
    };

    console.log(JSON.stringify(result, null, 2));
    CartographerTelemetryContract.assertResult(args, result);
    await CartographerTelemetryContract.persistReport(args.reportPath, result);
  } finally {
    if (trace !== null) await trace.stop();
    client?.close();
    await stopChild(preview.child);
    if (chrome !== null) await stopChild(chrome.child);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}

await main();
