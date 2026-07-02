/**
 * Tests for `AgentTraceProducer.select`.
 *
 * Verifies:
 *  1. Each mapped node name (`call-model`, `decode-tools`, `collect-results`,
 *     `append-assistant`) yields the corresponding reasoning-step kind,
 *     wrapped in a `ReasoningTraceItemType` carrying its emission ordinal.
 *  2. A node name absent from the dispatch map yields no item and consumes
 *     no ordinal.
 *  3. A stage whose `output` is `'error'` yields no item, even when its
 *     `nodeName` is one of the mapped names — an errored node produces no
 *     reasoning moment, and consumes no ordinal either.
 *  4. Ordinals are assigned 0, 1, 2, ... in emission order, and stay
 *     contiguous across skipped (unmapped/errored) stages — the ordinal
 *     increments only for stages that actually emit an item, so a
 *     downstream consumer can always derive `wasInformedBy` from
 *     `item.ordinal - 1` with no gaps.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ReasoningTraceItemType } from '../../src/entities/agent/ReasoningTraceItem.js';
import type { NodeResultType } from '../../src/entities/node/NodeResult.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { AgentTraceProducer } from '../../src/patterns/agent/AgentTraceProducer.js';

/** Minimal concrete producer: no inner execution needed, `select` is exercised directly. */
class TestTraceProducer extends AgentTraceProducer {
  protected describe(): string {
    return 'described';
  }

  /** Test-only seam onto the protected `select` template method. */
  selectFor(stage: NodeResultType<NodeStateInterface>): Iterable<ReasoningTraceItemType> {
    return this.select(stage);
  }
}

/** Builds `NodeResultType<NodeStateInterface>` fixtures for one node's result. */
class NodeResultFixture {
  static ofStage(nodeName: string, output: string | null): NodeResultType<NodeStateInterface> {
    return {
      'nodeName': nodeName,
      'output': output,
      'skipped': false,
      'state': new NodeStateBase(),
      'intermediateResults': [],
    };
  }
}

void describe('AgentTraceProducer.select', () => {
  void it('maps call-model to an ordinal-0 thought item', () => {
    const producer = new TestTraceProducer((async function* () { /* unused: select is exercised directly */ })());
    const items = [...producer.selectFor(NodeResultFixture.ofStage('call-model', 'text'))];
    assert.deepEqual(items, [{ 'ordinal': 0, 'step': { 'kind': 'thought', 'text': 'described' } }]);
  });

  void it('maps decode-tools to an action item with empty args', () => {
    const producer = new TestTraceProducer((async function* () { /* unused */ })());
    const items = [...producer.selectFor(NodeResultFixture.ofStage('decode-tools', 'tools'))];
    assert.deepEqual(items, [{ 'ordinal': 0, 'step': { 'kind': 'action', 'tool': 'described', 'args': {} } }]);
  });

  void it('maps collect-results to an observation item', () => {
    const producer = new TestTraceProducer((async function* () { /* unused */ })());
    const items = [...producer.selectFor(NodeResultFixture.ofStage('collect-results', 'ok'))];
    assert.deepEqual(items, [{ 'ordinal': 0, 'step': { 'kind': 'observation', 'output': 'described' } }]);
  });

  void it('maps append-assistant to a final item', () => {
    const producer = new TestTraceProducer((async function* () { /* unused */ })());
    const items = [...producer.selectFor(NodeResultFixture.ofStage('append-assistant', 'done'))];
    assert.deepEqual(items, [{ 'ordinal': 0, 'step': { 'kind': 'final', 'text': 'described' } }]);
  });

  void it('yields no item for a node name absent from the dispatch map', () => {
    const producer = new TestTraceProducer((async function* () { /* unused */ })());
    const items = [...producer.selectFor(NodeResultFixture.ofStage('normalize-response', 'text'))];
    assert.deepEqual(items, []);
  });

  void it('yields no item for a stage whose output is "error", even for a mapped node name', () => {
    const producer = new TestTraceProducer((async function* () { /* unused */ })());
    const items = [...producer.selectFor(NodeResultFixture.ofStage('call-model', 'error'))];
    assert.deepEqual(items, []);
  });

  void it('assigns ordinals 0, 1, 2, ... in emission order across multiple select calls', () => {
    const producer = new TestTraceProducer((async function* () { /* unused */ })());
    const first = [...producer.selectFor(NodeResultFixture.ofStage('call-model', 'text'))];
    const second = [...producer.selectFor(NodeResultFixture.ofStage('decode-tools', 'tools'))];
    const third = [...producer.selectFor(NodeResultFixture.ofStage('collect-results', 'ok'))];
    assert.equal(first[0]?.ordinal, 0);
    assert.equal(second[0]?.ordinal, 1);
    assert.equal(third[0]?.ordinal, 2);
  });

  void it('does not consume an ordinal for skipped stages (unmapped node name or errored output)', () => {
    const producer = new TestTraceProducer((async function* () { /* unused */ })());
    const emittedFirst = [...producer.selectFor(NodeResultFixture.ofStage('call-model', 'text'))];
    const skippedUnmapped = [...producer.selectFor(NodeResultFixture.ofStage('normalize-response', 'text'))];
    const skippedError = [...producer.selectFor(NodeResultFixture.ofStage('decode-tools', 'error'))];
    const emittedSecond = [...producer.selectFor(NodeResultFixture.ofStage('decode-tools', 'tools'))];

    assert.equal(emittedFirst[0]?.ordinal, 0);
    assert.deepEqual(skippedUnmapped, []);
    assert.deepEqual(skippedError, []);
    // The ordinal is contiguous: the second emitted item is ordinal 1, not 3 —
    // skipped stages left no gap, so wasInformedBy chains derived from
    // `ordinal - 1` never point at a stage that was never recorded.
    assert.equal(emittedSecond[0]?.ordinal, 1);
  });
});
