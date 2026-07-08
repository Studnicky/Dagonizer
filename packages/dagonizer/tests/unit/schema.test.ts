import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  NodeInterface,
  NodeOutputSchemaMapType,
  SchemaObjectType,
} from '../../src/contracts/NodeInterface.js';
import { GatherStrategies, GatherStrategy } from '../../src/core/GatherStrategies.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { DAGDocument } from '../../src/dag/DAGDocument.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { DAGErrorPredicate } from '../_support/DAGErrorPredicate.js';
import { TestNode } from '../_support/TestNode.js';

// validDAG: a minimal well-formed DAG — SingleNode routes to an explicit TerminalNode.
const validDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:demo',
  '@type':    'DAG',
  'name': 'demo',
  'version': '1',
  'entrypoints': { 'main': 's' },
  'nodes': [
    { '@id': 'urn:noocodex:dag:demo/node/s', '@type': 'SingleNode',
      'name': 's', 'node': 'op', 'outputs': { 'success': 'done' } },
    { '@id': 'urn:noocodex:dag:demo/node/done', '@type': 'TerminalNode',
      'name': 'done', 'outcome': 'completed' },
  ],
};

class RouteSchemaState extends NodeStateBase {
  name = '';
  score = 0;
}

class RouteSchemaNode<TOutput extends string> extends MonadicNode<RouteSchemaState, TOutput> {
  readonly name: string;
  readonly outputs: readonly [TOutput, ...TOutput[]];
  readonly #inputSchema: SchemaObjectType;
  readonly #outputSchema: Record<TOutput, SchemaObjectType>;

  constructor(
    name: string,
    outputs: readonly [TOutput, ...TOutput[]],
    inputSchema: SchemaObjectType,
    outputSchema: Record<TOutput, SchemaObjectType>,
  ) {
    super();
    this.name = name;
    this.outputs = outputs;
    this.#inputSchema = inputSchema;
    this.#outputSchema = outputSchema;
  }

  override get inputSchema(): SchemaObjectType {
    return this.#inputSchema;
  }

  override get outputSchema(): Record<TOutput, SchemaObjectType> {
    return this.#outputSchema;
  }

  override async execute(
    batch: Batch<RouteSchemaState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<TOutput, RouteSchemaState>> {
    return new Map([[this.outputs[0], batch]]);
  }
}

const literalInputSchema = {
  'type': 'object',
  'required': ['score'],
  'properties': { 'score': { 'type': 'number' } },
} as const satisfies SchemaObjectType;

const literalOutputSchemas = {
  'done': {
    'type': 'object',
    'required': ['accepted'],
    'properties': { 'accepted': { 'type': 'boolean' } },
  },
} as const satisfies NodeOutputSchemaMapType<'done'>;

class LiteralSchemaNode extends MonadicNode<RouteSchemaState, 'done'> {
  override readonly name = 'literal-schema';
  override readonly outputs = ['done'] as const;

  override get inputSchema(): typeof literalInputSchema {
    return literalInputSchema;
  }

  override get outputSchema(): typeof literalOutputSchemas {
    return literalOutputSchemas;
  }

  override async execute(
    batch: Batch<RouteSchemaState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'done', RouteSchemaState>> {
    return new Map([['done', batch]]);
  }
}

class ScoreObjectGatherStrategy extends GatherStrategy {
  override readonly resultSchema = {
    'type': 'object',
    'required': ['value'],
    'properties': { 'value': { 'type': 'number' } },
  } as const satisfies SchemaObjectType;

  constructor(readonly name: string) {
    super();
  }

