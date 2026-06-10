/**
 * ConformanceRegistry: shared law fixtures for the dag-containment conformance suite.
 *
 * The default export implements RegistryModuleInterface so DagHost (and any
 * W3 isolating container) can dynamic-import this module and reconstruct the
 * exact same nodes + DAGs + state class inside another process / worker / fork.
 *
 * Design constraint — NODES OBSERVE/RECORD THROUGH STATE, NEVER CLOSURES.
 * Every node writes its observations into ConformanceState (markers, counters,
 * collected errors). A closure-captured `let` would record only in the process
 * that defined the closure; a state marker round-trips through the snapshot/
 * restore boundary and is therefore visible no matter which process ran the
 * node. This is what lets the SAME DagConformance.laws() run unchanged
 * against in-process containers and DagContainerBase subclasses (cross-process:
 * worker_threads, child_process fork, etc.).
 *
 * W3 consumers: downstream packages re-export this module's default from a
 * local fixture file in their own test tree to obtain an importable module URL
 * (`new URL('./conformance-registry.js', import.meta.url).href`) that their
 * isolating container can pass as the `init` message's `registryModule`.
 *
 * Nodes (Laws 1–6, 7–8):
 *   recorder        — appends its node name to state.executedNodes; routes 'done'.
 *   mutator         — sets state.value = 99; routes 'done'.
 *   error-emitter   — collectError(...) into state.errors; routes 'error'.
 *   timeout-sleeper — declares timeoutMs; awaits the signal (times out).
 *   abort-sleeper   — records `began` marker, then awaits the signal (aborts).
 *   scatter-counter — reads currentItem from metadata; appends it to
 *                     state.scatterItems; routes 'done'. Used by Laws 7–8.
 *
 * DAGs (one per law, each containing EmbeddedDAGNode or ScatterNode placements
 * with container: CONFORMANCE_CONTAINER_ROLE):
 *   law1-dag       — recorder → done → end (TerminalNode)
 *   law2-dag       — mutator → done → end (TerminalNode)
 *   law3-dag       — error-emitter → error → end (TerminalNode)
 *   law4-dag       — timeout-sleeper → done → end (TerminalNode)
 *   law5-dag       — abort-sleeper → done → end (TerminalNode)
 *   law6-dag       — recorder → done → end (TerminalNode)
 *   law7-dag       — ScatterNode: source=scatterItems, dag-body=scatter-item-body, container=test-container
 *   law8-dag       — same shape as law7 (same scatter structure, exercised via interrupt/resume)
 *   law9-dag       — mutator → done → end (TerminalNode)   (same DAG shape; tests round-trip)
 *
 * The parent-level runner DAGs wrap each inner DAG via an EmbeddedDAGNode
 * placement so the container is exercised. Each placement carries
 * container: CONFORMANCE_CONTAINER_ROLE.
 *
 * Laws 7–8 use a ScatterNode whose dag body runs inside the container:
 * - Law 7: run scatter in-process and contained; assert checkpoint structures
 *   are byte-identical (deep-equal after JSON round-trip).
 * - Law 8: kill the container mid-scatter; assert resume via a fresh container
 *   reprocesses un-acked items (at-least-once delivery + ack dedup).
 */

import type { NodeInterface } from '../dist/contracts/NodeInterface.js';
import type {
  RegistryBundleInterface,
  RegistryModuleInterface,
} from '../dist/contracts/RegistryModuleInterface.js';
import type { DAG } from '../dist/entities/dag/DAG.js';
import type { JsonObject } from '../dist/entities/json.js';
import type { NodeContextInterface } from '../dist/entities/node/NodeContext.js';
import type { NodeOutputInterface } from '../dist/entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../dist/NodeStateBase.js';

import { NodeStateBase } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Container role bound parent-side and stamped on embedded DAG placements. */
export const CONFORMANCE_CONTAINER_ROLE = 'test-container';

/** Semantic version for the init ↔ ready handshake. */
export const CONFORMANCE_REGISTRY_VERSION = '1.0.0';

/** Per-node timeout (ms) declared on the timeout-sleeper for Law 4. */
const TIMEOUT_SLEEPER_TIMEOUT_MS = 50;

/** Safety ceiling so a never-aborted sleeper cannot hang the suite. */
const SLEEPER_SAFETY_CEILING_MS = 5000;

// ---------------------------------------------------------------------------
// ConformanceState — all observations recorded here, never in closures
// ---------------------------------------------------------------------------

