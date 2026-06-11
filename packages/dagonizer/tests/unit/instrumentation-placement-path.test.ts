import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// ── Recording Dagonizer subclass ─────────────────────────────────────────
//
// Captures every `(nodeName, placementPath)` pair the dispatcher emits on
// `onNodeStart` / `onNodeEnd`. The test asserts on the path shape:
//   • top-level placements              → `[]`
//   • inner placement inside one embed  → `['<parent-placement>']`
//   • inner placement two levels deep   → `['<outer>', '<inner-parent>']`

interface PathCall {
  readonly hook: 'nodeStart' | 'nodeEnd';
  readonly nodeName: string;
  readonly placementPath: readonly string[];
}

class PathRecordingDagonizer extends Dagonizer<NodeStateBase> {
  readonly calls: PathCall[] = [];

  protected override onNodeStart(nodeName: string, _state: NodeStateBase, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'nodeStart', nodeName, 'placementPath': [...placementPath] });
  }
  protected override onNodeEnd(nodeName: string, _output: string | null, _state: NodeStateBase, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'nodeEnd', nodeName, 'placementPath': [...placementPath] });
  }

  pathsFor(hook: 'nodeStart' | 'nodeEnd', nodeName: string): readonly (readonly string[])[] {
    return this.calls
      .filter((c) => c.hook === hook && c.nodeName === nodeName)
      .map((c) => c.placementPath);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

const makeNode = (
  name: string,
  outputs: readonly string[],
): NodeInterface<NodeStateBase> => ({
  name,
  outputs,
  async execute() { return { 'errors': [], 'output': outputs[0] as string }; },
});

// ── DAG fixtures ─────────────────────────────────────────────────────────
//
// Innermost DAG: used as the inner placement inside `middleDAG`.
const leafDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':   'urn:noocodex:dag:pp-leaf',
  '@type': 'DAG',
  'name': 'pp-leaf',
  'version': '1',
  'entrypoint': 'leaf-step',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:pp-leaf/node/leaf-step',
      '@type': 'SingleNode',
      'name':  'leaf-step',
      'node':  'leaf-step',
      'outputs': { 'done': 'end' },
    },
    { '@id': 'urn:noocodex:dag:pp-leaf/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// Middle DAG: wraps `leafDAG` so the leaf runs at depth 2 inside the parent.
const middleDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':   'urn:noocodex:dag:pp-middle',
  '@type': 'DAG',
  'name': 'pp-middle',
  'version': '1',
  'entrypoint': 'middle-step',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:pp-middle/node/middle-step',
      '@type': 'SingleNode',
      'name':  'middle-step',
      'node':  'middle-step',
      'outputs': { 'next': 'run-leaf' },
    },
    {
      '@id':   'urn:noocodex:dag:pp-middle/node/run-leaf',
      '@type': 'EmbeddedDAGNode',
      'name':  'run-leaf',
      'dag':   'pp-leaf',
      'outputs': { 'success': 'end', 'error': 'end' },
    },
    { '@id': 'urn:noocodex:dag:pp-middle/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// Parent DAG: top-level placement, then one embedded-DAG (which itself
// nests another embedded-DAG). Used to assert empty / one-deep / two-deep
// paths in a single execution.
const parentDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':   'urn:noocodex:dag:pp-parent',
  '@type': 'DAG',
  'name': 'pp-parent',
  'version': '1',
  'entrypoint': 'top-step',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:pp-parent/node/top-step',
      '@type': 'SingleNode',
      'name':  'top-step',
      'node':  'top-step',
      'outputs': { 'next': 'run-middle' },
    },
    {
      '@id':   'urn:noocodex:dag:pp-parent/node/run-middle',
      '@type': 'EmbeddedDAGNode',
      'name':  'run-middle',
      'dag':   'pp-middle',
      'outputs': { 'success': 'end', 'error': 'end' },
    },
    { '@id': 'urn:noocodex:dag:pp-parent/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// ── Tests ────────────────────────────────────────────────────────────────

void describe('Dagonizer placementPath threading', () => {
  void it('emits empty path for top-level nodes, single-element path for one-deep, full path for two-deep', async () => {
    const dispatcher = new PathRecordingDagonizer();

    dispatcher.registerNode(makeNode('top-step',    ['next']));
    dispatcher.registerNode(makeNode('middle-step', ['next']));
    dispatcher.registerNode(makeNode('leaf-step',   ['done']));

    dispatcher.registerDAG(leafDAG);
    dispatcher.registerDAG(middleDAG);
    dispatcher.registerDAG(parentDAG);

    const result = await dispatcher.execute('pp-parent', new NodeStateBase());
    assert.equal(result.state.lifecycle.kind, 'completed');

    // top-step ran at the root of pp-parent: path is empty
    assert.deepEqual(
      dispatcher.pathsFor('nodeStart', 'top-step'),
      [[]],
      'top-step fires onNodeStart with empty placementPath',
    );
    assert.deepEqual(
      dispatcher.pathsFor('nodeEnd', 'top-step'),
      [[]],
      'top-step fires onNodeEnd with empty placementPath',
    );

    // run-middle is the embedded-DAG placement in pp-parent; its own
    // onNodeStart fires at the parent level so it too carries an empty path.
    assert.deepEqual(
      dispatcher.pathsFor('nodeStart', 'run-middle'),
      [[]],
      'run-middle (top-level placement) carries empty path',
    );

    // middle-step runs inside the run-middle placement: path is ['run-middle']
    assert.deepEqual(
      dispatcher.pathsFor('nodeStart', 'middle-step'),
      [['run-middle']],
      'middle-step carries one-deep placementPath',
    );

    // leaf-step lives inside run-leaf inside run-middle: full ancestry.
    assert.deepEqual(
      dispatcher.pathsFor('nodeStart', 'leaf-step'),
      [['run-middle', 'run-leaf']],
      'leaf-step carries the full two-deep placementPath',
    );
    assert.deepEqual(
      dispatcher.pathsFor('nodeEnd', 'leaf-step'),
      [['run-middle', 'run-leaf']],
      'leaf-step onNodeEnd matches the same two-deep path',
    );
  });

  void it('emits distinct placement paths for two embed placements pointing at the same inner DAG', async () => {
    // Mirrors the Archivist case: two embedded-DAG placements point at the
    // SAME inner DAG. The inner node fires twice, once per outer placement,
    // and each fire must carry its OWN outer name as the path so the
    // visualiser can disambiguate same-named inner nodes.

    const innerDAG: DAG = {
      '@context': DAG_CONTEXT,
      '@id':   'urn:noocodex:dag:pp-shared-inner',
      '@type': 'DAG',
      'name': 'pp-shared-inner',
      'version': '1',
      'entrypoint': 'inner-step',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:pp-shared-inner/node/inner-step',
          '@type': 'SingleNode',
          'name':  'inner-step',
          'node':  'inner-step',
          'outputs': { 'done': 'end' },
        },
        { '@id': 'urn:noocodex:dag:pp-shared-inner/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    const twoInstancesDAG: DAG = {
      '@context': DAG_CONTEXT,
      '@id':   'urn:noocodex:dag:pp-two-instances',
      '@type': 'DAG',
      'name': 'pp-two-instances',
      'version': '1',
      'entrypoint': 'first-embed',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:pp-two-instances/node/first-embed',
          '@type': 'EmbeddedDAGNode',
          'name':  'first-embed',
          'dag':   'pp-shared-inner',
          'outputs': { 'success': 'second-embed', 'error': 'second-embed' },
        },
        {
          '@id':   'urn:noocodex:dag:pp-two-instances/node/second-embed',
          '@type': 'EmbeddedDAGNode',
          'name':  'second-embed',
          'dag':   'pp-shared-inner',
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        { '@id': 'urn:noocodex:dag:pp-two-instances/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    const dispatcher = new PathRecordingDagonizer();

    dispatcher.registerNode(makeNode('inner-step', ['done']));
    dispatcher.registerDAG(innerDAG);
    dispatcher.registerDAG(twoInstancesDAG);

    await dispatcher.execute('pp-two-instances', new NodeStateBase());

    // inner-step fires once under `first-embed` and once under
    // `second-embed`. The path discriminates the two instances.
    const innerPaths = dispatcher.pathsFor('nodeStart', 'inner-step');
    assert.equal(innerPaths.length, 2, 'inner-step fires once per outer placement');
    assert.deepEqual(innerPaths[0], ['first-embed']);
    assert.deepEqual(innerPaths[1], ['second-embed']);
  });
});
