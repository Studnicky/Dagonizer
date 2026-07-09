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
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

const placementIri = TestDag.placementIri;

// validDAG: a minimal well-formed DAG — SingleNode routes to an explicit TerminalNode.
const validDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:demo',
  '@type':    'DAG',
  'name': 'demo',
  'version': '1',
  'entrypoints': { 'main': placementIri('urn:noocodex:dag:demo', 's') },
  'nodes': [
    { '@id': placementIri('urn:noocodex:dag:demo', 's'), '@type': 'SingleNode',
      'name': 's', 'node': 'urn:noocodec:node:op', 'outputs': { 'success': placementIri('urn:noocodex:dag:demo', 'done') } },
    { '@id': placementIri('urn:noocodex:dag:demo', 'done'), '@type': 'TerminalNode',
      'name': 'done', 'outcome': 'completed' },
  ],
};

class RouteSchemaState extends NodeStateBase {
  name = '';
  score = 0;
}

class RouteSchemaNode<TOutput extends string> extends MonadicNode<RouteSchemaState, TOutput> {
  readonly '@id': string;
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
    this['@id'] = `urn:noocodec:node:${encodeURIComponent(name)}`;
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
  override readonly '@id' = 'urn:noocodec:node:literal-schema';
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
    const left = TestNode.make<NodeStateBase>('urn:noocodec:node:quorum-left', ['success']);
    const right = TestNode.make<NodeStateBase>('urn:noocodec:node:quorum-right', ['success']);
    dispatcher.registerNode(left);
    dispatcher.registerNode(right);

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:bad-quorum-policy',
      '@type': 'DAG',
      'name': 'bad-quorum-policy',
      'version': '1',
      'entrypoints': {
        'left': placementIri('urn:noocodex:dag:bad-quorum-policy', 'left'),
        'right': placementIri('urn:noocodex:dag:bad-quorum-policy', 'right'),
      },
      'nodes': [
        {
          '@id': placementIri('urn:noocodex:dag:bad-quorum-policy', 'left'),
          '@type': 'SingleNode',
          'name': 'left',
          'node': 'urn:noocodec:node:quorum-left',
          'outputs': { 'success': placementIri('urn:noocodex:dag:bad-quorum-policy', 'join') },
        },
        {
          '@id': placementIri('urn:noocodex:dag:bad-quorum-policy', 'right'),
          '@type': 'SingleNode',
          'name': 'right',
          'node': 'urn:noocodec:node:quorum-right',
          'outputs': { 'success': placementIri('urn:noocodex:dag:bad-quorum-policy', 'join') },
        },
        {
          '@id': placementIri('urn:noocodex:dag:bad-quorum-policy', 'join'),
          '@type': 'GatherNode',
          'name': 'join',
          'sources': { [placementIri('urn:noocodex:dag:bad-quorum-policy', 'left')]: {}, [placementIri('urn:noocodex:dag:bad-quorum-policy', 'right')]: {} },
          'gather': { 'strategy': 'discard' },
          'policy': { 'mode': 'quorum', 'quorum': 3 },
          'outputs': { 'success': placementIri('urn:noocodex:dag:bad-quorum-policy', 'end'), 'error': placementIri('urn:noocodex:dag:bad-quorum-policy', 'failed') },
        },
        { '@id': placementIri('urn:noocodex:dag:bad-quorum-policy', 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
        { '@id': placementIri('urn:noocodex:dag:bad-quorum-policy', 'failed'), '@type': 'TerminalNode', 'name': 'failed', 'outcome': 'failed' },
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
      'name': 'x', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:x', 'start') },
      'nodes': [{ '@id': placementIri('urn:noocodex:dag:x', 'start'), '@type': 'SingleNode', 'name': 's', 'node': 'urn:noocodec:node:op', 'outputs': {} }],
    };
    assert.throws(() => Validator.dag.validate(flat), DAGErrorPredicate.isValidationError);
  });

