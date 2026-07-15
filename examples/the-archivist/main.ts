/**
 * main.ts: browser entrypoint for the standalone Archivist demo.
 *
 * Builds and wires a `DomArchivistSession` — the DOM subclass of the shared
 * `ArchivistSession` base — then runs the same greeting → sample-reply
 * bootstrap as the advanced docs demo. Distinctive features retained:
 *
 *   Provider matrix: browser-visible adapters are detected, grouped by
 *     availability, and selected from the LLM Select tab or auto-ranked.
 *
 *   IndexedDB durability: memory n-quads persisted after every completed run;
 *     restored on page load so the Archivist remembers past conversations.
 *
 *   HITL park / reload / resume: when ParkForInputNode parks the flow, the
 *     checkpoint is persisted and a banner prompts the visitor for a reply.
 *     Resuming restores the checkpoint and continues the parked DAG.
 *
 *   URL params:
 *     ?apiKey=<key>        Gemini API key for the REST adapter; copied into local config.
 *     ?lang=<tag>          Override browser language detection (e.g. ?lang=fr).
 *     ?park                Skip auto-run; park immediately on load.
 *     ?webLlmModel=<id>    Persist the preferred WebLLM prebuilt model.
 *
 * Ollama CORS caveat: start the daemon with
 * `OLLAMA_ORIGINS='http://localhost:5174' ollama serve` (or `OLLAMA_ORIGINS='*'`)
 * to allow cross-origin requests from this harness.
 */

import type { DAGType } from '@studnicky/dagonizer';
import { IndexedDbCheckpointStore, IndexedDbStore } from '@studnicky/dagonizer-store-indexeddb';
import type { Term } from 'n3';

import { DomArchivistSession } from './DomArchivistSession.ts';
import type { SessionTimeoutSettings, SessionTraceEntry } from './ArchivistSession.ts';
import { UserLanguage } from './language/UserLanguage.ts';
import { DomConsoleLogger } from './logger/DomConsoleLogger.ts';
import { MemoryStore } from './memory/MemoryStore.ts';
import {
  ActiveBackendStore,
  ApiKeyStore,
  BackendMatrix,
  PreferredModels,
} from './providers/index.ts';
import type { BackendAvailability, ProviderId, WebLlmInitReportType } from './providers/index.ts';
import { archivistDAG } from './dag.ts';
import { bookSearchScatterDAG } from './embedded-dags/BookSearchScatterDAG.ts';
import { composeRetryLoopDAG } from './embedded-dags/ComposeRetryLoopDAG.ts';
import { ArchivistGraph } from './viz/ArchivistGraph.ts';

// ── DOM element acquisition ───────────────────────────────────────────────────

function mustGet<T extends HTMLElement>(id: string, ctor: { new(): T }): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) throw new Error(`missing #${id}`);
  return el;
}

const form = mustGet('ask-form', HTMLFormElement);
const input = mustGet('ask-input', HTMLInputElement);
const button = mustGet('ask-button', HTMLButtonElement);
const logEl = mustGet('archivist-log', HTMLPreElement);
const hitlBanner = mustGet('hitl-banner', HTMLDivElement);
const hitlInput = mustGet('hitl-input', HTMLInputElement);
const hitlResumeButton = mustGet('hitl-resume', HTMLButtonElement);
const conversationEl = mustGet('conversation', HTMLDivElement);
const dagContainerEl = mustGet('dag-container', HTMLDivElement);
const backendRefreshButton = mustGet('backend-refresh', HTMLButtonElement);
const backendSummaryEl = mustGet('backend-summary', HTMLDivElement);
const backendAutoInput = mustGet('backend-auto', HTMLInputElement);
const backendListEl = mustGet('backend-list', HTMLDivElement);
const conversationWindowInput = mustGet('conversation-window', HTMLInputElement);
const conversationWindowValueEl = mustGet('conversation-window-value', HTMLSpanElement);
const timeoutComposeInput = mustGet('timeout-compose', HTMLInputElement);
const timeoutSearchInput = mustGet('timeout-search', HTMLInputElement);
const timeoutRankInput = mustGet('timeout-rank', HTMLInputElement);
const traceListEl = mustGet('trace-list', HTMLDivElement);
const memoryStatsEl = mustGet('memory-stats', HTMLDivElement);
const memoryGraphEl = mustGet('memory-graph', HTMLDivElement);

