/**
 * 24-llm-adapter: LLM adapter surface — registry, cascade, and chat in a DAG node.
 *
 * Shows how to:
 *   1. Subclass `BaseAdapter` (or use the `StubAdapter`) to create a
 *      credential-free canned-response adapter.
 *   2. Register two adapters in an `LlmAdapterRegistry` under different
 *      (provider, model) keys.
 *   3. Wire an `LlmAdapterCascade` that walks the preference list in order,
 *      probing each adapter and selecting the first available one.
 *   4. Inject the selected `LlmAdapter` into state and call `.chat()` inside
 *      a DAG node that routes on the response kind (text vs tool_call).
 *
 * No credentials required: `StubAdapter` returns canned responses offline.
 * The primary stub has `probe()` overridden to return false, so the cascade
 * skips it and picks the fallback — demonstrating cascade preference ordering.
 *
 * DAG definition: examples/dags/24-llm-adapter.ts
 *
 * Run: npx tsx examples/24-llm-adapter.ts
 */

import { Dagonizer } from '@noocodex/dagonizer';
import {
  LlmAdapterRegistry,
  LlmAdapterCascade,
} from '@noocodex/dagonizer/adapter';
import type { ChatRequest, ChatResponse } from '@noocodex/dagonizer/adapter';
import { StubAdapter } from '@noocodex/dagonizer-adapter-stub';

import { ChatAdapterState, chat, handleText, handleTools, dag } from './dags/24-llm-adapter.js';

// ---------------------------------------------------------------------------
// 1. Subclass StubAdapter: primary adapter that is intentionally unavailable.
//    probe() returns false → cascade skips it and moves to the fallback.
// ---------------------------------------------------------------------------

class UnavailablePrimaryAdapter extends StubAdapter {
  constructor() {
    super({ 'defaultResponse': 'PRIMARY (should never be reached)' });
  }

  override async probe(): Promise<boolean> {
    return Promise.resolve(false);   // simulate: service down / key missing
  }
}

// ---------------------------------------------------------------------------
// 2. Fallback adapter: always available, returns a canned chat response.
//    probe() inherits BaseAdapter default → true.
// ---------------------------------------------------------------------------

class FallbackStubAdapter extends StubAdapter {
  constructor() {
    super({ 'defaultResponse': 'Hello from the fallback stub adapter.' });
  }

  override async probe(): Promise<boolean> {
    return Promise.resolve(true);    // simulate: service healthy
  }

  protected override async performChat(request: ChatRequest): Promise<ChatResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const content = lastUser !== undefined
      ? `Echo (fallback): "${lastUser.content}"`
      : 'Hello from the fallback stub adapter.';
    return Promise.resolve({
      'message':      { 'kind': 'text', content },
      'finishReason': 'stop',
      'usage':        { 'promptTokens': 10, 'completionTokens': 8 },
    });
  }
}

// ---------------------------------------------------------------------------
// 3. Registry: register both adapters under (provider, model) keys.
// ---------------------------------------------------------------------------

const registry = new LlmAdapterRegistry();

registry.register(
  { 'provider': 'stub-primary', 'model': 'canned-v1', 'capabilities': { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false } },
  () => new UnavailablePrimaryAdapter(),
);

registry.register(
  { 'provider': 'stub-fallback', 'model': 'canned-v1', 'capabilities': { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false } },
  () => new FallbackStubAdapter(),
);

// ---------------------------------------------------------------------------
// 4. Cascade: walk the preference list; pick the first adapter that probes true.
// ---------------------------------------------------------------------------

const cascade = new LlmAdapterCascade(registry, [
  { 'provider': 'stub-primary',  'model': 'canned-v1' },  // probes false → skipped
  { 'provider': 'stub-fallback', 'model': 'canned-v1' },  // probes true → selected
]);

const adapter = await cascade.select();
process.stdout.write(`\nLLM Adapter cascade selected: "${adapter.displayName}" (${adapter.id})\n`);
process.stdout.write(`  Registered adapters: [${registry.list().map((d) => `${d.provider}:${d.model}`).join(', ')}]\n`);
process.stdout.write(`  Cascade preferences: stub-primary (skipped, probe=false) → stub-fallback (selected)\n\n`);

// ---------------------------------------------------------------------------
// 5. DAG execution: inject adapter into state; chat node calls .chat() and
//    routes on the response kind.
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<ChatAdapterState>();
dispatcher.registerNode(chat);
dispatcher.registerNode(handleText);
dispatcher.registerNode(handleTools);
dispatcher.registerDAG(dag);

const state = new ChatAdapterState();
state.prompt  = 'What is a DAG?';
state.adapter = adapter;

await dispatcher.execute('llm-adapter-demo', state);

process.stdout.write(`\nDAG result:\n`);
process.stdout.write(`  prompt:       "${state.prompt}"\n`);
process.stdout.write(`  response:     "${state.response}"\n`);
process.stdout.write(`  finishReason: "${state.finishReason}"\n`);
process.stdout.write(`\nLesson: LlmAdapterCascade skips adapters whose probe() returns false\n`);
process.stdout.write(`        and selects the first available one from the preference list.\n`);
