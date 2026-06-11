/**
 * 25-embedder: embedding surface — registry, cascade, and cosine similarity.
 *
 * Shows how to:
 *   1. Subclass `BaseEmbedder` to create a deterministic stub embedder
 *      (no API key, no network). The stub produces a fixed-dimension vector
 *      where each element is a hash-derived value so identical strings yield
 *      the same vector and similar strings yield a measurably higher cosine
 *      similarity than unrelated ones.
 *   2. Register the stub in an `EmbedderRegistry` under a (provider, model) key.
 *   3. Wire an `EmbedderCascade` with a preference list; it probes and selects
 *      the first available embedder.
 *   4. Inject the selected embedder into state and embed two text strings inside
 *      a DAG node, then compute cosine similarity between their vectors.
 *
 * No credentials required: the stub embedder runs entirely offline.
 *
 * DAG definition: examples/dags/25-embedder.ts
 *
 * Run: npx tsx examples/25-embedder.ts
 */

import { Dagonizer } from '@noocodex/dagonizer';
import {
  BaseEmbedder,
  EmbedderRegistry,
  EmbedderCascade,
} from '@noocodex/dagonizer/adapter';

import { EmbedderState, embed, report, dag, cosineSimilarity } from './dags/25-embedder.js';

// ---------------------------------------------------------------------------
// 1. Deterministic stub embedder.
//
//    Produces a 16-dimensional vector from a simple djb2 hash of the input
//    text. The vector is deterministic (same text → same vector) and
//    normalised to unit length. Semantically identical strings produce
//    identical vectors (cosine = 1.0); different strings produce vectors
//    with measurably lower similarity.
//
//    This class is a minimal but complete BaseEmbedder subclass: it fills
//    the required `id`, `displayName`, `dimensions` constructor args and
//    implements the one abstract method `performEmbed()`.
// ---------------------------------------------------------------------------

const DIMS = 16;

class DeterministicStubEmbedder extends BaseEmbedder {
  constructor() {
    super('stub', 'Deterministic hash embedder (no model)', DIMS);
  }

  protected override async performEmbed(text: string, _signal: AbortSignal): Promise<readonly number[]> {
    const raw: number[] = Array<number>(DIMS).fill(0);

    // djb2 hash spread across dimensions
    let hash = 5381;
    for (let ci = 0; ci < text.length; ci++) {
      const ch = text.charCodeAt(ci);
      hash = ((hash << 5) + hash) ^ ch;  // hash * 33 XOR charCode
      hash = hash | 0;                   // keep as int32
      const dim = ci % DIMS;
      raw[dim] = (raw[dim] ?? 0) + Math.sin(hash);
    }

    // Normalize to unit length so cosine = dot product
    const norm = Math.sqrt(raw.reduce((acc, v) => acc + v * v, 0));
    const unit: number[] = norm === 0 ? raw : raw.map((v) => v / norm);
    return Promise.resolve(unit);
  }
}

// ---------------------------------------------------------------------------
// 2. Registry + Cascade
// ---------------------------------------------------------------------------

const embedderRegistry = new EmbedderRegistry();
embedderRegistry.register(
  {
    'provider':     'stub',
    'model':        'deterministic-hash-v1',
    'capabilities': { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false },
  },
  () => new DeterministicStubEmbedder(),
);

const cascade = new EmbedderCascade(embedderRegistry, [
  { 'provider': 'stub', 'model': 'deterministic-hash-v1' },
]);

const embedder = await cascade.select();
process.stdout.write(`\nEmbedder cascade selected: "${embedder.displayName}" (${embedder.id}, ${String(embedder.dimensions)}d)\n\n`);

// ---------------------------------------------------------------------------
// 3. DAG execution: embed two pairs and compute similarity
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<EmbedderState>();
dispatcher.registerNode(embed);
dispatcher.registerNode(report);
dispatcher.registerDAG(dag);

// Pair A: identical strings → cosine = 1.0
const stateA = new EmbedderState();
stateA.textA    = 'machine learning';
stateA.textB    = 'machine learning';
stateA.embedder = embedder;

// Pair B: semantically related strings → high similarity
const stateB = new EmbedderState();
stateB.textA    = 'graph traversal';
stateB.textB    = 'graph traversal algorithm';
stateB.embedder = embedder;

// Pair C: unrelated strings → low similarity
const stateC = new EmbedderState();
stateC.textA    = 'avocado toast';
stateC.textB    = 'quantum entanglement';
stateC.embedder = embedder;

process.stdout.write('Cosine similarities (deterministic hash embedder):\n');
await dispatcher.execute('embedder-demo', stateA);
await dispatcher.execute('embedder-demo', stateB);
await dispatcher.execute('embedder-demo', stateC);

// Verify dimensions and unit-norm contract
const vec = await embedder.embed('hello world');
const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
process.stdout.write(`\nVector dimensions: ${String(vec.length)}  (expected ${String(DIMS)})\n`);
process.stdout.write(`Vector L2 norm:    ${norm.toFixed(6)}  (expected 1.000000 — unit normalised)\n`);
process.stdout.write(`Self-similarity:   ${cosineSimilarity(vec, vec).toFixed(4)}  (expected 1.0000)\n`);
process.stdout.write(`\nLesson: EmbedderCascade selects the first embedder whose probe() is true.\n`);
process.stdout.write(`        BaseEmbedder subclasses implement one method: performEmbed(text, signal).\n`);
