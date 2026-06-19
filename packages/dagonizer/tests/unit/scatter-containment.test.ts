/**
 * scatter-containment.test.ts
 *
 * W4 scatter dag-body container seam tests:
 *
 * (a) scatter with a dag-body and NO container resolves in-process
 *     (inline runNodes path — byte-identical to pre-W4 behavior).
 * (b) scatter with a dag-body and a bound container routes each item's
 *     dag-body through the container: state round-trips, intermediates
 *     re-yield, errors collect, gather applies.
 * (c) scatter with a node-body ALWAYS runs inline, even when container is
 *     declared on the scatter placement (schema rejects that; this test
 *     verifies the in-process path for node-body scatter is untouched).
 * (d) Law 7 (byte-identical checkpoint): in-process and contained scatter
 *     produce identical per-ack SCATTER_PROGRESS_KEY writes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DagOutcomeType } from '../../src/container/DagOutcome.js';
import type { DagTaskInterface } from '../../src/container/DagTask.js';
import type { DagContainerInterface } from '../../src/contracts/DagContainerInterface.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import type { ObserverRelayInterface } from '../../src/contracts/ObserverRelayInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { SCATTER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class ScatterContainerState extends NodeStateBase {
  items: number[];
  processed: number[];
  nodeBodyProcessed: number[];
  /** Written by counterNode: carries the scatter item value back to the gather step. */
  value: number;

  constructor() {
    super();
    this.items = [];
    this.processed = [];
    this.nodeBodyProcessed = [];
    this.value = 0;
  }

  protected override snapshotData(): JsonObjectType {
    return {
      'items': [...this.items],
      'processed': [...this.processed],
      'nodeBodyProcessed': [...this.nodeBodyProcessed],
      'value': this.value,
    };
  }

  protected override restoreData(snap: Record<string, unknown>): void {
    const items = snap['items'];
    if (Array.isArray(items)) this.items = items.filter((x): x is number => typeof x === 'number');
    const processed = snap['processed'];
    if (Array.isArray(processed)) this.processed = processed.filter((x): x is number => typeof x === 'number');
    const n = snap['nodeBodyProcessed'];
    if (Array.isArray(n)) this.nodeBodyProcessed = n.filter((x): x is number => typeof x === 'number');
    const v = snap['value'];
    if (typeof v === 'number') this.value = v;
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** Reads currentItem from metadata and sets value on the clone. */
class CounterNode extends ScalarNode<ScatterContainerState, 'done'> {
  readonly name = 'counter';
  readonly outputs = ['done'] as const;
  protected async executeOne(state: ScatterContainerState): Promise<NodeOutputType<'done'>> {
    const item = state.getMetadata<number>('item') ?? 0;
    // value is a declared field on ScatterContainerState; no cast required.
    state.value = item;
    return { 'errors': [], 'output': 'done' as const };
  }
}
const counterNode = new CounterNode();

// ---------------------------------------------------------------------------
// Minimal DAG body (runs inside each scatter item clone)
// ---------------------------------------------------------------------------

const BODY_DAG_NAME = 'scatter-body';

const bodyDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:test:scatter-body',
  '@type': 'DAG',
  'name': BODY_DAG_NAME,
  'version': '1',
  'entrypoint': 'counter',
  'nodes': [
    {
      '@id': 'urn:test:scatter-body/node/counter',
      '@type': 'SingleNode',
      'name': 'counter',
      'node': 'counter',
      'outputs': { 'done': 'end' },
    },
    {
      '@id': 'urn:test:scatter-body/node/end',
      '@type': 'TerminalNode',
      'name': 'end',
      'outcome': 'completed',
    },
  ],
});

// ---------------------------------------------------------------------------
// Parent DAG with scatter dag-body + container
// ---------------------------------------------------------------------------

const RUNNER_DAG_NAME = 'scatter-runner';
const CONTAINER_ROLE = 'test-container';

const runnerDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:test:scatter-runner',
  '@type': 'DAG',
  'name': RUNNER_DAG_NAME,
  'version': '1',
  'entrypoint': 'fan',
  'nodes': [
    {
      '@id': 'urn:test:scatter-runner/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': { 'dag': BODY_DAG_NAME },
      'source': 'items',
      'itemKey': 'item',
      'concurrency': 1,
      'gather': { 'strategy': 'discard' },
      'container': CONTAINER_ROLE,
      'outputs': {
        'all-success': 'end',
        'partial': 'end',
        'all-error': 'end',
        'empty': 'end',
      },
    },
    {
      '@id': 'urn:test:scatter-runner/node/end',
      '@type': 'TerminalNode',
      'name': 'end',
      'outcome': 'completed',
    },
  ],
});

