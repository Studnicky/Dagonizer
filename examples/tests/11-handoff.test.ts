import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import {
  PipelineState,
  CollectANode,
  CollectBNode,
  CollectCNode,
  SummarizeNode,
  dagA,
  dagB,
} from '../dags/11-handoff.ts';

describe('11-handoff: DAG A collects, DAG B summarizes', () => {
  it('DAG A collects all three items and completes', async () => {
    const dispatcher = new Dagonizer<PipelineState>();
    dispatcher.registerNode(new CollectANode());
    dispatcher.registerNode(new CollectBNode());
    dispatcher.registerNode(new CollectCNode());
    dispatcher.registerDAG(dagA);

    const state = new PipelineState();
    const result = await dispatcher.execute('urn:noocodec:dag:pipeline-a', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(state.items, ['alpha', 'beta', 'gamma']);
  });

  it('DAG B summarizes a pre-populated items array', async () => {
    const dispatcher = new Dagonizer<PipelineState>();
    dispatcher.registerNode(new SummarizeNode());
    dispatcher.registerDAG(dagB);

    const state = new PipelineState();
    state.items = ['alpha', 'beta', 'gamma'];
    const result = await dispatcher.execute('urn:noocodec:dag:pipeline-b', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.ok(
      state.summary.includes('3 item(s)'),
      `Expected summary to contain "3 item(s)" but got: "${state.summary}"`,
    );
  });

  it('DAG B summary contains item names', async () => {
    const dispatcher = new Dagonizer<PipelineState>();
    dispatcher.registerNode(new SummarizeNode());
    dispatcher.registerDAG(dagB);

    const state = new PipelineState();
    state.items = ['alpha', 'beta', 'gamma'];
    await dispatcher.execute('urn:noocodec:dag:pipeline-b', state);

    assert.ok(state.summary.includes('alpha'), `summary: "${state.summary}"`);
    assert.ok(state.summary.includes('beta'), `summary: "${state.summary}"`);
    assert.ok(state.summary.includes('gamma'), `summary: "${state.summary}"`);
  });

  it('DAG B with empty items produces "0 item(s)" summary', async () => {
    const dispatcher = new Dagonizer<PipelineState>();
    dispatcher.registerNode(new SummarizeNode());
    dispatcher.registerDAG(dagB);

    const state = new PipelineState();
    state.items = [];
    await dispatcher.execute('urn:noocodec:dag:pipeline-b', state);

    assert.ok(
      state.summary.includes('0 item(s)'),
      `Expected "0 item(s)" in summary but got: "${state.summary}"`,
    );
  });
});