  reduce(): void {
    // Schema tests validate registration-time contracts; execution is not needed.
  }
}

void describe('Validator.dag', () => {
  void it('accepts a minimal valid DAG', () => {
    assert.equal(Validator.dag.is(validDAG), true);
    assert.deepEqual(Validator.dag.validate(validDAG), validDAG);
  });

  void it('rejects DAG with missing entrypoints field', () => {
    const bad = { ...validDAG };
    Reflect.deleteProperty(bad, 'entrypoints');
    assert.equal(Validator.dag.is(bad), false);
    assert.throws(() => Validator.dag.validate(bad), DAGErrorPredicate.isValidationError);
  });

  void it('rejects DAG with an empty entrypoint label', () => {
    const bad = {
      ...validDAG,
      'entrypoints': { '': 's' },
    };
    assert.equal(Validator.dag.is(bad), false);
    assert.throws(() => Validator.dag.validate(bad), DAGErrorPredicate.isValidationError);
  });

  void it('registry layer rejects first-class gather quorum policies that cannot fire', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const left = TestNode.make<NodeStateBase>('quorum-left', ['success']);
    const right = TestNode.make<NodeStateBase>('quorum-right', ['success']);
    dispatcher.registerNode(left);
    dispatcher.registerNode(right);

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:bad-quorum-policy',
      '@type': 'DAG',
      'name': 'bad-quorum-policy',
      'version': '1',
      'entrypoints': { 'left': 'left', 'right': 'right' },
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:bad-quorum-policy/node/left',
          '@type': 'SingleNode',
          'name': 'left',
          'node': 'quorum-left',
          'outputs': { 'success': 'join' },
        },
        {
          '@id': 'urn:noocodex:dag:bad-quorum-policy/node/right',
          '@type': 'SingleNode',
          'name': 'right',
          'node': 'quorum-right',
          'outputs': { 'success': 'join' },
        },
        {
          '@id': 'urn:noocodex:dag:bad-quorum-policy/node/join',
          '@type': 'GatherNode',
          'name': 'join',
          'sources': ['left', 'right'],
          'gather': { 'strategy': 'discard' },
          'policy': { 'mode': 'quorum', 'quorum': 3 },
          'outputs': { 'success': 'end', 'error': 'failed' },
        },
        { '@id': 'urn:noocodex:dag:bad-quorum-policy/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:bad-quorum-policy/node/failed', '@type': 'TerminalNode', 'name': 'failed', 'outcome': 'failed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /GatherNode 'join': policy\.quorum 3 exceeds source count 2/u,
    );
  });

  void it('rejects a flat DAG missing @context, @id, @type', () => {
    // A flat (non-JSON-LD) DAG must fail schema validation
    const flat = {
      'name': 'x', 'version': '1', 'entrypoints': { 'main': 'start' },
      'nodes': [{ '@id': 'urn:x', '@type': 'SingleNode', 'name': 's', 'node': 'op', 'outputs': {} }],
    };
    assert.throws(() => Validator.dag.validate(flat), DAGErrorPredicate.isValidationError);
  });

  void it('rejects unknown @type on a node placement', () => {
    const bad = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': 'start' },
      'nodes': [{ '@id': 'urn:x', '@type': 'NotANodeType', 'name': 's', 'node': 'op', 'outputs': {} }],
    };
    assert.throws(() => Validator.dag.validate(bad), DAGErrorPredicate.isValidationError);
  });

  void it('rejects a SingleNode whose output value is null', () => {
    const bad: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': 's' },
      'nodes': [{
        '@id': 'urn:x', '@type': 'SingleNode', 'name': 's', 'node': 'op',
        'outputs': { 'success': null },
      }],
    };
    assert.equal(Validator.dag.is(bad), false, 'null route must fail schema validation');
    assert.throws(() => Validator.dag.validate(bad), DAGErrorPredicate.isValidationError);

    // A single null route and multiple null routes both fail schema validation:
    // null is never a valid output target, regardless of how many appear.
    const oneNull: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:test',
      '@type':    'DAG',
      'name':     'test',
      'version':  '1',
      'entrypoints': { 'main': 'start' },
      'nodes': [{
        '@id':   'urn:noocodex:dag:test/node/start',
        '@type': 'SingleNode',
        'name':  'start',
        'node':  'start',
        'outputs': { 'done': null },
      }],
    };
    assert.equal(Validator.dag.is(oneNull), false, 'null output must not satisfy the schema');

