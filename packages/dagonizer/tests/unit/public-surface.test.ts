import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GATHER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import {
  GATHER_PROGRESS_KEY as ROOT_GATHER_PROGRESS_KEY,
  GatherCheckpoint,
  GatherProgressSchema,
  GatherRecordProgressSchema,
  DagReferenceGraph,
  DagGraphProjector,
  DagGraphQueries,
  JsonSchemaCompatibility,
  PluginDiscovery,
  PluginSpecifier,
  SchemaIdentity,
  SchemaRegistry,
  StableSchemaHash,
  WellFormedValidator,
} from '../../src/index.js';
import type {
  GatherProgressType as RootGatherProgressType,
  GatherRecordProgressType as RootGatherRecordProgressType,
} from '../../src/index.js';
import type {
  GatherProgressType as TypeBarrelGatherProgressType,
  GatherRecordProgressType as TypeBarrelGatherRecordProgressType,
} from '../../src/types/index.js';

void describe('public root surface', () => {
  void it('exports the gather progress key', () => {
    assert.equal(ROOT_GATHER_PROGRESS_KEY, GATHER_PROGRESS_KEY);
  });

  void it('exports gather checkpoint and progress schemas', () => {
    const progress: RootGatherProgressType = { 'entries': {} };
    const sameProgress: TypeBarrelGatherProgressType = progress;
    const record: RootGatherRecordProgressType = {
      'source': 'left',
      'index': null,
      'output': 'success',
      'terminalOutcome': null,
      'snapshot': {},
    };
    const sameRecord: TypeBarrelGatherRecordProgressType = record;

    assert.deepEqual(sameProgress, { 'entries': {} });
    assert.equal(sameRecord.source, 'left');
    assert.equal(GatherProgressSchema.properties.entries.type, 'object');
    assert.equal(GatherRecordProgressSchema.properties.source.type, 'string');
    assert.equal(typeof GatherCheckpoint.read, 'function');
  });

  void it('exports the authored-DAG well-formed validator', () => {
    assert.equal(typeof WellFormedValidator.check, 'function');
  });

  void it('exports graph reference classification utilities', () => {
    assert.equal(typeof DagGraphProjector.store, 'function');
    assert.equal(typeof DagGraphQueries.reachableCandidateDagIris, 'function');
    assert.equal(typeof DagReferenceGraph.referenceEdges, 'function');
    assert.equal(typeof DagReferenceGraph.stronglyConnectedComponents, 'function');
  });

  void it('exports schema and plugin discovery utilities for graph-backed composition', () => {
    assert.equal(typeof JsonSchemaCompatibility.produces, 'function');
    assert.equal(typeof SchemaIdentity.for, 'function');
    assert.equal(typeof SchemaRegistry, 'function');
    assert.equal(typeof StableSchemaHash.of, 'function');
    assert.equal(typeof PluginDiscovery.referencedDagIris, 'function');
    assert.equal(typeof PluginSpecifier.byIriPrefix, 'function');
  });
});
