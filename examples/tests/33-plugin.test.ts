import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Dagonizer } from '@studnicky/dagonizer';

import { normalizePlugin, PipelineState, parentDag } from '../dags/33-plugin.ts';

void describe('33-plugin: plugin bundle + embedded-DAG alias', () => {
  void it('runs the plugin-authored child DAG through the same embed surface', async () => {
    const dispatcher = new Dagonizer<PipelineState>();
    dispatcher.registerPlugin(normalizePlugin);
    dispatcher.registerDAG(parentDag);

    const state = new PipelineState();
    state.phrase = '  Hello, World! This is a somewhat long phrase.  ';

    const result = await dispatcher.execute('pipeline', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.normalized, 'hello, world! this is a somewhat long phrase.');
    assert.equal(state.status, 'long');
    assert.equal(normalizePlugin.exports.normalize, 'plugin-normalize');
    assert.ok(result.executedNodes.includes('normalize-step'));
  });
});
