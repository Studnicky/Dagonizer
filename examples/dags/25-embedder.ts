/**
 * 25-embedder/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/25-embedder.ts (the executable entry point).
 *
 * Demonstrates: EmbedderRegistry + EmbedderCascade with OllamaEmbedder.
 * A node embeds two text strings and computes cosine similarity between
 * their vectors.
 */

import { Batch, BatchItemExecutor, DAG_CONTEXT, MonadicNode, NodeOutput, NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { BatchExecutionOptionsType, DAGType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import type { EmbedderInterface } from '@studnicky/dagonizer/adapter';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class EmbedderState extends NodeStateBase {
  textA: string = '';
  textB: string = '';
  embedder: EmbedderInterface | null = null;
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

export class EmbedNode extends MonadicNode<EmbedderState, 'done'> {
  readonly name = 'embed';
  readonly outputs = ['done'] as const;
  readonly #execution: BatchExecutionOptionsType;

  constructor(options: { readonly execution?: BatchExecutionOptionsType } = {}) {
    super();
    this.#execution = options.execution ?? {};
  }

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<EmbedderState>,
    context: NodeContextType,
  ) {
    await BatchItemExecutor.map(batch.items(), async (item) => {
      const state = item.state;
      if (state.embedder === null) throw new Error('embed: embedder not set');
      const vectors = await state.embedder.embedBatch([state.textA, state.textB], { 'signal': context.signal });
      const vecA = vectors[0];
      const vecB = vectors[1];
      if (vecA === undefined || vecB === undefined) throw new Error('embed: embedder returned an incomplete batch');
      state.vectorA = vecA;
      state.vectorB = vecB;
      state.similarity = VectorSimilarity.cosine(vecA, vecB);
    }, this.#execution, context.signal);
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

export class ReportNode extends MonadicNode<EmbedderState, 'done'> {
  readonly name = 'report';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<EmbedderState>) {
    for (const item of batch) {
      const state = item.state;
      process.stdout.write(`  similarity("${state.textA}", "${state.textB}") = ${state.similarity.toFixed(4)}\n`);
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAGType = {
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
