import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { GatherRecordType } from '../../src/contracts/GatherExecution.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { GATHER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import type { GatherNodeType } from '../../src/entities/dag/GatherNode.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { GatherBuffers } from '../../src/execution/GatherBuffers.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

const placementIri = TestDag.placementIri;
const entrypointIri = TestDag.entrypointIri;

const MULTI_ENTRY_GATHER_DAG_IRI = 'urn:noocodex:dag:multi-entry-gather';
const MAIN_SOURCE_GATHER_DAG_IRI = 'urn:noocodex:dag:main-source-gather';
const GATHER_ANY_POLICY_DAG_IRI = 'urn:noocodex:dag:gather-any-policy';
const GATHER_QUORUM_POLICY_DAG_IRI = 'urn:noocodex:dag:gather-quorum-policy';
const GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI = 'urn:noocodex:dag:gather-include-errors-policy';
const MULTI_ENTRY_GATHER_RESUME_DAG_IRI = 'urn:noocodex:dag:multi-entry-gather-resume';
const CHILD_ANSWER_DAG_IRI = 'urn:noocodex:dag:child-answer';
const EMBEDDED_GATHER_RESULT_DAG_IRI = 'urn:noocodex:dag:embedded-gather-result';
const COMPACT_CHILD_ANSWER_DAG_IRI = 'urn:noocodex:dag:compact-child-answer';
const COMPACT_GATHER_RESULT_DAG_IRI = 'urn:noocodex:dag:compact-gather-result';
const RETAINED_CHILD_ANSWER_DAG_IRI = 'urn:noocodex:dag:retained-child-answer';
const RETAINED_GATHER_RESULT_DAG_IRI = 'urn:noocodex:dag:retained-gather-result';
const SOURCE_LABEL_RESUME_DAG_IRI = 'urn:noocodex:dag:source-label-resume';
const MIXED_CHILD_ANSWER_DAG_IRI = 'urn:noocodex:dag:mixed-child-answer';
const MIXED_PRODUCER_GATHER_DAG_IRI = 'urn:noocodex:dag:mixed-producer-gather';
const PARTITION_DAG_IRI = 'urn:noocodex:dag:partition';
const CUSTOM_FAN_DAG_IRI = 'urn:noocodex:dag:customfan';
const APPEND_FAN_DAG_IRI = 'urn:noocodex:dag:appendfan';
const MAP_FAN_DAG_IRI = 'urn:noocodex:dag:mapfan';
const CONC_DAG_IRI = 'urn:noocodex:dag:conc';

