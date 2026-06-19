/**
 * 24-llm-adapter: LLM adapter surface — registry, cascade, and chat in a DAG node.
 *
 * Shows how to:
 *   1. Register two OllamaApiAdapter instances in an LlmAdapterRegistry under
 *      different (provider, model) keys.
 *   2. Wire an LlmAdapterCascade that walks the preference list in order,
 *      probing each adapter and selecting the first available one.
 *   3. Inject the selected LlmAdapterInterface into state and call .chat() inside
 *      a DAG node that routes on the response kind (text vs tool_call).
 *
 * Prerequisites:
 *   - Ollama installed and running on the default port (11434).
 *   - The model pulled: ollama pull llama3.2
 *     (change the model string below to any model you have pulled)
 *
 * Cascade shape: the primary adapter targets a deliberately unreachable port
 * (1), so probe() returns false and the cascade skips it. The fallback targets
 * the default loopback and is selected when Ollama is running.
 *
 * DAG definition: examples/dags/24-llm-adapter.ts
 *
 * Run: npx tsx examples/24-llm-adapter.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import {
  LlmAdapterRegistry,
  LlmAdapterCascade,
} from '@studnicky/dagonizer/adapter';
import { OllamaApiAdapter } from '@studnicky/dagonizer-adapter-ollama';

import { ChatAdapterState, ChatNode, HandleTextNode, HandleToolsNode, dag } from './dags/24-llm-adapter.js';

// ---------------------------------------------------------------------------
// The model to use. Change this to any model you have pulled via `ollama pull`.
// ---------------------------------------------------------------------------

const OLLAMA_MODEL = 'llama3.2';

// ---------------------------------------------------------------------------
// 1. Registry: register two adapters under (provider, model) keys.
//
//    Primary: points at port 1 (unreachable). probe() contacts /api/tags at
//    that port, gets ECONNREFUSED, and returns false — cascade skips it.
//    This is the real-world shape: a cloud or remote Ollama instance that is
//    down or unreachable at runtime.
//
//    Fallback: points at the default loopback (127.0.0.1:11434). probe()
//    returns true when Ollama is running — cascade selects it.
// ---------------------------------------------------------------------------

const registry = new LlmAdapterRegistry();

registry.register(
  { 'provider': 'ollama-remote', 'model': OLLAMA_MODEL, 'capabilities': { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true } },
  () => new OllamaApiAdapter({ 'model': OLLAMA_MODEL, 'baseUrl': 'http://127.0.0.1:1' }),  // unreachable → probe false
);

registry.register(
  { 'provider': 'ollama-local', 'model': OLLAMA_MODEL, 'capabilities': { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true } },
  () => new OllamaApiAdapter({ 'model': OLLAMA_MODEL }),  // default loopback → probe true when Ollama is running
);

// ---------------------------------------------------------------------------
// 2. Cascade: walk the preference list; pick the first adapter that probes true.
// ---------------------------------------------------------------------------

const cascade = new LlmAdapterCascade(registry, [
  { 'provider': 'ollama-remote', 'model': OLLAMA_MODEL },   // probes false (port 1) → skipped
  { 'provider': 'ollama-local',  'model': OLLAMA_MODEL },   // probes true (default loopback) → selected
]);

const adapter = await cascade.select();
process.stdout.write(`\nLLM Adapter cascade selected: "${adapter.displayName}" (${adapter.id})\n`);
process.stdout.write(`  Registered adapters: [${registry.list().map((d) => `${d.provider}:${d.model}`).join(', ')}]\n`);
process.stdout.write(`  Cascade preferences: ollama-remote (skipped, probe=false) → ollama-local (selected)\n\n`);

// ---------------------------------------------------------------------------
// 3. DAG execution: inject adapter into state; chat node calls .chat() and
//    routes on the response kind.
// ---------------------------------------------------------------------------

// #region adapter-usage
const dispatcher = new Dagonizer<ChatAdapterState>();
dispatcher.registerNode(new ChatNode());
dispatcher.registerNode(new HandleTextNode());
dispatcher.registerNode(new HandleToolsNode());
dispatcher.registerDAG(dag);

const state = new ChatAdapterState();
state.prompt  = 'What is a DAG?';
state.adapter = adapter;

await dispatcher.execute('llm-adapter-demo', state);
// #endregion adapter-usage

process.stdout.write(`\nDAG result:\n`);
process.stdout.write(`  prompt:       "${state.prompt}"\n`);
process.stdout.write(`  response:     "${state.response}"\n`);
process.stdout.write(`  finishReason: "${state.finishReason}"\n`);
process.stdout.write(`\nLesson: LlmAdapterCascade skips adapters whose probe() returns false\n`);
process.stdout.write(`        and selects the first available one from the preference list.\n`);