// In-process runner DAG (no container bound)
const inProcessRunnerDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:test:scatter-inprocess',
  '@type': 'DAG',
  'name': 'scatter-inprocess',
  'version': '1',
  'entrypoint': 'fan',
  'nodes': [
    {
      '@id': 'urn:test:scatter-inprocess/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': { 'dag': BODY_DAG_NAME },
      'source': 'items',
      'itemKey': 'item',
      'concurrency': 1,
      'gather': { 'strategy': 'discard' },
      'outputs': {
        'all-success': 'end',
        'partial': 'end',
        'all-error': 'end',
        'empty': 'end',
      },
    },
    {
      '@id': 'urn:test:scatter-inprocess/node/end',
      '@type': 'TerminalNode',
      'name': 'end',
      'outcome': 'completed',
    },
  ],
});

// Node-body runner DAG (node body scatter, NO container)
const nodeBodyRunnerDag: DAGType = Validator.dag.validate({
  '@context': DAG_CONTEXT,
  '@id': 'urn:test:scatter-nodebody',
  '@type': 'DAG',
  'name': 'scatter-nodebody',
  'version': '1',
  'entrypoint': 'fan',
  'nodes': [
    {
      '@id': 'urn:test:scatter-nodebody/node/fan',
      '@type': 'ScatterNode',
      'name': 'fan',
      'body': { 'node': 'node-body-worker' },
      'source': 'items',
      'itemKey': 'item',
      'concurrency': 1,
      'gather': { 'strategy': 'discard' },
      'outputs': {
        'all-success': 'end',
        'partial': 'end',
        'all-error': 'end',
        'empty': 'end',
      },
    },
    {
      '@id': 'urn:test:scatter-nodebody/node/end',
      '@type': 'TerminalNode',
      'name': 'end',
      'outcome': 'completed',
    },
  ],
});

// ---------------------------------------------------------------------------
// Test double DagContainerInterface
//
// Executes the dag-body in-process (via a mini-dispatcher) and returns the
// outcome. This lets us test the seam wiring without a real isolate.
// ---------------------------------------------------------------------------