// Hide HITL banner until a parked flow is detected.
hitlBanner.style.display = 'none';

// ── UI helpers ───────────────────────────────────────────────────────────────

const API_KEY_BACKENDS = new Set<ProviderId>([
  'anthropic',
  'cerebras',
  'gemini-api',
  'groq',
  'mistral',
  'openrouter',
]);

const RUNTIME_CONFIG_STORAGE_KEY = 'dagonizer-archivist-runtime-config';

const DEFAULT_TIMEOUTS: SessionTimeoutSettings = {
  'composeMs':   60_000,
  'webSearchMs': 60_000,
  'rankMs':      30_000,
};

interface RuntimeConfig {
  readonly conversationContextWindow: number;
  readonly timeoutSettings: SessionTimeoutSettings;
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  'conversationContextWindow': 6,
  'timeoutSettings': DEFAULT_TIMEOUTS,
};

function objectField(source: unknown, key: string): unknown {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return undefined;
  return Object.entries(source).find(([name]) => name === key)?.[1];
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

class RuntimeConfigStore {
  static load(): RuntimeConfig {
    if (typeof localStorage === 'undefined') return DEFAULT_RUNTIME_CONFIG;
    const raw = localStorage.getItem(RUNTIME_CONFIG_STORAGE_KEY);
    if (raw === null) return DEFAULT_RUNTIME_CONFIG;
    try {
      const parsed: unknown = JSON.parse(raw);
      const timeoutSettings = objectField(parsed, 'timeoutSettings');
      return {
        'conversationContextWindow': boundedInteger(
          objectField(parsed, 'conversationContextWindow'),
          DEFAULT_RUNTIME_CONFIG.conversationContextWindow,
          0,
          24,
        ),
        'timeoutSettings': {
          'composeMs': boundedInteger(objectField(timeoutSettings, 'composeMs'), DEFAULT_TIMEOUTS.composeMs, 5_000, 300_000),
          'webSearchMs': boundedInteger(objectField(timeoutSettings, 'webSearchMs'), DEFAULT_TIMEOUTS.webSearchMs, 5_000, 300_000),
          'rankMs': boundedInteger(objectField(timeoutSettings, 'rankMs'), DEFAULT_TIMEOUTS.rankMs, 5_000, 300_000),
        },
      };
    } catch {
      return DEFAULT_RUNTIME_CONFIG;
    }
  }

  static save(config: RuntimeConfig): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(config));
  }
}

class TabPanels {
  static wire(): void {
    for (const buttonEl of document.querySelectorAll<HTMLButtonElement>('.tab-button[data-tab-target]')) {
      buttonEl.addEventListener('click', () => {
        const targetId = buttonEl.dataset['tabTarget'];
        if (targetId === undefined) return;
        const host = buttonEl.closest('#left-pane, #right-pane');
        if (!(host instanceof HTMLElement)) return;
        TabPanels.activate(host, targetId);
      });
    }
  }

