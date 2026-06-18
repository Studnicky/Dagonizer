/**
 * 25-embedder/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/25-embedder.ts (the executable entry point).
 *
 * Demonstrates: EmbedderRegistry + EmbedderCascade with OllamaEmbedder.
 * A node embeds two text strings and computes cosine similarity between
 * their vectors.
 */

import { DAG_CONTEXT, NodeOutputBuilder, NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { DAG } from '@studnicky/dagonizer';
import type { Embedder } from '@studnicky/dagonizer/adapter';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class EmbedderState extends NodeStateBase {
  textA: string = '';
  textB: string = '';
  embedder: Embedder | null = null;
  vectorA: readonly number[] = [];
  vectorB: readonly number[] = [];
  similarity: number = 0;
}

// ---------------------------------------------------------------------------
// Cosine similarity: domain utility, accepts readonly vectors
// ---------------------------------------------------------------------------

export class VectorSimilarity {
  static cosine(a: readonly number[], b: readonly number[]): number {
    if (a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dot   += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export class EmbedNode extends ScalarNode<EmbedderState, 'done'> {
  readonly name = 'embed';
  readonly outputs = ['done'] as const;
  protected override async executeOne(state: EmbedderState) {
    if (state.embedder === null) throw new Error('embed: embedder not set');
    const [vecA, vecB] = await Promise.all([
      state.embedder.embed(state.textA),
      state.embedder.embed(state.textB),
    ]);
    state.vectorA = vecA;
    state.vectorB = vecB;
    state.similarity = VectorSimilarity.cosine(vecA, vecB);
    return NodeOutputBuilder.of('done');
  }
}

export class ReportNode extends ScalarNode<EmbedderState, 'done'> {
  readonly name = 'report';
  readonly outputs = ['done'] as const;
  protected override async executeOne(state: EmbedderState) {
    process.stdout.write(`  similarity("${state.textA}", "${state.textB}") = ${state.similarity.toFixed(4)}\n`);
    return NodeOutputBuilder.of('done');
  }
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:embedder-demo',
  '@type':    'DAG',
  'name':       'embedder-demo',
  'version':    '1',
  'entrypoint': 'embed',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:embedder-demo/node/embed',
      '@type': 'SingleNode',
      'name':    'embed',
      'node':    'embed',
      'outputs': { 'done': 'report' },
    },
    {
      '@id':   'urn:noocodex:dag:embedder-demo/node/report',
      '@type': 'SingleNode',
      'name':    'report',
      'node':    'report',
      'outputs': { 'done': 'end' },
    },
    {
      '@id':    'urn:noocodex:dag:embedder-demo/node/end',
      '@type':  'TerminalNode',
      'name':     'end',
      'outcome':  'completed',
    },
  ],
};
