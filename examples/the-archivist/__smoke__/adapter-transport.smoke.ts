/**
 * adapter-transport.smoke.ts — wire-format smoke test for cloud adapters.
 *
 * Intercepts `fetch` and asserts each adapter's outgoing request body
 * matches the provider's documented schema (per docs verified at
 * v0.9.2):
 *
 *   Groq        max_completion_tokens, tools[*].type='function'
 *   Cerebras    max_completion_tokens, model='gpt-oss-120b' default
 *   Mistral     max_tokens, OpenAI-shape tools
 *   OpenRouter  HTTP-Referer + X-Title headers, OpenAI-shape tools
 *
 * No real network calls. Run via `npx tsx examples/the-archivist/__smoke__/adapter-transport.smoke.ts`.
 */

import { strict as assert } from 'node:assert';

import { CerebrasApiAdapter }  from '@noocodex/dagonizer-adapter-cerebras';
import { GroqApiAdapter }      from '@noocodex/dagonizer-adapter-groq';
import { MistralApiAdapter }   from '@noocodex/dagonizer-adapter-mistral';
import { OpenRouterApiAdapter } from '@noocodex/dagonizer-adapter-openrouter';
import type { ChatRequest }    from '@noocodex/dagonizer/adapter';

interface CapturedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function captureNextFetch(response: unknown): Promise<CapturedRequest> {
  return new Promise((resolveCaptured) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as { url: string }).url;
      const headers: Record<string, string> = {};
      const rawHeaders = init?.headers ?? {};
      if (rawHeaders instanceof Headers) {
        rawHeaders.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      } else if (Array.isArray(rawHeaders)) {
        for (const [k, v] of rawHeaders) headers[k.toLowerCase()] = v;
      } else {
        for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = String(v);
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      globalThis.fetch = original;
      resolveCaptured({ url, headers, body });
      return new Response(JSON.stringify(response), {
        'status': 200,
        'headers': { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });
}

const sampleRequest: ChatRequest = {
  'messages': [{ 'role': 'user', 'content': 'find me a book about labyrinths' }],
  'tools': [{
    'name': 'web_search_books',
    'description': 'Search the book catalogue.',
    'inputSchema': {
      'type': 'object',
      'properties': { 'query': { 'type': 'string' } },
      'required': ['query'],
    },
  }],
  'toolChoice': { 'type': 'auto' },
};

const openAiSuccessResponse = {
  'id': 'stub',
  'object': 'chat.completion',
  'choices': [{
    'index': 0,
    'message': { 'role': 'assistant', 'content': 'ok' },
    'finish_reason': 'stop',
  }],
};

let failures = 0;

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    // eslint-disable-next-line no-console
  console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    // eslint-disable-next-line no-console
  console.error(`✗ ${name}\n  ${err instanceof Error ? err.message : String(err)}`);
  }
}

await check('Groq — POSTs to api.groq.com with max_completion_tokens and OpenAI tools', async () => {
  const adapter = new GroqApiAdapter({ 'apiKey': 'sk-test' });
  const captured = captureNextFetch(openAiSuccessResponse);
  await adapter.chat(sampleRequest);
  const c = await captured;
  assert.equal(c.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(c.headers['authorization'], 'Bearer sk-test');
  assert.ok('max_completion_tokens' in c.body, 'must use max_completion_tokens, not max_tokens');
  assert.ok(!('max_tokens' in c.body), 'must NOT send max_tokens');
  const tools = c.body['tools'] as Array<{ type: string; function: { name: string } }>;
  assert.equal(tools[0]?.type, 'function');
  assert.equal(tools[0]?.function.name, 'web_search_books');
  assert.equal(c.body['tool_choice'], 'auto');
});

await check('Cerebras — POSTs to api.cerebras.ai with gpt-oss-120b default and max_completion_tokens', async () => {
  const adapter = new CerebrasApiAdapter({ 'apiKey': 'sk-test' });
  const captured = captureNextFetch(openAiSuccessResponse);
  await adapter.chat(sampleRequest);
  const c = await captured;
  assert.equal(c.url, 'https://api.cerebras.ai/v1/chat/completions');
  assert.equal(c.body['model'], 'gpt-oss-120b');
  assert.ok('max_completion_tokens' in c.body, 'must use max_completion_tokens');
  assert.ok(!('max_tokens' in c.body), 'must NOT send max_tokens');
});

await check('Mistral — POSTs to api.mistral.ai with max_tokens and OpenAI tools', async () => {
  const adapter = new MistralApiAdapter({ 'apiKey': 'sk-test' });
  const captured = captureNextFetch(openAiSuccessResponse);
  await adapter.chat(sampleRequest);
  const c = await captured;
  assert.equal(c.url, 'https://api.mistral.ai/v1/chat/completions');
  assert.ok('max_tokens' in c.body, 'Mistral uses max_tokens (not max_completion_tokens)');
  const tools = c.body['tools'] as Array<{ type: string; function: { name: string } }>;
  assert.equal(tools[0]?.type, 'function');
});

await check('OpenRouter — POSTs with HTTP-Referer + X-Title headers and OpenAI tools', async () => {
  const adapter = new OpenRouterApiAdapter({ 'apiKey': 'sk-test' });
  const captured = captureNextFetch(openAiSuccessResponse);
  await adapter.chat(sampleRequest);
  const c = await captured;
  assert.equal(c.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.ok(c.headers['http-referer'] !== undefined, 'must send HTTP-Referer header');
  assert.ok(c.headers['x-title'] !== undefined, 'must send X-Title header');
  assert.equal(c.body['model'], 'meta-llama/llama-3.3-70b-instruct:free');
});

await check('Adapters expose capabilities metadata', async () => {
  const groq = new GroqApiAdapter({ 'apiKey': 'sk-test' });
  const cerebras = new CerebrasApiAdapter({ 'apiKey': 'sk-test' });
  const mistral = new MistralApiAdapter({ 'apiKey': 'sk-test' });
  const openrouter = new OpenRouterApiAdapter({ 'apiKey': 'sk-test' });
  assert.equal(groq.capabilities.toolUse, 'full');
  assert.equal(cerebras.capabilities.toolUse, 'partial');
  assert.equal(mistral.capabilities.toolUse, 'full');
  assert.equal(openrouter.capabilities.toolUse, 'partial');
  for (const a of [groq, cerebras, mistral, openrouter]) {
    assert.equal(typeof a.capabilities.structuredOutput, 'boolean');
    assert.equal(typeof a.capabilities.jsonMode, 'boolean');
  }
});

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${String(failures)} smoke check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log(`\nAll smoke checks passed.`);
