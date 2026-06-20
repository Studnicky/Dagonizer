import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { LlmAdapterInterface } from '../../src/contracts/LlmAdapterInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ChatRequestType } from '../../src/entities/adapter/ChatRequest.js';
import type { ChatResponseType } from '../../src/entities/adapter/ChatResponse.js';
import type { ToolCallType } from '../../src/entities/adapter/ToolCall.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import {
  DecodeTextToolCallsNode,
  DispatchToolCallsNode,
  LlmChatNode,
  PartitionToolCallsNode,
  type ToolDispatchRecordType,
} from '../../src/patterns/index.js';
import type { ToolInterface } from '../../src/tool/ToolInterface.js';

class HarnessState extends NodeStateBase {
  prompt = 'What is 7 + 35?';
  request: ChatRequestType | null = null;
  response: ChatResponseType | null = null;
  assistantText = '';
  decodedCalls: ToolCallType[] = [];
  worksets: { 'safe': readonly ToolCallType[]; 'exclusive': readonly ToolCallType[] } = { 'safe': [], 'exclusive': [] };
  dispatchRecords: ToolDispatchRecordType[] = [];
  toolResult: unknown = null;
}

class FakeTextToolAdapter implements LlmAdapterInterface {
  readonly id = 'fake-text-adapter';
  readonly displayName = 'Fake Text Adapter';
  readonly capabilities = { 'toolUse': 'none' as const, 'structuredOutput': false, 'jsonMode': false };

  async chat(request: ChatRequestType): Promise<ChatResponseType> {
    return {
      'message': {
        'variant': 'text',
        'content': `I will compute this.\n{"tool_calls":[{"name":"calculator","arguments":{"a":7,"b":35}}]}`,
      },
      'finishReason': 'stop',
      'usage': { 'promptTokens': request.messages.length, 'completionTokens': 1 },
    };
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async probe(): Promise<boolean> {
    return true;
  }
}

class CalculatorTool implements ToolInterface<Record<string, unknown>, { 'result': number }> {
  readonly definition = {
    'name': 'calculator',
    'description': 'Add two numbers.',
    'inputSchema': {
      'type': 'object',
      'required': ['a', 'b'],
      'properties': {
        'a': { 'type': 'number' },
        'b': { 'type': 'number' },
      },
    },
    'strict': true,
  };

  async execute(input: Record<string, unknown>): Promise<{ 'result': number }> {
    const a = Number(input['a']);
    const b = Number(input['b']);
    return { 'result': a + b };
  }
}

const tool = new CalculatorTool();

void describe('agent patterns', () => {
  void it('compose into a reusable turn/tool DAG', async () => {
    const adapter = new FakeTextToolAdapter();

    const llmNode = new LlmChatNode<HarnessState>({
      'name': 'call-llm',
      'resolveAdapter': (state) => {
        assert.equal(state.prompt, 'What is 7 + 35?');
        return adapter;
      },
      'request': (state) => {
        const request: ChatRequestType = {
          'messages': [{ 'role': 'user', 'content': state.prompt }],
          'tools': [tool.definition],
          'toolChoice': { 'type': 'auto' },
          'outputSchema': { 'variant': 'none' },
          'maxTokens': 256,
          'temperature': 0,
          'signal': new AbortController().signal,
        };
        state.request = request;
        return request;
      },
      'storeResponse': (state, response) => {
        state.response = response;
        state.assistantText = response.message.variant === 'text' ? response.message.content : '';
      },
    });

    const decodeNode = new DecodeTextToolCallsNode<HarnessState>({
      'name': 'decode-tools',
      'getText': (state) => state.assistantText,
      'idPrefix': 'agent-flow',
      'storeToolCalls': (state, calls) => {
        state.decodedCalls = [...calls];
      },
    });

    const partitionNode = new PartitionToolCallsNode<HarnessState>({
      'name': 'partition-tools',
      'getToolCalls': (state) => state.decodedCalls,
      'classifyCall': (call) => (call.name === 'calculator' ? 'safe' : 'exclusive'),
      'storeWorksets': (state, worksets) => {
        state.worksets = { 'safe': [...worksets.safe], 'exclusive': [...worksets.exclusive] };
      },
    });

    const dispatchNode = new DispatchToolCallsNode<HarnessState>({
      'name': 'dispatch-tools',
      'getToolCalls': (state) => state.decodedCalls,
      'resolveTool': (call) => (call.name === 'calculator' ? tool : undefined),
      'storeResult': (state, record) => {
        state.dispatchRecords.push(record);
        if (record.status === 'success') {
          state.toolResult = record.result;
        }
      },
    });

    const dag = new DAGBuilder('agent-flow-demo', '1')
      .node('call-llm', llmNode, { 'text': 'decode-tools', 'tools': 'end', 'mixed': 'decode-tools', 'error': 'end' })
      .node('decode-tools', decodeNode, { 'decoded': 'partition-tools', 'empty': 'end', 'error': 'end' })
      .node('partition-tools', partitionNode, { 'ready': 'dispatch-tools', 'empty': 'end', 'error': 'end' })
      .node('dispatch-tools', dispatchNode, { 'done': 'end', 'partial': 'end', 'empty': 'end', 'error': 'end' })
      .terminal('end')
      .build();

    const dispatcher = new Dagonizer<HarnessState>();
    dispatcher.registerNode(llmNode);
    dispatcher.registerNode(decodeNode);
    dispatcher.registerNode(partitionNode);
    dispatcher.registerNode(dispatchNode);
    dispatcher.registerDAG(dag);

    const state = new HarnessState();
    await dispatcher.execute('agent-flow-demo', state);

    assert.equal(state.response?.message.variant, 'text');
    assert.equal(state.request?.tools[0]?.name, 'calculator');
    assert.equal(state.decodedCalls.length, 1);
    assert.equal(state.worksets.safe.length, 1);
    assert.equal(state.worksets.exclusive.length, 0);
    assert.equal(state.dispatchRecords[0]?.status, 'success');
    assert.deepEqual(state.toolResult, { 'result': 42 });
  });
});