  void it('rejects unknown @type on a node placement', () => {
    const bad = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:x', 'start') },
      'nodes': [{ '@id': placementIri('urn:noocodex:dag:x', 'start'), '@type': 'NotANodeType', 'name': 's', 'node': 'urn:noocodec:node:op', 'outputs': {} }],
    };
    assert.throws(() => Validator.dag.validate(bad), DAGErrorPredicate.isValidationError);
  });

  void it('rejects a SingleNode whose output value is null', () => {
    const bad: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:x', 's') },
      'nodes': [{
        '@id': placementIri('urn:noocodex:dag:x', 's'), '@type': 'SingleNode', 'name': 's', 'node': 'urn:noocodec:node:op',
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:test', 'start') },
      'nodes': [{
        '@id':   placementIri('urn:noocodex:dag:test', 'start'),
        '@type': 'SingleNode',
        'name':  'start',
        'node':  'urn:noocodec:node:start',
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
      'entrypoints': { 'main': placementIri('urn:noocodex:dag:test', 'start') },
      'nodes': [{
        '@id':   placementIri('urn:noocodex:dag:test', 'start'),
        '@type': 'SingleNode',
        'name':  'start',
        'node':  'urn:noocodec:node:start',
        'outputs': { 'ok': null, 'fail': null },
      }],
    };
    assert.equal(Validator.dag.is(multiNull), false, 'null outputs must not satisfy the schema');
  });

  void it('accepts a gather node with a custom registered gather strategy name', () => {
    // GatherConfig.strategy is an open string: custom strategies are registered
    // via GatherStrategies.register() and resolved at runtime. The schema does
    // not restrict strategy to a closed enum — unknown names are caught by
    // GatherStrategies.resolve() when the GatherNode executes, not at author time.
    const doc = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:x', 'f') },
      'nodes': [
        {
          '@id':    placementIri('urn:noocodex:dag:x', 'f'),
          '@type':  'ScatterNode',
          'name':   'f', 'body': { 'node': 'urn:noocodec:node:op' }, 'source': 'items',
          'outputs': {
            'all-success': placementIri('urn:noocodex:dag:x', 'join'),
            'partial': placementIri('urn:noocodex:dag:x', 'join'),
            'all-error': placementIri('urn:noocodex:dag:x', 'end'),
            'empty': placementIri('urn:noocodex:dag:x', 'join'),
          },
        },
        {
          '@id':     placementIri('urn:noocodex:dag:x', 'join'),
          '@type':   'GatherNode',
          'name':    'join',
          'sources': { [placementIri('urn:noocodex:dag:x', 'f')]: {} },
          'gather':  { 'strategy': 'my-domain-specific-gather' },
          'outputs': { 'success': placementIri('urn:noocodex:dag:x', 'end'), 'error': placementIri('urn:noocodex:dag:x', 'end'), 'empty': placementIri('urn:noocodex:dag:x', 'end') },
        },
        { '@id': placementIri('urn:noocodex:dag:x', 'end'), '@type': 'TerminalNode',
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

void describe('DAGDocument round-trip', () => {
  void it('serialize → load yields the original DAG', () => {
    const json = DAGDocument.serialize(validDAG);
    const parsed = DAGDocument.load(json);
    assert.deepEqual(parsed, validDAG);
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
      'name': '', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:x', 's') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:x', 's'), '@type': 'SingleNode',
          'name': 's', 'node': 'urn:noocodec:node:op', 'outputs': { 'success': placementIri('urn:noocodex:dag:x', 'done') } },
        { '@id': placementIri('urn:noocodex:dag:x', 'done'), '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };

    assert.throws(() => DAGDocument.load(JSON.stringify(bad)), DAGErrorPredicate.isValidationError);
  });

  void it('shape layer rejects entrypoint and route closure errors on hand-built DAGs', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:op', ['success']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:x', 'missing') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:x', 's'), '@type': 'SingleNode',
          'name': 's', 'node': 'urn:noocodec:node:op', 'outputs': { 'success': placementIri('urn:noocodex:dag:x', 'ghost') } },
        { '@id': placementIri('urn:noocodex:dag:x', 'done'), '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /Entrypoint 'main' targets 'urn:noocodex:dag:x\/node\/missing' which does not exist in nodes[\s\S]*output 'success' routes to unknown placement IRI 'urn:noocodex:dag:x\/node\/ghost'/u,
    );
  });

  void it('shape layer rejects gather sources that no producer can emit', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:op', ['success']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'left': placementIri('urn:noocodex:dag:x', 'left') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:x', 'left'), '@type': 'SingleNode',
          'name': 'left', 'node': 'urn:noocodec:node:op', 'outputs': { 'success': placementIri('urn:noocodex:dag:x', 'join') } },
        { '@id': placementIri('urn:noocodex:dag:x', 'join'), '@type': 'GatherNode',
          'name': 'join', 'sources': { [placementIri('urn:noocodex:dag:x', 'missing-source')]: {} }, 'gather': { 'strategy': 'discard' },
          'outputs': { 'success': placementIri('urn:noocodex:dag:x', 'done'), 'error': placementIri('urn:noocodex:dag:x', 'failed') } },
        { '@id': placementIri('urn:noocodex:dag:x', 'done'), '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
        { '@id': placementIri('urn:noocodex:dag:x', 'failed'), '@type': 'TerminalNode',
          'name': 'failed', 'outcome': 'failed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /GatherNode 'join': source 'urn:noocodex:dag:x\/node\/missing-source' is not declared by an entrypoint or producer placement/u,
    );
  });

  void it('schema layer rejects embedded dagFrom before registry lookup', () => {
    const dag: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:x', 'invoke') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:x', 'invoke'), '@type': 'EmbeddedDAGNode',
          'name': 'invoke', 'dag': 'urn:noocodec:dag:child', 'dagFrom': 'selectedDag',
          'outputs': { 'success': placementIri('urn:noocodex:dag:x', 'done'), 'error': placementIri('urn:noocodex:dag:x', 'failed') } },
        { '@id': placementIri('urn:noocodex:dag:x', 'done'), '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
        { '@id': placementIri('urn:noocodex:dag:x', 'failed'), '@type': 'TerminalNode',
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
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:op', ['success']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:x', 's') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:x', 's'), '@type': 'SingleNode',
          'name': 's', 'node': 'urn:noocodec:node:ghost', 'outputs': { 'success': placementIri('urn:noocodex:dag:x', 'done') } },
        { '@id': placementIri('urn:noocodex:dag:x', 'done'), '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), /references unknown registered node: urn:noocodec:node:ghost/u);
  });

  void it('registry layer rejects missing registered-node output routes', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:op', ['success', 'error']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:x', 's') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:x', 's'), '@type': 'SingleNode',
          'name': 's', 'node': 'urn:noocodec:node:op', 'outputs': { 'success': placementIri('urn:noocodex:dag:x', 'done') } },
        { '@id': placementIri('urn:noocodex:dag:x', 'done'), '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /registered node 'op' declares output 'error' but no routing is defined/u,
    );
  });

  void it('registry layer accepts schema-matching routed node schemas', () => {
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
      '@id':      'urn:noocodex:dag:schema-matching',
      '@type':    'DAG',
      'name': 'schema-matching', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:schema-matching', 'produce') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:schema-matching', 'produce'), '@type': 'SingleNode',
          'name': 'produce', 'node': 'urn:noocodec:node:producer', 'outputs': { 'success': placementIri('urn:noocodex:dag:schema-matching', 'consume') } },
        { '@id': placementIri('urn:noocodex:dag:schema-matching', 'consume'), '@type': 'SingleNode',
          'name': 'consume', 'node': 'urn:noocodec:node:consumer', 'outputs': { 'done': placementIri('urn:noocodex:dag:schema-matching', 'end') } },
        { '@id': placementIri('urn:noocodex:dag:schema-matching', 'end'), '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(dag));
  });

  void it('registry layer rejects mismatched routed node schemas', () => {
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
      '@id':      'urn:noocodex:dag:schema-mismatched',
      '@type':    'DAG',
      'name': 'schema-mismatched', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:schema-mismatched', 'produce') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:schema-mismatched', 'produce'), '@type': 'SingleNode',
          'name': 'produce', 'node': 'urn:noocodec:node:producer', 'outputs': { 'success': placementIri('urn:noocodex:dag:schema-mismatched', 'consume') } },
        { '@id': placementIri('urn:noocodex:dag:schema-mismatched', 'consume'), '@type': 'SingleNode',
          'name': 'consume', 'node': 'urn:noocodec:node:consumer', 'outputs': { 'done': placementIri('urn:noocodex:dag:schema-mismatched', 'end') } },
        { '@id': placementIri('urn:noocodex:dag:schema-mismatched', 'end'), '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /Route 'produce\.success' -> 'urn:noocodex:dag:schema-mismatched\/node\/consume' does not satisfy target input schema: producer does not declare required field 'score'/u,
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
      'name': 'child-required-input', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:child-required-input', 'child-entry') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:child-required-input', 'child-entry'), '@type': 'SingleNode',
          'name': 'child-entry', 'node': 'urn:noocodec:node:child-entry', 'outputs': { 'done': placementIri('urn:noocodex:dag:child-required-input', 'end') } },
        { '@id': placementIri('urn:noocodex:dag:child-required-input', 'end'), '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent-missing-child-input',
      '@type':    'DAG',
      'name': 'parent-missing-child-input', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:parent-missing-child-input', 'invoke') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:parent-missing-child-input', 'invoke'), '@type': 'EmbeddedDAGNode',
          'name': 'invoke', 'dag': 'urn:noocodex:dag:child-required-input', 'outputs': { 'success': placementIri('urn:noocodex:dag:parent-missing-child-input', 'end'), 'error': placementIri('urn:noocodex:dag:parent-missing-child-input', 'end') } },
        { '@id': placementIri('urn:noocodex:dag:parent-missing-child-input', 'end'), '@type': 'TerminalNode',
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
      'name': 'child-answer-output', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:child-answer-output', 'answer') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:child-answer-output', 'answer'), '@type': 'SingleNode',
          'name': 'answer', 'node': 'urn:noocodec:node:child-answer', 'outputs': { 'done': placementIri('urn:noocodex:dag:child-answer-output', 'end') } },
        { '@id': placementIri('urn:noocodex:dag:child-answer-output', 'end'), '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent-bad-gather-result',
      '@type':    'DAG',
      'name': 'parent-bad-gather-result', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:parent-bad-gather-result', 'invoke') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:parent-bad-gather-result', 'invoke'), '@type': 'EmbeddedDAGNode',
          'name': 'invoke', 'dag': 'urn:noocodex:dag:child-answer-output', 'gatherResult': { 'resultField': 'score' },
          'outputs': { 'success': placementIri('urn:noocodex:dag:parent-bad-gather-result', 'end'), 'error': placementIri('urn:noocodex:dag:parent-bad-gather-result', 'end') } },
        { '@id': placementIri('urn:noocodex:dag:parent-bad-gather-result', 'end'), '@type': 'TerminalNode',
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
      'name': 'child-mapped-output', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:child-mapped-output', 'answer') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:child-mapped-output', 'answer'), '@type': 'SingleNode',
          'name': 'answer', 'node': 'urn:noocodec:node:child-output', 'outputs': { 'done': placementIri('urn:noocodex:dag:child-mapped-output', 'end') } },
        { '@id': placementIri('urn:noocodex:dag:child-mapped-output', 'end'), '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent-bad-output-mapping',
      '@type':    'DAG',
      'name': 'parent-bad-output-mapping', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:parent-bad-output-mapping', 'invoke') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:parent-bad-output-mapping', 'invoke'), '@type': 'EmbeddedDAGNode',
          'name': 'invoke', 'dag': 'urn:noocodex:dag:child-mapped-output',
          'stateMapping': { 'output': { 'score': 'score' } },
          'outputs': { 'success': placementIri('urn:noocodex:dag:parent-bad-output-mapping', 'end'), 'error': placementIri('urn:noocodex:dag:parent-bad-output-mapping', 'end') } },
        { '@id': placementIri('urn:noocodex:dag:parent-bad-output-mapping', 'end'), '@type': 'TerminalNode',
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
    const strategyName = 'scatter-result-field-missing';
    GatherStrategies.register(new ScoreObjectGatherStrategy(strategyName));
    try {
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
      'name': 'scatter-bad-result-field', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'fan') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'fan'), '@type': 'ScatterNode',
          'name': 'fan', 'source': 'items', 'body': { 'node': 'urn:noocodec:node:scatter-body' },
          'outputs': { 'all-success': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'join'), 'partial': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'join'), 'all-error': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'failed'), 'empty': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'join') } },
        { '@id': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'join'), '@type': 'GatherNode',
          'name': 'join', 'sources': { [placementIri('urn:noocodex:dag:scatter-bad-result-field', 'fan')]: { 'resultField': 'score' } }, 'gather': { 'strategy': strategyName },
          'outputs': { 'success': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'end'), 'error': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'failed'), 'empty': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'end') } },
        { '@id': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'end'), '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
        { '@id': placementIri('urn:noocodex:dag:scatter-bad-result-field', 'failed'), '@type': 'TerminalNode',
          'name': 'failed', 'outcome': 'failed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /Gather 'join' strategy 'scatter-result-field-missing' declares resultSchema but source 'urn:noocodex:dag:scatter-bad-result-field\/node\/fan' does not declare a producer result schema/u,
    );
    } finally {
      GatherStrategies.unregister(strategyName);
    }
  });

  void it('registry layer accepts gather strategy result schemas satisfied by first-class gather sources', () => {
    const dispatcher = new Dagonizer<RouteSchemaState>();
    const strategyName = 'score-object-matching';
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
        '@id':      'urn:noocodex:dag:gather-strategy-matching',
        '@type':    'DAG',
        'name': 'gather-strategy-matching', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:gather-strategy-matching', 'fan') },
        'nodes': [
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-matching', 'fan'), '@type': 'ScatterNode',
            'name': 'fan', 'source': 'items', 'body': { 'node': 'urn:noocodec:node:score-body' },
            'outputs': { 'all-success': placementIri('urn:noocodex:dag:gather-strategy-matching', 'join'), 'partial': placementIri('urn:noocodex:dag:gather-strategy-matching', 'join'), 'all-error': placementIri('urn:noocodex:dag:gather-strategy-matching', 'failed'), 'empty': placementIri('urn:noocodex:dag:gather-strategy-matching', 'join') } },
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-matching', 'join'), '@type': 'GatherNode',
            'name': 'join', 'sources': { [placementIri('urn:noocodex:dag:gather-strategy-matching', 'fan')]: { 'resultField': 'score' } }, 'gather': { 'strategy': strategyName },
            'outputs': { 'success': placementIri('urn:noocodex:dag:gather-strategy-matching', 'end'), 'error': placementIri('urn:noocodex:dag:gather-strategy-matching', 'failed'), 'empty': placementIri('urn:noocodex:dag:gather-strategy-matching', 'end') } },
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-matching', 'end'), '@type': 'TerminalNode',
            'name': 'end', 'outcome': 'completed' },
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-matching', 'failed'), '@type': 'TerminalNode',
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
    const strategyName = 'score-object-mismatched';
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
        '@id':      'urn:noocodex:dag:gather-strategy-mismatched',
        '@type':    'DAG',
        'name': 'gather-strategy-mismatched', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'fan') },
        'nodes': [
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'fan'), '@type': 'ScatterNode',
            'name': 'fan', 'source': 'items', 'body': { 'node': 'urn:noocodec:node:score-body-bad' },
            'outputs': { 'all-success': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'join'), 'partial': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'join'), 'all-error': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'failed'), 'empty': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'join') } },
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'join'), '@type': 'GatherNode',
            'name': 'join', 'sources': { [placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'fan')]: { 'resultField': 'score' } }, 'gather': { 'strategy': strategyName },
            'outputs': { 'success': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'end'), 'error': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'failed'), 'empty': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'end') } },
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'end'), '@type': 'TerminalNode',
            'name': 'end', 'outcome': 'completed' },
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-mismatched', 'failed'), '@type': 'TerminalNode',
            'name': 'failed', 'outcome': 'failed' },
        ],
      };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /Gather 'join' producer result schema does not satisfy strategy 'score-object-mismatched' result schema: producer does not declare required field 'value'/u,
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
        'name': 'gather-strategy-missing-result', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:gather-strategy-missing-result', 'produce') },
        'nodes': [
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-missing-result', 'produce'), '@type': 'SingleNode',
            'name': 'produce', 'node': 'urn:noocodec:node:direct-producer', 'outputs': { 'done': placementIri('urn:noocodex:dag:gather-strategy-missing-result', 'join') } },
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-missing-result', 'join'), '@type': 'GatherNode',
            'name': 'join', 'sources': { [placementIri('urn:noocodex:dag:gather-strategy-missing-result', 'produce')]: {} }, 'gather': { 'strategy': strategyName },
            'outputs': { 'success': placementIri('urn:noocodex:dag:gather-strategy-missing-result', 'end'), 'error': placementIri('urn:noocodex:dag:gather-strategy-missing-result', 'failed'), 'empty': placementIri('urn:noocodex:dag:gather-strategy-missing-result', 'end') } },
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-missing-result', 'end'), '@type': 'TerminalNode',
            'name': 'end', 'outcome': 'completed' },
          { '@id': placementIri('urn:noocodex:dag:gather-strategy-missing-result', 'failed'), '@type': 'TerminalNode',
            'name': 'failed', 'outcome': 'failed' },
        ],
      };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /Gather 'join' strategy 'score-object-missing-result' declares resultSchema but source 'urn:noocodex:dag:gather-strategy-missing-result\/node\/produce' does not declare a producer result schema/u,
    );
    } finally {
      GatherStrategies.unregister(strategyName);
    }
  });

  void it('registry layer does not reject routed schemas whose schema relation is unknown', () => {
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
      'name': 'schema-unknown', 'version': '1', 'entrypoints': { 'main': placementIri('urn:noocodex:dag:schema-unknown', 'produce') },
      'nodes': [
        { '@id': placementIri('urn:noocodex:dag:schema-unknown', 'produce'), '@type': 'SingleNode',
          'name': 'produce', 'node': 'urn:noocodec:node:producer', 'outputs': { 'success': placementIri('urn:noocodex:dag:schema-unknown', 'consume') } },
        { '@id': placementIri('urn:noocodex:dag:schema-unknown', 'consume'), '@type': 'SingleNode',
          'name': 'consume', 'node': 'urn:noocodec:node:consumer', 'outputs': { 'done': placementIri('urn:noocodex:dag:schema-unknown', 'end') } },
        { '@id': placementIri('urn:noocodex:dag:schema-unknown', 'end'), '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(dag));
  });
});
