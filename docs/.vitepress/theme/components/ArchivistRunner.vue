<script setup lang="ts">
/**
 * ArchivistRunner — orchestrator for the in-browser Archivist demo.
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  BackendPicker                                                   │
 *   │  ┌───────────────────────────────────────────────────────────┐   │
 *   │  │                       DagGraph                            │   │
 *   │  └───────────────────────────────────────────────────────────┘   │
 *   │  ┌─────────────────────┬──────────────────────┬──────────────┐  │
 *   │  │   Conversation      │       Memory         │   Trace      │  │
 *   │  └─────────────────────┴──────────────────────┴──────────────┘  │
 *   │  RunControls                                                     │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Pure observer: the dispatcher's lifecycle hooks toggle CSS classes on
 * cytoscape nodes / edges via the DagGraph's imperative surface — no
 * setTimeout, no polling, no JS-driven animation loops.
 */

import { computed, onMounted, ref, watch } from 'vue';
import type { ElementDefinition } from 'cytoscape';

import { Checkpoint } from '@noocodex/dagonizer/checkpoint';
import type { ExecutionResultInterface } from '@noocodex/dagonizer';

import { CytoscapeRenderer } from '../../../../src/viz/CytoscapeRenderer.ts';

import { ArchivistState } from '../../../../examples/the-archivist/ArchivistState.ts';
import { archivistDAG } from '../../../../examples/the-archivist/dag.ts';
import { ConsoleLogger } from '../../../../examples/the-archivist/logger/ConsoleLogger.ts';
import { MemoryStore } from '../../../../examples/the-archivist/memory/MemoryStore.ts';
import { ONTOLOGY_NTRIPLES } from '../../../../examples/the-archivist/ontology/ArchivistOntology.ts';
import { RdfProvObserver } from '../../../../examples/the-archivist/provenance/RdfProvObserver.ts';
import { StateProjection } from '../../../../examples/the-archivist/state/StateProjection.ts';
import { NODE_KINDS } from '../../../../examples/the-archivist/nodes/ArchivistNode.ts';
import { classifyIntent } from '../../../../examples/the-archivist/nodes/classifyIntent.ts';
import { composeResponse, validateResponse } from '../../../../examples/the-archivist/nodes/composeResponse.ts';
import { decideTools } from '../../../../examples/the-archivist/nodes/decideTools.ts';
import { extractQuery } from '../../../../examples/the-archivist/nodes/extractQuery.ts';
import { groupByYear } from '../../../../examples/the-archivist/nodes/groupByYear.ts';
import { hasCitationsGate } from '../../../../examples/the-archivist/nodes/hasCitationsGate.ts';
import { mergeCandidates } from '../../../../examples/the-archivist/nodes/mergeCandidates.ts';
import { rankCandidates } from '../../../../examples/the-archivist/nodes/rankCandidates.ts';
import { rankByRating } from '../../../../examples/the-archivist/nodes/rankByRating.ts';
import { pickBestMatch } from '../../../../examples/the-archivist/nodes/pickBestMatch.ts';
import { recallContext } from '../../../../examples/the-archivist/nodes/recallContext.ts';
import { recallPastVisits } from '../../../../examples/the-archivist/nodes/recallPastVisits.ts';
import { recommendSimilar } from '../../../../examples/the-archivist/nodes/recommendSimilar.ts';
import { recordFindings } from '../../../../examples/the-archivist/nodes/recordFindings.ts';
import { declineEmpty, declineOffTopic, respondToVisitor } from '../../../../examples/the-archivist/nodes/respondToVisitor.ts';
import { webSearchScout, openLibraryScout, googleBooksScout, subjectScout, wikipediaScout } from '../../../../examples/the-archivist/nodes/scouts.ts';
import { detectBackends, hasNoRunnableModel, instantiateProvider, pickBestBackend } from '../../../../examples/the-archivist/providers/index.ts';
import type { BackendAvailability, ProviderId } from '../../../../examples/the-archivist/providers/index.ts';
import type { ArchivistServices } from '../../../../examples/the-archivist/services.ts';
import { GoogleBooksTool } from '../../../../examples/the-archivist/tools/GoogleBooksTool.ts';
import { OpenLibrarySearchTool } from '../../../../examples/the-archivist/tools/OpenLibrarySearchTool.ts';
import { SubjectSearchTool } from '../../../../examples/the-archivist/tools/SubjectSearchTool.ts';
import { WikipediaSummaryTool } from '../../../../examples/the-archivist/tools/WikipediaSummaryTool.ts';

