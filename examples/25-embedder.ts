/**
 * 25-embedder: embedding surface — registry, cascade, and cosine similarity.
 *
 * Shows how to:
 *   1. Discover an installed embedding model via instance-based discovery
 *      (selectEmbeddingModel() on OllamaEmbedder) with no hardcoded model tag.
 *   2. Register two OllamaEmbedder instances in an EmbedderRegistry under
 *      different (provider, model) keys.
 *   3. Wire an EmbedderCascade with a preference list; it probes and selects
 *      the first available embedder.
 *   4. Inject the selected embedder into state and embed two text strings inside
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

import { Dagonizer } from '@studnicky/dagonizer';
import {
  EmbedderRegistry,
  EmbedderCascade,
} from '@studnicky/dagonizer/adapter';
import { OllamaEmbedder } from '@studnicky/dagonizer-embedder-ollama';

import { EmbedderState, EmbedNode, ReportNode, dag, VectorSimilarity } from './dags/25-embedder.js';

// ---------------------------------------------------------------------------
// 1. Model discovery: construct without a model, then call selectEmbeddingModel()
//    on the live instance. selectEmbeddingModel() calls listModels() against the
//    running daemon, filters to embedding-classified models, honors the preferred
//    tag when installed, sets the chosen model on the adapter, and returns its
//    name (or null when no embedding model is installed or the daemon is down).
//    Override the choice with the OLLAMA_EMBED_MODEL env var.
// ---------------------------------------------------------------------------

const preferredEmbedModel = process.env['OLLAMA_EMBED_MODEL'];
const discoveryEmbedder = new OllamaEmbedder();
const EMBED_MODEL = await discoveryEmbedder.selectEmbeddingModel(
  preferredEmbedModel !== undefined ? { 'preferred': preferredEmbedModel } : {},
);

if (EMBED_MODEL === null) {
  process.stdout.write(
    'No Ollama embedding model installed — start the daemon at 127.0.0.1:11434 and run `ollama pull nomic-embed-text`.\n',
  );
  process.exit(0);
}

process.stdout.write(`Discovered Ollama embedding model: "${EMBED_MODEL}"\n`);

// ---------------------------------------------------------------------------
// 2. Registry + Cascade
//
//    Primary: points at port 1 (unreachable). probe() returns false → skipped.
//    Fallback: default loopback. probe() returns true when Ollama is running →
//    selected. Both registry entries use the discovered model name as the key.
// ---------------------------------------------------------------------------

const embedderRegistry = new EmbedderRegistry();

embedderRegistry.register(
  {
    'provider':     'ollama-remote',
    'model':        EMBED_MODEL,
    'capabilities': { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false },
  },
  () => new OllamaEmbedder({ 'model': EMBED_MODEL, 'baseUrl': 'http://127.0.0.1:1' }), // unreachable → probe false
);

embedderRegistry.register(
  {
    'provider':     'ollama-local',
    'model':        EMBED_MODEL,
    'capabilities': { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false },
  },
  () => new OllamaEmbedder({ 'model': EMBED_MODEL }),  // default loopback → probe true when Ollama is running
);

const cascade = new EmbedderCascade(embedderRegistry, [
  { 'provider': 'ollama-remote', 'model': EMBED_MODEL },  // probes false → skipped
  { 'provider': 'ollama-local',  'model': EMBED_MODEL },  // probes true → selected
]);

const embedder = await cascade.select();
process.stdout.write(`\nEmbedder cascade selected: "${embedder.displayName}" (${embedder.id}, ${String(embedder.dimensions)}d)\n\n`);

// ---------------------------------------------------------------------------
// 3. DAG execution: embed two pairs and compute similarity
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

process.stdout.write(`Cosine similarities (${EMBED_MODEL} via Ollama):\n`);
await dispatcher.execute('embedder-demo', stateA);
await dispatcher.execute('embedder-demo', stateB);
await dispatcher.execute('embedder-demo', stateC);

// Verify dimensions and unit-norm contract
const vec = await embedder.embed('hello world');
const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
process.stdout.write(`\nVector dimensions: ${String(vec.length)}  (reported by ${EMBED_MODEL}: ${String(embedder.dimensions)}d)\n`);
process.stdout.write(`Vector L2 norm:    ${norm.toFixed(6)}\n`);
process.stdout.write(`Self-similarity:   ${VectorSimilarity.cosine(vec, vec).toFixed(4)}  (expected 1.0000)\n`);
process.stdout.write(`\nLesson: EmbedderCascade selects the first embedder whose probe() is true.\n`);
process.stdout.write(`        OllamaEmbedder.embed(text) returns a float[] from the discovered embedding model.\n`);
