import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChatRequestBuilder } from '@studnicky/dagonizer/adapter';
import { EchoAdapter } from '../dags/custom-adapter.ts';

function textContent(msg: { variant: string; content?: string }): string {
  if (msg.variant === 'text' || msg.variant === 'mixed') {
    return (msg as { variant: string; content: string }).content;
  }
  return '';
}

describe('custom-adapter: EchoAdapter echoes the last user message', () => {
  it('echoes user message content with "echo:" prefix', async () => {
    const adapter = new EchoAdapter();
    const request = ChatRequestBuilder.from({
      messages: [{ role: 'user', content: 'hello' }],
    });
    const response = await adapter.chat(request);

    const content = textContent(response.message);
    assert.ok(
      content.includes('echo: hello'),
      `Expected content to include "echo: hello" but got: "${content}"`,
    );
  });

  it('handles multiple messages and echoes the last user message', async () => {
    const adapter = new EchoAdapter();
    const request = ChatRequestBuilder.from({
      messages: [
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'got it' },
        { role: 'user', content: 'second message' },
      ],
    });
    const response = await adapter.chat(request);

    const content = textContent(response.message);
    assert.ok(
      content.includes('echo: second message'),
      `Expected content to include "echo: second message" but got: "${content}"`,
    );
  });

  it('returns finishReason of "stop"', async () => {
    const adapter = new EchoAdapter();
    const request = ChatRequestBuilder.from({
      messages: [{ role: 'user', content: 'ping' }],
    });
    const response = await adapter.chat(request);

    assert.equal(response.finishReason, 'stop');
  });

  it('returns zero token usage', async () => {
    const adapter = new EchoAdapter();
    const request = ChatRequestBuilder.from({
      messages: [{ role: 'user', content: 'ping' }],
    });
    const response = await adapter.chat(request);

    assert.equal(response.usage.promptTokens, 0);
    assert.equal(response.usage.completionTokens, 0);
  });

  it('handles no user message gracefully', async () => {
    const adapter = new EchoAdapter();
    const request = ChatRequestBuilder.from({
      messages: [{ role: 'assistant', content: 'hello' }],
    });
    const response = await adapter.chat(request);

    const content = textContent(response.message);
    assert.ok(
      content.includes('(no user message)'),
      `Expected "(no user message)" but got: "${content}"`,
    );
  });
});
