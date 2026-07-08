import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import {
  JsonSchemaCompatibility,
  SchemaIdentity,
  SchemaRegistry,
  StableSchemaHash,
} from '../../src/schema/index.js';

void describe('schema identity and registry', () => {
  void it('uses $id as schema identity when present', () => {
    const schema: SchemaObjectType = { '$id': 'urn:test:schema', 'type': 'object' };
    assert.equal(SchemaIdentity.for(schema), 'urn:test:schema');
  });

  void it('hashes schemas without $id deterministically independent of key order', () => {
    const left: SchemaObjectType = {
      'type': 'object',
      'required': ['answer'],
      'properties': { 'answer': { 'type': 'number' } },
    };
    const right: SchemaObjectType = {
      'properties': { 'answer': { 'type': 'number' } },
      'required': ['answer'],
      'type': 'object',
    };

    assert.equal(StableSchemaHash.of(left), StableSchemaHash.of(right));
    assert.equal(SchemaIdentity.for(left), SchemaIdentity.for(right));
  });

  void it('hashes schemas with the substrate structural hash', () => {
    const schema: SchemaObjectType = { 'type': 'object' };
    assert.equal(StableSchemaHash.of(schema), '932b0415');
  });

  void it('hashes schemas independent of substrate metadata annotations', () => {
    const canonical: SchemaObjectType = {
      'type': 'object',
      'required': ['title'],
      'properties': { 'title': { 'type': 'string' } },
    };
    const annotated: SchemaObjectType = {
      '$id': 'urn:test:annotated',
      'title': 'Annotated schema',
      'description': 'Docs do not change the validation contract.',
      'type': 'object',
      'required': ['title'],
      'properties': { 'title': { 'type': 'string', 'description': 'Display title' } },
    };

    assert.equal(StableSchemaHash.of(canonical), StableSchemaHash.of(annotated));
  });

  void it('uses structural schema identity for anonymous schemas', () => {
    const schema: SchemaObjectType = { 'type': 'object' };
    assert.equal(SchemaIdentity.for(schema), 'urn:dagonizer:schema:structural:932b0415');
  });

  void it('registers schemas by identity and rejects conflicting bodies', () => {
    const registry = new SchemaRegistry();
    const first: SchemaObjectType = { '$id': 'urn:test:thing', 'type': 'object' };
    const same: SchemaObjectType = { '$id': 'urn:test:thing', 'type': 'object' };
    const conflict: SchemaObjectType = { '$id': 'urn:test:thing', 'type': 'string' };

    assert.equal(registry.register(first), 'urn:test:thing');
    assert.equal(registry.register(same), 'urn:test:thing');
    assert.equal(registry.has('urn:test:thing'), true);
    assert.throws(() => registry.register(conflict), /already registered with a different body/u);
  });
});

void describe('JsonSchemaCompatibility.produces', () => {
  void it('accepts identical schema identities', () => {
    const produced: SchemaObjectType = { '$id': 'urn:test:same', 'type': 'object' };
    const required: SchemaObjectType = { '$id': 'urn:test:same', 'type': 'string' };
    assert.deepEqual(JsonSchemaCompatibility.produces(produced, required), { 'status': 'compatible' });
  });

  void it('accepts permissive object targets', () => {
    const produced: SchemaObjectType = { 'type': 'string' };
    const required: SchemaObjectType = { 'type': 'object' };
    assert.deepEqual(JsonSchemaCompatibility.produces(produced, required), { 'status': 'compatible' });
  });

  void it('accepts simple object schemas when producer guarantees required target fields', () => {
    const produced: SchemaObjectType = {
      'type': 'object',
      'required': ['name', 'score'],
      'properties': {
        'name': { 'type': 'string' },
        'score': { 'type': 'number' },
      },
    };
    const required: SchemaObjectType = {
      'type': 'object',
      'required': ['name'],
      'properties': {
        'name': { 'type': 'string' },
      },
    };

    assert.deepEqual(JsonSchemaCompatibility.produces(produced, required), { 'status': 'compatible' });
  });

  void it('rejects simple object schemas when producer does not guarantee a required field', () => {
    const produced: SchemaObjectType = {
      'type': 'object',
      'properties': {
        'name': { 'type': 'string' },
      },
    };
    const required: SchemaObjectType = {
      'type': 'object',
      'required': ['name'],
      'properties': {
        'name': { 'type': 'string' },
      },
    };

    assert.deepEqual(
      JsonSchemaCompatibility.produces(produced, required),
      { 'status': 'incompatible', 'reason': "producer does not guarantee required field 'name'" },
    );
  });

  void it('returns unknown for unsupported implication features', () => {
    const produced: SchemaObjectType = { 'type': 'object', 'oneOf': [{ 'type': 'object' }] };
    const required: SchemaObjectType = { 'type': 'object' };
    assert.deepEqual(
      JsonSchemaCompatibility.produces(produced, required),
      { 'status': 'unknown', 'reason': "unsupported JSON Schema keyword 'oneOf'" },
    );
  });
});