    const multiNull: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:test',
      '@type':    'DAG',
      'name':     'test',
      'version':  '1',
      'entrypoints': { 'main': 'start' },
      'nodes': [{
        '@id':   'urn:noocodex:dag:test/node/start',
        '@type': 'SingleNode',
        'name':  'start',
        'node':  'start',
        'outputs': { 'ok': null, 'fail': null },
      }],
    };
    assert.equal(Validator.dag.is(multiNull), false, 'null outputs must not satisfy the schema');
  });

  void it('accepts a scatter node with a custom registered gather strategy name', () => {
    // GatherConfig.strategy is an open string: custom strategies are registered
    // via GatherStrategies.register() and resolved at runtime. The schema does
    // not restrict strategy to a closed enum — unknown names are caught by
    // GatherStrategies.resolve() when the scatter executes, not at author time.
    const doc = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': 'f' },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:x/node/f',
          '@type':  'ScatterNode',
          'name':   'f', 'body': { 'node': 'op' }, 'source': 'items',
          'gather': { 'strategy': 'my-domain-specific-gather' },
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        },
        { '@id': 'urn:noocodex:dag:x/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    assert.doesNotThrow(() => Validator.dag.validate(doc));
  });

  void it('returns formatted errors list without throwing', () => {
    const errs = Validator.dag.errors({});
    assert.ok(Array.isArray(errs));
    assert.ok(errs !== null && errs.length > 0);
  });
});

void describe('DAGDocument.load', () => {
  void it('parses + validates a JSON DAG', () => {
    const json = JSON.stringify(validDAG);
    const parsed = DAGDocument.load(json);
    assert.deepEqual(parsed, validDAG);
  });

  void it('rejects malformed JSON', () => {
    assert.throws(() => DAGDocument.load('{not json'), DAGErrorPredicate.isValidationError);
  });

  void it('rejects schema-noncompliant JSON', () => {
    assert.throws(() => DAGDocument.load('{"name": "x"}'), DAGErrorPredicate.isValidationError);
  });
});

void describe('DAGDocument.serialize round-trip', () => {
  void it('serialize → load yields the original DAG', () => {
    const json = DAGDocument.serialize(validDAG);
    const parsed = DAGDocument.load(json);
    assert.deepEqual(parsed, validDAG);
  });

  void it('serializeCompact omits whitespace', () => {
    const compact = DAGDocument.serializeCompact(validDAG);
    assert.equal(compact.includes('\n'), false);
  });
});

void describe('DAGDocument.ofValue', () => {
  void it('accepts an already-decoded valid DAG', () => {
    const result = DAGDocument.ofValue(validDAG);
    assert.deepEqual(result, validDAG);
  });

  void it('rejects schema-noncompliant value', () => {
    assert.throws(() => DAGDocument.ofValue({ 'name': 'x' }), DAGErrorPredicate.isValidationError);
  });
});