  private static activate(host: HTMLElement, targetId: string): void {
    for (const buttonEl of host.querySelectorAll<HTMLButtonElement>('.tab-button[data-tab-target]')) {
      const selected = buttonEl.dataset['tabTarget'] === targetId;
      buttonEl.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    for (const panel of host.querySelectorAll<HTMLElement>('.tab-panel, .wide-panel')) {
      panel.hidden = panel.id !== targetId;
    }
  }
}

function seconds(ms: number): string {
  return String(Math.round(ms / 1000));
}

function secondsInput(inputEl: HTMLInputElement, fallbackMs: number): number {
  return boundedInteger(inputEl.value, Math.round(fallbackMs / 1000), 5, 300) * 1000;
}

function syncRuntimeConfigControls(config: RuntimeConfig): void {
  conversationWindowInput.value = String(config.conversationContextWindow);
  conversationWindowValueEl.textContent = String(config.conversationContextWindow);
  timeoutComposeInput.value = seconds(config.timeoutSettings.composeMs);
  timeoutSearchInput.value = seconds(config.timeoutSettings.webSearchMs);
  timeoutRankInput.value = seconds(config.timeoutSettings.rankMs);
}

function traceLabel(trace: SessionTraceEntry): string {
  if (trace.variant === 'start') return 'started';
  if (trace.variant === 'end') return trace.output !== null ? `ended: ${trace.output}` : 'ended';
  if (trace.variant === 'error') return `error: ${trace.message}`;
  return trace.message;
}

function renderTraceEntry(trace: SessionTraceEntry): void {
  const row = document.createElement('div');
  row.className = 'trace-entry';

  const node = document.createElement('div');
  node.className = 'trace-node';
  node.textContent = trace.node;

  const meta = document.createElement('div');
  meta.className = 'trace-meta';
  meta.textContent = `${new Date(trace.ts).toLocaleTimeString()} | ${trace.variant} | ${traceLabel(trace)}`;

  row.append(node, meta);
  traceListEl.appendChild(row);
  while (traceListEl.childElementCount > 120) traceListEl.firstElementChild?.remove();
  traceListEl.scrollTop = traceListEl.scrollHeight;
}

function backendStatusClass(backend: BackendAvailability): string {
  if (backend.runnable) return 'ready';
  if (backend.needsAction !== null) return 'action';
  return 'unavailable';
}

function backendStatusLabel(backend: BackendAvailability): string {
  if (backend.runnable) return 'Ready';
  if (backend.needsAction === 'api-key') return 'API key';
  if (backend.needsAction === 'download') return 'Download';
  return 'Unavailable';
}

function groupBackends(backends: readonly BackendAvailability[]): ReadonlyArray<{
  readonly title: string;
  readonly rows: readonly BackendAvailability[];
}> {
  const sorted = BackendMatrix.sortAvailable(backends);
  return [
    { 'title': 'Available', 'rows': sorted.filter((backend) => backend.runnable) },
    { 'title': 'Setup Needed', 'rows': sorted.filter((backend) => !backend.runnable && backend.needsAction !== null) },
    { 'title': 'Unavailable', 'rows': sorted.filter((backend) => !backend.runnable && backend.needsAction === null) },
  ].filter((group) => group.rows.length > 0);
}

function modelName(model: { readonly name?: string }): string {
  return typeof model.name === 'string' && model.name.length > 0 ? model.name : '';
}

function shorten(value: string, max = 28): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}...`;
}

function compactTermLabel(term: Term): string {
  if (term.termType === 'DefaultGraph') return 'default';
  if (term.termType === 'Literal') return `"${shorten(term.value, 24)}"`;
  const hash = term.value.lastIndexOf('#');
  const slash = term.value.lastIndexOf('/');
  const colon = term.value.lastIndexOf(':');
  const cut = Math.max(hash, slash, colon);
  return shorten(cut >= 0 ? term.value.slice(cut + 1) : term.value, 28);
}

function termKey(term: Term, role: string): string {
  return `${role}:${term.termType}:${term.value}`;
}

interface MemoryNode {
  readonly key: string;
  readonly label: string;
  readonly kind: 'graph' | 'subject' | 'object';
  x: number;
  y: number;
  weight: number;
}

interface MemoryEdge {
  readonly from: string;
  readonly to: string;
}

function renderMemoryGraph(store: MemoryStore): void {
  const quads = [...store.triples()];
  const graphs = store.graphs();
  const shown = quads.slice(Math.max(0, quads.length - 70));
  memoryStatsEl.textContent = `graphs=${String(graphs.length)} | quads=${String(quads.length)} | showing=${String(shown.length)}`;

  if (shown.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'memory-empty';
    empty.textContent = 'No memory quads yet.';
    memoryGraphEl.replaceChildren(empty);
    return;
  }

  const nodes = new Map<string, MemoryNode>();
  const edges: MemoryEdge[] = [];

  const ensureNode = (key: string, label: string, kind: MemoryNode['kind']): MemoryNode => {
    const existing = nodes.get(key);
    if (existing !== undefined) {
      existing.weight += 1;
      return existing;
    }
    const node: MemoryNode = { key, label, kind, 'x': 0, 'y': 0, 'weight': 1 };
    nodes.set(key, node);
    return node;
  };

  for (const quad of shown) {
    const graphKey = termKey(quad.graph, 'graph');
    const subjectKey = termKey(quad.subject, 'subject');
    const objectKey = termKey(quad.object, 'object');
    ensureNode(graphKey, compactTermLabel(quad.graph), 'graph');
    ensureNode(subjectKey, compactTermLabel(quad.subject), 'subject');
    ensureNode(objectKey, compactTermLabel(quad.object), 'object');
    edges.push({ 'from': graphKey, 'to': subjectKey });
    edges.push({ 'from': subjectKey, 'to': objectKey });
  }

  const columns: ReadonlyArray<{ readonly kind: MemoryNode['kind']; readonly x: number }> = [
    { 'kind': 'graph', 'x': 120 },
    { 'kind': 'subject', 'x': 500 },
    { 'kind': 'object', 'x': 880 },
  ];
  for (const column of columns) {
    const columnNodes = [...nodes.values()].filter((node) => node.kind === column.kind);
    const step = 560 / (columnNodes.length + 1);
    columnNodes.forEach((node, index) => {
      node.x = column.x;
      node.y = 40 + step * (index + 1);
    });
  }

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 640');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Memory RDF graph');

  const drawnEdges = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    if (drawnEdges.has(key)) continue;
    drawnEdges.add(key);
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const line = document.createElementNS(svgNs, 'line');
    line.setAttribute('x1', String(from.x));
    line.setAttribute('y1', String(from.y));
    line.setAttribute('x2', String(to.x));
    line.setAttribute('y2', String(to.y));
    line.setAttribute('stroke', '#30363d');
    line.setAttribute('stroke-width', '1.2');
    svg.appendChild(line);
  }

  for (const node of nodes.values()) {
    const group = document.createElementNS(svgNs, 'g');
    const radius = Math.min(18, 7 + node.weight);
    const circle = document.createElementNS(svgNs, 'circle');
    circle.setAttribute('cx', String(node.x));
    circle.setAttribute('cy', String(node.y));
    circle.setAttribute('r', String(radius));
    circle.setAttribute('fill', node.kind === 'graph' ? '#58a6ff' : node.kind === 'subject' ? '#56d364' : '#f0883e');
    circle.setAttribute('opacity', '0.9');

    const label = document.createElementNS(svgNs, 'text');
    label.setAttribute('x', String(node.x + radius + 6));
    label.setAttribute('y', String(node.y + 4));
    label.setAttribute('fill', '#e6edf3');
    label.setAttribute('font-size', '11');
    label.textContent = node.label;

    group.append(circle, label);
    svg.appendChild(group);
  }

  memoryGraphEl.replaceChildren(svg);
}

// ── Static helpers for DAG visualization pane ─────────────────────────────────

/** Static helpers for the DAG visualization pane: mount an ArchivistGraph. */
class DagPane {
  static mount(
    container: HTMLDivElement,
    archivistDAG: DAGType,
    bookSearchDAG: DAGType,
    composeDAG: DAGType,
  ): void {
    const embeddedDAGs = new Map<string, DAGType>([
      ['book-search-scatter', bookSearchDAG],
      ['compose-retry-loop',  composeDAG],
    ]);
    void new ArchivistGraph(container, archivistDAG, { embeddedDAGs }).mount();
  }
}

// ── URL params ────────────────────────────────────────────────────────────────

const params      = new URLSearchParams(window.location.search);
const urlApiKey   = params.get('apiKey') ?? '';
const urlLang     = params.get('lang') ?? '';
const urlWebLlmModel = params.get('webLlmModel') ?? '';

// ── Logger ────────────────────────────────────────────────────────────────────

const logger = new DomConsoleLogger({ 'panel': logEl });

// ── Visitor device language ───────────────────────────────────────────────────

const userLanguage = urlLang.length > 0
  ? UserLanguage.normalize(urlLang)
  : UserLanguage.detect();
logger.note(`language: ${userLanguage} (${UserLanguage.displayName(userLanguage)})`);

// ── IndexedDB stores ──────────────────────────────────────────────────────────

const kvStore   = IndexedDbStore.open();
const ckptStore = IndexedDbCheckpointStore.open();
await kvStore.connect();
await ckptStore.connect();

// URL shortcuts seed the same local preferences the LLM Select tab edits.
if (urlApiKey.length > 0) {
  const keys = ApiKeyStore.load();
  ApiKeyStore.save({ ...keys, 'gemini-api': urlApiKey });
}
if (urlWebLlmModel.length > 0) {
  PreferredModels.set('web-llm', urlWebLlmModel);
}

// ── Memory store + persisted n-quads restore ──────────────────────────────────

const store = new MemoryStore();

const storedNquads = await kvStore.get('memory:nquads');
if (typeof storedNquads === 'string' && storedNquads.length > 0) {
  await store.restore({
    'version': 1,
    'type':    'archivist-memory-v1',
    'entries': [{ 'key': 'nquads', 'value': storedNquads }],
  });
  logger.note(`memory: restored ${String(store.size)} quads from IndexedDB`);
}

// ── Runtime config + provider panel wiring ───────────────────────────────────

const runtimeConfig = RuntimeConfigStore.load();
syncRuntimeConfigControls(runtimeConfig);

let sessionRef: DomArchivistSession | null = null;
let latestBackends: readonly BackendAvailability[] = [];
let detectingBackends = false;

function currentSession(): DomArchivistSession {
  if (sessionRef === null) throw new Error('Archivist session is not ready');
  return sessionRef;
}

function setBackendDetecting(value: boolean): void {
  detectingBackends = value;
  backendRefreshButton.disabled = value;
  if (value) backendSummaryEl.textContent = 'Detecting backends...';
}

function providerUsesApiKey(id: ProviderId): boolean {
  return API_KEY_BACKENDS.has(id);
}

function applyEffectiveBackend(): void {
  const selected = ActiveBackendStore.load();
  const effectiveId = BackendMatrix.effectiveActiveBackendId(selected, latestBackends);
  currentSession().setActiveBackend(effectiveId);
}

function renderBackendPanel(): void {
  const selected = ActiveBackendStore.load();
  const effectiveId = BackendMatrix.effectiveActiveBackendId(selected, latestBackends);
  backendAutoInput.checked = selected === null;
  if (!detectingBackends) backendSummaryEl.textContent = BackendMatrix.activeSummary(selected, latestBackends);

  const groups = groupBackends(latestBackends);
  const fragments: HTMLElement[] = [];
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'backend-group';
    const title = document.createElement('h3');
    title.className = 'backend-group-title';
    title.textContent = group.title;
    section.appendChild(title);
    for (const backend of group.rows) section.appendChild(createBackendRow(backend, selected, effectiveId));
    fragments.push(section);
  }

  if (fragments.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'status-line';
    empty.textContent = detectingBackends ? 'Detecting backends...' : 'No backends reported.';
    backendListEl.replaceChildren(empty);
    return;
  }

  backendListEl.replaceChildren(...fragments);
}

function createBackendRow(
  backend: BackendAvailability,
  selected: ProviderId | null,
  effectiveId: ProviderId | null,
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'backend-row';
  details.open = backend.id === effectiveId || backend.needsAction !== null;

  const summary = document.createElement('summary');
  const dot = document.createElement('span');
  dot.className = `status-dot ${backendStatusClass(backend)}`;
  dot.title = backendStatusLabel(backend);

  const title = document.createElement('span');
  title.className = 'backend-title';
  title.textContent = backend.displayName;

  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'backend-choice';
  radio.value = backend.id;
  radio.checked = selected === backend.id;
  radio.disabled = !backend.runnable;
  radio.addEventListener('click', (event) => { event.stopPropagation(); });
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    ActiveBackendStore.save(backend.id);
    currentSession().setActiveBackend(backend.id);
    renderBackendPanel();
  });

  summary.append(dot, title, radio);
  details.append(summary, createBackendBody(backend));
  return details;
}

function createBackendBody(backend: BackendAvailability): HTMLDivElement {
  const body = document.createElement('div');
  body.className = 'backend-body';

  if (providerUsesApiKey(backend.id) && (backend.needsAction === 'api-key' || ApiKeyStore.load()[backend.id] !== undefined)) {
    body.appendChild(createApiKeyField(backend.id));
  }

  if (backend.models !== undefined && backend.models.length > 0) {
    body.appendChild(createModelSelect(backend));
  } else if (backend.id === 'ollama') {
    body.appendChild(createOllamaModelInput());
  }

  if (backend.hint !== undefined && backend.hint.length > 0) {
    const hint = document.createElement('span');
    hint.className = 'status-line';
    hint.textContent = backend.hint;
    body.appendChild(hint);
  }

  return body;
}

function createApiKeyField(id: ProviderId): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'control-field';
  const text = document.createElement('span');
  text.textContent = 'API key';
  const field = document.createElement('input');
  field.type = 'password';
  field.autocomplete = 'off';
  field.value = ApiKeyStore.load()[id] ?? '';
  field.addEventListener('input', () => {
    const next = ApiKeyStore.load();
    if (field.value.trim().length > 0) next[id] = field.value.trim();
    else delete next[id];
    ApiKeyStore.save(next);
    currentSession().setApiKeys(next);
  });
  field.addEventListener('blur', () => { void refreshBackends(); });
  label.append(text, field);
  return label;
}

function createModelSelect(backend: BackendAvailability): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'control-field';
  const text = document.createElement('span');
  text.textContent = 'Model';

  const select = document.createElement('select');
  const preferred = PreferredModels.get(backend.id);
  const selectedValue = preferred.length > 0 ? preferred : (backend.resolvedModel ?? '');
  const optionNames: string[] = [];
  for (const model of backend.models ?? []) {
    const name = modelName(model);
    if (name.length === 0) continue;
    optionNames.push(name);
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  if (selectedValue.length > 0 && !optionNames.includes(selectedValue)) {
    const option = document.createElement('option');
    option.value = selectedValue;
    option.textContent = selectedValue;
    select.appendChild(option);
  }
  select.value = selectedValue;
  select.addEventListener('change', () => {
    PreferredModels.set(backend.id, select.value);
    currentSession().setPreferredModels(PreferredModels.load());
    void refreshBackends();
  });

  label.append(text, select);
  return label;
}

function createOllamaModelInput(): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'control-field';
  const text = document.createElement('span');
  text.textContent = 'Model';
  const field = document.createElement('input');
  field.type = 'text';
  field.value = PreferredModels.get('ollama');
  field.addEventListener('input', () => {
    PreferredModels.set('ollama', field.value);
    currentSession().setPreferredModels(PreferredModels.load());
  });
  field.addEventListener('blur', () => { void refreshBackends(); });
  label.append(text, field);
  return label;
}

function handleBackendsReady(backends: readonly BackendAvailability[], noModel: boolean): void {
  latestBackends = BackendMatrix.sortAvailable(backends);
  const selected = ActiveBackendStore.load();
  if (selected !== null) {
    const selectedBackend = latestBackends.find((backend) => backend.id === selected);
    if (selectedBackend?.runnable !== true) ActiveBackendStore.clear();
  }
  applyEffectiveBackend();
  renderBackendPanel();
  if (noModel) backendSummaryEl.textContent = 'No runnable backend available.';
}

async function refreshBackends(): Promise<void> {
  setBackendDetecting(true);
  try {
    currentSession().setApiKeys(ApiKeyStore.load());
    currentSession().setPreferredModels(PreferredModels.load());
    await currentSession().boot();
  } catch (err) {
    logger.warn(`backend detection failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBackendDetecting(false);
    renderBackendPanel();
  }
}

