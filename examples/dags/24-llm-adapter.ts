/**
 * 24-llm-adapter/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/24-llm-adapter.ts (the executable entry point).
 *
 * Demonstrates: LlmAdapterRegistry + LlmAdapterCascade with two OllamaApiAdapter
 * instances (primary at an unreachable port, fallback at the default loopback).
 * The primary adapter's probe() returns false, so the cascade skips it and
 * selects the fallback. A ChatNode calls the selected adapter and routes on
 * the response kind.
 */

import { DAG_CONTEXT, NodeOutputBuilder, NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';
import type { LlmAdapterInterface } from '@studnicky/dagonizer/adapter';
import { ChatRequestBuilder } from '@studnicky/dagonizer/adapter';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class ChatAdapterState extends NodeStateBase {
  prompt: string = '';
  adapter: LlmAdapterInterface | null = null;
  response: string = '';
  finishReason: string = '';
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export class ChatNode extends ScalarNode<ChatAdapterState, 'text' | 'tools'> {
  readonly name = 'chat';
  readonly outputs = ['text', 'tools'] as const;
  protected override async executeOne(state: ChatAdapterState) {
    if (state.adapter === null) throw new Error('chat: adapter not set');
    const request = ChatRequestBuilder.from({
      'messages': [
        { 'role': 'system', 'content': 'You are a helpful assistant.' },
        { 'role': 'user',   'content': state.prompt },
      ],
    });
    const response = await state.adapter.chat(request);
    state.finishReason = response.finishReason;
    if (response.message.kind === 'text') {
      state.response = response.message.content;
      return NodeOutputBuilder.of('text');
    }
    // tools or mixed: surface the first tool call name as the response text
    const calls = response.message.kind === 'mixed'
      ? response.message.toolCalls
      : response.message.toolCalls;
    state.response = `tool_call:${calls[0]?.name ?? 'unknown'}`;
    return NodeOutputBuilder.of('tools');
  }
}

export class HandleTextNode extends ScalarNode<ChatAdapterState, 'done'> {
  readonly name = 'handleText';
  readonly outputs = ['done'] as const;
  protected override async executeOne(state: ChatAdapterState) {
    // Slot for downstream text-processing logic; identity pass-through here
    process.stdout.write(`  [handleText] response="${state.response}"\n`);
    return NodeOutputBuilder.of('done');
  }
}

export class HandleToolsNode extends ScalarNode<ChatAdapterState, 'done'> {
  readonly name = 'handleTools';
  readonly outputs = ['done'] as const;
  protected override async executeOne(state: ChatAdapterState) {
    process.stdout.write(`  [handleTools] tool dispatched: ${state.response}\n`);
    return NodeOutputBuilder.of('done');
  }
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAGType = {
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