import { ObservedDagonizer } from './ObservedDagonizer.ts';
import BackendPicker from './BackendPicker.vue';
import CheckpointControls from './CheckpointControls.vue';
import Conversation from './Conversation.vue';
import DagGraph from './DagGraph.vue';
import MemoryGraph from './MemoryGraph.vue';
import NodeLegend from './NodeLegend.vue';
import PanesTabs from './PanesTabs.vue';
import PersistenceBadge from './PersistenceBadge.vue';
import SendForm from './SendForm.vue';
import StateLegend from './StateLegend.vue';
import TimeoutPane from './TimeoutPane.vue';
import type { TimeoutSettings } from './TimeoutPane.vue';
import TraceFeed from './TraceFeed.vue';
import TripleInspector from './TripleInspector.vue';

import { RunnerMachine } from '../runner/RunnerMachine.ts';
import { ARCHIVIST_GREETING } from '../../../../examples/the-archivist/providers/prompts.ts';

// ── State ───────────────────────────────────────────────────────────────
const backends = ref<readonly BackendAvailability[]>([]);
const activeBackend = ref<ProviderId>('gemini-nano');
const noModel = ref(false);
const apiKey = ref(loadKey());
const visitorQuery = ref("I'm looking for a book about a strange house and a library");
const isRunning = ref(false);
const conversation = ref<Array<{ role: 'visitor' | 'archivist'; text: string; ts: number }>>([
  { 'role': 'archivist', 'text': ARCHIVIST_GREETING, 'ts': Date.now() },
]);
const trace = ref<Array<{ node: string; output?: string; ts: number; kind: 'start' | 'end' | 'error' }>>([]);
const terminalKind = ref<'pending' | 'completed' | 'failed' | 'cancelled' | 'timed_out'>('pending');

const dagGraph = ref<InstanceType<typeof DagGraph> | null>(null);
const memoryStore = new MemoryStore();
memoryStore.enablePersistence();
const memoryTick = ref(0); // bumped after each write so MemoryGraph re-renders
const isPersisted = ref(memoryStore.isPersisted);
const logger = new ConsoleLogger();

// ── Timeout settings (deliverable 1) ────────────────────────────────────
const timeoutSettings = ref<TimeoutSettings>({
  'composeMs':   30_000,
  'webSearchMs': 20_000,
  'rankMs':      15_000,
});

function onTimeoutSettingsUpdate(settings: TimeoutSettings): void {
  timeoutSettings.value = settings;
}

/**
 * Overall safety-net deadline: sum of all per-phase budgets plus a small
 * grace window. Per-node timeouts are the primary mechanism — this is a
 * last-resort hard stop for nodes that do not declare their own budget.
 */
function overallDeadlineMs(): number {
  const { composeMs, webSearchMs, rankMs } = timeoutSettings.value;
  const grace = 5_000;
  return composeMs + webSearchMs + rankMs + grace;
}

// ── Cancel button (deliverable 2) ────────────────────────────────────────
let activeAbortController: AbortController | null = null;

function cancel(): void {
  if (activeAbortController !== null) {
    activeAbortController.abort(new Error('cancelled by visitor'));
  }
}

// ── Checkpoint (deliverable 3) ───────────────────────────────────────────
const CHECKPOINT_KEY = 'dagonizer-archivist-checkpoint';
const checkpointNode = ref<string | null>(null);
const hasCheckpoint = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem('dagonizer-archivist-checkpoint') !== null
);
let lastResult: ExecutionResultInterface<ArchivistState> | null = null;
let lastDagName = 'the-archivist';