void describe('Dagonizer.registerDAG validation layers', () => {
  void it('preserves literal node schema types through NodeInterface generics', () => {
    const node: NodeInterface<
      RouteSchemaState,
      'done',
      typeof literalInputSchema,
      typeof literalOutputSchemas
    > = new LiteralSchemaNode();

    const requiredField: 'score' = node.inputSchema.required[0];
    assert.equal(requiredField, 'score');
    assert.equal(node.outputSchema.done.required[0], 'accepted');
    // @ts-expect-error: the literal schema contract declares only the done port.
    void node.outputSchema.error;
  });

  void it('leaves schema validation at the DAGDocument ingest boundary', () => {
    const bad = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': '', 'version': '1', 'entrypoints': { 'main': 's' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:x/node/s', '@type': 'SingleNode',
          'name': 's', 'node': 'op', 'outputs': { 'success': 'done' } },
        { '@id': 'urn:noocodex:dag:x/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };

    assert.throws(() => DAGDocument.ofValue(bad), DAGErrorPredicate.isValidationError);
  });

  void it('shape layer rejects entrypoint and route closure errors on hand-built DAGs', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': 'missing' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:x/node/s', '@type': 'SingleNode',
          'name': 's', 'node': 'op', 'outputs': { 'success': 'ghost' } },
        { '@id': 'urn:noocodex:dag:x/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /Entrypoint 'main' targets 'missing' which does not exist in nodes[\s\S]*output 'success' routes to unknown node 'ghost'/u,
    );
  });

  void it('shape layer rejects gather sources that no producer can emit', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'left': 'left' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:x/node/left', '@type': 'SingleNode',
          'name': 'left', 'node': 'op', 'outputs': { 'success': 'join' } },
        { '@id': 'urn:noocodex:dag:x/node/join', '@type': 'GatherNode',
          'name': 'join', 'sources': ['missing-source'], 'gather': { 'strategy': 'discard' },
          'outputs': { 'success': 'done', 'error': 'failed' } },
        { '@id': 'urn:noocodex:dag:x/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:x/node/failed', '@type': 'TerminalNode',
          'name': 'failed', 'outcome': 'failed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /GatherNode 'join': source 'missing-source' is not declared by an entrypoint or producer placement/u,
    );
  });

  void it('schema layer rejects legacy embedded dagFrom before registry lookup', () => {
    const dag: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': 'invoke' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:x/node/invoke', '@type': 'EmbeddedDAGNode',
          'name': 'invoke', 'dag': 'child', 'dagFrom': 'selectedDag',
          'outputs': { 'success': 'done', 'error': 'failed' } },
        { '@id': 'urn:noocodex:dag:x/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:x/node/failed', '@type': 'TerminalNode',
          'name': 'failed', 'outcome': 'failed' },
      ],
    };

    assert.throws(
      () => Validator.dag.validate(dag),
      DAGErrorPredicate.isValidationError,
    );
  });

  void it('registry layer rejects unknown registered node references', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': 's' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:x/node/s', '@type': 'SingleNode',
          'name': 's', 'node': 'ghost', 'outputs': { 'success': 'done' } },
        { '@id': 'urn:noocodex:dag:x/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), /references unknown registered node: ghost/u);
  });

  void it('registry layer rejects missing registered-node output routes', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success', 'error']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': 's' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:x/node/s', '@type': 'SingleNode',
          'name': 's', 'node': 'op', 'outputs': { 'success': 'done' } },
        { '@id': 'urn:noocodex:dag:x/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /registered node 'op' declares output 'error' but no routing is defined/u,
    );
  });

  void it('registry layer accepts compatible routed node schemas', () => {
    const dispatcher = new Dagonizer<RouteSchemaState>();
    dispatcher.registerNode(new RouteSchemaNode('producer', ['success'], { 'type': 'object' }, {
      'success': {
        'type': 'object',
        'required': ['score'],
        'properties': { 'score': { 'type': 'number' } },
      },
    }));
    dispatcher.registerNode(new RouteSchemaNode('consumer', ['done'], {
      'type': 'object',
      'required': ['score'],
      'properties': { 'score': { 'type': 'number' } },
    }, {
      'done': { 'type': 'object' },
    }));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:schema-compatible',
      '@type':    'DAG',
      'name': 'schema-compatible', 'version': '1', 'entrypoints': { 'main': 'produce' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:schema-compatible/node/produce', '@type': 'SingleNode',
          'name': 'produce', 'node': 'producer', 'outputs': { 'success': 'consume' } },
        { '@id': 'urn:noocodex:dag:schema-compatible/node/consume', '@type': 'SingleNode',
          'name': 'consume', 'node': 'consumer', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:schema-compatible/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(dag));
  });

  void it('registry layer rejects incompatible routed node schemas', () => {
    const dispatcher = new Dagonizer<RouteSchemaState>();
    dispatcher.registerNode(new RouteSchemaNode('producer', ['success'], { 'type': 'object' }, {
      'success': {
        'type': 'object',
        'required': ['name'],
        'properties': { 'name': { 'type': 'string' } },
      },
    }));
    dispatcher.registerNode(new RouteSchemaNode('consumer', ['done'], {
      'type': 'object',
      'required': ['score'],
      'properties': { 'score': { 'type': 'number' } },
    }, {
      'done': { 'type': 'object' },
    }));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:schema-incompatible',
      '@type':    'DAG',
      'name': 'schema-incompatible', 'version': '1', 'entrypoints': { 'main': 'produce' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:schema-incompatible/node/produce', '@type': 'SingleNode',
          'name': 'produce', 'node': 'producer', 'outputs': { 'success': 'consume' } },
        { '@id': 'urn:noocodex:dag:schema-incompatible/node/consume', '@type': 'SingleNode',
          'name': 'consume', 'node': 'consumer', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:schema-incompatible/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /Route 'produce\.success' -> 'consume' does not satisfy target input schema: producer does not declare required field 'score'/u,
    );
  });

  void it('registry layer rejects embedded DAG input mappings that omit required child entry fields', () => {
    const dispatcher = new Dagonizer<RouteSchemaState>();
    dispatcher.registerNode(new RouteSchemaNode('child-entry', ['done'], {
      'type': 'object',
      'required': ['score'],
      'properties': { 'score': { 'type': 'number' } },
    }, {
      'done': { 'type': 'object' },
    }));

    const childDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:child-required-input',
      '@type':    'DAG',
      'name': 'child-required-input', 'version': '1', 'entrypoints': { 'main': 'child-entry' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:child-required-input/node/child-entry', '@type': 'SingleNode',
          'name': 'child-entry', 'node': 'child-entry', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:child-required-input/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent-missing-child-input',
      '@type':    'DAG',
      'name': 'parent-missing-child-input', 'version': '1', 'entrypoints': { 'main': 'invoke' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:parent-missing-child-input/node/invoke', '@type': 'EmbeddedDAGNode',
          'name': 'invoke', 'dag': 'child-required-input', 'outputs': { 'success': 'end', 'error': 'end' } },
        { '@id': 'urn:noocodex:dag:parent-missing-child-input/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };

    dispatcher.registerDAG(childDag);

    assert.throws(
      () => dispatcher.registerDAG(parentDag),
      /EmbeddedDAGNode 'invoke' -> child DAG 'child-required-input' entrypoint 'main' does not seed required input field 'score'/u,
    );
  });

  void it('registry layer rejects embedded gatherResult fields not produced by child terminal routes', () => {
    const dispatcher = new Dagonizer<RouteSchemaState>();
    dispatcher.registerNode(new RouteSchemaNode('child-answer', ['done'], { 'type': 'object' }, {
      'done': {
        'type': 'object',
        'required': ['name'],
        'properties': { 'name': { 'type': 'string' } },
      },
    }));

    const childDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:child-answer-output',
      '@type':    'DAG',
      'name': 'child-answer-output', 'version': '1', 'entrypoints': { 'main': 'answer' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:child-answer-output/node/answer', '@type': 'SingleNode',
          'name': 'answer', 'node': 'child-answer', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:child-answer-output/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent-bad-gather-result',
      '@type':    'DAG',
      'name': 'parent-bad-gather-result', 'version': '1', 'entrypoints': { 'main': 'invoke' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:parent-bad-gather-result/node/invoke', '@type': 'EmbeddedDAGNode',
          'name': 'invoke', 'dag': 'child-answer-output', 'gatherResult': { 'resultField': 'score' },
          'outputs': { 'success': 'end', 'error': 'end' } },
        { '@id': 'urn:noocodex:dag:parent-bad-gather-result/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };

    dispatcher.registerDAG(childDag);

    assert.throws(
      () => dispatcher.registerDAG(parentDag),
      /EmbeddedDAGNode 'invoke' gatherResult\.resultField 'score' is not produced by child DAG 'child-answer-output' terminal routes/u,
    );
  });

  void it('registry layer rejects embedded output mappings not produced by child terminal routes', () => {
    const dispatcher = new Dagonizer<RouteSchemaState>();
    dispatcher.registerNode(new RouteSchemaNode('child-output', ['done'], { 'type': 'object' }, {
      'done': {
        'type': 'object',
        'required': ['name'],
        'properties': { 'name': { 'type': 'string' } },
      },
    }));

    const childDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:child-mapped-output',
      '@type':    'DAG',
      'name': 'child-mapped-output', 'version': '1', 'entrypoints': { 'main': 'answer' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:child-mapped-output/node/answer', '@type': 'SingleNode',
          'name': 'answer', 'node': 'child-output', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:child-mapped-output/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent-bad-output-mapping',
      '@type':    'DAG',
      'name': 'parent-bad-output-mapping', 'version': '1', 'entrypoints': { 'main': 'invoke' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:parent-bad-output-mapping/node/invoke', '@type': 'EmbeddedDAGNode',
          'name': 'invoke', 'dag': 'child-mapped-output',
          'stateMapping': { 'output': { 'score': 'score' } },
          'outputs': { 'success': 'end', 'error': 'end' } },
        { '@id': 'urn:noocodex:dag:parent-bad-output-mapping/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };

    dispatcher.registerDAG(childDag);

    assert.throws(
      () => dispatcher.registerDAG(parentDag),
      /EmbeddedDAGNode 'invoke' stateMapping\.output 'score' reads child path 'score' that is not produced by child DAG 'child-mapped-output' terminal routes/u,
    );
  });

  void it('registry layer rejects scatter gather result fields not produced by node body outputs', () => {
    const dispatcher = new Dagonizer<RouteSchemaState>();
    dispatcher.registerNode(new RouteSchemaNode('scatter-body', ['done'], { 'type': 'object' }, {
      'done': {
        'type': 'object',
        'required': ['name'],
        'properties': { 'name': { 'type': 'string' } },
      },
    }));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scatter-bad-result-field',
      '@type':    'DAG',
      'name': 'scatter-bad-result-field', 'version': '1', 'entrypoints': { 'main': 'fan' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:scatter-bad-result-field/node/fan', '@type': 'ScatterNode',
          'name': 'fan', 'source': 'items', 'body': { 'node': 'scatter-body' },
          'gather': { 'strategy': 'discard', 'resultField': 'score' },
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'failed', 'empty': 'end' } },
        { '@id': 'urn:noocodex:dag:scatter-bad-result-field/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:scatter-bad-result-field/node/failed', '@type': 'TerminalNode',
          'name': 'failed', 'outcome': 'failed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /ScatterNode 'fan' gather\.resultField 'score' is not produced by registered node 'scatter-body' output schemas/u,
    );
  });

  void it('registry layer accepts gather strategy result schemas satisfied by first-class gather sources', () => {
    const dispatcher = new Dagonizer<RouteSchemaState>();
    const strategyName = 'score-object-compatible';
    GatherStrategies.register(new ScoreObjectGatherStrategy(strategyName));
    try {
      dispatcher.registerNode(new RouteSchemaNode('score-body', ['done'], { 'type': 'object' }, {
        'done': {
          'type': 'object',
          'required': ['score'],
          'properties': {
            'score': {
              'type': 'object',
              'required': ['value'],
              'properties': { 'value': { 'type': 'number' } },
            },
          },
        },
      }));

      const dag: DAGType = {
        '@context': DAG_CONTEXT,
        '@id':      'urn:noocodex:dag:gather-strategy-compatible',
        '@type':    'DAG',
        'name': 'gather-strategy-compatible', 'version': '1', 'entrypoints': { 'main': 'fan' },
        'nodes': [
          { '@id': 'urn:noocodex:dag:gather-strategy-compatible/node/fan', '@type': 'ScatterNode',
            'name': 'fan', 'source': 'items', 'body': { 'node': 'score-body' },
            'gather': { 'strategy': 'discard', 'resultField': 'score' },
            'outputs': { 'all-success': 'join', 'partial': 'join', 'all-error': 'failed', 'empty': 'join' } },
          { '@id': 'urn:noocodex:dag:gather-strategy-compatible/node/join', '@type': 'GatherNode',
            'name': 'join', 'sources': ['fan'], 'gather': { 'strategy': strategyName },
            'outputs': { 'success': 'end', 'error': 'failed', 'empty': 'end' } },
          { '@id': 'urn:noocodex:dag:gather-strategy-compatible/node/end', '@type': 'TerminalNode',
            'name': 'end', 'outcome': 'completed' },
          { '@id': 'urn:noocodex:dag:gather-strategy-compatible/node/failed', '@type': 'TerminalNode',
            'name': 'failed', 'outcome': 'failed' },
        ],
      };

      assert.doesNotThrow(() => dispatcher.registerDAG(dag));
    } finally {
      GatherStrategies.unregister(strategyName);
    }
  });

  void it('registry layer rejects scatter gather strategy result schemas not satisfied by producer results', () => {
    const dispatcher = new Dagonizer<RouteSchemaState>();
    const strategyName = 'score-object-incompatible';
    GatherStrategies.register(new ScoreObjectGatherStrategy(strategyName));
    try {
      dispatcher.registerNode(new RouteSchemaNode('score-body-bad', ['done'], { 'type': 'object' }, {
        'done': {
          'type': 'object',
          'required': ['score'],
          'properties': {
            'score': {
              'type': 'object',
              'required': ['label'],
              'properties': { 'label': { 'type': 'string' } },
            },
          },
        },
      }));

      const dag: DAGType = {
        '@context': DAG_CONTEXT,
        '@id':      'urn:noocodex:dag:gather-strategy-incompatible',
        '@type':    'DAG',
        'name': 'gather-strategy-incompatible', 'version': '1', 'entrypoints': { 'main': 'fan' },
        'nodes': [
          { '@id': 'urn:noocodex:dag:gather-strategy-incompatible/node/fan', '@type': 'ScatterNode',
            'name': 'fan', 'source': 'items', 'body': { 'node': 'score-body-bad' },
            'gather': { 'strategy': strategyName, 'resultField': 'score' },
            'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'failed', 'empty': 'end' } },
          { '@id': 'urn:noocodex:dag:gather-strategy-incompatible/node/end', '@type': 'TerminalNode',
            'name': 'end', 'outcome': 'completed' },
          { '@id': 'urn:noocodex:dag:gather-strategy-incompatible/node/failed', '@type': 'TerminalNode',
            'name': 'failed', 'outcome': 'failed' },
        ],
      };

      assert.throws(
        () => dispatcher.registerDAG(dag),
        /Gather 'fan' producer result schema does not satisfy strategy 'score-object-incompatible' result schema: producer does not declare required field 'value'/u,
      );
    } finally {
      GatherStrategies.unregister(strategyName);
    }
  });

  void it('registry layer rejects result-schema gather strategies when sources do not declare producer results', () => {
    const dispatcher = new Dagonizer<RouteSchemaState>();
    const strategyName = 'score-object-missing-result';
    GatherStrategies.register(new ScoreObjectGatherStrategy(strategyName));
    try {
      dispatcher.registerNode(new RouteSchemaNode('direct-producer', ['done'], { 'type': 'object' }, {
        'done': {
          'type': 'object',
          'required': ['score'],
          'properties': {
            'score': {
              'type': 'object',
              'required': ['value'],
              'properties': { 'value': { 'type': 'number' } },
            },
          },
        },
      }));

      const dag: DAGType = {
        '@context': DAG_CONTEXT,
        '@id':      'urn:noocodex:dag:gather-strategy-missing-result',
        '@type':    'DAG',
        'name': 'gather-strategy-missing-result', 'version': '1', 'entrypoints': { 'main': 'produce' },
        'nodes': [
          { '@id': 'urn:noocodex:dag:gather-strategy-missing-result/node/produce', '@type': 'SingleNode',
            'name': 'produce', 'node': 'direct-producer', 'outputs': { 'done': 'join' } },
          { '@id': 'urn:noocodex:dag:gather-strategy-missing-result/node/join', '@type': 'GatherNode',
            'name': 'join', 'sources': ['main'], 'gather': { 'strategy': strategyName },
            'outputs': { 'success': 'end', 'error': 'failed', 'empty': 'end' } },
          { '@id': 'urn:noocodex:dag:gather-strategy-missing-result/node/end', '@type': 'TerminalNode',
            'name': 'end', 'outcome': 'completed' },
          { '@id': 'urn:noocodex:dag:gather-strategy-missing-result/node/failed', '@type': 'TerminalNode',
            'name': 'failed', 'outcome': 'failed' },
        ],
      };

      assert.throws(
        () => dispatcher.registerDAG(dag),
        /Gather 'join' strategy 'score-object-missing-result' declares resultSchema but source 'main' does not declare a producer result schema/u,
      );
    } finally {
      GatherStrategies.unregister(strategyName);
    }
  });

  void it('registry layer does not reject routed schemas whose compatibility is unknown', () => {
    const dispatcher = new Dagonizer<RouteSchemaState>();
    dispatcher.registerNode(new RouteSchemaNode('producer', ['success'], { 'type': 'object' }, {
      'success': {
        'oneOf': [
          {
            'type': 'object',
            'required': ['score'],
            'properties': { 'score': { 'type': 'number' } },
          },
        ],
      },
    }));
    dispatcher.registerNode(new RouteSchemaNode('consumer', ['done'], {
      'type': 'object',
      'required': ['score'],
      'properties': { 'score': { 'type': 'number' } },
    }, {
      'done': { 'type': 'object' },
    }));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:schema-unknown',
      '@type':    'DAG',
      'name': 'schema-unknown', 'version': '1', 'entrypoints': { 'main': 'produce' },
      'nodes': [
        { '@id': 'urn:noocodex:dag:schema-unknown/node/produce', '@type': 'SingleNode',
          'name': 'produce', 'node': 'producer', 'outputs': { 'success': 'consume' } },
        { '@id': 'urn:noocodex:dag:schema-unknown/node/consume', '@type': 'SingleNode',
          'name': 'consume', 'node': 'consumer', 'outputs': { 'done': 'end' } },
        { '@id': 'urn:noocodex:dag:schema-unknown/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(dag));
  });
});