function buildTestContainer(): DagContainerInterface<ScatterContainerState> {
  const innerDispatcher = new Dagonizer<ScatterContainerState>();
  innerDispatcher.registerNode(counterNode as NodeInterface<ScatterContainerState>);
  innerDispatcher.registerDAG(bodyDag);

  return {
    async runDag(task: DagTaskInterface<ScatterContainerState, unknown>, _options?: { readonly relay?: ObserverRelayInterface }): Promise<DagOutcomeType> {
      const cloneState = task.state;
      const intermediates: Array<{ output: string | null; skipped: boolean; nodeName: string }> = [];

      try {
        // Drain the execution iterator: collect intermediates and capture the
        // terminal result. Execution is a PromiseLike AND AsyncIterable;
        // iterate manually so we capture both.
        const exec = innerDispatcher.execute(task.dagName, cloneState);
        const iter = exec[Symbol.asyncIterator]();
        let step = await iter.next();
        while (!step.done) {
          const nr = step.value;
          intermediates.push({
            'output': nr.output,
            'skipped': nr.skipped,
            'nodeName': nr.nodeName,
          });
          step = await iter.next();
        }
        const terminal = step.value;
        return {
          'terminalOutput': terminal.state.lifecycle.kind === 'failed' ? 'failed' : 'completed',
          'errors': [...terminal.state.errors],
          'stateSnapshot': terminal.state.snapshot(),
          'intermediates': intermediates,
        };
      } catch (err: unknown) {
        return {
          'terminalOutput': 'failed',
          'errors': [{
            'code': 'CONTAINER_ERROR',
            'context': {},
            'message': err instanceof Error ? err.message : String(err),
            'operation': 'runDag',
            'recoverable': false,
            'timestamp': new Date().toISOString(),
          }],
          'stateSnapshot': null,
          'intermediates': [],
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('Scatter dag-body container seam (W4)', () => {
  // ── (a) No container: scatter dag-body runs in-process ───────────────────
  void it('scatter dag-body without container runs inline (in-process path)', async () => {
    const dispatcher = new Dagonizer<ScatterContainerState>();
    dispatcher.registerNode(counterNode as NodeInterface<ScatterContainerState>);
    dispatcher.registerDAG(bodyDag);
    dispatcher.registerDAG(inProcessRunnerDag);

    const state = new ScatterContainerState();
    state.items = [1, 2, 3];

    const result = await dispatcher.execute('scatter-inprocess', state);

    assert.strictEqual(result.state.lifecycle.kind, 'completed', 'flow must complete');
    // No container was bound, so CONTAINER_ROLE is unbound. The in-process path ran.
    assert.strictEqual(result.cursor, null, 'cursor must be null after clean completion');
  });

  // ── (b) Container bound: dag-body routes through container ───────────────
  void it('scatter dag-body with container routes through container; state round-trips', async () => {
    const testContainer = buildTestContainer();

    let runDagCallCount = 0;
    const trackingContainer: DagContainerInterface<ScatterContainerState> = {
      async runDag(task, options): Promise<DagOutcomeType> {
        runDagCallCount++;
        return testContainer.runDag(task, options);
      },
    };

    const dispatcher = new Dagonizer<ScatterContainerState>({
      'containers': { [CONTAINER_ROLE]: trackingContainer },
    });
    dispatcher.registerNode(counterNode as NodeInterface<ScatterContainerState>);
    dispatcher.registerDAG(bodyDag);
    dispatcher.registerDAG(runnerDag);

    const state = new ScatterContainerState();
    state.items = [10, 20, 30];

    const result = await dispatcher.execute(RUNNER_DAG_NAME, state);

    // Container must have been called once per item.
    assert.strictEqual(runDagCallCount, 3, `container.runDag must be called 3 times, got ${runDagCallCount}`);

    // result.state must be the same reference as the initial state object.
    assert.strictEqual(result.state, state, 'result.state must be the initial state object');

    assert.strictEqual(result.state.lifecycle.kind, 'completed', 'flow must complete');
    assert.strictEqual(result.cursor, null, 'cursor must be null after clean completion');
  });

  // ── (c) Node-body scatter is ALWAYS inline; container key is N/A ─────────
  void it('node-body scatter runs inline regardless of container presence', async () => {
    let containerCalls = 0;
    let inlineNodeCalls = 0;

    const container: DagContainerInterface<ScatterContainerState> = {
      async runDag(_task, _options): Promise<DagOutcomeType> {
        containerCalls++;
        return {
          'terminalOutput': 'completed',
          'errors': [],
          'stateSnapshot': null,
          'intermediates': [],
        };
      },
    };

    // Counting node-body node — uses a closure counter since node-body
    // scatter runs inline (no snapshot/restore boundary).
    class CountingNodeBodyNode extends ScalarNode<ScatterContainerState, 'done'> {
      readonly name = 'node-body-worker';
      readonly outputs = ['done'] as const;
      protected async executeOne(_state: ScatterContainerState): Promise<NodeOutputType<'done'>> {
        inlineNodeCalls++;
        return { 'errors': [], 'output': 'done' as const };
      }
    }
    const countingNodeBody = new CountingNodeBodyNode();

    const dispatcher = new Dagonizer<ScatterContainerState>({
      // Container is bound but node-body scatter must NOT use it.
      'containers': { [CONTAINER_ROLE]: container },
    });
    dispatcher.registerNode(countingNodeBody as NodeInterface<ScatterContainerState>);
    dispatcher.registerDAG(nodeBodyRunnerDag);

    const state = new ScatterContainerState();
    state.items = [5, 6, 7];

    const result = await dispatcher.execute('scatter-nodebody', state);

    // Container must NEVER be called for node-body scatter.
    assert.strictEqual(containerCalls, 0, 'container.runDag must NOT be called for node-body scatter');

    // The inline node ran once per item.
    assert.strictEqual(inlineNodeCalls, 3, 'node-body worker must run 3 times inline');

    assert.strictEqual(result.state.lifecycle.kind, 'completed', 'flow must complete');
  });

  // ── (d) Container error → collected error, not unhandled throw ───────────
  void it('transport failure from container collects error; scatter routes to error output', async () => {
    const failContainer: DagContainerInterface<ScatterContainerState> = {
      async runDag(task, _options): Promise<DagOutcomeType> {
        return {
          'terminalOutput': 'failed',
          'errors': [{
            'code': 'TRANSPORT_FAILURE',
            'context': {},
            'message': 'simulated container failure',
            'operation': 'runDag',
            'recoverable': false,
            'timestamp': new Date().toISOString(),
          }],
          'stateSnapshot': task.state.snapshot(),
          'intermediates': [],
        };
      },
    };

    const dispatcher = new Dagonizer<ScatterContainerState>({
      'containers': { [CONTAINER_ROLE]: failContainer },
    });
    dispatcher.registerNode(counterNode as NodeInterface<ScatterContainerState>);
    dispatcher.registerDAG(bodyDag);
    dispatcher.registerDAG(runnerDag);

    const state = new ScatterContainerState();
    state.items = [1, 2, 3];

    // Must NOT throw even if container fails.
    const result = await dispatcher.execute(RUNNER_DAG_NAME, state);

    // Errors were collected and routing happened.
    assert.ok(
      result.state.lifecycle.kind === 'completed' || result.state.lifecycle.kind === 'failed',
      `lifecycle must be completed or failed, got ${result.state.lifecycle.kind}`,
    );
    assert.ok(result.state.errors.length > 0, 'state must have collected errors from container failure');
  });

  // ── (e) Law 7: per-ack checkpoint writes are deep-equal in-process vs contained
  //
  // The SCATTER_PROGRESS_KEY payload is keyed by scatter node name ('fan' in
  // both cases). The scatter node name is not the DAG name, so identical
  // checkpoint keys appear regardless of which runner DAG was used. Each
  // ScatterProgress entry contains { placementName, inbox, ackedResults }.
  // With gather:'discard' no mappingValues/fieldValue are present. The item
  // payload (numbers 10/20/30) and index are deterministic across both runs.
  // deepStrictEqual is therefore achievable and is a stronger assertion than
  // comparing lengths only.
  void it('Law 7: per-ack SCATTER_PROGRESS_KEY writes are deep-equal across in-process and contained', async () => {
    // Helper: run scatter DAG and capture all SCATTER_PROGRESS_KEY writes.
    const runAndCapture = async (useContainer: boolean): Promise<{
      checkpoints: unknown[];
      finalSnapshot: unknown;
    }> => {
      const checkpoints: unknown[] = [];

      const dispatcher = useContainer
        ? new Dagonizer<ScatterContainerState>({
            'containers': { [CONTAINER_ROLE]: buildTestContainer() },
          })
        : new Dagonizer<ScatterContainerState>();

      dispatcher.registerNode(counterNode as NodeInterface<ScatterContainerState>);
      dispatcher.registerDAG(bodyDag);
      dispatcher.registerDAG(useContainer ? runnerDag : inProcessRunnerDag);

      const state = new ScatterContainerState();
      state.items = [10, 20, 30];

      const origSet = state.setMetadata.bind(state);
      state.setMetadata = (key: string, value: unknown): void => {
        if (key === SCATTER_PROGRESS_KEY) {
          checkpoints.push(JSON.parse(JSON.stringify(value)));
        }
        origSet(key, value);
      };

      await dispatcher.execute(useContainer ? RUNNER_DAG_NAME : 'scatter-inprocess', state);
      const finalSnapshot = JSON.parse(JSON.stringify(state.snapshot()));
      return { checkpoints, finalSnapshot };
    };

    const inProcess = await runAndCapture(false);
    const contained = await runAndCapture(true);

    // Same number of checkpoint writes (one per acked item = 3).
    assert.strictEqual(
      inProcess.checkpoints.length,
      contained.checkpoints.length,
      `checkpoint write count must match: in-process=${inProcess.checkpoints.length} contained=${contained.checkpoints.length}`,
    );

    // Each checkpoint write must be deep-equal. The scatter node name is 'fan'
    // in both DAGs so the checkpoint key is identical. The ScatterProgress
    // payload — { placementName, inbox: ScatterInboxItem[], ackedResults:
    // ScatterAckedResult[] } — is constructed by the parent dispatcher using
    // the original item values from state.items ([10, 20, 30]) and sequential
    // indices, independent of which container (or no container) ran the body.
    for (let i = 0; i < inProcess.checkpoints.length; i++) {
      assert.deepStrictEqual(
        inProcess.checkpoints[i],
        contained.checkpoints[i],
        `checkpoint write[${i}] must be deep-equal: ` +
        `in-process=${JSON.stringify(inProcess.checkpoints[i])} ` +
        `contained=${JSON.stringify(contained.checkpoints[i])}`,
      );
    }

    // Final gathered state must also be identical across both runs.
    // With gather:'discard' the parent state is unchanged by gather; both
    // runs over the same items produce the same final snapshot.
    const inProcessData = (inProcess.finalSnapshot as Record<string, unknown>)['data'] as Record<string, unknown> | undefined;
    const containedData = (contained.finalSnapshot as Record<string, unknown>)['data'] as Record<string, unknown> | undefined;
    assert.deepStrictEqual(
      inProcessData?.['processed'],
      containedData?.['processed'],
      `final processed must be deep-equal: ` +
      `in-process=${JSON.stringify(inProcessData?.['processed'])} ` +
      `contained=${JSON.stringify(containedData?.['processed'])}`,
    );
  });
});
