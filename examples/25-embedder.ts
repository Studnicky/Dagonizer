/**
 * 25-embedder: embedding surface — registry, cascade, and cosine similarity.
 *
 * Shows how to:
 *   1. Register two OllamaEmbedder instances in an EmbedderRegistry under
 *      different (provider, model) keys.
 *   2. Wire an EmbedderCascade with a preference list; it probes and selects
 *      the first available embedder.
 *   3. Inject the selected embedder into state and embed two text strings inside
 *      a DAG node, then compute cosine similarity between their vectors.
 *
 * Prerequisites:
 *   - Ollama installed and running on the default port (11434).
 *   - The embedding model pulled: ollama pull nomic-embed-text
 *
 * Cascade shape: the primary embedder targets port 1 (unreachable) so its
 * probe() returns false and the cascade skips it. The fallback targets the
 * default loopback and is selected when Ollama is running.
 *
 * DAG definition: examples/dags/25-embedder.ts
 *
 * Run: npx tsx examples/25-embedder.ts
 */

import { Dagonizer } from '@noocodex/dagonizer';
import {
  EmbedderRegistry,
  EmbedderCascade,
} from '@noocodex/dagonizer/adapter';
import { OllamaEmbedder } from '@noocodex/dagonizer-embedder-ollama';

import { EmbedderState, EmbedNode, ReportNode, dag, VectorSimilarity } from './dags/25-embedder.js';

// ---------------------------------------------------------------------------
// 1. Registry + Cascade
//
//    Primary: points at port 1 (unreachable). probe() returns false → skipped.
//    Fallback: default loopback, nomic-embed-text (768-dim). probe() returns
//    true when Ollama is running → selected.
// ---------------------------------------------------------------------------

const embedderRegistry = new EmbedderRegistry();

embedderRegistry.register(
  {
    'provider':     'ollama-remote',
    'model':        'nomic-embed-text',
    'capabilities': { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false },
  },
  () => new OllamaEmbedder({ 'model': 'nomic-embed-text', 'baseUrl': 'http://127.0.0.1:1' }), // unreachable → probe false
);

embedderRegistry.register(
  {
    'provider':     'ollama-local',
    'model':        'nomic-embed-text',
    'capabilities': { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false },
  },
  () => new OllamaEmbedder({ 'model': 'nomic-embed-text' }),  // default loopback → probe true when Ollama is running
);

const cascade = new EmbedderCascade(embedderRegistry, [
  { 'provider': 'ollama-remote', 'model': 'nomic-embed-text' },  // probes false → skipped
  { 'provider': 'ollama-local',  'model': 'nomic-embed-text' },  // probes true → selected
]);

const embedder = await cascade.select();
process.stdout.write(`\nEmbedder cascade selected: "${embedder.displayName}" (${embedder.id}, ${String(embedder.dimensions)}d)\n\n`);

// ---------------------------------------------------------------------------
// 2. DAG execution: embed two pairs and compute similarity
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<EmbedderState>();
dispatcher.registerNode(new EmbedNode());
dispatcher.registerNode(new ReportNode());
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

process.stdout.write('Cosine similarities (nomic-embed-text via Ollama):\n');
await dispatcher.execute('embedder-demo', stateA);
await dispatcher.execute('embedder-demo', stateB);
await dispatcher.execute('embedder-demo', stateC);

// Verify dimensions and unit-norm contract
const vec = await embedder.embed('hello world');
const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
process.stdout.write(`\nVector dimensions: ${String(vec.length)}  (expected 768 for nomic-embed-text)\n`);
process.stdout.write(`Vector L2 norm:    ${norm.toFixed(6)}\n`);
process.stdout.write(`Self-similarity:   ${VectorSimilarity.cosine(vec, vec).toFixed(4)}  (expected 1.0000)\n`);
process.stdout.write(`\nLesson: EmbedderCascade selects the first embedder whose probe() is true.\n`);
process.stdout.write(`        OllamaEmbedder.embed(text) returns a float[] from nomic-embed-text.\n`);
