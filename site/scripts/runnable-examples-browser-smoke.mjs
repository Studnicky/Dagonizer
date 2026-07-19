import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const HOST = '127.0.0.1';
const HYDRATION_MISMATCH = 'Hydration completed but contains mismatches';
const LOG_LIMIT = 16_384;
const USE_DEV_SERVER = process.argv.includes('--dev');
const EXTERNAL_SITE_ORIGIN = process.argv.find((argument) => argument.startsWith('--site-origin='))?.slice('--site-origin='.length) ?? null;
const TIMEOUT_MS = USE_DEV_SERVER || EXTERNAL_SITE_ORIGIN !== null ? 90_000 : 30_000;
const ARCHIVIST_STORAGE_RECOVERY_SCRIPT = `(() => {
  if (!location.pathname.endsWith('/examples/the-archivist/')) return;
  localStorage.setItem('dagonizer-api-keys', '{"groq":');
  localStorage.setItem('dagonizer-preferred-models', '[]');
  localStorage.setItem('dagonizer-active-backend', 'legacy-backend');
  localStorage.setItem('dagonizer-device-override', 'tablet');
})();`;
const EXAMPLES = [
  {
    'name': 'the-archivist',
    'path': '/Dagonizer/examples/the-archivist/',
    'required': [
      'main',
      '[data-runnable-example="archivist"]',
      '.archivist-runner',
      '[data-runnable-example-workbench]',
      '[data-runnable-example-region="left"]',
      '[data-runnable-example-region="right"]',
    ],
    'optional': ['.diagram-frame', '.no-model-gate', '.backend-picker'],
  },
  {
    'name': 'the-cartographer',
    'path': '/Dagonizer/examples/the-cartographer/',
    'required': [
      'main',
      '[data-runnable-example="cartographer"]',
      '.cartographer-runner',
      '[data-runnable-example-workbench]',
      '[data-runnable-example-region="left"]',
      '[data-runnable-example-region="right"]',
      '.diagram-frame',
      '#cartographer-telemetry-json',
    ],
    'optional': [],
  },
  {
    'name': 'the-dispatcher',
    'path': '/Dagonizer/examples/the-dispatcher/',
    'required': [
      'main',
      '[data-runnable-example="dispatcher"]',
      '.dispatcher-runner',
      '[data-runnable-example-workbench]',
      '[data-runnable-example-region="left"]',
      '[data-runnable-example-region="right"]',
    ],
    'optional': ['.diagram-frame', '.dr-no-model-gate', '.backend-picker'],
  },
];
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

function stopExistingDevServer(cwd) {
  if (!USE_DEV_SERVER) {
    return;
  }

  spawnSync('pnpm', ['exec', 'astro', 'dev', 'stop'], {
    cwd,
    stdio: 'ignore',
  });
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

async function waitForExternalHttp(url) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The external site is not ready yet.
    }
    await setTimeout(200);
  }
  throw new Error(`External site did not serve ${url}`);
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

async function evaluateValue(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    'awaitPromise': true,
    'returnByValue': true,
  });
  return result.result?.value ?? null;
}

async function waitForClientState(client, description, expression) {
  const deadline = Date.now() + TIMEOUT_MS;
  let state = null;
  while (Date.now() < deadline) {
    state = await evaluateValue(client, expression);
    if (state?.ready) return state;
    await setTimeout(200);
  }
  throw new Error(`${description}; state=${JSON.stringify(state)}`);
}

function exampleStateExpression(example, targetUrl) {
  return `(() => {
    const required = ${JSON.stringify(EXAMPLES)}.find((entry) => entry.name === ${JSON.stringify(example.name)});
    if (required === undefined) {
      return { missing: ['example-config'], ready: false };
    }
    const missing = required.required.filter((selector) => document.querySelector(selector) === null);
    const runner = document.querySelector(\`.${example.name.slice(4)}-runner\`);
    const island = runner?.closest('astro-island');
    const mountRoot = document.querySelector(${JSON.stringify(`[data-runnable-example="${example.name.slice(4)}"]`)});
    const mountState = mountRoot?.getAttribute('data-runnable-example-state') ?? null;
    const optionalMatches = required.optional.filter((selector) => document.querySelector(selector) !== null);
    const optionalReady = required.optional.length === 0 || optionalMatches.length > 0;
    return {
      missing,
      mountState,
      optionalMatches,
      locationHref: location.href,
      ready: location.href === ${JSON.stringify(targetUrl)} && document.readyState === 'complete' && missing.length === 0 && optionalReady && mountState === 'ready' && (!island || !island.hasAttribute('ssr')),
    };
  })()`;
}

