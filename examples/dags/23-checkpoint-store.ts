/**
 * 23-checkpoint-store/dags: pure module — state, node, and DAG for the
 * MemoryCheckpointStore demonstration.
 *
 * No side effects, no dispatcher, no execute.
 * Imported by examples/23-checkpoint-store.ts (the executable entry point).
 */

import {
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';

// ---------------------------------------------------------------------------
// State: snapshotData/restoreData persist domain fields across the
// serialisation boundary that Checkpoint.capture + restoreState impose.
// ---------------------------------------------------------------------------

export class PipelineState extends NodeStateBase {
  stage  = '';
  tally  = 0;
  trail: string[] = [];

  protected override snapshotData(): JsonObject {
    return { stage: this.stage, tally: this.tally, trail: [...this.trail] };
  }

  protected override restoreData(snapshot: JsonObject): void {
    const s = snapshot['stage'];
    if (typeof s === 'string') this.stage = s;
    const n = snapshot['tally'];
    if (typeof n === 'number') this.tally = n;
    const t = snapshot['trail'];
    if (Array.isArray(t)) this.trail = t.filter((x): x is string => typeof x === 'string');
  }
}

// ---------------------------------------------------------------------------
// Node: a multi-stage pipeline node that marks its stage and tallies work
// ---------------------------------------------------------------------------

function makeStageNode(stageName: string): NodeInterface<PipelineState, 'success'> {
  return {
    name:    stageName,
    outputs: ['success'],
    async execute(state) {
      state.stage = stageName;
      state.tally++;
      state.trail.push(stageName);
      return NodeOutputBuilder.of('success');
    },
  };
}

export const ingestNode  = makeStageNode('ingest');
export const processNode = makeStageNode('process');
export const exportNode  = makeStageNode('export');

// ---------------------------------------------------------------------------
// DAG: three sequential stages: ingest -> process -> export -> end
// ---------------------------------------------------------------------------

export const dag: DAG = {
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