/**
 * State for conformance laws. `value` is a counter (Law 2/9 mutation target);
 * `executedNodes` records every recorder node that ran (Laws 1/6 markers);
 * `began` flags that a sleeper node entered its body (Law 5 abort proof);
 * `scatterItems` is the SOURCE array for scatter Laws 7–8 (pre-seeded by test);
 * `gatheredItems` collects map-gathered results from scatter-counter (Laws 7–8).
 * All fields round-trip through the snapshot so they are visible no matter
 * which process executed the node.
 */
export class ConformanceState extends NodeStateBase {
  value: number;
  executedNodes: string[];
  began: boolean;
  scatterItems: number[];
  gatheredItems: number[];

  constructor() {
    super();
    this.value = 0;
    this.executedNodes = [];
    this.began = false;
    this.scatterItems = [];
    this.gatheredItems = [];
  }

  protected override snapshotData(): JsonObject {
    return {
      'value': this.value,
      'executedNodes': [...this.executedNodes],
      'began': this.began,
      'scatterItems': [...this.scatterItems],
      'gatheredItems': [...this.gatheredItems],
    };
  }

  protected override restoreData(snap: Record<string, unknown>): void {
    const v = snap['value'];
    if (typeof v === 'number') this.value = v;
    const e = snap['executedNodes'];
    if (Array.isArray(e)) this.executedNodes = e.filter((x): x is string => typeof x === 'string');
    const b = snap['began'];
    if (typeof b === 'boolean') this.began = b;
    const s = snap['scatterItems'];
    if (Array.isArray(s)) this.scatterItems = s.filter((x): x is number => typeof x === 'number');
    const g = snap['gatheredItems'];
    if (Array.isArray(g)) this.gatheredItems = g.filter((x): x is number => typeof x === 'number');
  }
}

/** Restore a ConformanceState from a snapshot (the registry's restoreState). */
function restoreConformanceState(snapshot: JsonObject): ConformanceState {
  const instance = new ConformanceState();
  instance.applySnapshot(snapshot);
  return instance;
}

// ---------------------------------------------------------------------------
// Signal-respecting sleep
// ---------------------------------------------------------------------------

function sleepUntilAborted(signal: AbortSignal, ceilingMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { 'once': true });
    setTimeout(() => resolve(), ceilingMs);
  });
}

// ---------------------------------------------------------------------------
// Nodes — Laws 1–6, each records through state
// ---------------------------------------------------------------------------

const recorderNode: NodeInterface<ConformanceState> = {
  'name': 'recorder',
  'outputs': ['done'],
  async execute(state: ConformanceState): Promise<NodeOutputInterface<'done'>> {
    state.executedNodes.push('recorder');
    return { 'errors': [], 'output': 'done' };
  },
};

const mutatorNode: NodeInterface<ConformanceState> = {
  'name': 'mutator',
  'outputs': ['done'],
  async execute(state: ConformanceState): Promise<NodeOutputInterface<'done'>> {
    state.value = 99;
    return { 'errors': [], 'output': 'done' };
  },
};

const errorEmitterNode: NodeInterface<ConformanceState> = {
  'name': 'error-emitter',
  'outputs': ['error'],
  async execute(state: ConformanceState): Promise<NodeOutputInterface<'error'>> {
    state.collectError({
      'code': 'TEST_ERROR',
      'context': {},
      'message': 'conformance law error',
      'operation': 'error-emitter',
      'recoverable': true,
      'timestamp': new Date().toISOString(),
    });
    return { 'errors': [], 'output': 'error' };
  },
};

const timeoutSleeperNode: NodeInterface<ConformanceState> = {
  'name': 'timeout-sleeper',
  'outputs': ['done'],
  'timeoutMs': TIMEOUT_SLEEPER_TIMEOUT_MS,
  async execute(
    _state: ConformanceState,
    context: NodeContextInterface<undefined>,
  ): Promise<NodeOutputInterface<'done'>> {
    await sleepUntilAborted(context.signal, SLEEPER_SAFETY_CEILING_MS);
    return { 'errors': [], 'output': 'done' };
  },
};

const abortSleeperNode: NodeInterface<ConformanceState> = {
  'name': 'abort-sleeper',
  'outputs': ['done'],
  async execute(
    state: ConformanceState,
    context: NodeContextInterface<undefined>,
  ): Promise<NodeOutputInterface<'done'>> {
    state.began = true;
    await sleepUntilAborted(context.signal, SLEEPER_SAFETY_CEILING_MS);
    return { 'errors': [], 'output': 'done' };
  },
};

