/**
 * custom-adapter: runnable exercise of EchoAdapter — a real LlmAdapter built by
 * extending BaseAdapter.
 *
 * EchoAdapter implements the single abstract method (`performChat`) and inherits
 * retry, error classification, and the capability descriptor from BaseAdapter.
 * It echoes the last user message instead of calling a provider, so the example
 * is deterministic and runs offline. Production swaps the `performChat` body for
 * a real HTTP call; the rest of the contract is unchanged.
 *
 * Definition (the adapter subclass): examples/dags/custom-adapter.ts
 *
 * Run: npx tsx examples/custom-adapter.ts
 */

import { ChatRequestBuilder } from '@studnicky/dagonizer/adapter';
import { EchoAdapter } from './dags/custom-adapter.js';

process.stdout.write('\n=== custom-adapter: EchoAdapter extends BaseAdapter ===\n\n');

const adapter = new EchoAdapter();
process.stdout.write(`[adapter] id="${adapter.id}" displayName="${adapter.displayName}"\n`);
process.stdout.write(`[adapter] capabilities=${JSON.stringify(adapter.capabilities)}\n\n`);

const request = ChatRequestBuilder.from({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is a DAG?' },
  ],
});

const response = await adapter.chat(request);
const text = response.message.variant === 'tools' ? '(tool call)' : response.message.content;

process.stdout.write(`[chat] finishReason="${response.finishReason}"\n`);
process.stdout.write(`[chat] response="${text}"\n\n`);

if (text !== 'echo: What is a DAG?') {
  throw new Error(`Expected the echoed user message, got "${text}"`);
}

process.stdout.write('Assertion passed.\n');
process.stdout.write('Lesson: extend BaseAdapter, implement performChat, and the adapter gets\n');
process.stdout.write('        retry, error classification, and probe() from the base for free.\n');
