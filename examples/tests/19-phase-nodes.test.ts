import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import { PhaseState, PreSetupNode, ComputeNode, PostAuditNode, dag } from '../dags/19-phase-nodes.ts';

describe('19-phase-nodes: pre/post phase nodes bookend the main flow', () => {
  it('executionLog contains all four expected entries', async () => {
    const dispatcher = new Dagonizer<PhaseState>();
    dispatcher.registerNode(new PreSetupNode());
    dispatcher.registerNode(new ComputeNode());
    dispatcher.registerNode(new PostAuditNode());
    dispatcher.registerDAG(dag);

    const state = new PhaseState();
    const result = await dispatcher.execute('phase-demo', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(state.executionLog, [
      'pre-setup',
      'compute',
      'post-audit',
      'final-result:computed:84',
    ]);
  });

  it('result equals "computed:84" (seedValue=42 * 2)', async () => {
    const dispatcher = new Dagonizer<PhaseState>();
    dispatcher.registerNode(new PreSetupNode());
    dispatcher.registerNode(new ComputeNode());
    dispatcher.registerNode(new PostAuditNode());
    dispatcher.registerDAG(dag);

    const state = new PhaseState();
    await dispatcher.execute('phase-demo', state);

    assert.equal(state.result, 'computed:84');
  });

  it('seedValue is set to 42 by the pre-phase node', async () => {
    const dispatcher = new Dagonizer<PhaseState>();
    dispatcher.registerNode(new PreSetupNode());
    dispatcher.registerNode(new ComputeNode());
    dispatcher.registerNode(new PostAuditNode());
    dispatcher.registerDAG(dag);

    const state = new PhaseState();
    await dispatcher.execute('phase-demo', state);

    assert.equal(state.seedValue, 42);
  });

  it('pre-setup appears before compute in executionLog', async () => {
    const dispatcher = new Dagonizer<PhaseState>();
    dispatcher.registerNode(new PreSetupNode());
    dispatcher.registerNode(new ComputeNode());
    dispatcher.registerNode(new PostAuditNode());
    dispatcher.registerDAG(dag);

    const state = new PhaseState();
    await dispatcher.execute('phase-demo', state);

    const preIndex = state.executionLog.indexOf('pre-setup');
    const computeIndex = state.executionLog.indexOf('compute');
    assert.ok(preIndex < computeIndex, `pre-setup (${String(preIndex)}) should precede compute (${String(computeIndex)})`);
  });

  it('post-audit appears after compute in executionLog', async () => {
    const dispatcher = new Dagonizer<PhaseState>();
    dispatcher.registerNode(new PreSetupNode());
    dispatcher.registerNode(new ComputeNode());
    dispatcher.registerNode(new PostAuditNode());
    dispatcher.registerDAG(dag);

    const state = new PhaseState();
    await dispatcher.execute('phase-demo', state);

    const computeIndex = state.executionLog.indexOf('compute');
    const postIndex = state.executionLog.indexOf('post-audit');
    assert.ok(postIndex > computeIndex, `post-audit (${String(postIndex)}) should follow compute (${String(computeIndex)})`);
  });
});
