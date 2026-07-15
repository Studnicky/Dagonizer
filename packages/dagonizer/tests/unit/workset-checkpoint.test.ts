/**
 * WorkSet checkpoint tests: exercises multi-item work-set capture and resume
 * (RFC 0003 §7 sub-wave 5).
 *
 * Three suites:
 *   1. multi-item resume parity — a fan→process→collect DAG aborted mid-run
 *      resumes to produce the same final set as an uninterrupted run.
 *   2. work-set blob shape — asserts the captured state carries the expected
 *      metadata key and that a clean run omits it.
 *   3. size-1 parity guard — a size-1 DAG aborted+resumed still works via the
 *      cursor model; no work-set blob is written.
 *
 * House style: node:test + assert/strict, hand-written NodeInterface
 * implementations, JSON-LD DAG literals.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Checkpoint, CheckpointRestoreAdapter } from '../../src/checkpoint/Checkpoint.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import { WORKSET_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Clock } from '../../src/runtime/Clock.js';
import { Scheduler } from '../../src/runtime/Scheduler.js';
import { VirtualClockProvider } from '../../testing/VirtualClock.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';
import { TestDag } from '../_support/TestDag.js';

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

class WalkState extends NodeStateBase {
  value: number;
  log: string[];

  constructor() {
    super();
    this.value = 0;
    this.log = [];
  }

  override clone(): this {
    const copy = super.clone();
    // NodeStateBase.clone() copies _metadata; we additionally copy domain fields.
    copy.value = this.value;
    copy.log = [...this.log];
    return copy;
  }


}


// ---------------------------------------------------------------------------
// DAG fixture:  fan(1→N) → process → collect (terminal accumulator)
//
// DAG shape:
//   entrypoint: fan
//   fan  → [out] → proc
//   proc → [done] → collect
//   collect → [done] → end (TerminalNode, outcome: completed)
//
// Nodes:
//   fan:     size-1 in, N items out (clones with value = 0..N-1)
//   proc:    stamps each item's log and routes to 'done'
//   collect: accumulates all items into a module-level array, routes 'done'
// ---------------------------------------------------------------------------

const FAN_N = 4;
const FAN_PROC_COLLECT_DAG = 'urn:noocodec:dag:fan-proc-collect';
const SIZE1_CKPT_DAG = 'urn:noocodec:dag:size1-ckpt';

/** Fan-out node: takes the single input item and fans to N clones. */
class FanNode extends MonadicNode<WalkState, 'out'> {
  readonly '@id': string;
  readonly name: string;
  readonly outputs: readonly ['out'] = ['out'];
  private readonly n: number;

  constructor(name: string, n: number) { super(); this['@id'] = `urn:noocodec:node:${encodeURIComponent(name)}`; this.name = name; this.n = n; }

  override get outputSchema(): Record<'out', SchemaObjectType> {
    return { 'out': { 'type': 'object' } };
  }

  override async execute(batch: Batch<WalkState>): Promise<RoutedBatchType<'out', WalkState>> {
    const src = batch.row(0).state;
    const items: Array<{ 'id': string; 'state': WalkState }> = [];
    for (let i = 0; i < this.n; i++) {
      const clone = src.clone();
      clone.value = i;
      clone.log.push(`fan:${i}`);
      items.push({ 'id': String(i), 'state': clone });
    }
    const result = new Map<'out', Batch<WalkState>>();
    result.set('out', Batch.from(items));
    return result;
  }
}
/** Process node: stamps each item's log. */
class ProcNode extends MonadicNode<WalkState, 'done'> {
  readonly '@id': string;
  readonly name: string;
  readonly outputs: readonly ['done'] = ['done'];

  constructor(name: string) { super(); this['@id'] = `urn:noocodec:node:${encodeURIComponent(name)}`; this.name = name; }

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<WalkState>): Promise<RoutedBatchType<'done', WalkState>> {
    for (const item of batch) item.state.log.push(`proc:${item.state.value}`);
    return new Map([['done', batch]]);
  }
}

/** Accumulator node: pushes all items into `collected`, routes 'done'. */
class CollectNode extends MonadicNode<WalkState, 'done'> {
  readonly '@id': string;
  readonly name: string;
  readonly outputs: readonly ['done'] = ['done'];
  private readonly collected: WalkState[];

  constructor(name: string, collected: WalkState[]) { super(); this['@id'] = `urn:noocodec:node:${encodeURIComponent(name)}`; this.name = name; this.collected = collected; }

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<WalkState>): Promise<RoutedBatchType<'done', WalkState>> {
    for (const item of batch) {
      this.collected.push(item.state);
    }
    const result = new Map<'done', Batch<WalkState>>();
    result.set('done', batch);
    return result;
  }
}