function applyRuntimeConfig(): void {
  const next: RuntimeConfig = {
    'conversationContextWindow': boundedInteger(conversationWindowInput.value, runtimeConfig.conversationContextWindow, 0, 24),
    'timeoutSettings': {
      'composeMs': secondsInput(timeoutComposeInput, DEFAULT_TIMEOUTS.composeMs),
      'webSearchMs': secondsInput(timeoutSearchInput, DEFAULT_TIMEOUTS.webSearchMs),
      'rankMs': secondsInput(timeoutRankInput, DEFAULT_TIMEOUTS.rankMs),
    },
  };
  syncRuntimeConfigControls(next);
  RuntimeConfigStore.save(next);
  currentSession().setConversationContextWindow(next.conversationContextWindow);
  currentSession().setTimeoutSettings(next.timeoutSettings);
}

// ── DomArchivistSession ───────────────────────────────────────────────────────

const session = new DomArchivistSession(store, logger, {
  'visitorLanguage': userLanguage,
  'conversationContextWindow': runtimeConfig.conversationContextWindow,
  'timeoutSettings': runtimeConfig.timeoutSettings,
  'onWebLlmProgress': (report: WebLlmInitReportType) => {
    logger.note(`web-llm: ${report.text} (${String(Math.round(report.progress * 100))}%)`);
  },
  'dom': { button, input, logEl, conversationEl, hitlBanner, hitlInput, hitlResumeButton },
  'stores': { kvStore, ckptStore },
  'callbacks': {
    'onBackendsReady': handleBackendsReady,
    'onTraceEntry': renderTraceEntry,
    'onMemoryChanged': () => { renderMemoryGraph(store); },
  },
});
sessionRef = session;