/**
 * scatter-counter: increments state.value by 1 to prove the item was
 * processed. The map gather { value → gatheredItems } collects value=1 from
 * each clone into the parent's gatheredItems array. Used by Laws 7–8.
 * Observes through state so results survive snapshot/restore round-trips.
 */
const scatterCounterNode: NodeInterface<ConformanceState> = {
  'name': 'scatter-counter',
  'outputs': ['done'],
  async execute(state: ConformanceState): Promise<NodeOutputInterface<'done'>> {
    state.value += 1;
    return { 'errors': [], 'output': 'done' };
  },
};

// ---------------------------------------------------------------------------
// DAG context
// ---------------------------------------------------------------------------

const DAG_CONTEXT = {
  '@version': 1.1,
  'name':            { '@id': 'https://noocodex.dev/ontology/dag/name' },
  'version':         { '@id': 'https://noocodex.dev/ontology/dag/version' },
  'entrypoint':      { '@id': 'https://noocodex.dev/ontology/dag/entrypoint' },
  'nodes':           { '@id': 'https://noocodex.dev/ontology/dag/nodes', '@container': '@set' },
  'outputs':         { '@id': 'https://noocodex.dev/ontology/dag/outputs' },
  'node':            { '@id': 'https://noocodex.dev/ontology/dag/node' },
  'container':       { '@id': 'https://noocodex.dev/ontology/dag/container' },
  'dag':             { '@id': 'https://noocodex.dev/ontology/dag/dag' },
  'DAG':             { '@id': 'https://noocodex.dev/ontology/dag/DAG' },
  'SingleNode':      { '@id': 'https://noocodex.dev/ontology/dag/SingleNode' },
  'EmbeddedDAGNode': { '@id': 'https://noocodex.dev/ontology/dag/EmbeddedDAGNode' },
  'ScatterNode':     { '@id': 'https://noocodex.dev/ontology/dag/ScatterNode' },
  'body':            { '@id': 'https://noocodex.dev/ontology/dag/body' },
  'source':          { '@id': 'https://noocodex.dev/ontology/dag/source' },
  'itemKey':         { '@id': 'https://noocodex.dev/ontology/dag/itemKey' },
  'concurrency':     { '@id': 'https://noocodex.dev/ontology/dag/concurrency' },
  'reducer':         { '@id': 'https://noocodex.dev/ontology/dag/reducer' },
  'gather':          { '@id': 'https://noocodex.dev/ontology/dag/gather' },
} as const;

/**
 * Build a simple single-node DAG (the body DAG that runs inside the host).
 */
function singleNodeDag(dagName: string, nodeName: string, output: string): DAG {
  return {
    '@context': DAG_CONTEXT,
    '@id': `urn:conformance:dag:${dagName}`,
    '@type': 'DAG',
    'name': dagName,
    'version': '1',
    'entrypoint': nodeName,
    'nodes': [
      {
        '@id': `urn:conformance:dag:${dagName}/node/${nodeName}`,
        '@type': 'SingleNode',
        'name': nodeName,
        'node': nodeName,
        'outputs': { [output]: 'end' },
      },
      {
        '@id': `urn:conformance:dag:${dagName}/node/end`,
        '@type': 'TerminalNode',
        'name': 'end',
        'outcome': 'completed',
      },
    ],
  } as unknown as DAG;
}

/**
 * Build a parent DAG that runs an embedded child DAG via a container.
 * The EmbeddedDAGNode carries container: CONFORMANCE_CONTAINER_ROLE and
 * stateMapping that propagates all ConformanceState fields back to the parent.
 *
 * The output mapping format is `{ parentKey: childKey }`: for each pair,
 * the child field is read and written to the parent field of the same name.
 * This is required so conformance law assertions on parent state reflect
 * mutations made inside the contained execution.
 */