function saveCheckpoint(): void {
  if (lastResult === null || lastResult.cursor === null) {
    logger.warn('no resumable checkpoint available (run completed fully, or no run yet)');
    return;
  }
  try {
    const data = Checkpoint.from(lastDagName, lastResult);
    const json = Checkpoint.toJson(data);
    localStorage.setItem(CHECKPOINT_KEY, json);
    checkpointNode.value = lastResult.cursor;
    hasCheckpoint.value = true;
    dagGraph.value?.setCompleted(lastResult.cursor);
    trace.value = [...trace.value, {
      'node': lastResult.cursor,
      'ts': Date.now(),
      'kind': 'end',
      'output': 'checkpoint saved',
    }];
    logger.info(`checkpoint saved at ${lastResult.cursor}`);
  } catch (err) {
    logger.warn(`checkpoint failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function resumeFromCheckpoint(): Promise<void> {
  if (isRunning.value) return;
  const raw = typeof localStorage !== 'undefined'
    ? localStorage.getItem(CHECKPOINT_KEY)
    : null;
  if (raw === null) {
    logger.warn('no checkpoint found in localStorage');
    return;
  }
  let restored: { state: ArchivistState; dagName: string; cursor: string } | null = null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    restored = Checkpoint.restore(parsed, (snap) => ArchivistState.restore(snap)) as {
      state: ArchivistState;
      dagName: string;
      cursor: string;
    };
  } catch (err) {
    logger.warn(`checkpoint restore failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  runnerMachine.dispatch({ 'type': 'submit' });
  isRunning.value = true;
  terminalKind.value = 'pending';
  trace.value = [];
  dagGraph.value?.reset();
  memoryTick.value++;
  logger.clear();
  logger.info(`resuming from checkpoint at node: ${restored.cursor}`);

  const runId = restored.state.runId !== ''
    ? restored.state.runId
    : (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `r-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

  const prov = new RdfProvObserver({
    'store':              memoryStore,
    'runId':              runId,
    'dispatcherAgentId':  `dispatcher:${activeBackend.value}`,
  });

  const services = buildServices();
  const dispatcher = new ObservedDagonizer<ArchivistState, ArchivistServices>({
    services,
    'observer': buildObserver(restored.cursor, prov),
  });

  for (const node of [
    recallContext,
    classifyIntent, extractQuery, decideTools,
    webSearchScout, openLibraryScout, googleBooksScout, subjectScout, wikipediaScout,
    rankCandidates,
    rankByRating, pickBestMatch,
    mergeCandidates, recordFindings, hasCitationsGate,
    recallPastVisits, groupByYear, recommendSimilar,
    composeResponse, validateResponse,
    respondToVisitor, declineOffTopic, declineEmpty,
  ]) dispatcher.registerNode(node);
  dispatcher.registerDAG(archivistDAG);

  activeAbortController = new AbortController();
  const deadlineMs = overallDeadlineMs();

  try {
    await dispatcher.resume(
      restored.dagName,
      restored.state,
      restored.cursor,
      { 'signal': activeAbortController.signal, 'deadlineMs': deadlineMs },
    );
  } catch (error) {
    conversation.value = [...conversation.value, {
      'role': 'archivist',
      'text': `(error: ${error instanceof Error ? error.message : String(error)})`,
      'ts': Date.now(),
    }];
  } finally {
    await dispatcher.destroy();
    activeAbortController = null;
    isRunning.value = false;
  }
}

// ── Persistence badge toggle (deliverable 4) ─────────────────────────────
function togglePersistence(): void {
  if (memoryStore.isPersisted) {
    memoryStore.disablePersistence();
    isPersisted.value = false;
    logger.info('memory store: switched to in-memory mode (localStorage dump removed)');
  } else {
    memoryStore.enablePersistence();
    isPersisted.value = true;
    logger.info('memory store: switched to persisted mode');
  }
  memoryTick.value++;
}

// UI state machine — runner subscribes; views derive UI from the
// machine's current state instead of independent refs. Pulses fire on
// sub-events (node-start, node-end) without shifting top-level state.
const runnerMachine = new RunnerMachine();

// Selected IRI in the memory graph — TripleInspector reads this.
const selectedIri = ref<string | null>(null);
function onMemorySelect(iri: string | null): void { selectedIri.value = iri; }

function clearMemory(): void {
  memoryStore.clear();
  memoryTick.value++;
  logger.info('memory store cleared');
}

// Re-detect backend availability when the visitor pastes or types an
// API key, so the gemini-api option flips runnable as soon as the key
// has any length.
watch(apiKey, async () => {
  backends.value = await detectBackends({ 'apiKey': apiKey.value || undefined });
  noModel.value = hasNoRunnableModel(backends.value);
});

// Workshop tabs — 4 tabs. Conversation is standalone in the left column.
//   DAG       — live execution graph
//   Memory    — unified RDF graph (ontology + memory + state + prov layers)
//   Trace     — merged node lifecycle events + logger lines
//   Timeouts  — per-phase timeout sliders
const workshopTabs = computed(() => {
  const traceCount = trace.value.length + logger.history().length;
  return [
    { 'key': 'dag',      'label': 'DAG',      'badge': isRunning.value ? 'live' : '',        'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default' },
    { 'key': 'memory',   'label': 'Memory',   'badge': String(memoryStore.size || ''),       'tone': 'accent' as const },
    { 'key': 'trace',    'label': 'Trace',    'badge': String(traceCount || ''),             'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default' },
    { 'key': 'timeouts', 'label': 'Timeouts', 'badge': '',                                  'tone': 'default' as const },
  ];
});

const dagElements = computed<ElementDefinition[]>(() => {
  // Enrich every node element with `kind` so the cytoscape stylesheet
  // can style deterministic vs non-deterministic placements differently.
  const raw = CytoscapeRenderer.render(archivistDAG) as ElementDefinition[];
  return raw.map((el) => {
    const data = el.data as { id?: string; node?: string };
    const nodeName = data.node ?? data.id;
    const kind = nodeName !== undefined ? NODE_KINDS[nodeName] : undefined;
    if (kind === undefined) return el;
    return { ...el, data: { ...el.data, kind } };
  });
});

function buildServices(): ArchivistServices {
  return {
    'webSearch':         OpenLibrarySearchTool,
    'googleBooks':       GoogleBooksTool,
    'subjectSearch':     SubjectSearchTool,
    'wikipediaSummary':  WikipediaSummaryTool,
    'memory':            memoryStore,
    'llm':               instantiateProvider(activeBackend.value, { 'apiKey': apiKey.value || undefined }),
    'logger':            logger,
  };
}

/**
 * Shared observer used by both `ask()` (fresh run) and
 * `resumeFromCheckpoint()` (resume from a cursor). When `fromCursor`
 * is non-null the observer highlights the resume node on flow-start so
 * the visitor sees where execution picks back up.
 */
function buildObserver(fromCursor: string | null, prov: RdfProvObserver) {
  return {
    onFlowStart(dagName: string) {
      dagGraph.value?.reset();
      if (fromCursor !== null) dagGraph.value?.setActive(fromCursor);
      prov.recordFlowStart(dagName);
    },
    onNodeStart(nodeName: string) {
      trace.value = [...trace.value, { 'node': nodeName, 'ts': Date.now(), 'kind': 'start' }];
      dagGraph.value?.setActive(nodeName);
      prov.recordNodeStart(nodeName);
      runnerMachine.pulse({ 'type': 'nodeStart', 'node': nodeName });
    },
    onNodeEnd(nodeName: string, output: string | undefined, state: ArchivistState) {
      trace.value = [...trace.value, { 'node': nodeName, output, 'ts': Date.now(), 'kind': 'end' }];
      dagGraph.value?.setCompleted(nodeName);
      if (output !== undefined) dagGraph.value?.markEdgeTraversed(nodeName, output);
      StateProjection.project(state, memoryStore);
      prov.recordNodeEnd(nodeName, output);
      memoryTick.value++;
      runnerMachine.pulse(output === undefined
        ? { 'type': 'nodeEnd', 'node': nodeName }
        : { 'type': 'nodeEnd', 'node': nodeName, 'output': output });
    },
    onError(nodeName: string, error: Error) {
      trace.value = [...trace.value, { 'node': nodeName, 'ts': Date.now(), 'kind': 'error' }];
      dagGraph.value?.setErrored(nodeName);
      prov.recordError(nodeName, error);
      runnerMachine.pulse({ 'type': 'nodeError', 'node': nodeName, 'error': error });
    },
    onFlowEnd(dagName: string, state: ArchivistState, result: { cursor: string | null }) {
      const kind = state.lifecycle.kind;
      if (kind === 'completed' || kind === 'failed' || kind === 'cancelled' || kind === 'timed_out') {
        terminalKind.value = kind;
      }
      if (state.draft.length > 0) {
        conversation.value = [...conversation.value, {
          'role': 'archivist',
          'text': state.draft,
          'ts': Date.now(),
        }];
      }
      lastResult = result as never;
      lastDagName = dagName;
      if (result.cursor !== null) checkpointNode.value = result.cursor;
      prov.recordFlowEnd(kind);
      memoryTick.value++;
      logger.result(`intent=${state.intent} · shortlist=${String(state.shortlist.length)} · triples=${String(memoryStore.size)} · lifecycle=${kind}`);
      runnerMachine.dispatch({ 'type': 'flowEnd', 'lifecycle': kind });
    },
  };
}

// ── Boot ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  // TBox must be available before any run writes ABox triples.
  memoryStore.loadOntology(ONTOLOGY_NTRIPLES);
  memoryTick.value++;

  backends.value = await detectBackends({ 'apiKey': apiKey.value || undefined });
  if (hasNoRunnableModel(backends.value)) {
    noModel.value = true;
    logger.warn('no LLM backend detected — visitor must enable one');
    return;
  }
  noModel.value = false;
  const picked = pickBestBackend(backends.value);
  if (picked !== null) {
    activeBackend.value = picked.id;
    logger.info(`backend: ${picked.displayName}`);
  }
});

watch(apiKey, saveKey);

// ── Run ──────────────────────────────────────────────────────────────────
async function ask(): Promise<void> {
  if (isRunning.value || visitorQuery.value.trim().length === 0) return;
  runnerMachine.dispatch({ 'type': 'submit' });
  isRunning.value = true;
  terminalKind.value = 'pending';
  trace.value = [];

  conversation.value = [...conversation.value, {
    'role': 'visitor',
    'text': visitorQuery.value,
    'ts': Date.now(),
  }];

  dagGraph.value?.reset();
  // Memory persists across runs — clear via the Memory pane's button.
  memoryTick.value++;
  logger.clear();
  logger.info(`run start — query: "${visitorQuery.value}"`);

  // Per-run identifier — used as the suffix for both
  // urn:dagonizer:state:<runId> and urn:dagonizer:prov:<runId>.
  const runId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `r-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;
  StateProjection.clear(runId, memoryStore);
  const prov = new RdfProvObserver({
    'store':              memoryStore,
    'runId':              runId,
    'dispatcherAgentId':  `dispatcher:${activeBackend.value}`,
  });

  const services = buildServices();
  const dispatcher = new ObservedDagonizer<ArchivistState, ArchivistServices>({
    services,
    'observer': buildObserver(null, prov),
  });

  // Apply per-phase timeouts from the visitor's Timeouts tab settings.
  // The node objects from the module are treated as defaults; each run gets
  // a fresh instance with the user's chosen budget injected via spread.
  const { composeMs, webSearchMs, rankMs } = timeoutSettings.value;
  const composeNode     = { ...composeResponse,    'timeoutMs': composeMs };
  const rankNode        = { ...rankCandidates,     'timeoutMs': rankMs };
  const scoutNode       = { ...webSearchScout,     'timeoutMs': webSearchMs };
  const olScoutNode     = { ...openLibraryScout,   'timeoutMs': webSearchMs };
  const gbScoutNode     = { ...googleBooksScout,   'timeoutMs': webSearchMs };
  const subjectScoutNode = { ...subjectScout,      'timeoutMs': webSearchMs };
  const wikiScoutNode   = { ...wikipediaScout,     'timeoutMs': webSearchMs };

  for (const node of [
    recallContext,
    classifyIntent, extractQuery, decideTools,
    scoutNode, olScoutNode, gbScoutNode, subjectScoutNode, wikiScoutNode,
    rankNode,
    rankByRating, pickBestMatch,
    mergeCandidates, recordFindings, hasCitationsGate,
    groupByYear, recallPastVisits, recommendSimilar,
    composeNode, validateResponse,
    respondToVisitor, declineOffTopic, declineEmpty,
  ]) dispatcher.registerNode(node);
  dispatcher.registerDAG(archivistDAG);

  const visitor = new ArchivistState();
  visitor.query = visitorQuery.value;
  visitor.runId = runId;

  // Create a fresh AbortController for this run (deliverable 2).
  activeAbortController = new AbortController();
  // Overall safety-net deadline: per-node timeouts are primary; this catches
  // any node that does not declare its own budget.
  const deadlineMs = overallDeadlineMs();

  try {
    await dispatcher.execute(
      'the-archivist',
      visitor,
      { 'signal': activeAbortController.signal, 'deadlineMs': deadlineMs },
    );
  } catch (error) {
    conversation.value = [...conversation.value, {
      'role': 'archivist',
      'text': `(error: ${error instanceof Error ? error.message : String(error)})`,
      'ts': Date.now(),
    }];
  } finally {
    await dispatcher.destroy();
    activeAbortController = null;
    isRunning.value = false;
  }
}

function reset(): void {
  conversation.value = [
    { 'role': 'archivist', 'text': ARCHIVIST_GREETING, 'ts': Date.now() },
  ];
  trace.value = [];
  terminalKind.value = 'pending';
  selectedIri.value = null;
  checkpointNode.value = null;
  lastResult = null;
  dagGraph.value?.reset();
  // Reset does NOT wipe persisted memory — use the Memory pane's Clear button.
  memoryTick.value++;
  logger.clear();
  runnerMachine.dispatch({ 'type': 'reset' });
}

function saveKey(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('dagonizer-gemini-key', apiKey.value);
  }
}

function loadKey(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem('dagonizer-gemini-key') ?? '';
}
</script>

<template>
  <div :class="['archivist-runner', { 'is-running': isRunning }]">
    <section v-if="noModel" class="no-model-gate" role="alert">
      <h3>No LLM backend detected</h3>
      <p>The Archivist demo runs against real on-device or web LLMs only — there is no canned fallback in the browser. To watch the DAG execute, enable one of:</p>
      <ul>
        <li><strong>Gemini Nano (Chrome on-device)</strong> — toggle <code>chrome://flags/#prompt-api-for-gemini-nano</code> and <code>chrome://flags/#optimization-guide-on-device-model</code>, restart, then visit <code>chrome://components</code> to trigger the model download.</li>
        <li><strong>Gemini API key</strong> — paste a free <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">AI Studio key</a> below; nothing leaves your browser except the request to Google.</li>
        <li><strong>WebLLM</strong> — needs WebGPU. Use a recent Chrome / Edge / Brave with hardware acceleration on.</li>
      </ul>
      <BackendPicker
        :backends="backends"
        :active-id="activeBackend"
        :api-key="apiKey"
        :disabled="true"
        @update:active-id="activeBackend = $event as ProviderId"
        @update:api-key="apiKey = $event"
      />
    </section>

    <template v-else>
    <div class="backend-row">
      <BackendPicker
        :backends="backends"
        :active-id="activeBackend"
        :api-key="apiKey"
        :disabled="isRunning"
        @update:active-id="activeBackend = $event as ProviderId"
        @update:api-key="apiKey = $event"
      />
      <div class="backend-accessories">
        <PersistenceBadge
          :triple-count="memoryStore.size"
          :is-persisted="isPersisted"
          @toggle="togglePersistence"
        />
      </div>
    </div>

    <div class="runner-layout">
      <section class="runner-conversation">
        <Conversation :turns="conversation" />

        <div class="conversation-footer">
          <CheckpointControls
            :checkpoint-node="checkpointNode"
            :running="isRunning"
            :has-checkpoint="hasCheckpoint"
            @save="saveCheckpoint"
            @resume="resumeFromCheckpoint"
          />
        </div>

        <SendForm
          :query="visitorQuery"
          :running="isRunning"
          :terminal-kind="terminalKind"
          @update:query="visitorQuery = $event"
          @ask="ask"
          @cancel="cancel"
          @reset="reset"
        />
      </section>

      <section class="runner-workshop">
        <PanesTabs :tabs="workshopTabs" default-key="dag" class="workshop-tabs">
          <template #dag>
            <div class="dag-wrapper">
              <DagGraph
                ref="dagGraph"
                :elements="dagElements"
                aria-label="Archivist DAG live execution"
              />
              <div class="dag-legend-anchor">
                <NodeLegend />
                <StateLegend />
              </div>
            </div>
          </template>
          <template #memory>
            <div class="memory-graph-wrap">
              <MemoryGraph
                :store="memoryStore"
                :tick="memoryTick"
                @clear="clearMemory"
                @select="onMemorySelect"
              />
              <TripleInspector
                :store="memoryStore"
                :tick="memoryTick"
                :selected-iri="selectedIri"
                @close="selectedIri = null"
              />
            </div>
          </template>
          <template #trace>
            <TraceFeed :entries="trace" :logger="logger" />
          </template>
          <template #timeouts>
            <TimeoutPane @update:settings="onTimeoutSettingsUpdate" />
          </template>
        </PanesTabs>
      </section>
    </div>
    </template>
  </div>
</template>

<style scoped>
.archivist-runner {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 1rem;
  background: var(--vp-c-bg-alt);
  font-family: var(--vp-font-family-base);
  width: 100%;
}

.no-model-gate {
  border: 1px dashed var(--dagonizer-brand3);
  border-radius: 6px;
  padding: 1.2rem 1.4rem;
  background: rgba(212, 166, 73, 0.08);
}

.no-model-gate h3 {
  margin: 0 0 0.6rem 0;
  color: var(--dagonizer-brand3);
  font-size: 1.05rem;
  letter-spacing: 0.04em;
}

.no-model-gate p {
  margin: 0 0 0.7rem 0;
  color: var(--vp-c-text-1);
  font-size: 0.92rem;
  line-height: 1.5;
}

.no-model-gate ul {
  margin: 0 0 1rem 0;
  padding-left: 1.4rem;
  color: var(--vp-c-text-1);
  font-size: 0.88rem;
  line-height: 1.55;
}

.no-model-gate li { margin-bottom: 0.4rem; }
.no-model-gate code {
  background: var(--vp-c-bg-elv);
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
}

/* Backend row: picker + accessories (persistence badge, timeout drawer). */
.backend-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.backend-accessories {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

/* Two-column workshop layout: conversation on the left (standalone),
   tabbed workshop on the right (DAG / RDF memory / state / trace / logger). */
.runner-layout {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(0, 1.6fr);
  gap: 1.2rem;
  align-items: stretch;
}

.runner-conversation {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
}

.conversation-footer {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 0.1rem;
}

.runner-workshop {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.workshop-tabs            { min-height: 720px; }
.workshop-tabs :deep(.tab-pane) { min-height: 680px; }

@media (max-width: 960px) {
  .runner-layout { grid-template-columns: 1fr; }
}

/* DAG wrapper — fixed-height shell so the cytoscape canvas always has a
   non-zero box before mount, and gets a pulsing border while running. */
.dag-wrapper {
  position: relative;
  width: 100%;
  height: 680px;
  border-radius: 8px;
  transition: box-shadow 0.25s ease;
}

/* Memory-graph wrapper hosts the cosmos canvas + the click-to-inspect
   side panel. Relative so the absolutely-positioned panel anchors here. */
.memory-graph-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 680px;
}

.archivist-runner.is-running .dag-wrapper {
  box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 28px -6px var(--dagonizer-brand);
  animation: dag-pulse 1.8s ease-in-out infinite;
}

/* Bottom-row tabs — each active pane occupies the full center-column
   width, so trace / memory / logger can breathe horizontally. */
.runner-tabs {
  min-height: 280px;
}

@media (max-width: 640px) {
  .dag-wrapper { height: 420px; }
}

.dag-legend-anchor {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  background: rgba(0, 0, 0, 0.35);
  padding: 0.5rem 0.6rem;
  border-radius: 6px;
  backdrop-filter: blur(4px);
  min-width: 108px;
}

@keyframes dag-pulse {
  0%, 100% { box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 28px -8px var(--dagonizer-brand); }
  50%      { box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 36px -2px var(--dagonizer-brand); }
}
</style>
