<script setup lang="ts">
/**
 * DispatcherRunner: orchestrator for the in-browser Dispatcher demo.
 *
 * Two-column iridis-style layout matching ArchivistRunner:
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ <single-column on narrow; two-column at ≥720px container width>      │
 *   ├──────────────────────────┬───────────────────────────────────────────┤
 *   │ LEFT COL                 │ RIGHT COL                                 │
 *   │ tabs: Stream | Config    │ tabs: Operator | DAG | Trace              │
 *   └──────────────────────────┴───────────────────────────────────────────┘
 *
 * Pure observer: lifecycle hooks toggle CSS classes on cytoscape nodes via
 * the DagGraph's imperative surface; no polling, no JS animation loops.
 *
 * HITL flow:
 *   execute() → ParkForOperatorNode parks → lifecycle = awaiting-input
 *   Right pane auto-switches to Operator tab.
 *   Operator types response → click "Send response".
 *   Checkpoint.capture → restoreState → set response → dispatcher.resume().
 *
 * LLM backend: BackendPicker (same as ArchivistRunner). Detection runs at mount.
 * When no backend is available, the no-model gate shows BackendPicker inline.
 * classify-message and ai-compose call the LLM; trolley switch and escalation
 * routing are deterministic overrides on top of the LLM decision.
 */