function embeddingDag(runnerName: string, childDagName: string, _outputs: string[]): DAG {
  // All embedded DAG outputs route to a shared 'end' TerminalNode.
  // The _outputs parameter names the possible outcomes of the child DAG (e.g. 'done', 'error');
  // each is routed to the parent's terminal placement.
  const outputMap: Record<string, string> = { 'done': 'end', 'error': 'end' };

  return {
    '@context': DAG_CONTEXT,
    '@id': `urn:conformance:dag:${runnerName}`,
    '@type': 'DAG',
    'name': runnerName,
    'version': '1',
    'entrypoint': 'run-child',
    'nodes': [
      {
        '@id': `urn:conformance:dag:${runnerName}/node/run-child`,
        '@type': 'EmbeddedDAGNode',
        'name': 'run-child',
        'dag': childDagName,
        'outputs': outputMap,
        'container': CONFORMANCE_CONTAINER_ROLE,
        'stateMapping': {
          // Propagate all ConformanceState domain fields back to parent after
          // the contained execution completes. Format: { parentKey: childKey }.
          'output': {
            'value': 'value',
            'executedNodes': 'executedNodes',
            'began': 'began',
          },
        },
      },
      {
        '@id': `urn:conformance:dag:${runnerName}/node/end`,
        '@type': 'TerminalNode',
        'name': 'end',
        'outcome': 'completed',
      },
    ],
  } as unknown as DAG;
}

// ---------------------------------------------------------------------------
// Scatter body DAG factory — for Laws 7 & 8
//
// The scatter-item-body DAG is the dag-body used by the ScatterNode on each
// item. It runs scatter-counter, which records the item into state.scatterItems.
// ---------------------------------------------------------------------------

/** Name of the DAG that runs inside each scatter item clone. */
export const SCATTER_ITEM_BODY_DAG = 'conformance-scatter-item-body';

function scatterItemBodyDag(): DAG {
  return {
    '@context': DAG_CONTEXT,
    '@id': `urn:conformance:dag:${SCATTER_ITEM_BODY_DAG}`,
    '@type': 'DAG',
    'name': SCATTER_ITEM_BODY_DAG,
    'version': '1',
    'entrypoint': 'scatter-counter',
    'nodes': [
      {
        '@id': `urn:conformance:dag:${SCATTER_ITEM_BODY_DAG}/node/scatter-counter`,
        '@type': 'SingleNode',
        'name': 'scatter-counter',
        'node': 'scatter-counter',
        'outputs': { 'done': 'end' },
      },
      {
        '@id': `urn:conformance:dag:${SCATTER_ITEM_BODY_DAG}/node/end`,
        '@type': 'TerminalNode',
        'name': 'end',
        'outcome': 'completed',
      },
    ],
  } as unknown as DAG;
}

/**
 * Build a runner DAG that drives a scatter whose each item's dag-body runs
 * through the bound container. Source is `scatterItems` (pre-seeded on state).
 * Uses map gather: reads `value` from each clone and collects into parent
 * `scatterItems` array. The scatter-counter node increments clone.value so
 * the gather result is a per-item integer array — deterministic and comparable.
 */
function scatterDag(runnerName: string): DAG {
  return {
    '@context': DAG_CONTEXT,
    '@id': `urn:conformance:dag:${runnerName}`,
    '@type': 'DAG',
    'name': runnerName,
    'version': '1',
    'entrypoint': 'fan',
    'nodes': [
      {
        '@id': `urn:conformance:dag:${runnerName}/node/fan`,
        '@type': 'ScatterNode',
        'name': 'fan',
        'body': { 'dag': SCATTER_ITEM_BODY_DAG },
        'source': 'scatterItems',
        'itemKey': 'currentItem',
        'concurrency': 1,
        'container': CONFORMANCE_CONTAINER_ROLE,
        'gather': { 'strategy': 'map', 'mapping': { 'value': 'gatheredItems' } },
        'outputs': {
          'all-success': 'end',
          'partial': 'end',
          'all-error': 'end',
          'empty': 'end',
        },
      },
      {
        '@id': `urn:conformance:dag:${runnerName}/node/end`,
        '@type': 'TerminalNode',
        'name': 'end',
        'outcome': 'completed',
      },
    ],
  } as unknown as DAG;
}

// ---------------------------------------------------------------------------
// DAG names
// ---------------------------------------------------------------------------

/** Body DAGs that run inside the container. */
const BODY = {
  'law1': 'conformance-body-law1',
  'law2': 'conformance-body-law2',
  'law3': 'conformance-body-law3',
  'law4': 'conformance-body-law4',
  'law5': 'conformance-body-law5',
  'law6': 'conformance-body-law6',
  'law9': 'conformance-body-law9',
} as const;

/** Runner DAGs that the test dispatches; each embeds a body DAG via a container. */
export const CONFORMANCE_DAG = {
  'law1': 'conformance-runner-law1',
  'law2': 'conformance-runner-law2',
  'law3': 'conformance-runner-law3',
  'law4': 'conformance-runner-law4',
  'law5': 'conformance-runner-law5',
  'law6': 'conformance-runner-law6',
  'law7': 'conformance-runner-law7',
  'law8': 'conformance-runner-law8',
  'law9': 'conformance-runner-law9',
} as const;