// ── DAG visualization ────────────────────────────────────────────────────────

TabPanels.wire();
DagPane.mount(dagContainerEl, archivistDAG, bookSearchScatterDAG, composeRetryLoopDAG);
renderMemoryGraph(store);

// ── Restore pending HITL state (survives page reload) ────────────────────────

const pendingKey    = await kvStore.get('hitl:pendingKey');
const hasPendingHitl = typeof pendingKey === 'string' && pendingKey.length > 0;
if (hasPendingHitl) {
  logger.note(`hitl: pending resume for correlation key '${String(pendingKey)}'`);
  hitlBanner.style.display = 'flex';
}

// ── Event wiring ──────────────────────────────────────────────────────────────

backendRefreshButton.addEventListener('click', () => { void refreshBackends(); });

backendAutoInput.addEventListener('change', () => {
  if (!backendAutoInput.checked) return;
  ActiveBackendStore.clear();
  applyEffectiveBackend();
  renderBackendPanel();
});

conversationWindowInput.addEventListener('input', applyRuntimeConfig);
timeoutComposeInput.addEventListener('change', applyRuntimeConfig);
timeoutSearchInput.addEventListener('change', applyRuntimeConfig);
timeoutRankInput.addEventListener('change', applyRuntimeConfig);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (query.length === 0) return;
  button.disabled = true;
  void session.ask(query).catch((err) => {
    button.disabled = false;
    session.appendErrorLine(err instanceof Error ? err.message : String(err));
  });
});

hitlResumeButton.addEventListener('click', () => {
  const humanText = hitlInput.value.trim();
  if (humanText.length === 0) return;
  void session.resumeHitl(humanText);
});

// ── Bootstrap: boot → greet → sampleReply ────────────────────────────────────
// Mirrors the advanced docs demo. On pending HITL, skip the fresh greeting so
// the visitor can resume the parked flow without triggering a competing run.
// On ?park, start parked immediately.

await refreshBackends();

if (!hasPendingHitl) {
  if (params.has('park')) {
    void session.ask('').catch((err) => {
      button.disabled = false;
      session.appendErrorLine(err instanceof Error ? err.message : String(err));
    });
  } else {
    const greeting = await session.greet();
    const seedQuery = await session.sampleReply(greeting);
    button.disabled = true;
    void session.answerRecordedVisitorTurn(seedQuery).catch((err) => {
      button.disabled = false;
      session.appendErrorLine(err instanceof Error ? err.message : String(err));
    });
  }
}