class TestWorksetNode {
  private constructor() {}
  static fan(name: string, n: number): FanNode { return new FanNode(name, n); }
  static proc(name: string): ProcNode { return new ProcNode(name); }
  static collect(name: string, collected: WalkState[]): CollectNode { return new CollectNode(name, collected); }
}

class TestWorksetDag {
  private constructor() {}
  /** Build and register the fan→proc→collect DAG. */
  static fan(
    dispatcher: Dagonizer<WalkState>,
    collected: WalkState[],
  ): DAGType {
    dispatcher.registerNode(TestWorksetNode.fan('fan', FAN_N));
    dispatcher.registerNode(TestWorksetNode.proc('proc'));
    dispatcher.registerNode(TestWorksetNode.collect('collect', collected));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': FAN_PROC_COLLECT_DAG,
      '@type': 'DAG',
      'name': 'fan-proc-collect',
      'version': '1',
      'entrypoints': { 'main': `${FAN_PROC_COLLECT_DAG}/node/fan-node` },
      'nodes': [
        {
          '@id': `${FAN_PROC_COLLECT_DAG}/node/fan-node`,
          '@type': 'SingleNode',
          'name': 'fan-node',
          'node': 'urn:noocodec:node:fan',
          'outputs': { 'out': `${FAN_PROC_COLLECT_DAG}/node/proc-node` },
        },
        {
          '@id': `${FAN_PROC_COLLECT_DAG}/node/proc-node`,
          '@type': 'SingleNode',
          'name': 'proc-node',
          'node': 'urn:noocodec:node:proc',
          'outputs': { 'done': `${FAN_PROC_COLLECT_DAG}/node/collect-node` },
        },
        {
          '@id': `${FAN_PROC_COLLECT_DAG}/node/collect-node`,
          '@type': 'SingleNode',
          'name': 'collect-node',
          'node': 'urn:noocodec:node:collect',
          'outputs': { 'done': `${FAN_PROC_COLLECT_DAG}/node/end` },
        },
        {
          '@id': `${FAN_PROC_COLLECT_DAG}/node/end`,
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    const canonical = TestDag.from(dag);
    dispatcher.registerDAG(canonical);
    return canonical;
  }
}

// ---------------------------------------------------------------------------
// Suite 1: multi-item resume parity
// ---------------------------------------------------------------------------

void describe('WorkSet checkpoint — multi-item resume parity', () => {
  afterEach(() => { Scheduler.reset(); Clock.reset(); });

  void it(
    'aborted multi-item run resumed via checkpoint produces exact same final set as uninterrupted run',
    async () => {
      Clock.configure(new VirtualClockProvider(0n));
      Scheduler.configure(new VirtualScheduler(0));

      // ── Reference run ──────────────────────────────────────────────────────
      const refCollected: WalkState[] = [];
      const refDispatcher = new Dagonizer<WalkState>();
      TestWorksetDag.fan(refDispatcher, refCollected);

      const refResult = await refDispatcher.execute(FAN_PROC_COLLECT_DAG, new WalkState());
      assert.equal(refResult.cursor, null, 'reference run must complete');
      assert.equal(refResult.terminalOutcome, 'completed');
      assert.equal(refCollected.length, FAN_N, 'reference run must collect all items');

      // Record the canonical set of (value, log) pairs from the reference run.
      const refSet = new Set(refCollected.map((s) => JSON.stringify({ 'value': s.value, 'log': s.log })));

      // ── Run 1: abort after the fan node fires (items are in proc-node) ─────
      // We abort after the first yielded stage (which is the fan node completing).
      // At that point all N items are pending at proc-node; the work set has
      // N items whose states are clones, not the top-level state — so a blob
      // will be written.
      const run1Collected: WalkState[] = [];
      const ctl = new AbortController();
      let stagesYielded = 0;

      const run1Dispatcher = new Dagonizer<WalkState>();
      TestWorksetDag.fan(run1Dispatcher, run1Collected);

      const initialState = new WalkState();
      const execution = run1Dispatcher.execute(FAN_PROC_COLLECT_DAG, initialState, {
        'signal': ctl.signal,
      });

      // Abort after the fan node yields (1 stage = fan completed).
      for await (const _stage of execution) {
        stagesYielded++;
        if (stagesYielded === 1) {
          ctl.abort(new Error('pause after fan'));
        }
      }
      const run1Result = await execution;

      // The run must have been interrupted — cursor is non-null.
      assert.ok(run1Result.cursor !== null, 'run 1 must be interrupted');

      // Capture, round-trip, restore, resume.
      const ckpt = await Checkpoint.capture(FAN_PROC_COLLECT_DAG, run1Result);
      const raw = ckpt.toJson();
      const parsed: unknown = JSON.parse(raw);
      const ckpt2 = Checkpoint.load(parsed);
      const { 'state': restoredState, dagName, cursor } = await ckpt2.restoreState(
        CheckpointRestoreAdapter.wrap(() => new WalkState()),
      );

      // ── Run 2: resume ────────────────────────────────────────────────────
      const run2Collected: WalkState[] = [];
      const run2Dispatcher = new Dagonizer<WalkState>();
      TestWorksetDag.fan(run2Dispatcher, run2Collected);

      const run2Result = await run2Dispatcher.resume(dagName, restoredState, cursor);
      assert.equal(run2Result.cursor, null, 'run 2 must complete');
      assert.equal(run2Result.terminalOutcome, 'completed');

      // ── Union assertion: run1Collected ∪ run2Collected = refSet ───────────
      // (run1Collected will be empty since items hadn't reached collect-node yet)
      const unionSet = new Set([
        ...run1Collected.map((s) => JSON.stringify({ 'value': s.value, 'log': s.log })),
        ...run2Collected.map((s) => JSON.stringify({ 'value': s.value, 'log': s.log })),
      ]);

      assert.equal(
        unionSet.size,
        FAN_N,
        `union of run1 + run2 must have exactly ${FAN_N} items (got ${unionSet.size})`,
      );
      for (const key of refSet) {
        assert.ok(unionSet.has(key), `item ${key} from reference run is missing from resumed runs`);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 2: work-set blob shape
// ---------------------------------------------------------------------------

void describe('WorkSet checkpoint — blob shape', () => {
  afterEach(() => { Scheduler.reset(); Clock.reset(); });

  void it(
    'captured state metadata contains WORKSET_PROGRESS_KEY blob with expected placements after multi-item abort',
    async () => {
      Clock.configure(new VirtualClockProvider(0n));
      Scheduler.configure(new VirtualScheduler(0));

      const ctl = new AbortController();
      let stagesYielded = 0;

      const dispatcher = new Dagonizer<WalkState>();
      const collected: WalkState[] = [];
      TestWorksetDag.fan(dispatcher, collected);

      const initialState = new WalkState();
      const execution = dispatcher.execute(FAN_PROC_COLLECT_DAG, initialState, {
        'signal': ctl.signal,
      });

      // Abort after the first stage (fan fires → items pending at proc-node).
      for await (const _stage of execution) {
        stagesYielded++;
        if (stagesYielded === 1) {
          ctl.abort(new Error('stop'));
        }
      }
      const result = await execution;
      assert.ok(result.cursor !== null, 'run must be interrupted');

      // The captured state snapshot must carry the workset blob.
      const meta = result.state.getMetadata(WORKSET_PROGRESS_KEY);
      assert.ok(
        meta !== undefined,
        'graph state must have a workset entry',
      );
      const blob = meta;
      assert.ok(
        blob !== null && typeof blob === 'object' && !Array.isArray(blob),
        'blob must be an object',
      );
      // blob is narrowed to JsonObjectType; entries is JsonValueType, narrowed to array below.
      const entriesValue = blob['entries'];
      assert.ok(Array.isArray(entriesValue), 'blob must have an entries array');

      // entriesValue narrowed to JsonArrayType (JsonValueType[]); each item is JsonValueType.
      assert.equal(entriesValue.length, 1, 'blob must have exactly one placement entry');
      const entryValue = entriesValue[0];
      assert.ok(
        entryValue !== null && typeof entryValue === 'object' && !Array.isArray(entryValue),
        'blob entry must be an object',
      );
      // entryValue narrowed to JsonObjectType.
      assert.equal(
        entryValue['placement'],
        `${FAN_PROC_COLLECT_DAG}/node/proc-node`,
        'blob entry placement must be proc-node IRI',
      );
      const itemsValue = entryValue['items'];
      assert.ok(Array.isArray(itemsValue), 'blob entry must have an items array');
      assert.equal(itemsValue.length, FAN_N, `blob entry must have ${FAN_N} items`);
    },
  );

  void it(
    'completed uninterrupted run does NOT carry WORKSET_PROGRESS_KEY in state snapshot',
    async () => {
      Clock.configure(new VirtualClockProvider(0n));
      Scheduler.configure(new VirtualScheduler(0));

      const dispatcher = new Dagonizer<WalkState>();
      const collected: WalkState[] = [];
      TestWorksetDag.fan(dispatcher, collected);

      const result = await dispatcher.execute(FAN_PROC_COLLECT_DAG, new WalkState());
      assert.equal(result.cursor, null, 'run must complete');

      assert.equal(result.state.getMetadata(WORKSET_PROGRESS_KEY), undefined);
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 3: size-1 parity guard
// ---------------------------------------------------------------------------

void describe('WorkSet checkpoint — size-1 parity guard', () => {
  afterEach(() => { Scheduler.reset(); Clock.reset(); });

  void it(
    'size-1 DAG aborted and resumed via checkpoint works via cursor model; no work-set blob written',
    async () => {
      Clock.configure(new VirtualClockProvider(0n));
      Scheduler.configure(new VirtualScheduler(0));

      // Simple size-1 linear DAG: a → b → c → end.
      // Abort after the first stage, resume from cursor 'b'.
      class CountState extends NodeStateBase {
        count = 0;

        override clone(): this {
          const copy = super.clone();
          copy.count = this.count;
          return copy;
        }


      }

      const dispatcher = new Dagonizer<CountState>();

      // Inline node factory — increments count and routes to 'next'.
      class IncNode extends MonadicNode<CountState, 'next'> {
        readonly '@id': string;
        readonly name: string;
        readonly outputs: readonly ['next'] = ['next'];

        constructor(name: string) { super(); this['@id'] = `urn:noocodec:node:${encodeURIComponent(name)}`; this.name = name; }

        override get outputSchema(): Record<'next', SchemaObjectType> {
          return { 'next': { 'type': 'object' } };
        }

        override async execute(batch: Batch<CountState>): Promise<RoutedBatchType<'next', CountState>> {
          for (const item of batch) item.state.count++;
          return new Map([['next', batch]]);
        }
      }

      dispatcher.registerNode(new IncNode('inc'));

      const dag: DAGType = {
        '@context': DAG_CONTEXT,
        '@id': SIZE1_CKPT_DAG,
        '@type': 'DAG',
        'name': 'size1-ckpt',
        'version': '1',
        'entrypoints': { 'main': `${SIZE1_CKPT_DAG}/node/a` },
        'nodes': [
          {
            '@id': `${SIZE1_CKPT_DAG}/node/a`, '@type': 'SingleNode',
            'name': 'a', 'node': 'urn:noocodec:node:inc', 'outputs': { 'next': `${SIZE1_CKPT_DAG}/node/b` } },
          {
            '@id': `${SIZE1_CKPT_DAG}/node/b`, '@type': 'SingleNode',
            'name': 'b', 'node': 'urn:noocodec:node:inc', 'outputs': { 'next': `${SIZE1_CKPT_DAG}/node/c` } },
          {
            '@id': `${SIZE1_CKPT_DAG}/node/c`, '@type': 'SingleNode',
            'name': 'c', 'node': 'urn:noocodec:node:inc', 'outputs': { 'next': `${SIZE1_CKPT_DAG}/node/end` } },
          {
            '@id': `${SIZE1_CKPT_DAG}/node/end`, '@type': 'TerminalNode',
            'name': 'end', 'outcome': 'completed' },
        ],
      };
      dispatcher.registerDAG(TestDag.from(dag));

      // Abort after the first stage.
      const ctl = new AbortController();
      let stagesYielded = 0;
      const initial = new CountState();
      const execution = dispatcher.execute(SIZE1_CKPT_DAG, initial, { 'signal': ctl.signal });

      for await (const _stage of execution) {
        stagesYielded++;
        if (stagesYielded === 1) ctl.abort(new Error('pause'));
      }

      const partial = await execution;
      assert.ok(partial.cursor !== null, 'run must be interrupted');
      assert.equal(partial.state.count, 1, 'count must be 1 after first node');

      // Assert: NO work-set blob in snapshot (size-1 canonical path).
      assert.equal(partial.state.getMetadata(WORKSET_PROGRESS_KEY), undefined);

      // Checkpoint → round-trip → restore → resume.
      const ckpt = await Checkpoint.capture(SIZE1_CKPT_DAG, partial);
      const raw = ckpt.toJson();
      const parsed: unknown = JSON.parse(raw);
      const ckpt2 = Checkpoint.load(parsed);
      const { state, dagName, cursor } = await ckpt2.restoreState(
        CheckpointRestoreAdapter.wrap(() => new CountState()),
      );

      assert.equal(state.count, 1, 'restored count must be 1');
      assert.equal(cursor, `${SIZE1_CKPT_DAG}/node/b`, 'cursor must point to b placement IRI');

      const resumed = await dispatcher.resume(dagName, state, cursor);
      assert.equal(resumed.cursor, null, 'resume must complete');
      assert.equal(resumed.state.count, 3, 'final count must be 3 after all three nodes');
    },
  );
});