void describe('GatherBuffers', () => {
  void it('preserves multiple scalar records from the same producer source', () => {
    const buffers = new GatherBuffers();
    const gather = {
      '@id':     'urn:test:join',
      '@type':   'GatherNode',
      'name':    'join',
      'sources': { 'producer': {} },
      'gather':  { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge' },
      'outputs': { 'success': 'end', 'error': 'failed' },
    } satisfies GatherNodeType;

    const first = new NodeStateBase();
    const second = new NodeStateBase();
    const records: GatherRecordType[] = [
      {
        'source': 'producer',
        'index': null,
        'item': undefined,
        'output': 'success',
        'terminalOutcome': null,
        'result': 'first',
        'cloneState': first,
      },
      {
        'source': 'producer',
        'index': null,
        'item': undefined,
        'output': 'success',
        'terminalOutcome': null,
        'result': 'second',
        'cloneState': second,
      },
    ];

    const gatherKey = 'urn:noocodex:dag:test/node/join/execution/0';
    for (const record of records) buffers.add(gatherKey, record);

    assert.equal(buffers.ready(gather, gatherKey), true);
    assert.deepEqual(
      buffers.takeReady(gather, gatherKey).records.map((record) => record.result),
      ['first', 'second'],
    );
  });
});

void describe('Dagonizer scatter gather strategies', () => {
  void it('first-class gather waits for multiple entrypoint producers', async () => {
    class MultiEntryState extends NodeStateBase {
      leftValue = '';
      rightValue = '';
      seenSources: string[] = [];
    }

    const dispatcher = new Dagonizer<MultiEntryState>();
    const left = TestNode.make<MultiEntryState>('urn:noocodec:node:left', ['success'], (state) => {
      state.leftValue = 'left-ready';
      return 'success';
    });
    const right = TestNode.make<MultiEntryState>('urn:noocodec:node:right', ['success'], (state) => {
      state.rightValue = 'right-ready';
      return 'success';
    });
    const merge = TestNode.make<MultiEntryState>('urn:noocodec:node:merge', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenSources = records.map((record) => String(record['source'])).sort();
      return 'success';
    });

    dispatcher.registerNode(left);
    dispatcher.registerNode(right);
    dispatcher.registerNode(merge);

    const dag = new DAGBuilder(MULTI_ENTRY_GATHER_DAG_IRI, '1', { 'name': 'multi-entry-gather' })
      .node(placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'left'), left, { 'success': placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'join') }, { 'name': 'left' })
      .node(placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'right'), right, { 'success': placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'join') }, { 'name': 'right' })
      .gather(placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'join'), {
        [placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'left')]: {},
        [placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'right')]: {},
      }, { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge' }, {
        'success': placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'end'),
        'error': placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'failed'),
      }, { 'name': 'join' })
      .terminal(placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'failed'), { 'name': 'failed', 'outcome': 'failed' })
      .entrypoints({ 'left': placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'left'), 'right': placementIri(MULTI_ENTRY_GATHER_DAG_IRI, 'right') })
      .build();
    dispatcher.registerDAG(dag);

    const state = new MultiEntryState();
    const result = await dispatcher.execute(MULTI_ENTRY_GATHER_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(state.seenSources, [
      'urn:noocodex:dag:multi-entry-gather/node/left',
      'urn:noocodex:dag:multi-entry-gather/node/right',
    ]);
  });

  void it('first-class gather uses main as the scalar entrypoint producer label', async () => {
    class MainSourceState extends NodeStateBase {
      seenSources: string[] = [];
    }

    const dispatcher = new Dagonizer<MainSourceState>();
    const work = TestNode.make<MainSourceState>('urn:noocodec:node:work-main-source', ['success']);
    const merge = TestNode.make<MainSourceState>('urn:noocodec:node:merge-main-source', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenSources = records.map((record) => String(record['source']));
      return 'success';
    });

    dispatcher.registerNode(work);
    dispatcher.registerNode(merge);

    const dag = new DAGBuilder(MAIN_SOURCE_GATHER_DAG_IRI, '1', { 'name': 'main-source-gather' })
      .node(placementIri(MAIN_SOURCE_GATHER_DAG_IRI, 'work-placement'), work, { 'success': placementIri(MAIN_SOURCE_GATHER_DAG_IRI, 'join') }, { 'name': 'work-placement' })
      .gather(placementIri(MAIN_SOURCE_GATHER_DAG_IRI, 'join'), { [entrypointIri(MAIN_SOURCE_GATHER_DAG_IRI, 'main')]: {} }, { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge-main-source' }, {
        'success': placementIri(MAIN_SOURCE_GATHER_DAG_IRI, 'end'),
        'error': placementIri(MAIN_SOURCE_GATHER_DAG_IRI, 'failed'),
      }, { 'name': 'join' })
      .terminal(placementIri(MAIN_SOURCE_GATHER_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(MAIN_SOURCE_GATHER_DAG_IRI, 'failed'), { 'name': 'failed', 'outcome': 'failed' })
      .build();
    dispatcher.registerDAG(dag);

    const state = new MainSourceState();
    const result = await dispatcher.execute(MAIN_SOURCE_GATHER_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(state.seenSources, ['urn:noocodex:dag:main-source-gather/entrypoint/main']);
  });

  void it('first-class gather any policy keeps only the first arrived source', async () => {
    class AnyState extends NodeStateBase {
      seenSources: string[] = [];
    }

    const dispatcher = new Dagonizer<AnyState>();
    const left = TestNode.make<AnyState>('urn:noocodec:node:left-any', ['success']);
    const right = TestNode.make<AnyState>('urn:noocodec:node:right-any', ['success']);
    const merge = TestNode.make<AnyState>('urn:noocodec:node:merge-any', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenSources = records.map((record) => String(record['source'])).sort();
      return 'success';
    });

    dispatcher.registerNode(left);
    dispatcher.registerNode(right);
    dispatcher.registerNode(merge);

    const dag = new DAGBuilder(GATHER_ANY_POLICY_DAG_IRI, '1', { 'name': 'gather-any-policy' })
      .node(placementIri(GATHER_ANY_POLICY_DAG_IRI, 'left-node'), left, { 'success': placementIri(GATHER_ANY_POLICY_DAG_IRI, 'join') }, { 'name': 'left-node' })
      .node(placementIri(GATHER_ANY_POLICY_DAG_IRI, 'right-node'), right, { 'success': placementIri(GATHER_ANY_POLICY_DAG_IRI, 'join') }, { 'name': 'right-node' })
      .gather(placementIri(GATHER_ANY_POLICY_DAG_IRI, 'join'), {
        [entrypointIri(GATHER_ANY_POLICY_DAG_IRI, 'left')]: {},
        [entrypointIri(GATHER_ANY_POLICY_DAG_IRI, 'right')]: {},
      }, { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge-any' }, {
        'success': placementIri(GATHER_ANY_POLICY_DAG_IRI, 'end'),
        'error': placementIri(GATHER_ANY_POLICY_DAG_IRI, 'failed'),
      }, {
        'name': 'join',
        'policy': { 'mode': 'any' },
      })
      .terminal(placementIri(GATHER_ANY_POLICY_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(GATHER_ANY_POLICY_DAG_IRI, 'failed'), { 'name': 'failed', 'outcome': 'failed' })
      .entrypoints({ 'left': placementIri(GATHER_ANY_POLICY_DAG_IRI, 'left-node'), 'right': placementIri(GATHER_ANY_POLICY_DAG_IRI, 'right-node') })
      .build();
    dispatcher.registerDAG(dag);

    const state = new AnyState();
    const result = await dispatcher.execute(GATHER_ANY_POLICY_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(state.seenSources, ['urn:noocodex:dag:gather-any-policy/entrypoint/left']);
  });

  void it('first-class gather quorum policy keeps the first quorum source groups', async () => {
    class QuorumState extends NodeStateBase {
      seenSources: string[] = [];
    }

    const dispatcher = new Dagonizer<QuorumState>();
    const first = TestNode.make<QuorumState>('urn:noocodec:node:first-quorum', ['success']);
    const second = TestNode.make<QuorumState>('urn:noocodec:node:second-quorum', ['success']);
    const third = TestNode.make<QuorumState>('urn:noocodec:node:third-quorum', ['success']);
    const merge = TestNode.make<QuorumState>('urn:noocodec:node:merge-quorum', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenSources = records.map((record) => String(record['source'])).sort();
      return 'success';
    });

    dispatcher.registerNode(first);
    dispatcher.registerNode(second);
    dispatcher.registerNode(third);
    dispatcher.registerNode(merge);

    const dag = new DAGBuilder(GATHER_QUORUM_POLICY_DAG_IRI, '1', { 'name': 'gather-quorum-policy' })
      .node(placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'first-node'), first, { 'success': placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'join') }, { 'name': 'first-node' })
      .node(placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'second-node'), second, { 'success': placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'join') }, { 'name': 'second-node' })
      .node(placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'third-node'), third, { 'success': placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'join') }, { 'name': 'third-node' })
      .gather(placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'join'), {
        [entrypointIri(GATHER_QUORUM_POLICY_DAG_IRI, 'first')]: {},
        [entrypointIri(GATHER_QUORUM_POLICY_DAG_IRI, 'second')]: {},
        [entrypointIri(GATHER_QUORUM_POLICY_DAG_IRI, 'third')]: {},
      }, { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge-quorum' }, {
        'success': placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'end'),
        'error': placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'failed'),
      }, {
        'name': 'join',
        'policy': { 'mode': 'quorum', 'quorum': 2 },
      })
      .terminal(placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'failed'), { 'name': 'failed', 'outcome': 'failed' })
      .entrypoints({
        'first': placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'first-node'),
        'second': placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'second-node'),
        'third': placementIri(GATHER_QUORUM_POLICY_DAG_IRI, 'third-node'),
      })
      .build();
    dispatcher.registerDAG(dag);

    const state = new QuorumState();
    const result = await dispatcher.execute(GATHER_QUORUM_POLICY_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(state.seenSources, [
      'urn:noocodex:dag:gather-quorum-policy/entrypoint/first',
      'urn:noocodex:dag:gather-quorum-policy/entrypoint/second',
    ]);
  });

  void it('first-class gather can exclude error records from strategy input', async () => {
    class IncludeErrorsState extends NodeStateBase {
      seenSources: string[] = [];
    }

    const dispatcher = new Dagonizer<IncludeErrorsState>();
    const bad = TestNode.make<IncludeErrorsState>('urn:noocodec:node:bad-source', ['error'], () => 'error');
    const good = TestNode.make<IncludeErrorsState>('urn:noocodec:node:good-source', ['success']);
    const merge = TestNode.make<IncludeErrorsState>('urn:noocodec:node:merge-include-errors', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenSources = records.map((record) => String(record['source'])).sort();
      return 'success';
    });

    dispatcher.registerNode(bad);
    dispatcher.registerNode(good);
    dispatcher.registerNode(merge);

    const dag = new DAGBuilder(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, '1', { 'name': 'gather-include-errors-policy' })
      .node(placementIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'bad-node'), bad, { 'error': placementIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'join') }, { 'name': 'bad-node' })
      .node(placementIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'good-node'), good, { 'success': placementIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'join') }, { 'name': 'good-node' })
      .gather(placementIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'join'), {
        [entrypointIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'bad')]: {},
        [entrypointIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'good')]: {},
      }, { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge-include-errors' }, {
        'success': placementIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'end'),
        'error': placementIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'failed'),
      }, {
        'name': 'join',
        'policy': { 'includeErrors': false },
      })
      .terminal(placementIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'failed'), { 'name': 'failed', 'outcome': 'failed' })
      .entrypoints({ 'bad': placementIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'bad-node'), 'good': placementIri(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, 'good-node') })
      .build();
    dispatcher.registerDAG(dag);

    const state = new IncludeErrorsState();
    const result = await dispatcher.execute(GATHER_INCLUDE_ERRORS_POLICY_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(state.seenSources, ['urn:noocodex:dag:gather-include-errors-policy/entrypoint/good']);
  });

  void it('first-class gather resumes after one producer is buffered', async () => {
    class MultiEntryState extends NodeStateBase {
      seenSources: string[] = [];
    }

    const controller = new AbortController();
    const dispatcher = new Dagonizer<MultiEntryState>();
    const left = TestNode.make<MultiEntryState>('urn:noocodec:node:left', ['success'], () => {
      controller.abort();
      return 'success';
    });
    const right = TestNode.make<MultiEntryState>('urn:noocodec:node:right', ['success']);
    const merge = TestNode.make<MultiEntryState>('urn:noocodec:node:merge', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenSources = records.map((record) => String(record['source'])).sort();
      return 'success';
    });

    dispatcher.registerNode(left);
    dispatcher.registerNode(right);
    dispatcher.registerNode(merge);

    const dag = new DAGBuilder(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, '1', { 'name': 'multi-entry-gather-resume' })
      .node(placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'left'), left, { 'success': placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'join') }, { 'name': 'left' })
      .node(placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'right'), right, { 'success': placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'join') }, { 'name': 'right' })
      .gather(placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'join'), {
        [placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'left')]: {},
        [placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'right')]: {},
      }, { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge' }, {
        'success': placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'end'),
        'error': placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'failed'),
      }, { 'name': 'join' })
      .terminal(placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'failed'), { 'name': 'failed', 'outcome': 'failed' })
      .entrypoints({ 'left': placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'left'), 'right': placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'right') })
      .build();
    dispatcher.registerDAG(dag);

    const partial = await dispatcher.execute(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, new MultiEntryState(), {
      'signal': controller.signal,
    });

    assert.equal(partial.terminalOutcome, null);
    assert.deepEqual(partial.interruptedAt, { 'nodeName': placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'right'), 'reason': 'abort' });
    assert.equal(partial.cursor, placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'right'));
    assert.ok(partial.state.getMetadata(GATHER_PROGRESS_KEY));

    const resumed = await dispatcher.resume(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, partial.state, partial.cursor);

    assert.equal(resumed.terminalOutcome, 'completed');
    assert.deepEqual(partial.state.seenSources, [
      placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'left'),
      placementIri(MULTI_ENTRY_GATHER_RESUME_DAG_IRI, 'right'),
    ]);
    assert.equal(partial.state.getMetadata(GATHER_PROGRESS_KEY), undefined);
  });

  void it('first-class gather consumes embedded DAG gatherResult projection', async () => {
    class ChildState extends NodeStateBase {
      answer = '';
    }
    class ParentState extends NodeStateBase {
      seenResults: unknown[] = [];
    }

    const dispatcher = new Dagonizer<ParentState>();
    const answer = TestNode.make<ChildState>('urn:noocodec:node:answer', ['success'], (state) => {
      state.answer = 'forty-two';
      return 'success';
    });
    const merge = TestNode.make<ParentState>('urn:noocodec:node:merge', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenResults = records.map((record) => record['result']);
      return 'success';
    });

    const childDag = new DAGBuilder(CHILD_ANSWER_DAG_IRI, '1', { 'name': 'child-answer' })
      .node(placementIri(CHILD_ANSWER_DAG_IRI, 'answer'), answer, { 'success': placementIri(CHILD_ANSWER_DAG_IRI, 'done') }, { 'name': 'answer' })
      .terminal(placementIri(CHILD_ANSWER_DAG_IRI, 'done'), { 'name': 'done' })
      .build();

    const parentDag = new DAGBuilder(EMBEDDED_GATHER_RESULT_DAG_IRI, '1', { 'name': 'embedded-gather-result' })
      .embed<ChildState, ParentState>(placementIri(EMBEDDED_GATHER_RESULT_DAG_IRI, 'invoke'), CHILD_ANSWER_DAG_IRI, {
        'success': placementIri(EMBEDDED_GATHER_RESULT_DAG_IRI, 'join'),
        'error': placementIri(EMBEDDED_GATHER_RESULT_DAG_IRI, 'join'),
      }, {
        'gatherResult': { 'resultField': 'answer' },
        'name': 'invoke',
      })
      .gather(placementIri(EMBEDDED_GATHER_RESULT_DAG_IRI, 'join'), {
        [placementIri(EMBEDDED_GATHER_RESULT_DAG_IRI, 'invoke')]: { 'resultField': 'answer' },
      }, { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge' }, {
        'success': placementIri(EMBEDDED_GATHER_RESULT_DAG_IRI, 'end'),
        'error': placementIri(EMBEDDED_GATHER_RESULT_DAG_IRI, 'failed'),
      }, { 'name': 'join' })
      .terminal(placementIri(EMBEDDED_GATHER_RESULT_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(EMBEDDED_GATHER_RESULT_DAG_IRI, 'failed'), { 'name': 'failed', 'outcome': 'failed' })
      .build();

    dispatcher.registerNode(answer);
    dispatcher.registerNode(merge);
    dispatcher.registerDAG(childDag, () => new ChildState());
    dispatcher.registerDAG(parentDag);

    const state = new ParentState();
    const result = await dispatcher.execute(EMBEDDED_GATHER_RESULT_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(state.seenResults, ['forty-two']);
  });

  void it('gather checkpoint compacts projected embedded result records', async () => {
    class ChildState extends NodeStateBase {
      answer = '';
    }
    class ParentState extends NodeStateBase {
      seenResults: unknown[] = [];
      seenSources: string[] = [];
    }

    const controller = new AbortController();
    const dispatcher = new Dagonizer<ParentState>();
    const answer = TestNode.make<ChildState>('urn:noocodec:node:answer-compact', ['success'], (state) => {
      state.answer = 'forty-two';
      return 'success';
    });
    const pause = TestNode.make<ParentState>('urn:noocodec:node:pause-compact', ['success'], () => {
      controller.abort();
      return 'success';
    });
    const merge = TestNode.make<ParentState>('urn:noocodec:node:merge-compact', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenResults = records.map((record) => record['result']);
      state.seenSources = records.map((record) => String(record['source'])).sort();
      return 'success';
    });

    const childDag = new DAGBuilder(COMPACT_CHILD_ANSWER_DAG_IRI, '1', { 'name': 'compact-child-answer' })
      .node(placementIri(COMPACT_CHILD_ANSWER_DAG_IRI, 'answer'), answer, { 'success': placementIri(COMPACT_CHILD_ANSWER_DAG_IRI, 'done') }, { 'name': 'answer' })
      .terminal(placementIri(COMPACT_CHILD_ANSWER_DAG_IRI, 'done'), { 'name': 'done' })
      .build();

    const parentDag = new DAGBuilder(COMPACT_GATHER_RESULT_DAG_IRI, '1', { 'name': 'compact-gather-result' })
      .embed<ChildState, ParentState>(placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'invoke'), COMPACT_CHILD_ANSWER_DAG_IRI, {
        'success': placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'join'),
        'error': placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'join'),
      }, {
        'gatherResult': { 'resultField': 'answer' },
        'name': 'invoke',
      })
      .node(placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'pause'), pause, { 'success': placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'join') }, { 'name': 'pause' })
      .gather(placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'join'), {
        [entrypointIri(COMPACT_GATHER_RESULT_DAG_IRI, 'embedded-answer')]: { 'resultField': 'answer' },
        [entrypointIri(COMPACT_GATHER_RESULT_DAG_IRI, 'plain-answer')]: { 'resultField': 'answer' },
      }, { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge-compact' }, {
        'success': placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'end'),
        'error': placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'failed'),
      }, { 'name': 'join' })
      .terminal(placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'failed'), { 'name': 'failed', 'outcome': 'failed' })
      .entrypoints({
        'embedded-answer': placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'invoke'),
        'plain-answer': placementIri(COMPACT_GATHER_RESULT_DAG_IRI, 'pause'),
      })
      .build();

    dispatcher.registerNode(answer);
    dispatcher.registerNode(pause);
    dispatcher.registerNode(merge);
    dispatcher.registerDAG(childDag, () => new ChildState());
    dispatcher.registerDAG(parentDag);

    const partial = await dispatcher.execute(COMPACT_GATHER_RESULT_DAG_IRI, new ParentState(), {
      'signal': controller.signal,
    });

    assert.equal(partial.terminalOutcome, null);
    const rawProgress = partial.state.getMetadata(GATHER_PROGRESS_KEY);
    assert.ok(rawProgress !== undefined, 'gather checkpoint should be present after abort');
    const progress = Validator.gatherProgress.validate(rawProgress);
    const buffered = Object.values(progress.entries).flat();
    const compacted = buffered.find((record) => record.source === entrypointIri(COMPACT_GATHER_RESULT_DAG_IRI, 'embedded-answer'));
    assert.ok(compacted !== undefined, 'embedded producer record should be checkpointed');
    assert.equal(compacted.result, 'forty-two');
    assert.equal('snapshot' in compacted, false, 'projected result record should not retain clone snapshot');

    assert.ok(partial.cursor !== null);
    const resumed = await dispatcher.resume(COMPACT_GATHER_RESULT_DAG_IRI, partial.state, partial.cursor);

    assert.equal(resumed.terminalOutcome, 'completed');
    assert.deepEqual(partial.state.seenSources, [
      entrypointIri(COMPACT_GATHER_RESULT_DAG_IRI, 'embedded-answer'),
      entrypointIri(COMPACT_GATHER_RESULT_DAG_IRI, 'plain-answer'),
    ]);
    assert.deepEqual(partial.state.seenResults, ['forty-two', null]);
    assert.equal(partial.state.getMetadata(GATHER_PROGRESS_KEY), undefined);
  });

  void it('gather checkpoint retains snapshots for built-in reducers that read clone state', async () => {
    class ChildState extends NodeStateBase {
      static readonly FIELDS = { 'answer': 'string' } as const;

      answer = '';

      protected override snapshotData(): JsonObjectType {
        return NodeStateBase.snapshotFields(this, ChildState.FIELDS);
      }

      protected override restoreData(snapshot: JsonObjectType): void {
        NodeStateBase.restoreFields(this, snapshot, ChildState.FIELDS);
      }
    }
    class ParentState extends NodeStateBase {
      answers: unknown[] = [];
    }

    const controller = new AbortController();
    const dispatcher = new Dagonizer<ParentState>();
    const answer = TestNode.make<ChildState>('urn:noocodec:node:answer-retained', ['success'], (state) => {
      state.answer = 'forty-two';
      return 'success';
    });
    const pause = TestNode.make<ParentState>('urn:noocodec:node:pause-retained', ['success'], () => {
      controller.abort();
      return 'success';
    });

    const childDag = new DAGBuilder(RETAINED_CHILD_ANSWER_DAG_IRI, '1', { 'name': 'retained-child-answer' })
      .node(placementIri(RETAINED_CHILD_ANSWER_DAG_IRI, 'answer'), answer, { 'success': placementIri(RETAINED_CHILD_ANSWER_DAG_IRI, 'done') }, { 'name': 'answer' })
      .terminal(placementIri(RETAINED_CHILD_ANSWER_DAG_IRI, 'done'), { 'name': 'done' })
      .build();

    const parentDag = new DAGBuilder(RETAINED_GATHER_RESULT_DAG_IRI, '1', { 'name': 'retained-gather-result' })
      .embed<ChildState, ParentState>(placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'invoke'), RETAINED_CHILD_ANSWER_DAG_IRI, {
        'success': placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'join'),
        'error': placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'join'),
      }, {
        'gatherResult': { 'resultField': 'answer' },
        'name': 'invoke',
      })
      .node(placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'pause'), pause, { 'success': placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'join') }, { 'name': 'pause' })
      .gather(placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'join'), {
        [entrypointIri(RETAINED_GATHER_RESULT_DAG_IRI, 'embedded-answer')]: { 'resultField': 'answer' },
        [entrypointIri(RETAINED_GATHER_RESULT_DAG_IRI, 'plain-answer')]: { 'resultField': 'answer' },
      }, {
        'strategy': 'append',
        'target':   'answers',
        'field':    'answer',
      }, {
        'success': placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'end'),
        'error': placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'failed'),
      }, { 'name': 'join' })
      .terminal(placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'failed'), { 'name': 'failed', 'outcome': 'failed' })
      .entrypoints({
        'embedded-answer': placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'invoke'),
        'plain-answer': placementIri(RETAINED_GATHER_RESULT_DAG_IRI, 'pause'),
      })
      .build();

    dispatcher.registerNode(answer);
    dispatcher.registerNode(pause);
    dispatcher.registerDAG(childDag, () => new ChildState());
    dispatcher.registerDAG(parentDag);

    const partial = await dispatcher.execute(RETAINED_GATHER_RESULT_DAG_IRI, new ParentState(), {
      'signal': controller.signal,
    });

    const rawProgress = partial.state.getMetadata(GATHER_PROGRESS_KEY);
    assert.ok(rawProgress !== undefined, 'gather checkpoint should be present after abort');
    const progress = Validator.gatherProgress.validate(rawProgress);
    const buffered = Object.values(progress.entries).flat();
    const retained = buffered.find((record) => record.source === entrypointIri(RETAINED_GATHER_RESULT_DAG_IRI, 'embedded-answer'));
    assert.ok(retained !== undefined, 'embedded producer record should be checkpointed');
    assert.equal(retained.result, 'forty-two');
    assert.equal('snapshot' in retained, true, 'built-in reducers need clone state for resume');

    assert.ok(partial.cursor !== null);
    const resumed = await dispatcher.resume(RETAINED_GATHER_RESULT_DAG_IRI, partial.state, partial.cursor);

    assert.equal(resumed.terminalOutcome, 'completed');
    assert.ok(partial.state.answers.includes('forty-two'));
    assert.equal(partial.state.getMetadata(GATHER_PROGRESS_KEY), undefined);
  });

  void it('resume preserves entrypoint source labels that differ from placement names', async () => {
    class MultiEntryState extends NodeStateBase {
      seenSources: string[] = [];
    }

    const controller = new AbortController();
    const dispatcher = new Dagonizer<MultiEntryState>();
    const left = TestNode.make<MultiEntryState>('urn:noocodec:node:left-source-node', ['success'], () => {
      controller.abort();
      return 'success';
    });
    const right = TestNode.make<MultiEntryState>('urn:noocodec:node:right-source-node', ['success']);
    const merge = TestNode.make<MultiEntryState>('urn:noocodec:node:merge-source-labels', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenSources = records.map((record) => String(record['source'])).sort();
      return 'success';
    });

    dispatcher.registerNode(left);
    dispatcher.registerNode(right);
    dispatcher.registerNode(merge);

    const dag = new DAGBuilder(SOURCE_LABEL_RESUME_DAG_IRI, '1', { 'name': 'source-label-resume' })
      .node(placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'left-node'), left, { 'success': placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'join') }, { 'name': 'left-node' })
      .node(placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'right-node'), right, { 'success': placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'join') }, { 'name': 'right-node' })
      .gather(placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'join'), {
        [entrypointIri(SOURCE_LABEL_RESUME_DAG_IRI, 'left-label')]: {},
        [entrypointIri(SOURCE_LABEL_RESUME_DAG_IRI, 'right-label')]: {},
      }, { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge-source-labels' }, {
        'success': placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'end'),
        'error': placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'failed'),
      }, { 'name': 'join' })
      .terminal(placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'failed'), { 'name': 'failed', 'outcome': 'failed' })
      .entrypoints({
        'left-label': placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'left-node'),
        'right-label': placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'right-node'),
      })
      .build();
    dispatcher.registerDAG(dag);

    const partial = await dispatcher.execute(SOURCE_LABEL_RESUME_DAG_IRI, new MultiEntryState(), {
      'signal': controller.signal,
    });

    assert.equal(partial.terminalOutcome, null);
    assert.equal(partial.cursor, placementIri(SOURCE_LABEL_RESUME_DAG_IRI, 'right-node'));
    assert.ok(partial.state.getMetadata(GATHER_PROGRESS_KEY));

    assert.ok(partial.cursor !== null);
    const resumed = await dispatcher.resume(SOURCE_LABEL_RESUME_DAG_IRI, partial.state, partial.cursor);

    assert.equal(resumed.terminalOutcome, 'completed');
    assert.deepEqual(partial.state.seenSources, [
      entrypointIri(SOURCE_LABEL_RESUME_DAG_IRI, 'left-label'),
      entrypointIri(SOURCE_LABEL_RESUME_DAG_IRI, 'right-label'),
    ]);
  });

  void it('first-class gather joins embedded and scatter producers', async () => {
    class ChildState extends NodeStateBase {
      answer = '';
    }
    class ParentState extends NodeStateBase {
      items = [1, 2, 3];
      seenSources: string[] = [];
      seenOutputs: string[] = [];
    }

    const dispatcher = new Dagonizer<ParentState>();
    const answer = TestNode.make<ChildState>('urn:noocodec:node:answer-mixed', ['success'], (state) => {
      state.answer = 'embedded-ready';
      return 'success';
    });
    const classify = TestNode.make<ParentState>('urn:noocodec:node:classify-mixed', ['success'], () => 'success');
    const merge = TestNode.make<ParentState>('urn:noocodec:node:merge-mixed', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      const records = Array.isArray(raw) ? raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
      state.seenSources = [...new Set(records.map((record) => String(record['source'])))].sort();
      state.seenOutputs = [...new Set(records.map((record) => String(record['output'])))].sort();
      return 'success';
    });

    const childDag = new DAGBuilder(MIXED_CHILD_ANSWER_DAG_IRI, '1', { 'name': 'mixed-child-answer' })
      .node(placementIri(MIXED_CHILD_ANSWER_DAG_IRI, 'answer'), answer, { 'success': placementIri(MIXED_CHILD_ANSWER_DAG_IRI, 'done') }, { 'name': 'answer' })
      .terminal(placementIri(MIXED_CHILD_ANSWER_DAG_IRI, 'done'), { 'name': 'done' })
      .build();

    const parentDag = new DAGBuilder(MIXED_PRODUCER_GATHER_DAG_IRI, '1', { 'name': 'mixed-producer-gather' })
      .embed<ChildState, ParentState>(placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'invoke'), MIXED_CHILD_ANSWER_DAG_IRI, {
        'success': placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'join'),
        'error': placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'join'),
      }, {
        'gatherResult': { 'resultField': 'answer' },
        'name': 'invoke',
      })
      .scatter(placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'fan'), 'items', classify, {
        'all-success': placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'join'),
        'partial':     placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'join'),
        'all-error':   placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'join'),
        'empty':       placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'join'),
      }, { 'name': 'fan' })
      .gather(placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'join'), {
        [entrypointIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'embedded')]: { 'resultField': 'answer' },
        [entrypointIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'scatter')]: {},
      }, { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge-mixed' }, {
        'success': placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'end'),
        'error': placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'failed'),
      }, { 'name': 'join' })
      .terminal(placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'failed'), { 'name': 'failed', 'outcome': 'failed' })
      .entrypoints({
        'embedded': placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'invoke'),
        'scatter': placementIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'fan'),
      })
      .build();

    dispatcher.registerNode(answer);
    dispatcher.registerNode(classify);
    dispatcher.registerNode(merge);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new ParentState();
    const result = await dispatcher.execute(MIXED_PRODUCER_GATHER_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(state.seenSources, [
      entrypointIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'embedded'),
      entrypointIri(MIXED_PRODUCER_GATHER_DAG_IRI, 'scatter'),
    ]);
    assert.deepEqual(state.seenOutputs, ['success']);
  });

  void it('partition routes items by output into distinct target paths', async () => {
    class PartitionState extends NodeStateBase {
      items: number[] = [];
      evens: number[] = [];
      odds: number[] = [];
    }
    const dispatcher = new Dagonizer<NodeStateBase>();
    const classify = TestNode.make<NodeStateBase>('urn:noocodec:node:classify', ['even', 'odd'], (state) => {
      const n = state.getter.number('item');
      return n % 2 === 0 ? 'even' : 'odd';
    });
    dispatcher.registerNode(classify);

    const dag = new DAGBuilder(PARTITION_DAG_IRI, '1', { 'name': 'partition' })
      .scatter(
        placementIri(PARTITION_DAG_IRI, 'fan'),
        'items',
        classify,
        {
          'all-success': placementIri(PARTITION_DAG_IRI, 'join'),
          'partial':     placementIri(PARTITION_DAG_IRI, 'join'),
          'all-error':   placementIri(PARTITION_DAG_IRI, 'join'),
          'empty':       placementIri(PARTITION_DAG_IRI, 'end'),
        },
        {
          'itemKey': 'item',
          'name':    'fan',
        },
      )
      .gather(placementIri(PARTITION_DAG_IRI, 'join'), { [placementIri(PARTITION_DAG_IRI, 'fan')]: {} }, { 'strategy': 'partition', 'partitions': { 'even': 'evens', 'odd': 'odds' } }, {
        'success': placementIri(PARTITION_DAG_IRI, 'end'),
        'error':   placementIri(PARTITION_DAG_IRI, 'end'),
        'empty':   placementIri(PARTITION_DAG_IRI, 'end'),
      }, { 'name': 'join' })
      .terminal(placementIri(PARTITION_DAG_IRI, 'end'), { 'name': 'end' })
      .build();
    dispatcher.registerDAG(dag);

    const state = new PartitionState();
    state.items = [1, 2, 3, 4, 5];
    state.evens = [];
    state.odds  = [];
    await dispatcher.execute(PARTITION_DAG_IRI, state);
    assert.deepEqual(state.evens.sort(), [2, 4]);
    assert.deepEqual(state.odds.sort(), [1, 3, 5]);
  });

  void it('custom invokes a custom node with gatherResults metadata', async () => {
    interface GatherResultRecord {
      source: string;
      index: number | null;
      item: unknown;
      output: string;
      terminalOutcome: 'completed' | 'failed' | null;
      result: unknown;
    }

    class GatherResultRecordGuard {
      private constructor() {}
      static isArray(v: unknown): v is GatherResultRecord[] {
        if (!Array.isArray(v)) return false;
        return v.every((entry) => {
          if (typeof entry !== 'object' || entry === null) return false;
          return 'item' in entry && 'output' in entry;
        });
      }
    }

    let seenResults: GatherResultRecord[] | undefined;

    class CustomFanState extends NodeStateBase {
      items: number[] = [];
      doubled = 0;
    }

    const dispatcher = new Dagonizer<CustomFanState>();
    const cls = TestNode.make<CustomFanState>('urn:noocodec:node:classify', ['success'], (state) => {
      const item = state.getMetadata('item');
      state.doubled = typeof item === 'number' ? item * 2 : 0;
      return 'success';
    });
    const merge = TestNode.make<CustomFanState>('urn:noocodec:node:merge', ['success'], (state) => {
      const raw = state.getMetadata('gatherResults');
      seenResults = GatherResultRecordGuard.isArray(raw) ? raw : undefined;
      return 'success';
    });
    dispatcher.registerNode(cls);
    dispatcher.registerNode(merge);

    const dag = new DAGBuilder(CUSTOM_FAN_DAG_IRI, '1', { 'name': 'customfan' })
      .scatter(
        placementIri(CUSTOM_FAN_DAG_IRI, 'fan'),
        'items',
        cls,
        {
          'all-success': placementIri(CUSTOM_FAN_DAG_IRI, 'join'),
          'partial':     placementIri(CUSTOM_FAN_DAG_IRI, 'join'),
          'all-error':   placementIri(CUSTOM_FAN_DAG_IRI, 'join'),
          'empty':       placementIri(CUSTOM_FAN_DAG_IRI, 'end'),
        },
        {
          'itemKey': 'item',
          'name':    'fan',
        },
      )
      .gather(placementIri(CUSTOM_FAN_DAG_IRI, 'join'), { [placementIri(CUSTOM_FAN_DAG_IRI, 'fan')]: { 'resultField': 'doubled' } }, { 'strategy': 'custom', 'customNode': 'urn:noocodec:node:merge' }, {
        'success': placementIri(CUSTOM_FAN_DAG_IRI, 'end'),
        'error':   placementIri(CUSTOM_FAN_DAG_IRI, 'end'),
        'empty':   placementIri(CUSTOM_FAN_DAG_IRI, 'end'),
      }, { 'name': 'join' })
      .terminal(placementIri(CUSTOM_FAN_DAG_IRI, 'end'), { 'name': 'end' })
      .build();
    dispatcher.registerDAG(dag);

    const state = new CustomFanState();
    state.items = [1, 2, 3];
    await dispatcher.execute(CUSTOM_FAN_DAG_IRI, state);

    assert.ok(seenResults !== undefined);
    assert.equal(seenResults?.length, 3);
    // gatherResults carries producer metadata plus the projected result.
    const items = seenResults?.map((r) => r.item).sort((a, b) => Number(a) - Number(b));
    assert.deepEqual(items, [1, 2, 3]);
    assert.ok(seenResults?.every((r) => r.output === 'success'));
    assert.ok(seenResults?.every((r) => r.source === placementIri(CUSTOM_FAN_DAG_IRI, 'fan')));
    assert.deepEqual(
      seenResults?.map((r) => r.result).sort((a, b) => Number(a) - Number(b)),
      [2, 4, 6],
    );
  });

  void it('append gathers clone items into a target array in source-index order', async () => {
    class AppendState extends NodeStateBase { items: number[] = []; out: number[] = []; }

    const dispatcher = new Dagonizer<NodeStateBase>();
    const passThrough = TestNode.make('urn:noocodec:node:passThrough', ['success']);
    dispatcher.registerNode(passThrough);

    const dag = new DAGBuilder(APPEND_FAN_DAG_IRI, '1', { 'name': 'appendfan' })
      .scatter(
        placementIri(APPEND_FAN_DAG_IRI, 'fan'),
        'items',
        passThrough,
        {
          'all-success': placementIri(APPEND_FAN_DAG_IRI, 'join'),
          'partial':     placementIri(APPEND_FAN_DAG_IRI, 'join'),
          'all-error':   placementIri(APPEND_FAN_DAG_IRI, 'join'),
          'empty':       placementIri(APPEND_FAN_DAG_IRI, 'end'),
        },
        {
          'itemKey': 'item',
          'name':    'fan',
        },
      )
      .gather(placementIri(APPEND_FAN_DAG_IRI, 'join'), { [placementIri(APPEND_FAN_DAG_IRI, 'fan')]: {} }, { 'strategy': 'append', 'target': 'out' }, {
        'success': placementIri(APPEND_FAN_DAG_IRI, 'end'),
        'error':   placementIri(APPEND_FAN_DAG_IRI, 'end'),
        'empty':   placementIri(APPEND_FAN_DAG_IRI, 'end'),
      }, { 'name': 'join' })
      .terminal(placementIri(APPEND_FAN_DAG_IRI, 'end'), { 'name': 'end' })
      .build();
    dispatcher.registerDAG(dag);

    const state = new AppendState();
    state.items = [10, 20, 30];
    state.out   = [];
    await dispatcher.execute(APPEND_FAN_DAG_IRI, state);
    // append with no `field` uses the source item; order follows source index
    assert.deepEqual([...state.out].sort((a, b) => a - b), [10, 20, 30]);
    assert.equal(state.out.length, 3);
  });

  void it('map gather strategy writes clone field to parent as an array (incremental gather)', async () => {
    // With incremental gather, map strategy always appends to an array — even for
    // a single-item source. Cardinality is not known up front in streaming mode,
    // so the target is always an array. This is the documented behavior change
    // introduced with native streaming scatter (§A.3.4).
    const dispatcher = new Dagonizer<NodeStateBase>();
    const produce = TestNode.make('urn:noocodec:node:produce', ['success'], (state) => {
      state.setMetadata('answer', 'hello');
      return 'success';
    });
    dispatcher.registerNode(produce);

    // Single-item source scatter + map strategy: reads cloneState metadata
    // via dotted path accessor; use a plain top-level key written via setMetadata
    // that is accessible as a metadata field directly via cloneState.
    // The accessor reads dotted paths off the state object itself; metadata is
    // stored under the 'metadata' property on NodeStateBase.
    const dag = new DAGBuilder(MAP_FAN_DAG_IRI, '1', { 'name': 'mapfan' })
      .scatter(
        placementIri(MAP_FAN_DAG_IRI, 'fan'),
        'items',
        produce,
        {
          'all-success': placementIri(MAP_FAN_DAG_IRI, 'join'),
          'partial':     placementIri(MAP_FAN_DAG_IRI, 'join'),
          'all-error':   placementIri(MAP_FAN_DAG_IRI, 'join'),
          'empty':       placementIri(MAP_FAN_DAG_IRI, 'end'),
        },
        {
          'itemKey': 'item',
          'name':    'fan',
        },
      )
      .gather(placementIri(MAP_FAN_DAG_IRI, 'join'), { [placementIri(MAP_FAN_DAG_IRI, 'fan')]: {} }, { 'strategy': 'map', 'mapping': { 'metadata.answer': 'metadata.result' } }, {
        'success': placementIri(MAP_FAN_DAG_IRI, 'end'),
        'error':   placementIri(MAP_FAN_DAG_IRI, 'end'),
        'empty':   placementIri(MAP_FAN_DAG_IRI, 'end'),
      }, { 'name': 'join' })
      .terminal(placementIri(MAP_FAN_DAG_IRI, 'end'), { 'name': 'end' })
      .build();
    dispatcher.registerDAG(dag);

    class MapFanState extends NodeStateBase { items: number[] = []; }
    const state = new MapFanState();
    state.items = [1];
    await dispatcher.execute(MAP_FAN_DAG_IRI, state);
    // Incremental gather always produces an array; single-item → ['hello'].
    assert.deepEqual(state.getMetadata('result'), ['hello']);
  });

  void it('scatter respects concurrency cap', async () => {
    class ConcState extends NodeStateBase { items: number[] = []; out: number[] = []; }
    let inFlight = 0;
    let peak = 0;
    const dispatcher = new Dagonizer<NodeStateBase>();
    const slow = TestNode.make('urn:noocodec:node:slow', ['success'], async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((r) => setImmediate(r));
      inFlight--;
      return 'success';
    });
    dispatcher.registerNode(slow);

    const dag = new DAGBuilder(CONC_DAG_IRI, '1', { 'name': 'conc' })
      .scatter(
        placementIri(CONC_DAG_IRI, 'fan'),
        'items',
        slow,
        {
          'all-success': placementIri(CONC_DAG_IRI, 'end'),
          'partial':     placementIri(CONC_DAG_IRI, 'end'),
          'all-error':   placementIri(CONC_DAG_IRI, 'end'),
          'empty':       placementIri(CONC_DAG_IRI, 'end'),
        },
        {
          'execution': { 'mode': 'item', 'concurrency': 2 },
          'name':      'fan',
        },
      )
      .terminal(placementIri(CONC_DAG_IRI, 'end'), { 'name': 'end' })
      .build();
    dispatcher.registerDAG(dag);

    const state = new ConcState();
    state.items = [1, 2, 3, 4, 5, 6];
    state.out   = [];
    await dispatcher.execute(CONC_DAG_IRI, state);
    assert.ok(peak <= 2, `expected peak <= 2 but got ${peak}`);
  });
});

void describe('NodeStateBase clone semantics', () => {
  void it('clone copies metadata but resets errors/warnings/lifecycle', () => {
    const state = new NodeStateBase();
    state.setMetadata('foo', { 'bar': 1 });
    state.collectError({
      'code': 'E', 'context': {}, 'message': 'm', 'operation': 'op',
      'recoverable': false, 'timestamp': new Date().toISOString(),
    });
    state.markRunning();

    const clone = state.clone();
    assert.deepEqual(clone.getMetadata('foo'), { 'bar': 1 });
    assert.equal(clone.errors.length, 0);
    assert.equal(clone.lifecycle.variant, 'pending');
  });
});
