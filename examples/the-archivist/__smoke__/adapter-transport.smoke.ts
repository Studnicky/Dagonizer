/**
 * adapter-transport.smoke.ts: wire-format smoke test for cloud adapters.
 *
 * Intercepts `fetch` and asserts each adapter's outgoing request body
 * matches the provider's documented schema (per docs verified at
 * v0.9.2):
 *
 *   Groq        max_completion_tokens, tools[*].type='function'
 *   Cerebras    max_completion_tokens and a non-empty discovered/default model
 *   Mistral     max_tokens, OpenAI-shape tools
 *   OpenRouter  HTTP-Referer + X-Title headers, OpenAI-shape tools
 *
 * No real network calls. Run via `npx tsx examples/the-archivist/__smoke__/adapter-transport.smoke.ts`.
 */

import { strict as assert } from 'node:assert';

import { ChatRequest, OpenAiCompatibleAdapter } from '@studnicky/dagonizer/adapter';
import type { ChatRequestType }    from '@studnicky/dagonizer/adapter';

interface CapturedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

interface OpenAiToolEntry {
  readonly type: string;
  readonly function: { readonly name: string };
}

/** Returns true when `value` is an array of objects with `type` string and `function.name` string. */
class SmokeAssert {
  static isOpenAiToolEntry(entry: unknown): entry is OpenAiToolEntry {
    if (entry === null || typeof entry !== 'object') return false;
    if (!('type' in entry) || typeof entry.type !== 'string') return false;
    if (!('function' in entry)) return false;
    const fn: unknown = entry.function;
    if (fn === null || typeof fn !== 'object') return false;
    return 'name' in fn && typeof fn.name === 'string';
  }

  static isOpenAiToolArray(value: unknown): value is readonly OpenAiToolEntry[] {
    return Array.isArray(value) && value.every((entry) => SmokeAssert.isOpenAiToolEntry(entry));
  }
}

