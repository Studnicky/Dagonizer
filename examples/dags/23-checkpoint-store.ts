/**
 * 23-checkpoint-store/dags: pure module — state, node, and DAG for the
 * MemoryCheckpointStore demonstration.
 *
 * No side effects, no dispatcher, no execute.
 * Imported by examples/23-checkpoint-store.ts (the executable entry point).
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

// ---------------------------------------------------------------------------
// State: snapshotData/restoreData persist domain fields across the
// serialisation boundary that Checkpoint.capture + restoreState impose.
// ---------------------------------------------------------------------------

// #region pipeline-state
export class PipelineState extends NodeStateBase {
  stage  = '';
  tally  = 0;
  trail: string[] = [];

  protected override snapshotData(): JsonObjectType {
    return { stage: this.stage, tally: this.tally, trail: [...this.trail] };
  }

  protected override restoreData(snapshot: JsonObjectType): void {
    const s = snapshot['stage'];
    if (typeof s === 'string') this.stage = s;
    const n = snapshot['tally'];
    if (typeof n === 'number') this.tally = n;
    const t = snapshot['trail'];
    if (Array.isArray(t)) this.trail = t.filter((x): x is string => typeof x === 'string');
  }
}
// #endregion pipeline-state

// ---------------------------------------------------------------------------
// Nodes: each stage marks its name, increments tally, and appends to trail
// ---------------------------------------------------------------------------

export class IngestNode extends MonadicNode<PipelineState, 'success'> {
  readonly name = 'ingest';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }
  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) {
      item.state.stage = 'ingest';
      item.state.tally++;
      item.state.trail.push('ingest');
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

export class ProcessNode extends MonadicNode<PipelineState, 'success'> {
  readonly name = 'process';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }
  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) {
      item.state.stage = 'process';
      item.state.tally++;
      item.state.trail.push('process');
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

export class ExportNode extends MonadicNode<PipelineState, 'success'> {
  readonly name = 'export';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }
  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) {
      item.state.stage = 'export';
      item.state.tally++;
      item.state.trail.push('export');
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

// ---------------------------------------------------------------------------
// DAG: three sequential stages: ingest -> process -> export -> end
// ---------------------------------------------------------------------------

export const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:pipeline',
  '@type':     'DAG',
  name:        'pipeline',
  version:     '1',
  entrypoint:  'ingest',
  nodes: [
    {
      '@id':   'urn:noocodex:dag:pipeline/node/ingest',
      '@type': 'SingleNode',
      name:    'ingest',
      node:    'ingest',
      outputs: { success: 'process' },
    },
    {
      '@id':   'urn:noocodex:dag:pipeline/node/process',
      '@type': 'SingleNode',
      name:    'process',
      node:    'process',
      outputs: { success: 'export' },
    },
    {
      '@id':   'urn:noocodex:dag:pipeline/node/export',
      '@type': 'SingleNode',
      name:    'export',
      node:    'export',
      outputs: { success: 'end' },
    },
    {
      '@id':     'urn:noocodex:dag:pipeline/node/end',
      '@type':   'TerminalNode',
      name:      'end',
      outcome:   'completed',
    },
  ],
};
