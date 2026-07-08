import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type SchemaRouteTypes } from '../../src/builder/index.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

class SchemaRouteState extends NodeStateBase {
  score = 0;
  label = '';
}

const scoreSchema = {
  'type': 'object',
  'required': ['score'],
  'properties': { 'score': { 'type': 'number' } },
} as const satisfies SchemaObjectType;

const labelSchema = {
  'type': 'object',
  'required': ['label'],
  'properties': { 'label': { 'type': 'string' } },
} as const satisfies SchemaObjectType;

const scoreOutputSchemas = {
  'done': scoreSchema,
} as const satisfies Record<'done', SchemaObjectType>;

const passthroughOutputSchemas = {
  'done': { 'type': 'object' },
} as const satisfies Record<'done', SchemaObjectType>;

class ScoreProducerNode extends MonadicNode<SchemaRouteState, 'done'> {
  override readonly name = 'score-producer';
  override readonly outputs = ['done'] as const;

  override get outputSchema(): typeof scoreOutputSchemas {
    return scoreOutputSchemas;
  }

  override async execute(
    batch: Batch<SchemaRouteState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'done', SchemaRouteState>> {
    return new Map([['done', batch]]);
  }
}

class NeedsScoreNode extends MonadicNode<SchemaRouteState, 'done'> {
  override readonly name = 'needs-score';
  override readonly outputs = ['done'] as const;

  override get inputSchema(): typeof scoreSchema {
    return scoreSchema;
  }

  override get outputSchema(): typeof passthroughOutputSchemas {
    return passthroughOutputSchemas;
  }

  override async execute(
    batch: Batch<SchemaRouteState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'done', SchemaRouteState>> {
    return new Map([['done', batch]]);
  }
}

class NeedsLabelNode extends MonadicNode<SchemaRouteState, 'done'> {
  override readonly name = 'needs-label';
  override readonly outputs = ['done'] as const;

  override get inputSchema(): typeof labelSchema {
    return labelSchema;
  }

  override get outputSchema(): typeof passthroughOutputSchemas {
    return passthroughOutputSchemas;
  }

  override async execute(
    batch: Batch<SchemaRouteState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'done', SchemaRouteState>> {
    return new Map([['done', batch]]);
  }
}

class GenericScoreProducerNode extends MonadicNode<
  SchemaRouteState,
  'done',
  typeof passthroughOutputSchemas['done'],
  typeof scoreOutputSchemas
> {
  override readonly name = 'generic-score-producer';
  override readonly outputs = ['done'] as const;

  override get outputSchema() {
    return scoreOutputSchemas;
  }

  override async execute(
    batch: Batch<SchemaRouteState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'done', SchemaRouteState>> {
    return new Map([['done', batch]]);
  }
}

class GenericNeedsScoreNode extends MonadicNode<
  SchemaRouteState,
  'done',
  typeof scoreSchema,
  typeof passthroughOutputSchemas
> {
  override readonly name = 'generic-needs-score';
  override readonly outputs = ['done'] as const;

  override get inputSchema() {
    return scoreSchema;
  }

  override get outputSchema() {
    return passthroughOutputSchemas;
  }

  override async execute(
    batch: Batch<SchemaRouteState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'done', SchemaRouteState>> {
    return new Map([['done', batch]]);
  }
}

type ProducedScore = SchemaRouteTypes.NodeOutputType<ScoreProducerNode, 'done'>;
type RequiredScore = SchemaRouteTypes.NodeInputType<NeedsScoreNode>;
type GenericProducedScore = SchemaRouteTypes.NodeOutputType<GenericScoreProducerNode, 'done'>;
type GenericRequiredScore = SchemaRouteTypes.NodeInputType<GenericNeedsScoreNode>;

const producedScore: ProducedScore = { 'score': 1 };
const requiredScore: RequiredScore = { 'score': 1 };
const compatibleRoute: SchemaRouteTypes.AssertCompatibleRouteType<ScoreProducerNode, 'done', NeedsScoreNode> = {};
const genericProducedScore: GenericProducedScore = { 'score': 2 };
const genericRequiredScore: GenericRequiredScore = { 'score': 2 };
const genericCompatibleRoute: SchemaRouteTypes.AssertCompatibleRouteType<GenericScoreProducerNode, 'done', GenericNeedsScoreNode> = {};

// @ts-expect-error score output requires a number.
const invalidProducedScore: ProducedScore = { 'score': 'high' };

// @ts-expect-error score input is required.
const invalidRequiredScore: RequiredScore = {};

// @ts-expect-error score output does not satisfy a target that requires label.
const incompatibleRoute: SchemaRouteTypes.AssertCompatibleRouteType<ScoreProducerNode, 'done', NeedsLabelNode> = {};

// @ts-expect-error unknown output ports are incompatible.
const missingPortRoute: SchemaRouteTypes.AssertCompatibleRouteType<ScoreProducerNode, 'missing', NeedsScoreNode> = {};

// @ts-expect-error generic schema output still requires a number.
const invalidGenericProducedScore: GenericProducedScore = { 'score': 'high' };

// @ts-expect-error generic schema input still requires score.
const invalidGenericRequiredScore: GenericRequiredScore = {};

void describe('SchemaRouteTypes', () => {
  void it('derives compile-time route shapes from node schemas', () => {
    assert.deepEqual(producedScore, { 'score': 1 });
    assert.deepEqual(requiredScore, { 'score': 1 });
    assert.deepEqual(compatibleRoute, {});
    assert.deepEqual(genericProducedScore, { 'score': 2 });
    assert.deepEqual(genericRequiredScore, { 'score': 2 });
    assert.deepEqual(genericCompatibleRoute, {});
    assert.equal(typeof invalidProducedScore, 'object');
    assert.equal(typeof invalidRequiredScore, 'object');
    assert.equal(typeof incompatibleRoute, 'object');
    assert.equal(typeof missingPortRoute, 'object');
    assert.equal(typeof invalidGenericProducedScore, 'object');
    assert.equal(typeof invalidGenericRequiredScore, 'object');
  });
});
