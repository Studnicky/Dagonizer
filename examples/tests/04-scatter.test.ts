import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer } from '@studnicky/dagonizer';
import { ScrapeState, ProbeNode, dag } from '../dags/04-scatter.ts';

describe('04-scatter: partition strategy routes clones by output', () => {
  it('completes successfully with mixed lengths', async () => {
    const dispatcher = new Dagonizer<ScrapeState>();
    dispatcher.registerNode(new ProbeNode());
    dispatcher.registerDAG(dag);

    const state = new ScrapeState();
    // even-length (2 chars) → 'ok'; odd-length (3 chars) → 'fail'
    state.urls = ['ab', 'abc'];
    const result = await dispatcher.execute('scrape', state);

    assert.equal(result.terminalOutcome, 'completed');
  });

  it('partitions succeeded (even-length) and failed (odd-length) correctly', async () => {
    const dispatcher = new Dagonizer<ScrapeState>();
    dispatcher.registerNode(new ProbeNode());
    dispatcher.registerDAG(dag);

    const state = new ScrapeState();
    state.urls = ['ab', 'abc'];
    await dispatcher.execute('scrape', state);

    assert.ok(
      state.succeeded.includes('ab'),
      `Expected "ab" in succeeded but got: ${JSON.stringify(state.succeeded)}`,
    );
    assert.ok(
      state.failed.includes('abc'),
      `Expected "abc" in failed but got: ${JSON.stringify(state.failed)}`,
    );
  });

  it('all-ok scatter fills succeeded only', async () => {
    const dispatcher = new Dagonizer<ScrapeState>();
    dispatcher.registerNode(new ProbeNode());
    dispatcher.registerDAG(dag);

    const state = new ScrapeState();
    // both even length
    state.urls = ['ab', 'cd'];
    const result = await dispatcher.execute('scrape', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.failed.length, 0);
    assert.equal(state.succeeded.length, 2);
  });

  it('all-fail scatter fills failed only', async () => {
    const dispatcher = new Dagonizer<ScrapeState>();
    dispatcher.registerNode(new ProbeNode());
    dispatcher.registerDAG(dag);

    const state = new ScrapeState();
    // both odd length
    state.urls = ['abc', 'def'];
    const result = await dispatcher.execute('scrape', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.succeeded.length, 0);
    assert.equal(state.failed.length, 2);
  });
});