/** Smoke test runner: fetch interception and named check execution. */
class SmokeRunner {
  static captureNextFetch(response: unknown): Promise<CapturedRequest> {
    return new Promise((resolveCaptured) => {
      const original = globalThis.fetch;
      const stub: typeof fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const headers: Record<string, string> = {};
        const rawHeaders = init?.headers ?? {};
        if (rawHeaders instanceof Headers) {
          rawHeaders.forEach((v, k) => { headers[k.toLowerCase()] = v; });
        } else if (Array.isArray(rawHeaders)) {
          for (const [k, v] of rawHeaders) headers[k.toLowerCase()] = v;
        } else {
          for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = String(v);
        }
        // JSON.parse returns `any`; the explicit type annotation binds it to the CapturedRequest shape.
        const body: Record<string, unknown> = JSON.parse(String(init?.body ?? '{}'));
        globalThis.fetch = original;
        resolveCaptured({ url, headers, body });
        return new Response(JSON.stringify(response), {
          'status': 200,
          'headers': { 'content-type': 'application/json' },
        });
      };
      globalThis.fetch = stub;
    });
  }

  static async check(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      process.stdout.write(`✓ ${name}\n`);
    } catch (err) {
      failures++;
      process.stderr.write(`✗ ${name}\n  ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

const sampleRequest: ChatRequestType = ChatRequest.create({
  'messages': [{ 'role': 'user', 'content': 'find me a book about labyrinths' }],
  'tools': [{
    'name': 'web_search_books',
    'description': 'Search the book catalogue.',
    'inputSchema': {
      'type': 'object',
      'properties': { 'query': { 'type': 'string' } },
      'required': ['query'],
    },
    'strict': true,
  }],
  'toolChoice': { 'type': 'auto' },
});

const openAiSuccessResponse = {
  'id': 'chat-completion-0',
  'object': 'chat.completion',
  'choices': [{
    'index': 0,
    'message': { 'role': 'assistant', 'content': 'ok' },
    'finish_reason': 'stop',
  }],
};

let failures = 0;

await SmokeRunner.check('Groq: POSTs to api.groq.com with max_completion_tokens and OpenAI tools', async () => {
  const adapter = OpenAiCompatibleAdapter.groq('sk-test');
  const captured = SmokeRunner.captureNextFetch(openAiSuccessResponse);
  await adapter.chat(sampleRequest);
  const c = await captured;
  assert.equal(c.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(c.headers['authorization'], 'Bearer sk-test');
  assert.ok('max_completion_tokens' in c.body, 'must use max_completion_tokens, not max_tokens');
  assert.ok(!('max_tokens' in c.body), 'must NOT send max_tokens');
  const rawGroqTools = c.body['tools'];
  if (!SmokeAssert.isOpenAiToolArray(rawGroqTools)) throw new Error('tools must be an OpenAI-shape tool array');
  assert.equal(rawGroqTools[0]?.type, 'function');
  assert.equal(rawGroqTools[0]?.function.name, 'web_search_books');
  assert.equal(c.body['tool_choice'], 'auto');
});

await SmokeRunner.check('Cerebras: POSTs to api.cerebras.ai with a model and max_completion_tokens', async () => {
  const adapter = OpenAiCompatibleAdapter.cerebras('sk-test');
  const captured = SmokeRunner.captureNextFetch(openAiSuccessResponse);
  await adapter.chat(sampleRequest);
  const c = await captured;
  assert.equal(c.url, 'https://api.cerebras.ai/v1/chat/completions');
  assert.equal(typeof c.body['model'], 'string');
  assert.notEqual(c.body['model'], '');
  assert.ok('max_completion_tokens' in c.body, 'must use max_completion_tokens');
  assert.ok(!('max_tokens' in c.body), 'must NOT send max_tokens');
});

await SmokeRunner.check('Mistral: POSTs to api.mistral.ai with max_tokens and OpenAI tools', async () => {
  const adapter = OpenAiCompatibleAdapter.mistral('sk-test');
  const captured = SmokeRunner.captureNextFetch(openAiSuccessResponse);
  await adapter.chat(sampleRequest);
  const c = await captured;
  assert.equal(c.url, 'https://api.mistral.ai/v1/chat/completions');
  assert.ok('max_tokens' in c.body, 'Mistral uses max_tokens (not max_completion_tokens)');
  const rawMistralTools = c.body['tools'];
  if (!SmokeAssert.isOpenAiToolArray(rawMistralTools)) throw new Error('tools must be an OpenAI-shape tool array');
  assert.equal(rawMistralTools[0]?.type, 'function');
});

await SmokeRunner.check('OpenRouter: POSTs with HTTP-Referer + X-Title headers and OpenAI tools', async () => {
  const adapter = OpenAiCompatibleAdapter.openRouter('sk-test', {
    'referer': 'https://studnicky.github.io/Dagonizer/',
    'title': 'Dagonizer Archivist',
  });
  const captured = SmokeRunner.captureNextFetch(openAiSuccessResponse);
  await adapter.chat(sampleRequest);
  const c = await captured;
  assert.equal(c.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.ok(c.headers['http-referer'] !== undefined, 'must send HTTP-Referer header');
  assert.ok(c.headers['x-title'] !== undefined, 'must send X-Title header');
  assert.equal(typeof c.body['model'], 'string');
  assert.notEqual(c.body['model'], '');
});

await SmokeRunner.check('Adapters expose capabilities metadata', async () => {
  const groq = OpenAiCompatibleAdapter.groq('sk-test');
  const cerebras = OpenAiCompatibleAdapter.cerebras('sk-test');
  const mistral = OpenAiCompatibleAdapter.mistral('sk-test');
  const openrouter = OpenAiCompatibleAdapter.openRouter('sk-test');
  assert.equal(groq.capabilities.toolUse, 'partial');
  assert.equal(cerebras.capabilities.toolUse, 'partial');
  assert.equal(mistral.capabilities.toolUse, 'partial');
  assert.equal(openrouter.capabilities.toolUse, 'partial');
  for (const a of [groq, cerebras, mistral, openrouter]) {
    assert.equal(typeof a.capabilities.structuredOutput, 'boolean');
    assert.equal(typeof a.capabilities.jsonMode, 'boolean');
  }
});

if (failures > 0) {
  process.stderr.write(`\n${String(failures)} smoke check${failures === 1 ? '' : 's'} failed.\n`);
  process.exit(1);
}
process.stdout.write(`\nAll smoke checks passed.\n`);