async function waitForExample(client, example, targetUrl) {
  const expression = exampleStateExpression(example, targetUrl);
  return await waitForClientState(client, `${example.name} client did not start`, expression);
}

async function verifyArchivistStorageRecovery(client) {
  const expression = `(() => {
    const root = document.querySelector('[data-runnable-example="archivist"]');
    const noModelGate = document.querySelector('.no-model-gate');
    const backendPicker = document.querySelector('.backend-picker');
    const activeBackend = localStorage.getItem('dagonizer-active-backend');
    return {
      apiKeys: localStorage.getItem('dagonizer-api-keys'),
      preferredModels: localStorage.getItem('dagonizer-preferred-models'),
      activeBackend,
      deviceOverride: localStorage.getItem('dagonizer-device-override'),
      mountState: root?.getAttribute('data-runnable-example-state') ?? null,
      hasRunner: document.querySelector('.archivist-runner') !== null,
      hasVisibleRuntimeUi: noModelGate !== null || backendPicker !== null,
      ready: (
        localStorage.getItem('dagonizer-api-keys') === null
        && localStorage.getItem('dagonizer-preferred-models') === null
        && localStorage.getItem('dagonizer-device-override') === null
        && activeBackend !== 'legacy-backend'
        && root?.getAttribute('data-runnable-example-state') === 'ready'
        && document.querySelector('.archivist-runner') !== null
        && (noModelGate !== null || backendPicker !== null)
      ),
    };
  })()`;
  return await waitForClientState(
    client,
    'archivist did not clear stale browser storage on startup',
    expression,
  );
}

function archivistRecoveryDiagnosticsExpression() {
  return `(() => {
    const root = document.querySelector('[data-runnable-example="archivist"]');
    return {
      mountState: root?.getAttribute('data-runnable-example-state') ?? null,
      statusTitle: document.querySelector('.runnable-example-island__title')?.textContent?.trim() ?? null,
      statusBody: document.querySelector('.runnable-example-island__body')?.textContent?.trim() ?? null,
      hasRunner: document.querySelector('.archivist-runner') !== null,
      hasNoModelGate: document.querySelector('.no-model-gate') !== null,
      hasBackendPicker: document.querySelector('.backend-picker') !== null,
      bodyText: document.body.textContent?.slice(0, 1_000) ?? null,
    };
  })()`;
}

