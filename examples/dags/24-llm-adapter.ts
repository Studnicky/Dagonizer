/**
 * 24-llm-adapter/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/24-llm-adapter.ts (the executable entry point).
 *
 * Demonstrates: LlmAdapterRegistry + LlmAdapterCascade with two OllamaApiAdapter
 * instances (primary at an unreachable port, fallback at the default loopback).
 * The primary adapter's probe() returns false, so the cascade skips it and
 * selects the fallback. A ChatNode calls the selected adapter and routes on
 * the response variant.
 */

import { Batch, DAG_CONTEXT, MonadicNode, NodeOutput, NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { LlmAdapterInterface } from '@studnicky/dagonizer/adapter';
import { ChatRequest } from '@studnicky/dagonizer/adapter';

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

export class ChatNode extends MonadicNode<ChatAdapterState, 'text' | 'tools'> {
  readonly name = 'chat';
  readonly outputs = ['text', 'tools'] as const;
  override get outputSchema(): Record<'text' | 'tools', SchemaObjectType> {
    return { 'text': { 'type': 'object' }, 'tools': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ChatAdapterState>) {
    const entries: Array<readonly ['text' | 'tools', Batch<ChatAdapterState>]> = [];
    for (const item of batch) {
      const state = item.state;
      if (state.adapter === null) throw new Error('chat: adapter not set');
      const request = ChatRequest.create({
        'messages': [
          { 'role': 'system', 'content': 'You are a helpful assistant.' },
          { 'role': 'user',   'content': state.prompt },
        ],
      });
      const response = await state.adapter.chat(request);
      state.finishReason = response.finishReason;
      if (response.message.variant === 'text') {
        state.response = response.message.content;
        entries.push([NodeOutput.create('text').output, Batch.from([item])]);
        continue;
      }
      // tools or mixed: surface the first tool call name as the response text
      const calls = response.message.variant === 'mixed'
        ? response.message.toolCalls
        : response.message.toolCalls;
      state.response = `tool_call:${calls[0]?.name ?? 'unknown'}`;
      entries.push([NodeOutput.create('tools').output, Batch.from([item])]);
    }
    return RoutedBatch.create(entries);
  }
}

export class HandleTextNode extends MonadicNode<ChatAdapterState, 'done'> {
  readonly name = 'handleText';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ChatAdapterState>) {
    for (const item of batch) {
      // Slot for downstream text-processing logic; identity pass-through here
      process.stdout.write(`  [handleText] response="${item.state.response}"\n`);
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

export class HandleToolsNode extends MonadicNode<ChatAdapterState, 'done'> {
  readonly name = 'handleTools';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ChatAdapterState>) {
    for (const item of batch) {
      process.stdout.write(`  [handleTools] tool dispatched: ${item.state.response}\n`);
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
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
  'entrypoints': { 'main': 'chat' },
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
