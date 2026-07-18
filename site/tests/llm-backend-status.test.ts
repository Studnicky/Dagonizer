import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmBackendStatus } from '../../docs/.vitepress/theme/components/LlmBackendStatus.ts';

test('browser-local LLM backends expose the shared slow-model warning', () => {
  const geminiNanoWarning = LlmBackendStatus.warning('gemini-nano');
  const webLlmWarning = LlmBackendStatus.warning('web-llm');

  assert.equal(geminiNanoWarning, webLlmWarning);
  assert.match(geminiNanoWarning ?? '', /Slow model selected/);
});

test('non-local and unselected LLM backends do not expose a slow-model warning', () => {
  assert.equal(LlmBackendStatus.warning('groq'), null);
  assert.equal(LlmBackendStatus.warning(null), null);
});