async function visitExample(client, siteOrigin, example) {
  const consoleMessages = [];
  const logErrors = [];
  const exceptions = [];
  const networkErrors = [];
  let recoveryScriptIdentifier = null;

  const onConsole = (event) => {
    consoleMessages.push({ type: event.type, text: (event.args ?? []).map(consoleText).join(' ') });
  };
  const onException = (event) => {
    exceptions.push(event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text ?? 'Unknown exception');
  };
  const onLog = (event) => {
    if (event.entry?.level === 'error') logErrors.push(event.entry.text ?? 'Unknown log error');
  };
  const onResponse = (event) => {
    const status = event.response?.status ?? 0;
    if (status >= 400) {
      networkErrors.push({
        status,
        'url': event.response?.url ?? 'unknown',
      });
    }
  };

  client.on('Runtime.consoleAPICalled', onConsole);
  client.on('Runtime.exceptionThrown', onException);
  client.on('Log.entryAdded', onLog);
  client.on('Network.responseReceived', onResponse);

  if (example.name === 'the-archivist') {
    const registration = await client.send('Page.addScriptToEvaluateOnNewDocument', {
      'source': ARCHIVIST_STORAGE_RECOVERY_SCRIPT,
    });
    recoveryScriptIdentifier = registration.identifier;
  }

  let state = null;
  try {
    const targetUrl = `${siteOrigin}${example.path}`;
    await client.send('Page.navigate', { 'url': targetUrl });
    try {
      state = await waitForExample(client, example, targetUrl);
    } catch (error) {
      const timeoutState = await evaluateValue(client, exampleStateExpression(example, targetUrl)).catch(() => null);
      const hydrationWarnings = consoleMessages.filter(({ text }) => text.includes(HYDRATION_MISMATCH));
      const consoleErrors = consoleMessages.filter(({ type }) => type === 'error');
      throw new Error(`${example.name} failed before reaching ready state:\n${JSON.stringify({
        'message': error instanceof Error ? error.message : String(error),
        hydrationWarnings,
        consoleErrors,
        logErrors,
        networkErrors,
        exceptions,
        'state': timeoutState,
      }, null, 2)}`);
    }
    if (example.name === 'the-archivist') {
      try {
        state = await verifyArchivistStorageRecovery(client);
      } catch (error) {
        const recoveryState = await evaluateValue(client, archivistRecoveryDiagnosticsExpression()).catch(() => null);
        const hydrationWarnings = consoleMessages.filter(({ text }) => text.includes(HYDRATION_MISMATCH));
        const consoleErrors = consoleMessages.filter(({ type }) => type === 'error');
        throw new Error(`archivist storage recovery failed:\n${JSON.stringify({
          'message': error instanceof Error ? error.message : String(error),
          hydrationWarnings,
          consoleErrors,
          logErrors,
          networkErrors,
          exceptions,
          'state': recoveryState,
        }, null, 2)}`);
      }
    }
    await setTimeout(250);

    const hydrationWarnings = consoleMessages.filter(({ text }) => text.includes(HYDRATION_MISMATCH));
    const consoleErrors = consoleMessages.filter(({ type }) => type === 'error');
    if (hydrationWarnings.length || consoleErrors.length || logErrors.length || networkErrors.length || exceptions.length) {
      throw new Error(`${example.name} diagnostics failed:\n${JSON.stringify({ hydrationWarnings, consoleErrors, logErrors, networkErrors, exceptions, state }, null, 2)}`);
    }
    return { state, targetUrl };
  } finally {
    if (recoveryScriptIdentifier !== null) {
      await client.send('Page.removeScriptToEvaluateOnNewDocument', {
        'identifier': recoveryScriptIdentifier,
      }).catch(() => {});
    }
  }
}

async function main() {
  if (!USE_DEV_SERVER && EXTERNAL_SITE_ORIGIN === null) {
    await stat(new URL('../dist/index.html', import.meta.url));
    for (const example of EXAMPLES) {
      await stat(new URL(`../dist/examples/${example.name}/index.html`, import.meta.url));
    }
  }
  const previewPort = await availablePort(4_400);
  const debugPort = await availablePort(9_500);
  const profile = await mkdtemp(join(tmpdir(), 'runnable-examples-browser-smoke-'));
  const serverMode = USE_DEV_SERVER ? 'dev' : 'preview';
  const siteRoot = new URL('..', import.meta.url);
  const siteOrigin = EXTERNAL_SITE_ORIGIN ?? `http://${HOST}:${previewPort}`;
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
    if (EXTERNAL_SITE_ORIGIN === null) {
      stopExistingDevServer(siteRoot);
      preview = startProcess(
        'pnpm',
        ['exec', 'astro', serverMode, '--host', HOST, '--port', String(previewPort), '--strictPort'],
        siteRoot,
        serverMode,
      );
      await waitForHttp(`${siteOrigin}/Dagonizer/`, preview);
    } else {
      await waitForExternalHttp(`${siteOrigin}/Dagonizer/`);
    }
    chrome = startProcess(chromePath(), [
      '--headless=new', `--remote-debugging-port=${debugPort}`, `--remote-debugging-address=${HOST}`,
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', '--disable-extensions', '--disable-sync', 'about:blank',
    ], process.cwd(), 'chrome');
    client = await connectToChrome(chrome, debugPort);
    await Promise.all([client.send('Runtime.enable'), client.send('Log.enable'), client.send('Page.enable'), client.send('Network.enable')]);

    const visited = [];
    for (const example of EXAMPLES) {
      visited.push(await visitExample(client, siteOrigin, example));
    }
    console.log(`runnable-examples-browser-smoke: PASS ${visited.map(({ targetUrl }) => targetUrl).join(', ')}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`runnable-examples-browser-smoke: FAIL\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
