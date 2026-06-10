/**
 * 24-llm-adapter/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/24-llm-adapter.ts (the executable entry point).
 *
 * Demonstrates: LlmAdapterRegistry + LlmAdapterCascade with two StubAdapter
 * instances (primary + fallback). The primary stub has probe() overridden to
 * return false, so the cascade skips it and selects the fallback. A ChatNode
 * calls the selected adapter and routes on the response kind.
 */

import { DAG_CONTEXT, NodeStateBase } from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';
import type { LlmAdapter } from '@noocodex/dagonizer/adapter';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class ChatAdapterState extends NodeStateBase {
  prompt: string = '';
  adapter: LlmAdapter | null = null;
  response: string = '';
  finishReason: string = '';
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export const chat: NodeInterface<ChatAdapterState, 'text' | 'tools'> = {
  'name': 'chat',
  'outputs': ['text', 'tools'],
  async execute(state) {
    if (state.adapter === null) throw new Error('chat: adapter not set');
    const request = ChatRequestBuilder.from({
      'messages': [
        { 'role': 'system', 'content': 'You are a helpful assistant.', 'toolCallId': '', 'toolName': '' },
        { 'role': 'user',   'content': state.prompt,                   'toolCallId': '', 'toolName': '' },
      ],
    });
    const response = await state.adapter.chat(request);
    state.finishReason = response.finishReason;
    if (response.message.kind === 'text') {
      state.response = response.message.content;
      return { 'output': 'text' };
    }
    // tools or mixed: surface the first tool call name as the response text
    const calls = response.message.kind === 'mixed'
      ? response.message.toolCalls
      : response.message.toolCalls;
    state.response = `tool_call:${calls[0]?.name ?? 'unknown'}`;
    return { 'output': 'tools' };
  },
};

export const handleText: NodeInterface<ChatAdapterState, 'done'> = {
  'name': 'handleText',
  'outputs': ['done'],
  async execute(state) {
    // Slot for downstream text-processing logic; identity pass-through here
    process.stdout.write(`  [handleText] response="${state.response}"\n`);
    return { 'output': 'done' };
  },
};

export const handleTools: NodeInterface<ChatAdapterState, 'done'> = {
  'name': 'handleTools',
  'outputs': ['done'],
  async execute(state) {
    process.stdout.write(`  [handleTools] tool dispatched: ${state.response}\n`);
    return { 'output': 'done' };
  },
};

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:llm-adapter-demo',
  '@type':    'DAG',
  'name':       'llm-adapter-demo',
  'version':    '1',
  'entrypoint': 'chat',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:llm-adapter-demo/node/chat',
      '@type': 'SingleNode',
      'name':    'chat',
      'node':    'chat',
      'outputs': { 'text': 'handleText', 'tools': 'handleTools' },
    },
    {
      '@id':   'urn:noocodex:dag:llm-adapter-demo/node/handleText',
      '@type': 'SingleNode',
      'name':    'handleText',
      'node':    'handleText',
      'outputs': { 'done': 'end' },
    },
    {
      '@id':   'urn:noocodex:dag:llm-adapter-demo/node/handleTools',
      '@type': 'SingleNode',
      'name':    'handleTools',
      'node':    'handleTools',
      'outputs': { 'done': 'end' },
    },
    {
      '@id':    'urn:noocodex:dag:llm-adapter-demo/node/end',
      '@type':  'TerminalNode',
      'name':     'end',
      'outcome':  'completed',
    },
  ],
};