// Body DAGs (registered on the host; run inside the container)
const bodyLaw1 = singleNodeDag(BODY.law1, 'recorder', 'done');
const bodyLaw2 = singleNodeDag(BODY.law2, 'mutator', 'done');
const bodyLaw3 = singleNodeDag(BODY.law3, 'error-emitter', 'error');
const bodyLaw4 = singleNodeDag(BODY.law4, 'timeout-sleeper', 'done');
const bodyLaw5 = singleNodeDag(BODY.law5, 'abort-sleeper', 'done');
const bodyLaw6 = singleNodeDag(BODY.law6, 'recorder', 'done');
const bodyLaw9 = singleNodeDag(BODY.law9, 'mutator', 'done');

// Scatter item body DAG for Laws 7 & 8
const scatterItemBody = scatterItemBodyDag();

// Runner DAGs (registered both parent and host-side; dispatch child via container)
const runnerLaw1 = embeddingDag(CONFORMANCE_DAG.law1, BODY.law1, ['done', 'error']);
const runnerLaw2 = embeddingDag(CONFORMANCE_DAG.law2, BODY.law2, ['done', 'error']);
const runnerLaw3 = embeddingDag(CONFORMANCE_DAG.law3, BODY.law3, ['done', 'error']);
const runnerLaw4 = embeddingDag(CONFORMANCE_DAG.law4, BODY.law4, ['done', 'error']);
const runnerLaw5 = embeddingDag(CONFORMANCE_DAG.law5, BODY.law5, ['done', 'error']);
const runnerLaw6 = embeddingDag(CONFORMANCE_DAG.law6, BODY.law6, ['done', 'error']);
const runnerLaw7 = scatterDag(CONFORMANCE_DAG.law7);
const runnerLaw8 = scatterDag(CONFORMANCE_DAG.law8);
const runnerLaw9 = embeddingDag(CONFORMANCE_DAG.law9, BODY.law9, ['done', 'error']);

// ---------------------------------------------------------------------------
// Bundle assembly
// ---------------------------------------------------------------------------

const CONFORMANCE_NODES: NodeInterface<NodeStateInterface, string, unknown>[] = [
  recorderNode,
  mutatorNode,
  errorEmitterNode,
  timeoutSleeperNode,
  abortSleeperNode,
  scatterCounterNode,
] as NodeInterface<NodeStateInterface, string, unknown>[];

/**
 * All DAGs — body DAGs + runner DAGs. The host needs body DAGs to execute;
 * both parent and host need runner DAGs registered (parent dispatches them,
 * host recurses into them when DagHost resolves embedded DAG nodes).
 * The parent-side dispatcher needs runner DAGs registered to dispatch them.
 * In the host, only the body DAGs are directly executed; runner DAGs are
 * included for completeness in case the host needs to resolve them.
 *
 * Laws 7–8 add scatterItemBody (the dag-body that runs inside each scatter item
 * clone). This DAG is registered so both parent-side and host-side dispatchers
 * can resolve it when the scatter dag-body is dispatched through the container.
 */
const CONFORMANCE_DAGS: DAG[] = [
  bodyLaw1, bodyLaw2, bodyLaw3, bodyLaw4, bodyLaw5, bodyLaw6, bodyLaw9,
  scatterItemBody,
  runnerLaw1, runnerLaw2, runnerLaw3, runnerLaw4, runnerLaw5, runnerLaw6,
  runnerLaw7, runnerLaw8, runnerLaw9,
];

/** Static factory for conformance bundles. */
export class ConformanceRegistry {
  private constructor() { /* static class */ }

  /** Build a fresh RegistryBundleInterface (new array references each call). */
  static bundle(): RegistryBundleInterface {
    return {
      'bundle': {
        'nodes': [...CONFORMANCE_NODES],
        'dags': [...CONFORMANCE_DAGS],
      },
      'services': undefined,
      'registryVersion': CONFORMANCE_REGISTRY_VERSION,
      'restoreState': (snap: JsonObject) => restoreConformanceState(snap) as NodeStateInterface,
    };
  }
}

// ---------------------------------------------------------------------------
// RegistryModuleInterface default export
// ---------------------------------------------------------------------------

const registryModule: RegistryModuleInterface = {
  async createBundle(_servicesConfig: JsonObject): Promise<RegistryBundleInterface> {
    return ConformanceRegistry.bundle();
  },
};

export default registryModule;
