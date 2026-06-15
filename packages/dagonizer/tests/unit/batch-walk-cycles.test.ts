/**
 * Batch-walk cycle / retry-loop tests: locks in batch-native back-edge behavior.
 *
 * The work-set scheduler handles retry by routing a back-edge output to an
 * earlier (or self) placement. Items re-enter that placement's pending work
 * and are re-batched with any other items waiting there. Each pass reduces the
 * batch until all items exit the loop. This file covers five proven behaviors:
 *
 *  1. Size-1 self-loop retry — single item retries N times then exits.
 *  2. Multi-item homogeneous self-loop — N identical items all retry in lockstep.
 *  3. Multi-item heterogeneous self-loop — items exit at different iterations;
 *     each pass the surviving sub-batch shrinks.
 *  4. Budget exhaustion → salvage — items that exhaust `withinRetryBudget` land
 *     on a `salvage` port; items that succeed earlier land on `done`.
 *  5. Back-edge into a join — a cycle drains before the downstream join fires.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../../src/contracts/OperationContractFragment.js';
import { Batch } from '../../src/core/batch/Batch.js';
import type { RoutedBatch } from '../../src/core/batch/RoutedBatch.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/dag/DAG.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Timeout } from '../../src/runtime/Timeout.js';

// ---------------------------------------------------------------------------
// Cycle state: carries per-item retry counters and an exit threshold.
//
// `exitAt` — number of attempts after which this item exits the loop.
//             Items with `exitAt = 0` exit on the very first pass.
// `attempts` — how many times this item has been processed by the retry node.
// ---------------------------------------------------------------------------

class CycleState extends NodeStateBase {
  exitAt: number;
  attempts: number;

  constructor() {
    super();
    this.exitAt = 0;
    this.attempts = 0;
  }

  override clone(): this {
    const copy = new CycleState() as this;
    copy.exitAt = this.exitAt;
    copy.attempts = this.attempts;
    return copy;
  }
}

// ---------------------------------------------------------------------------
// Helper: fan-out node — takes a size-1 input batch and emits N items.
//
// Item i receives `exitAt = i`, so item 0 exits immediately, item 1 after one
// retry, item 4 after four retries, etc. The `attempts` counter starts at 0.
// ---------------------------------------------------------------------------

function makeCycleFanOutNode(name: string, n: number): NodeInterface<CycleState, 'out'> {
  return {
    'name': name,
    'outputs': ['out'] as const,
    'contract': EMPTY_CONTRACT_FRAGMENT,
    'timeout': Timeout.none(),
    async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'out', CycleState>> {
      const sourceState = batch.row(0).state;
      const items: Array<{ 'id': string; 'state': CycleState }> = [];
      for (let i = 0; i < n; i++) {
        const clone = sourceState.clone();
        clone.exitAt = i;
        clone.attempts = 0;
        items.push({ 'id': String(i), 'state': clone });
      }
      const result = new Map<'out', Batch<CycleState>>();
      result.set('out', Batch.from(items));
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: fan-out with uniform exitAt — all N items exit after the same
// number of attempts. Used for the homogeneous lockstep test.
// ---------------------------------------------------------------------------

function makeHomogeneousFanOutNode(
  name: string,
  n: number,
  exitAt: number,
): NodeInterface<CycleState, 'out'> {
  return {
    'name': name,
    'outputs': ['out'] as const,
    'contract': EMPTY_CONTRACT_FRAGMENT,
    'timeout': Timeout.none(),
    async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'out', CycleState>> {
      const sourceState = batch.row(0).state;
      const items: Array<{ 'id': string; 'state': CycleState }> = [];
      for (let i = 0; i < n; i++) {
        const clone = sourceState.clone();
        clone.exitAt = exitAt;
        clone.attempts = 0;
        items.push({ 'id': String(i), 'state': clone });
      }
      const result = new Map<'out', Batch<CycleState>>();
      result.set('out', Batch.from(items));
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: retry node — increments `attempts` per item; routes items whose
// attempt count has reached `exitAt` to `done`, others to `retry`.
//
// Hard cap at 50 iterations prevents an infinite loop if a bug in the
// scheduler causes items to never exit — the test then fails on the wrong
// `executedNodes` assertion rather than hanging.
// ---------------------------------------------------------------------------

function makeRetryNode(
  name: string,
  firings: number[],
): NodeInterface<CycleState, 'retry' | 'done'> {
  return {
    'name': name,
    'outputs': ['retry', 'done'] as const,
    'contract': EMPTY_CONTRACT_FRAGMENT,
    'timeout': Timeout.none(),
    async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'retry' | 'done', CycleState>> {
      firings.push(batch.size);

      const retryItems: Array<{ 'id': string; 'state': CycleState }> = [];
      const doneItems: Array<{ 'id': string; 'state': CycleState }> = [];

      for (const item of batch) {
        item.state.attempts += 1;
        // Safety cap: treat items that have been around too long as done to
        // prevent hangs; a real engine regression surfaces as a wrong assertion.
        if (item.state.attempts > 50 || item.state.attempts > item.state.exitAt) {
          doneItems.push({ 'id': item.id, 'state': item.state });
        } else {
          retryItems.push({ 'id': item.id, 'state': item.state });
        }
      }

      const result = new Map<'retry' | 'done', Batch<CycleState>>();
      if (retryItems.length > 0) {
        result.set('retry', Batch.from(retryItems));
      }
      if (doneItems.length > 0) {
        result.set('done', Batch.from(doneItems));
      }
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: budget-based retry node — uses `withinRetryBudget` to decide
// routing. Items within budget go to `retry`; exhausted items go to `salvage`;
// items with `exitAt=0` succeed immediately and go to `done`.
// ---------------------------------------------------------------------------

function makeBudgetRetryNode(
  name: string,
  maxAttempts: number,
  firings: number[],
): NodeInterface<CycleState, 'retry' | 'done' | 'salvage'> {
  return {
    'name': name,
    'outputs': ['retry', 'done', 'salvage'] as const,
    'contract': EMPTY_CONTRACT_FRAGMENT,
    'timeout': Timeout.none(),
    async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'retry' | 'done' | 'salvage', CycleState>> {
      firings.push(batch.size);

      const retryItems: Array<{ 'id': string; 'state': CycleState }> = [];
      const doneItems: Array<{ 'id': string; 'state': CycleState }> = [];
      const salvageItems: Array<{ 'id': string; 'state': CycleState }> = [];

      for (const item of batch) {
        // Items with `exitAt = 0` succeed immediately (do not consume budget).
        if (item.state.exitAt === 0) {
          item.state.attempts += 1;
          doneItems.push({ 'id': item.id, 'state': item.state });
        } else if (item.state.withinRetryBudget('loop', maxAttempts)) {
          // Within budget — loop again.
          item.state.attempts += 1;
          retryItems.push({ 'id': item.id, 'state': item.state });
        } else {
          // Budget exhausted.
          item.state.attempts += 1;
          salvageItems.push({ 'id': item.id, 'state': item.state });
        }
      }

      const result = new Map<'retry' | 'done' | 'salvage', Batch<CycleState>>();
      if (retryItems.length > 0) result.set('retry', Batch.from(retryItems));
      if (doneItems.length > 0) result.set('done', Batch.from(doneItems));
      if (salvageItems.length > 0) result.set('salvage', Batch.from(salvageItems));
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: accumulator node — collects all items for post-run inspection.
// ---------------------------------------------------------------------------

function makeAccumulatorNode(
  name: string,
  collected: CycleState[],
): NodeInterface<CycleState, 'done'> {
  return {
    'name': name,
    'outputs': ['done'] as const,
    'contract': EMPTY_CONTRACT_FRAGMENT,
    'timeout': Timeout.none(),
    async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'done', CycleState>> {
      for (const item of batch) {
        collected.push(item.state);
      }
      const result = new Map<'done', Batch<CycleState>>();
      result.set('done', batch);
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: recording node — stamps firings array and passes items through.
// ---------------------------------------------------------------------------

function makeRecordingNode(
  name: string,
  firings: number[],
): NodeInterface<CycleState, 'done'> {
  return {
    'name': name,
    'outputs': ['done'] as const,
    'contract': EMPTY_CONTRACT_FRAGMENT,
    'timeout': Timeout.none(),
    async execute(
      batch: Batch<CycleState>,
      _ctx: NodeContextInterface,
    ): Promise<RoutedBatch<'done', CycleState>> {
      firings.push(batch.size);
      const result = new Map<'done', Batch<CycleState>>();
      result.set('done', batch);
      return result;
    },
  };
}

// ===========================================================================
// Tests
// ===========================================================================

void describe('Batch walk cycles — size-1 self-loop retry', () => {
  void it('single item retries exactly exitAt times then reaches terminal', async () => {
    // exitAt=3: item exits on the 4th pass (attempts goes 1→2→3→4, but the
    // node routes to `done` when `attempts > exitAt`, i.e. on attempt 4).
    const dispatcher = new Dagonizer<CycleState>();
    const firings: number[] = [];

    dispatcher.registerNode(makeRetryNode('retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(makeAccumulatorNode('acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-size1',
      '@type': 'DAG',
      'name': 'cycle-size1',
      'version': '1',
      'entrypoint': 'a',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-size1/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'retrier',
          'outputs': { 'retry': 'a', 'done': 'collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-size1/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-size1/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const input = new CycleState();
    input.exitAt = 3; // exits after attempt 4 (attempts 1,2,3 loop; attempt 4 exits)

    const result = await dispatcher.execute('cycle-size1', input);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.lifecycle.kind, 'completed');
    assert.equal(result.cursor, null);

    // Node 'a' fires 4 times: attempts 1,2,3 route to `retry`, attempt 4 routes to `done`.
    assert.deepEqual(firings, [1, 1, 1, 1], 'retrier fires once per item per round');

    // executedNodes: a,a,a,a,collect,end
    assert.deepEqual(result.executedNodes, ['a', 'a', 'a', 'a', 'collect', 'end']);

    // One item reaches the accumulator with attempts=4.
    assert.equal(collected.length, 1);
    assert.equal(collected[0]?.attempts, 4);
  });

  void it('size-1 immediate exit (exitAt=0) reaches terminal in a single pass', async () => {
    const dispatcher = new Dagonizer<CycleState>();
    const firings: number[] = [];

    dispatcher.registerNode(makeRetryNode('retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(makeAccumulatorNode('acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-immediate',
      '@type': 'DAG',
      'name': 'cycle-immediate',
      'version': '1',
      'entrypoint': 'a',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-immediate/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'retrier',
          'outputs': { 'retry': 'a', 'done': 'collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-immediate/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-immediate/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const input = new CycleState();
    input.exitAt = 0; // attempts becomes 1 which is > 0 → immediate exit

    const result = await dispatcher.execute('cycle-immediate', input);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(result.executedNodes, ['a', 'collect', 'end']);
    assert.deepEqual(firings, [1]);
    assert.equal(collected.length, 1);
    assert.equal(collected[0]?.attempts, 1);
  });
});

void describe('Batch walk cycles — multi-item homogeneous self-loop', () => {
  void it('N identical items all retry in lockstep; retrier fires once per round', async () => {
    // 4 items all with exitAt=2: exit after attempt 3 (attempts 1,2 loop; 3 exits).
    const dispatcher = new Dagonizer<CycleState>();
    const firings: number[] = [];

    dispatcher.registerNode(makeHomogeneousFanOutNode('fan', 4, 2));
    dispatcher.registerNode(makeRetryNode('retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(makeAccumulatorNode('acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-homogeneous',
      '@type': 'DAG',
      'name': 'cycle-homogeneous',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-homogeneous/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'fan',
          'outputs': { 'out': 'a' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-homogeneous/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'retrier',
          'outputs': { 'retry': 'a', 'done': 'collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-homogeneous/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-homogeneous/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('cycle-homogeneous', new CycleState());

    assert.equal(result.terminalOutcome, 'completed');

    // Round 1: all 4 loop. Round 2: all 4 loop. Round 3: all 4 exit.
    assert.deepEqual(firings, [4, 4, 4], 'retrier fires once per round over the full N-item batch');

    // executedNodes: fan, a,a,a, collect, end
    assert.deepEqual(result.executedNodes, ['fan', 'a', 'a', 'a', 'collect', 'end']);

    // All 4 items reach the accumulator with attempts=3.
    assert.equal(collected.length, 4);
    for (const s of collected) {
      assert.equal(s.attempts, 3, 'each item attempted exactly 3 times');
    }
  });
});

void describe('Batch walk cycles — multi-item heterogeneous self-loop', () => {
  void it('items with exitAt 0..4 exit one-at-a-time; retrier batch shrinks each round', async () => {
    // 5 items: exitAt 0,1,2,3,4.
    // Round 1: all 5 process; item 0 exits (attempts 1 > 0), items 1-4 loop.
    // Round 2: 4 items; item 1 exits (attempts 2 > 1), items 2-4 loop.
    // Round 3: 3 items; item 2 exits, items 3-4 loop.
    // Round 4: 2 items; item 3 exits, item 4 loops.
    // Round 5: 1 item; item 4 exits.
    const dispatcher = new Dagonizer<CycleState>();
    const firings: number[] = [];

    dispatcher.registerNode(makeCycleFanOutNode('fan', 5));
    dispatcher.registerNode(makeRetryNode('retrier', firings));
    const collected: CycleState[] = [];
    dispatcher.registerNode(makeAccumulatorNode('acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-heterogeneous',
      '@type': 'DAG',
      'name': 'cycle-heterogeneous',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-heterogeneous/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'fan',
          'outputs': { 'out': 'a' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-heterogeneous/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'retrier',
          'outputs': { 'retry': 'a', 'done': 'collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-heterogeneous/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-heterogeneous/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('cycle-heterogeneous', new CycleState());

    assert.equal(result.terminalOutcome, 'completed');

    // 'a' fires exactly 5 times with shrinking batch sizes: 5,4,3,2,1.
    assert.deepEqual(
      firings,
      [5, 4, 3, 2, 1],
      'heterogeneous: one more item exits each round, batch shrinks by 1',
    );

    // executedNodes: fan, a×5, collect, end
    assert.deepEqual(result.executedNodes, ['fan', 'a', 'a', 'a', 'a', 'a', 'collect', 'end']);

    // All 5 items reach the accumulator.
    assert.equal(collected.length, 5, 'all 5 items reach the terminal accumulator');

    // Each item's final attempt count equals exitAt + 1 (one extra attempt that exits).
    const attemptsByExitAt = new Map<number, number>();
    for (const s of collected) {
      attemptsByExitAt.set(s.exitAt, s.attempts);
    }
    for (let exitAt = 0; exitAt < 5; exitAt++) {
      const attempts = attemptsByExitAt.get(exitAt);
      assert.equal(
        attempts,
        exitAt + 1,
        `item with exitAt=${exitAt} must have attempts=${exitAt + 1}`,
      );
    }
  });
});

void describe('Batch walk cycles — budget exhaustion → salvage', () => {
  void it('items exhausting withinRetryBudget land at salvage; successful items land at done terminal', async () => {
    // 4 items: 2 with exitAt=0 (succeed immediately), 2 with exitAt=255 (exhaust budget).
    const dispatcher = new Dagonizer<CycleState>();
    const firings: number[] = [];
    const MAX_ATTEMPTS = 3;

    // Custom fan-out: 2 items with exitAt=0 (succeed fast), 2 items with exitAt=255 (exhaust).
    const mixedFanOut: NodeInterface<CycleState, 'out'> = {
      'name': 'mix-fan',
      'outputs': ['out'] as const,
      'contract': EMPTY_CONTRACT_FRAGMENT,
      'timeout': Timeout.none(),
      async execute(
        batch: Batch<CycleState>,
        _ctx: NodeContextInterface,
      ): Promise<RoutedBatch<'out', CycleState>> {
        const sourceState = batch.row(0).state;
        const s0 = sourceState.clone(); s0.exitAt = 0; s0.attempts = 0;
        const s1 = sourceState.clone(); s1.exitAt = 0; s1.attempts = 0;
        const s2 = sourceState.clone(); s2.exitAt = 255; s2.attempts = 0;
        const s3 = sourceState.clone(); s3.exitAt = 255; s3.attempts = 0;
        const items: Array<{ 'id': string; 'state': CycleState }> = [
          { 'id': '0', 'state': s0 },
          { 'id': '1', 'state': s1 },
          { 'id': '2', 'state': s2 },
          { 'id': '3', 'state': s3 },
        ];
        const result = new Map<'out', Batch<CycleState>>();
        result.set('out', Batch.from(items));
        return result;
      },
    };

    dispatcher.registerNode(mixedFanOut);
    dispatcher.registerNode(makeBudgetRetryNode('budget-retrier', MAX_ATTEMPTS, firings));

    const successCollected: CycleState[] = [];
    const salvageCollected: CycleState[] = [];
    dispatcher.registerNode(makeAccumulatorNode('success-acc', successCollected));
    dispatcher.registerNode(makeAccumulatorNode('salvage-acc', salvageCollected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-budget',
      '@type': 'DAG',
      'name': 'cycle-budget',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-budget/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'mix-fan',
          'outputs': { 'out': 'b' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-budget/node/b',
          '@type': 'SingleNode',
          'name': 'b',
          'node': 'budget-retrier',
          'outputs': { 'retry': 'b', 'done': 'success-collect', 'salvage': 'salvage-collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-budget/node/success-collect',
          '@type': 'SingleNode',
          'name': 'success-collect',
          'node': 'success-acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-budget/node/salvage-collect',
          '@type': 'SingleNode',
          'name': 'salvage-collect',
          'node': 'salvage-acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-budget/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('cycle-budget', new CycleState());

    assert.equal(result.terminalOutcome, 'completed');

    // Successful items (exitAt=0) exit on the first pass.
    assert.equal(successCollected.length, 2, 'exactly 2 items succeed');
    for (const s of successCollected) {
      assert.equal(s.exitAt, 0, 'succeeded items have exitAt=0');
    }

    // Salvage items (exitAt=255) exhaust the budget (3 attempts) and land in salvage.
    assert.equal(salvageCollected.length, 2, 'exactly 2 items are salvaged');
    for (const s of salvageCollected) {
      assert.equal(s.exitAt, 255, 'salvaged items have exitAt=255 (never self-succeed)');
      // `withinRetryBudget` increments the counter; exhausted at maxAttempts.
      assert.equal(s.retriesFor('loop'), MAX_ATTEMPTS, 'budget key records exactly maxAttempts attempts');
    }
  });
});

void describe('Batch walk cycles — back-edge into a join', () => {
  void it('cycle drains before the downstream join fires; join fires once over full coalesced batch', async () => {
    // Shape: input → fan (splits into loop-out and straight-out)
    //   loop-out  → a (self-loop; exitAt 0,1,1) → done: j
    //   straight-out → j (2 items, straight through)
    //   j → collect → end
    //
    // The join 'j' receives items from two feeders: the retry loop (cycle)
    // and the straight path. The rank scheduler must hold 'j' until both
    // feeders drain. After both drain, 'j' fires once over all 5 items.

    const dispatcher = new Dagonizer<CycleState>();
    const jFirings: number[] = [];
    const collected: CycleState[] = [];

    // Fan-out: 3 loop items (exitAt 0,1,1) + 2 straight items.
    const fanNode: NodeInterface<CycleState, 'loop-out' | 'straight-out'> = {
      'name': 'cycle-join-fan',
      'outputs': ['loop-out', 'straight-out'] as const,
      'contract': EMPTY_CONTRACT_FRAGMENT,
      'timeout': Timeout.none(),
      async execute(
        batch: Batch<CycleState>,
        _ctx: NodeContextInterface,
      ): Promise<RoutedBatch<'loop-out' | 'straight-out', CycleState>> {
        const sourceState = batch.row(0).state;

        const l0 = sourceState.clone(); l0.exitAt = 0;
        const l1 = sourceState.clone(); l1.exitAt = 1;
        const l2 = sourceState.clone(); l2.exitAt = 1;
        const s0 = sourceState.clone(); s0.exitAt = 0;
        const s1 = sourceState.clone(); s1.exitAt = 0;

        const loopItems: Array<{ 'id': string; 'state': CycleState }> = [
          { 'id': 'L0', 'state': l0 },
          { 'id': 'L1', 'state': l1 },
          { 'id': 'L2', 'state': l2 },
        ];
        const straightItems: Array<{ 'id': string; 'state': CycleState }> = [
          { 'id': 'S0', 'state': s0 },
          { 'id': 'S1', 'state': s1 },
        ];

        const result = new Map<'loop-out' | 'straight-out', Batch<CycleState>>();
        result.set('loop-out', Batch.from(loopItems));
        result.set('straight-out', Batch.from(straightItems));
        return result;
      },
    };

    dispatcher.registerNode(fanNode);
    dispatcher.registerNode(makeRetryNode('cycle-retrier', []));
    dispatcher.registerNode(makeRecordingNode('j-join', jFirings));
    dispatcher.registerNode(makeAccumulatorNode('j-acc', collected));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:cycle-join',
      '@type': 'DAG',
      'name': 'cycle-join',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:cycle-join/node/fan',
          '@type': 'SingleNode',
          'name': 'fan',
          'node': 'cycle-join-fan',
          'outputs': { 'loop-out': 'a', 'straight-out': 'j' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-join/node/a',
          '@type': 'SingleNode',
          'name': 'a',
          'node': 'cycle-retrier',
          'outputs': { 'retry': 'a', 'done': 'j' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-join/node/j',
          '@type': 'SingleNode',
          'name': 'j',
          'node': 'j-join',
          'outputs': { 'done': 'collect' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-join/node/collect',
          '@type': 'SingleNode',
          'name': 'collect',
          'node': 'j-acc',
          'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:noocodex:dag:cycle-join/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('cycle-join', new CycleState());

    assert.equal(result.terminalOutcome, 'completed');

    // j fires once with all 5 items (3 from cycle + 2 from straight path).
    assert.deepEqual(jFirings, [5], 'join fires exactly once over all 5 items after cycle drains');

    // All 5 items reach the accumulator.
    assert.equal(collected.length, 5, 'all 5 items coalesce at the join and reach the terminal');
  });
});