import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { Checkpoint, CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';
import type { ExecutionResultType } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import { DispatcherState } from '../../../../examples/the-dispatcher/DispatcherState.ts';
import type { ConversationTurnType } from '../../../../examples/the-dispatcher/DispatcherState.ts';
import { DispatcherBundleFactory } from '../../../../examples/the-dispatcher/dag.ts';
import type { DispatcherServices } from '../../../../examples/the-dispatcher/services.ts';
import { DispatcherLlmClient } from '../../../../examples/the-dispatcher/providers/DispatcherLlmClient.ts';

import { ApiKeyStore, BackendMatrix, BaseLlmClient, MobileDetection, OllamaModels, ProviderInstantiator } from '../../../../examples/the-archivist/providers/index.ts';
import type { BackendAvailability, ProviderId } from '../../../../examples/the-archivist/providers/index.ts';
import { ObservedDag } from '../../../../examples/the-archivist/ObservedDag.ts';
import { DomConsoleLogger } from '../../../../examples/the-archivist/logger/DomConsoleLogger.ts';
import type { LogEvent } from '../../../../examples/the-archivist/logger/ConsoleLogger.ts';

import BackendPicker from './BackendPicker.vue';
import DagGraph from './DagGraph.vue';
import PanesTabs from './PanesTabs.vue';
import TraceFeed from './TraceFeed.vue';

// ── Types ────────────────────────────────────────────────────────────────────
type TraceEvent =
  | { readonly variant: 'start'; readonly node: string; readonly ts: number }
  | { readonly variant: 'end';   readonly node: string; readonly ts: number; readonly output: string | null }
  | { readonly variant: 'error'; readonly node: string; readonly ts: number; readonly message: string };

// ── Backend state ─────────────────────────────────────────────────────────────
const backends = ref<readonly BackendAvailability[]>([]);
const savedBackend = typeof localStorage !== 'undefined'
  ? (localStorage.getItem('dagonizer-active-backend') as ProviderId | null)
  : null;
const activeBackend = ref<ProviderId | null>(savedBackend);
const noModel  = ref(false);
const isMobile = ref(false);
const apiKeys  = ref<Partial<Record<ProviderId, string>>>(ApiKeyStore.load());
const ollamaModel = ref<string>(OllamaModels.loadModel());

const resolvedModel = computed<string>(() => {
  if (activeBackend.value === 'ollama' && ollamaModel.value.length > 0) return ollamaModel.value;
  const entry = backends.value.find((b) => b.id === activeBackend.value);
  return entry?.resolvedModel ?? '';
});

// ── State ────────────────────────────────────────────────────────────────────
const customerQuery    = ref('');
const operatorInput    = ref('');
const isRunning        = ref(false);
const humanMode        = ref(false);
const conversation     = ref<ConversationTurnType[]>([]);
const trace            = ref<TraceEvent[]>([]);
const logEvents        = ref<LogEvent[]>([]);
const logger           = new DomConsoleLogger({ 'events': logEvents.value });
const dispatcherDag    = ref<DAGType>(DispatcherBundleFactory.structure());
const dagGraph         = ref<InstanceType<typeof DagGraph> | null>(null);
const streamRef        = ref<HTMLOListElement | null>(null);
const rightActiveKey   = ref<'operator' | 'dag' | 'trace'>('dag');
const terminalVariant  = ref<'pending' | 'completed' | 'failed' | 'cancelled' | 'timed_out'>('pending');
const escalationReason = ref('');

// Parked execution: stored outside Vue reactivity to preserve class identity.
// Vue's Proxy wrapping strips private class fields; ExecutionResultType<DispatcherState>
// must stay as a plain module-level variable. The reactive ref only holds the
// cursor string (UI-relevant) + a boolean indicating a parked state exists.
interface ParkedExecution {
  readonly result: ExecutionResultType<DispatcherState>;
  readonly dagName: string;
  readonly cursor: string;
}
let parkedExecution: ParkedExecution | null = null;
const parked = ref<{ readonly cursor: string; readonly dagName: string } | null>(null);

let activeAbortController: AbortController | null = null;

// ── Cancel ───────────────────────────────────────────────────────────────────
function cancel(): void {
  if (activeAbortController !== null) {
    activeAbortController.abort(new Error('cancelled by operator'));
  }
}

// ── DAG variant map for node styling ─────────────────────────────────────────
const DISPATCHER_NODE_VARIANTS: Readonly<Record<string, string>> = {
  'setup':              'phase',
  'classify-message':   'classify',
  'ai-compose':         'ai',
  'park-for-operator':  'park',
  'send-response':      'send',
  'decline':            'decline',
};

/**
 * Dispatch map: log a detail line after key nodes complete.
 */
const DISPATCHER_NODE_TRACE: Readonly<Record<string, (state: DispatcherState) => void>> = {
  'classify-message': (state) => {
    if (state.escalationReason.length > 0) {
      logger.info(`classify: escalate — ${state.escalationReason}`);
    } else {
      logger.info('classify: routine — AI will compose response');
    }
  },
  'park-for-operator': (state) => {
    if (state.response.length > 0) {
      logger.info('park-for-operator: response received — routing ready');
    } else {
      logger.info('park-for-operator: parked — awaiting operator input');
    }
  },
};

// ── Browser observer ─────────────────────────────────────────────────────────
/**
 * DispatcherBrowserObserver: wires lifecycle hooks to the Vue reactive state
 * (trace feed, DAG graph, conversation, awaiting-input tab auto-switch).
 */
class DispatcherBrowserObserver extends ObservedDag<DispatcherState> {
  constructor(log: DomConsoleLogger) {
    super(log);
  }

  protected override onNodeStart(
    nodeName: string,
    state: DispatcherState,
    placementPath: readonly string[],
  ): void {
    super.onNodeStart(nodeName, state, placementPath);
    const fullId = [...placementPath, nodeName].join('/');
    trace.value = [...trace.value, { 'node': fullId, 'ts': Date.now(), 'variant': 'start' }];
    dagGraph.value?.setActive(fullId);
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    state: DispatcherState,
    placementPath: readonly string[],
  ): void {
    super.onNodeEnd(nodeName, output, state, placementPath);
    const fullId = [...placementPath, nodeName].join('/');
    trace.value = [...trace.value, { 'node': fullId, output, 'ts': Date.now(), 'variant': 'end' }];
    dagGraph.value?.setCompleted(fullId);
    if (output !== null) dagGraph.value?.markEdgeTraversed(fullId, output);
    DISPATCHER_NODE_TRACE[nodeName]?.(state);
  }

  protected override onError(
    nodeName: string,
    error: Error,
    state: DispatcherState,
    placementPath: readonly string[],
  ): void {
    super.onError(nodeName, error, state, placementPath);
    const fullId = [...placementPath, nodeName].join('/');
    trace.value = [...trace.value, {
      'node': fullId,
      'ts': Date.now(),
      'variant': 'error',
      'message': error.message !== '' ? error.message : String(error),
    }];
    dagGraph.value?.setErrored(fullId);
  }

  protected override onFlowEnd(
    dagName: string,
    state: DispatcherState,
    result: ExecutionResultType<DispatcherState>,
  ): void {
    super.onFlowEnd(dagName, state, result);

    const lifecycleVariant = state.lifecycle.variant;

    // Update conversation from state.
    if (state.conversation.length > 0) {
      conversation.value = [...state.conversation];
    }

    escalationReason.value = state.escalationReason;
    terminalVariant.value = (
      lifecycleVariant === 'completed' ||
      lifecycleVariant === 'failed' ||
      lifecycleVariant === 'cancelled' ||
      lifecycleVariant === 'timed_out'
    ) ? lifecycleVariant : 'pending';

    if (lifecycleVariant === 'awaiting-input' && result.parked !== null) {
      // Store the full result outside Vue reactivity (preserves class identity).
      parkedExecution = { 'result': result, 'dagName': dagName, 'cursor': result.parked.cursor };
      // Expose only the cursor to Vue so the template can react.
      parked.value = { 'dagName': dagName, 'cursor': result.parked.cursor };
      // Auto-switch right pane to Operator tab.
      rightActiveKey.value = 'operator';
      logger.info(`parked at cursor: ${result.parked.cursor} · key: ${result.parked.correlationKey}`);
    } else {
      parkedExecution = null;
      parked.value = null;
    }

    logger.result(`lifecycle=${lifecycleVariant} · conversation=${String(state.conversation.length)} turns`);
  }
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
const leftTabs = computed(() => [
  { 'key': 'stream', 'label': 'Stream', 'badge': String(conversation.value.length || ''), 'tone': 'default' as const },
  { 'key': 'config', 'label': 'Config', 'badge': humanMode.value ? 'HUMAN' : '', 'tone': (humanMode.value ? 'warn' : 'default') as 'warn' | 'default' },
]);

const rightTabs = computed(() => {
  const traceCount = trace.value.length + logEvents.value.length;
  const operatorBadge = parked.value !== null ? '!' : '';
  const operatorTone = parked.value !== null ? 'warn' : 'default';
  return [
    { 'key': 'operator', 'label': 'Operator', 'badge': operatorBadge, 'tone': operatorTone as 'warn' | 'default' },
    { 'key': 'dag',      'label': 'DAG',      'badge': isRunning.value ? 'live' : '', 'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default' },
    { 'key': 'trace',    'label': 'Trace',    'badge': String(traceCount || ''), 'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default' },
  ];
});

// ── Auto-scroll stream ────────────────────────────────────────────────────────
watch(
  () => conversation.value.length,
  async () => {
    const el = streamRef.value;
    if (el === null) return;
    const wasAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 80;
    await nextTick();
    if (wasAtBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  },
);

// ── Backend watches ───────────────────────────────────────────────────────────
watch(apiKeys, async () => {
  backends.value = await BackendMatrix.detect({
    'apiKeys': apiKeys.value,
    ...(ollamaModel.value.length > 0 ? { 'preferredOllamaModel': ollamaModel.value } : {}),
  });
  noModel.value = BackendMatrix.hasNoRunnableModel(backends.value, { 'isMobile': isMobile.value });
}, { 'deep': true });

watch(activeBackend, (id) => {
  if (typeof localStorage !== 'undefined' && id !== null) {
    localStorage.setItem('dagonizer-active-backend', id);
  }
});

watch(apiKeys, () => { ApiKeyStore.save(apiKeys.value); }, { 'deep': true });
watch(ollamaModel, (next) => { OllamaModels.saveModel(next); });

// ── Boot ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  isMobile.value = MobileDetection.isLikelyMobile();

  backends.value = await BackendMatrix.detect({
    'apiKeys': apiKeys.value,
    ...(ollamaModel.value.length > 0 ? { 'preferredOllamaModel': ollamaModel.value } : {}),
  });

  if (BackendMatrix.hasNoRunnableModel(backends.value, { 'isMobile': isMobile.value })) {
    noModel.value = true;
    logger.warn('no LLM backend detected; select one to enable the demo');
    return;
  }
  noModel.value = false;

  // Honor a saved user preference only when that backend is runnable right now;
  // otherwise default to the best available backend (in-browser web models first).
  const savedEntry = savedBackend !== null
    ? backends.value.find((b) => b.id === savedBackend) ?? null
    : null;
  if (savedEntry !== null && savedEntry.runnable) {
    logger.info(`backend from saved preference: ${savedBackend}`);
  } else {
    const picked = BackendMatrix.pickBest(backends.value, { 'isMobile': isMobile.value });
    if (picked !== null) {
      activeBackend.value = picked.id;
      logger.info(
        savedBackend === null
          ? `backend auto-selected: ${picked.displayName}`
          : `saved preference "${savedBackend}" unavailable; defaulting to ${picked.displayName}`,
      );
    }
  }
});

// ── Services factory ──────────────────────────────────────────────────────────
function buildServices(): DispatcherServices {
  if (activeBackend.value === null) throw new Error('no backend selected');
  const client = ProviderInstantiator.instantiate(activeBackend.value, {
    'apiKeys': apiKeys.value,
    'model':   resolvedModel.value,
  });
  // ProviderInstantiator returns BaseLlmClient instances; access the underlying
  // adapter so DispatcherLlmClient can drive the chat calls directly.
  if (!(client instanceof BaseLlmClient)) throw new Error('unexpected client type');
  return { 'llm': new DispatcherLlmClient(client.adapter) };
}

// ── Execute ───────────────────────────────────────────────────────────────────
async function ask(): Promise<void> {
  if (isRunning.value || customerQuery.value.trim().length === 0 || activeBackend.value === null) return;

  const queryText = customerQuery.value.trim();
  customerQuery.value = '';
  isRunning.value = true;
  terminalVariant.value = 'pending';
  parked.value = null;
  trace.value = [];
  logger.clear();
  logger.info(`run start — message: "${queryText}" · humanMode: ${String(humanMode.value)}`);

  await dagGraph.value?.reset();

  // Re-build the bundle each run (fresh node instances, no cross-run state).
  const services = buildServices();
  const bundle = DispatcherBundleFactory.create(services);

  const state = new DispatcherState();
  state.message   = queryText;
  state.humanMode = humanMode.value;

  const dispatcher = new DispatcherBrowserObserver(logger);
  dispatcher.registerBundle(bundle);

  activeAbortController = new AbortController();
  try {
    await dispatcher.execute('support-dispatcher', state, { 'signal': activeAbortController.signal });
  } catch (error) {
    logger.error(`execute error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await dispatcher.destroy();
    activeAbortController = null;
    isRunning.value = false;
  }
}

// ── Operator resume ───────────────────────────────────────────────────────────
async function sendOperatorResponse(): Promise<void> {
  // Use the non-reactive store: parked.value is just the cursor signal.
  const pe = parkedExecution;
  if (pe === null || operatorInput.value.trim().length === 0) return;

  const responseText = operatorInput.value.trim();
  operatorInput.value = '';
  isRunning.value = true;
  trace.value = [...trace.value, {
    'node': 'operator',
    'ts': Date.now(),
    'variant': 'start',
  }];
  logger.info(`operator response captured — resuming from cursor: ${pe.cursor}`);

  // Re-build the bundle for the resume run (fresh node instances).
  const services = buildServices();
  const bundle = DispatcherBundleFactory.create(services);
  await dagGraph.value?.reset();

  let restored: { state: DispatcherState; dagName: string; cursor: string } | null = null;
  try {
    // pe.result was stored outside Vue reactivity so it retains class identity.
    const ckpt = await Checkpoint.capture(pe.dagName, pe.result);
    restored = ckpt.restoreState(
      CheckpointRestoreAdapter.wrap((snap) => DispatcherState.restore(snap)),
    );
  } catch (err) {
    logger.error(`checkpoint restore failed: ${err instanceof Error ? err.message : String(err)}`);
    isRunning.value = false;
    return;
  }

  restored.state.response = responseText;

  const dispatcher = new DispatcherBrowserObserver(logger);
  dispatcher.registerBundle(bundle);

  activeAbortController = new AbortController();
  try {
    await dispatcher.resume(restored.dagName, restored.state, restored.cursor, {
      'signal': activeAbortController.signal,
    });
  } catch (error) {
    logger.error(`resume error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await dispatcher.destroy();
    activeAbortController = null;
    isRunning.value = false;
    parkedExecution = null;
    parked.value = null;
    if (rightActiveKey.value === 'operator') rightActiveKey.value = 'dag';
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function reset(): void {
  conversation.value = [];
  trace.value = [];
  parkedExecution = null;
  parked.value = null;
  escalationReason.value = '';
  terminalVariant.value = 'pending';
  customerQuery.value = '';
  operatorInput.value = '';
  logger.clear();
  void dagGraph.value?.reset();
}

// ── Computed lifecycle badge text ─────────────────────────────────────────────
const lifecycleBadge = computed<string>(() => {
  if (isRunning.value) return 'running';
  if (parked.value !== null) return 'awaiting-input';
  const t = terminalVariant.value;
  return t === 'pending' ? 'idle' : t;
});

const isAwaiting = computed(() => parked.value !== null);

// ── Example prompts ───────────────────────────────────────────────────────────
const EXAMPLE_PROMPTS: readonly string[] = [
  'What are your store hours?',
  'Do you carry graphic novels?',
  'I need a refund for my last order',
  'My account was charged twice',
];

function fillPrompt(text: string): void {
  customerQuery.value = text;
}
</script>

<template>
  <div :class="['dispatcher-runner', { 'is-running': isRunning, 'is-awaiting': isAwaiting }]">

    <!-- No-model gate: shown when no real backend is available on this device. -->
    <section v-if="noModel" class="dr-no-model-gate" role="alert">
      <h3>No LLM backend detected</h3>
      <p>The Dispatcher demo now uses real LLM calls for classification and reply composition. Enable one of the backends below to start:</p>
      <BackendPicker
        :backends="backends"
        :active-id="activeBackend ?? ''"
        :api-keys="apiKeys"
        :ollama-model="ollamaModel"
        :is-mobile="isMobile"
        @update:active-id="activeBackend = $event as ProviderId"
        @update:api-keys="apiKeys = $event"
        @update:ollama-model="ollamaModel = $event"
      />
    </section>

    <template v-else>
    <div class="dr-grid">

      <!-- LEFT: Stream | Config -->
      <div class="dr-col dr-col--left">
        <div class="dr-col-head">
          <span class="dr-label">Customer</span>
          <span :class="['dr-badge', `dr-badge--${lifecycleBadge}`]">{{ lifecycleBadge }}</span>
        </div>

        <PanesTabs :tabs="leftTabs" default-key="stream" class="dr-tabs">

          <!-- Stream tab: conversation history -->
          <template #stream>
            <div class="dr-stream-pane">
              <ol v-if="conversation.length > 0" ref="streamRef" class="dr-conversation">
                <li
                  v-for="turn in conversation"
                  :key="turn.ts"
                  :class="['dr-turn', `dr-turn--${turn.role}`]"
                >
                  <span class="dr-turn-role">
                    {{ turn.role === 'customer' ? 'Customer' : turn.role === 'agent' ? 'Agent (AI)' : 'Operator' }}
                  </span>
                  <p class="dr-turn-text">{{ turn.text }}</p>
                </li>
              </ol>
              <p v-else class="dr-empty">
                Type a customer message below and click Send.
              </p>

              <div class="dr-send-area">
                <textarea
                  v-model="customerQuery"
                  :disabled="isRunning || isAwaiting"
                  class="dr-textarea"
                  rows="2"
                  placeholder="Customer message…"
                  @keydown.enter.prevent="!isRunning && !isAwaiting && ask()"
                />
                <div class="dr-send-row">
                  <button
                    type="button"
                    class="dr-btn dr-btn--primary"
                    :disabled="isRunning || isAwaiting || customerQuery.trim().length === 0"
                    @click="ask"
                  >
                    {{ isRunning ? 'Running…' : 'Send' }}
                  </button>
                  <button
                    v-if="isRunning && !isAwaiting"
                    type="button"
                    class="dr-btn dr-btn--cancel"
                    @click="cancel"
                  >
                    Cancel
                  </button>
                  <button
                    v-if="conversation.length > 0 && !isRunning"
                    type="button"
                    class="dr-btn dr-btn--ghost"
                    @click="reset"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- Config tab: trolley switch + example prompts -->
          <template #config>
            <div class="dr-config-pane">

              <!-- Trolley switch -->
              <section class="dr-config-section">
                <h5 class="dr-config-head">Routing mode</h5>
                <label class="dr-trolley">
                  <span :class="['dr-trolley-label', !humanMode ? 'dr-trolley-label--active' : '']">AI AUTO</span>
                  <button
                    type="button"
                    :class="['dr-trolley-track', humanMode ? 'dr-trolley-track--human' : '']"
                    :aria-pressed="humanMode"
                    aria-label="Toggle routing mode"
                    @click="humanMode = !humanMode"
                  >
                    <span class="dr-trolley-thumb" />
                  </button>
                  <span :class="['dr-trolley-label', humanMode ? 'dr-trolley-label--active dr-trolley-label--warn' : '']">HUMAN GATE</span>
                </label>
                <p class="dr-config-hint" v-if="humanMode">
                  All messages will route to the operator regardless of content.
                </p>
                <p class="dr-config-hint" v-else>
                  The classifier routes routine queries to AI; escalation keywords force the operator.
                </p>
              </section>

              <!-- Example prompts -->
              <section class="dr-config-section">
                <h5 class="dr-config-head">Example prompts</h5>
                <ul class="dr-prompt-list">
                  <li v-for="prompt in EXAMPLE_PROMPTS" :key="prompt">
                    <button
                      type="button"
                      class="dr-prompt-btn"
                      :disabled="isRunning || isAwaiting"
                      @click="fillPrompt(prompt)"
                    >{{ prompt }}</button>
                  </li>
                </ul>
              </section>

              <!-- Escalation reason -->
              <section v-if="escalationReason.length > 0" class="dr-config-section">
                <h5 class="dr-config-head">Last escalation reason</h5>
                <p class="dr-escalation-reason">{{ escalationReason }}</p>
              </section>

              <!-- Backend picker -->
              <section class="dr-config-section">
                <h5 class="dr-config-head">Backend</h5>
                <BackendPicker
                  :backends="backends"
                  :active-id="activeBackend ?? ''"
                  :api-keys="apiKeys"
                  :ollama-model="ollamaModel"
                  :is-mobile="isMobile"
                  @update:active-id="activeBackend = $event as ProviderId"
                  @update:api-keys="apiKeys = $event"
                  @update:ollama-model="ollamaModel = $event"
                />
              </section>

            </div>
          </template>

        </PanesTabs>
      </div>

      <!-- RIGHT: Operator | DAG | Trace -->
      <div class="dr-col dr-col--right">
        <div class="dr-col-head">
          <span class="dr-label">Operator / Graph</span>
          <span class="dr-hint">{{ isAwaiting ? 'awaiting operator' : isRunning ? 'running…' : 'ready' }}</span>
        </div>

        <PanesTabs
          :tabs="rightTabs"
          :default-key="rightActiveKey"
          class="dr-tabs dr-tabs--right"
        >

          <!-- Operator tab -->
          <template #operator>
            <div class="dr-operator-pane">
              <template v-if="isAwaiting">
                <div class="dr-operator-alert">
                  <span class="dr-operator-alert-icon">!</span>
                  <span class="dr-operator-alert-text">Customer request requires operator response</span>
                </div>
                <div v-if="escalationReason.length > 0" class="dr-operator-reason">
                  <span class="dr-operator-reason-label">Reason:</span>
                  {{ escalationReason }}
                </div>
                <div v-if="conversation.length > 0" class="dr-operator-last-msg">
                  <span class="dr-operator-msg-label">Customer said:</span>
                  <blockquote class="dr-operator-msg-quote">
                    {{ conversation[conversation.length - 1]?.text ?? '' }}
                  </blockquote>
                </div>
                <textarea
                  v-model="operatorInput"
                  class="dr-textarea dr-operator-textarea"
                  rows="4"
                  placeholder="Type operator response here…"
                />
                <button
                  type="button"
                  class="dr-btn dr-btn--primary"
                  :disabled="operatorInput.trim().length === 0 || isRunning"
                  @click="sendOperatorResponse"
                >
                  {{ isRunning ? 'Resuming…' : 'Send response' }}
                </button>
              </template>
              <template v-else>
                <div class="dr-operator-idle">
                  <p class="dr-operator-idle-text">
                    AI handling — no operator action needed.
                  </p>
                  <p class="dr-operator-idle-sub" v-if="conversation.length === 0">
                    Send a customer message to watch the classifier route it.
                  </p>
                  <p class="dr-operator-idle-sub" v-else>
                    Try an escalation keyword ("refund", "billing") or flip the trolley switch to HUMAN GATE.
                  </p>
                </div>
              </template>
            </div>
          </template>

          <!-- DAG tab: live execution graph -->
          <template #dag>
            <div class="dr-graph-pane">
              <DagGraph
                ref="dagGraph"
                :dag="dispatcherDag"
                :node-variants="DISPATCHER_NODE_VARIANTS"
                :expand-all="false"
                aria-label="Dispatcher DAG live execution"
              />
            </div>
          </template>

          <!-- Trace tab -->
          <template #trace>
            <TraceFeed
              :entries="trace"
              :log-events="logEvents"
            />
          </template>

        </PanesTabs>
      </div>

    </div>
    </template>
  </div>
</template>

<style scoped>
/* ── Container ─────────────────────────────────────────────────────────── */
.dispatcher-runner {
  container-type: inline-size;
  container-name: dispatcher;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 1rem;
  background: var(--vp-c-bg-alt);
  font-family: var(--vp-font-family-base);
  width: 100%;
}

/* ── Two-column grid: iridis pattern ──────────────────────────────────── */
.dr-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}

@container dispatcher (min-width: 720px) {
  .dr-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
  }
}

/* ── Column ────────────────────────────────────────────────────────────── */
.dr-col {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

/* ── Column head ────────────────────────────────────────────────────────── */
.dr-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 1.75rem;
}

.dr-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.dr-hint {
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}

/* ── Lifecycle badge ────────────────────────────────────────────────────── */
.dr-badge {
  font-family: var(--vp-font-family-mono);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.45rem;
  border-radius: 3px;
  border: 1px solid transparent;
}

.dr-badge--idle          { color: var(--vp-c-text-3); border-color: var(--vp-c-divider); }
.dr-badge--running       { color: var(--dagonizer-brand); border-color: var(--dagonizer-brand); animation: pulse-badge 1.2s ease-in-out infinite; }
.dr-badge--awaiting-input { color: var(--dagonizer-brand3); border-color: var(--dagonizer-brand3); }
.dr-badge--completed     { color: var(--dagonizer-brand2); border-color: var(--dagonizer-brand2); }
.dr-badge--failed        { color: #e06c75; border-color: #e06c75; }
.dr-badge--cancelled     { color: var(--vp-c-text-3); border-color: var(--vp-c-divider); }
.dr-badge--timed_out     { color: #e06c75; border-color: #e06c75; }

@keyframes pulse-badge {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */
.dr-tabs {
  flex: 1 1 auto;
  min-height: 460px;
  max-height: min(800px, calc(100vh - 200px));
  overflow: hidden;
}

.dr-tabs--right {
  min-height: 460px;
  max-height: min(800px, calc(100vh - 200px));
}

/* ── Stream pane ─────────────────────────────────────────────────────────── */
.dr-stream-pane {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  height: 100%;
  padding: 0.75rem;
}

.dr-conversation {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--vp-c-divider) transparent;
}

.dr-conversation::-webkit-scrollbar { width: 6px; }
.dr-conversation::-webkit-scrollbar-track { background: transparent; }
.dr-conversation::-webkit-scrollbar-thumb { background: var(--vp-c-divider); border-radius: 3px; }

.dr-turn {
  padding: 0.45rem 0.6rem;
  border-radius: 4px;
  border-left: 3px solid transparent;
  background: var(--vp-c-bg-alt);
  animation: turn-in 0.2s ease-out;
}

.dr-turn--customer { border-left-color: var(--dagonizer-brand3); }
.dr-turn--agent    { border-left-color: var(--dagonizer-brand); }
.dr-turn--operator { border-left-color: var(--dagonizer-brand2); }

.dr-turn-role {
  display: block;
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 0.18rem;
}

.dr-turn--customer .dr-turn-role { color: var(--dagonizer-brand3); }
.dr-turn--agent    .dr-turn-role { color: var(--dagonizer-brand); }
.dr-turn--operator .dr-turn-role { color: var(--dagonizer-brand2); }

.dr-turn-text {
  margin: 0;
  color: var(--vp-c-text-1);
  line-height: 1.45;
  font-size: 0.88rem;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.dr-empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vp-c-text-3);
  font-style: italic;
  font-size: 0.88rem;
  text-align: center;
  padding: 1rem;
  margin: 0;
}

@keyframes turn-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Send area ───────────────────────────────────────────────────────────── */
.dr-send-area {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.dr-send-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

/* ── Textarea (shared) ────────────────────────────────────────────────────── */
.dr-textarea {
  width: 100%;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
  padding: 0.5rem 0.65rem;
  font-size: 0.88rem;
  font-family: var(--vp-font-family-base);
  color: var(--vp-c-text-1);
  resize: vertical;
  transition: border-color 0.12s ease;
  box-sizing: border-box;
}

.dr-textarea:focus {
  outline: none;
  border-color: var(--dagonizer-brand);
}

.dr-textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.dr-btn {
  padding: 0.38rem 0.85rem;
  border-radius: 5px;
  font-size: 0.82rem;
  font-family: var(--vp-font-family-base);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, opacity 0.12s ease, color 0.12s ease;
  white-space: nowrap;
}

.dr-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dr-btn--primary {
  background: var(--dagonizer-brand);
  color: #020306;
  border: 1px solid var(--dagonizer-brand);
}

.dr-btn--primary:not(:disabled):hover {
  background: color-mix(in srgb, var(--dagonizer-brand) 85%, #fff);
}

.dr-btn--cancel {
  background: transparent;
  color: #e06c75;
  border: 1px solid #e06c75;
}

.dr-btn--cancel:hover {
  background: rgba(224, 108, 117, 0.1);
}

.dr-btn--ghost {
  background: transparent;
  color: var(--vp-c-text-3);
  border: 1px solid var(--vp-c-divider);
}

.dr-btn--ghost:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-text-3);
}

/* ── Config pane ─────────────────────────────────────────────────────────── */
.dr-config-pane {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 0.85rem 0.9rem;
  overflow-y: auto;
  height: 100%;
}

.dr-config-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.dr-config-head {
  margin: 0;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.dr-config-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
  line-height: 1.45;
}

/* ── Trolley switch ──────────────────────────────────────────────────────── */
.dr-trolley {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  user-select: none;
}

.dr-trolley-label {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  transition: color 0.15s ease;
}

.dr-trolley-label--active {
  color: var(--dagonizer-brand);
}

.dr-trolley-label--warn {
  color: var(--dagonizer-brand3);
}

.dr-trolley-track {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 3rem;
  height: 1.5rem;
  border-radius: 0.75rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
  flex-shrink: 0;
  padding: 0;
}

.dr-trolley-track--human {
  background: rgba(212, 166, 73, 0.18);
  border-color: var(--dagonizer-brand3);
}

.dr-trolley-thumb {
  position: absolute;
  left: 0.18rem;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  background: var(--vp-c-text-3);
  transition: transform 0.18s ease, background 0.18s ease;
}

.dr-trolley-track--human .dr-trolley-thumb {
  transform: translateX(1.5rem);
  background: var(--dagonizer-brand3);
}

/* ── Example prompts ─────────────────────────────────────────────────────── */
.dr-prompt-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.dr-prompt-btn {
  width: 100%;
  text-align: left;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  padding: 0.4rem 0.65rem;
  font-size: 0.82rem;
  font-family: var(--vp-font-family-base);
  color: var(--vp-c-text-1);
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
}

.dr-prompt-btn:not(:disabled):hover {
  border-color: var(--dagonizer-brand);
  background: var(--vp-c-bg-elv);
}

.dr-prompt-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Escalation reason ────────────────────────────────────────────────────── */
.dr-escalation-reason {
  margin: 0;
  font-size: 0.82rem;
  font-style: italic;
  color: var(--dagonizer-brand3);
  background: rgba(212, 166, 73, 0.08);
  border: 1px solid rgba(212, 166, 73, 0.25);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  line-height: 1.4;
}

/* ── Operator pane ────────────────────────────────────────────────────────── */
.dr-operator-pane {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.9rem;
  height: 100%;
  overflow-y: auto;
}

.dr-operator-alert {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.8rem;
  background: rgba(212, 166, 73, 0.1);
  border: 1px solid var(--dagonizer-brand3);
  border-radius: 6px;
  font-size: 0.85rem;
  color: var(--dagonizer-brand3);
  font-weight: 600;
}

.dr-operator-alert-icon {
  flex-shrink: 0;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  background: var(--dagonizer-brand3);
  color: #020306;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 0.78rem;
}

.dr-operator-alert-text {
  flex: 1 1 auto;
}

.dr-operator-reason {
  font-size: 0.82rem;
  color: var(--vp-c-text-2);
  padding: 0.4rem 0.6rem;
  background: var(--vp-c-bg);
  border-radius: 4px;
  border: 1px solid var(--vp-c-divider);
}

.dr-operator-reason-label {
  font-weight: 600;
  color: var(--vp-c-text-3);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: block;
  margin-bottom: 0.15rem;
}

.dr-operator-last-msg {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.dr-operator-msg-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vp-c-text-3);
  font-weight: 600;
}

.dr-operator-msg-quote {
  margin: 0;
  padding: 0.5rem 0.7rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-left: 3px solid var(--dagonizer-brand3);
  border-radius: 4px;
  font-size: 0.88rem;
  color: var(--vp-c-text-1);
  line-height: 1.45;
  font-style: italic;
}

.dr-operator-textarea {
  min-height: 5rem;
}

.dr-operator-idle {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  text-align: center;
  padding: 2rem 1rem;
}

.dr-operator-idle-text {
  margin: 0;
  font-size: 0.92rem;
  color: var(--vp-c-text-2);
  font-weight: 500;
}

.dr-operator-idle-sub {
  margin: 0;
  font-size: 0.82rem;
  color: var(--vp-c-text-3);
  line-height: 1.45;
  max-width: 28rem;
}

/* ── Graph pane ──────────────────────────────────────────────────────────── */
.dr-graph-pane {
  position: relative;
  width: 100%;
  height: 560px;
}

/* ── Running animation: glow the DAG pane ──────────────────────────────── */
.dispatcher-runner.is-running .dr-graph-pane,
.dispatcher-runner.is-awaiting .dr-graph-pane {
  box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 28px -6px var(--dagonizer-brand);
  animation: dag-pulse 1.8s ease-in-out infinite;
  border-radius: 8px;
}

.dispatcher-runner.is-awaiting .dr-graph-pane {
  box-shadow: 0 0 0 1px var(--dagonizer-brand3), 0 0 28px -6px var(--dagonizer-brand3);
}

@keyframes dag-pulse {
  0%, 100% { box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 28px -8px var(--dagonizer-brand); }
  50%       { box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 36px -2px var(--dagonizer-brand); }
}
</style>
