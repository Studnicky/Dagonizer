/**
 * 26-tool-use/dags: pure module — state, tool, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/26-tool-use.ts (the executable entry point).
 *
 * Demonstrates: ToolInterface<TInput, TOutput> definition, ToolCallCodec.decode for
 * text-channel tool-call extraction, and a DAG node that dispatches to the
 * ToolInterface and routes on the result.
 */

import { DAG_CONTEXT, NodeOutputBuilder, NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { LlmAdapterInterface, ToolCallType, ToolDefinitionType } from '@studnicky/dagonizer/adapter';
import { ChatRequestBuilder, ToolCallCodec } from '@studnicky/dagonizer/adapter';
import type { ToolInterface } from '@studnicky/dagonizer/tool';

// ---------------------------------------------------------------------------
// ToolInterface: calculator — adds two numbers
// ---------------------------------------------------------------------------

// #region tool-impl
export interface CalcInput extends Record<string, unknown> {
  readonly a: number;
  readonly b: number;
}

export interface CalcOutput {
  readonly result: number;
}

// #region tool-usage
export class CalculatorTool implements ToolInterface<CalcInput, CalcOutput> {
  readonly definition = {
    'name':        'calculator',
    'description': 'Add two numbers. Returns { result: number }.',
    'inputSchema': {
      '$schema':    'https://json-schema.org/draft/2020-12/schema',
      'type':       'object' as const,
      'required':   ['a', 'b'] as const,
      'properties': {
        'a': { 'type': 'number' as const },
        'b': { 'type': 'number' as const },
      },
    },
    'outputSchema': {
      'type': 'object' as const,
    },
    'strict': true,
  };
  async execute(input: CalcInput) {
    return Promise.resolve({ 'result': input.a + input.b });
  }
}
// #endregion tool-usage
// #endregion tool-impl

// ---------------------------------------------------------------------------
// ToolInterface registry (simple map; no framework needed for the dispatch pattern)
// ---------------------------------------------------------------------------

type AnyTool = ToolInterface<Record<string, unknown>, unknown>;

export class ToolRegistry {
  readonly #tools = new Map<string, AnyTool>();

  register(tool: AnyTool): void {
    this.#tools.set(tool.definition.name, tool);
  }

  resolve(name: string): AnyTool | null {
    return this.#tools.get(name) ?? null;
  }

  definitions(): readonly ToolDefinitionType[] {
    return [...this.#tools.values()].map((t) => t.definition);
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class ToolUseState extends NodeStateBase {
  adapter: LlmAdapterInterface | null = null;
  registry: ToolRegistry = new ToolRegistry();
  question: string = '';
  toolCallRaw: string = '';          // raw text from adapter (codec input)
  dispatchedTool: string = '';       // name of the tool that was called
  toolResult: unknown = null;        // output from ToolInterface.execute()
  finalAnswer: string = '';
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** Call the adapter; inspect the response for tool calls. */
export class CallLlmNode extends ScalarNode<ToolUseState, 'tool_call' | 'text'> {
  readonly name = 'callLlm';
  readonly outputs = ['tool_call', 'text'] as const;
  override get outputSchema(): Record<'tool_call' | 'text', SchemaObjectType> {
    return { 'tool_call': { 'type': 'object' }, 'text': { 'type': 'object' } };
  }
  protected override async executeOne(state: ToolUseState) {
    if (state.adapter === null) throw new Error('callLlm: adapter not set');

    const tools = state.registry.definitions();
    const request = ChatRequestBuilder.from({
      'messages': [
        { 'role': 'user', 'content': state.question },
      ],
      'tools':      [...tools],
      'toolChoice': { 'type': 'required' },
    });

    const response = await state.adapter.chat(request);

    if (response.message.variant === 'tools') {
      // Native tool_calls channel: adapter returned structured ToolCall[]
      const firstCall = response.message.toolCalls[0];
      if (firstCall !== undefined) {
        state.dispatchedTool = firstCall.name;
        // StoreInterface as serialized text for codec demo path (codec handles prose too)
        state.toolCallRaw = JSON.stringify({ tool_calls: [{ name: firstCall.name, arguments: firstCall.arguments }] });
        return NodeOutputBuilder.of('tool_call');
      }
    }

    if (response.message.variant === 'text') {
      // Text-channel fallback: adapter returned prose with embedded tool JSON.
      // ToolCallCodec.decode extracts { tool_calls: [...] } from arbitrary prose.
      state.toolCallRaw = response.message.content;
      const calls: ToolCallType[] = ToolCallCodec.decode(response.message.content, 'demo');
      if (calls.length > 0 && calls[0] !== undefined) {
        state.dispatchedTool = calls[0].name;
        return NodeOutputBuilder.of('tool_call');
      }
    }

    // No tool call produced — treat as plain text answer
    state.finalAnswer = response.message.variant === 'text' ? response.message.content : '(no text)';
    return NodeOutputBuilder.of('text');
  }
}

/** Dispatch the tool call to the registered ToolInterface and collect the result. */
export class DispatchToolNode extends ScalarNode<ToolUseState, 'done' | 'error'> {
  readonly name = 'dispatchTool';
  readonly outputs = ['done', 'error'] as const;
  override get outputSchema(): Record<'done' | 'error', SchemaObjectType> {
    return { 'done': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }
  protected override async executeOne(state: ToolUseState) {
    // Decode from raw text (works for both native JSON and prose-wrapped)
    const calls: ToolCallType[] = ToolCallCodec.decode(state.toolCallRaw, 'dispatch');

    const [call] = calls;
    if (call === undefined) {
      state.finalAnswer = 'Error: could not decode tool call from adapter response.';
      return NodeOutputBuilder.of('error');
    }
    const tool = state.registry.resolve(call.name);
    if (tool === null) {
      state.finalAnswer = `Error: unknown tool "${call.name}"`;
      return NodeOutputBuilder.of('error');
    }

    const result = await tool.execute(call.arguments);
    state.toolResult = result;
    state.finalAnswer = `ToolInterface "${call.name}" returned: ${JSON.stringify(result)}`;
    return NodeOutputBuilder.of('done');
  }
}

export class OnTextNode extends ScalarNode<ToolUseState, 'done'> {
  readonly name = 'onText';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  protected override async executeOne(state: ToolUseState) {
    process.stdout.write(`  [onText] direct answer: "${state.finalAnswer}"\n`);
    return NodeOutputBuilder.of('done');
  }
}

export class OnToolDoneNode extends ScalarNode<ToolUseState, 'done'> {
  readonly name = 'onToolDone';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  protected override async executeOne(state: ToolUseState) {
    process.stdout.write(`  [onToolDone] tool="${state.dispatchedTool}" result=${JSON.stringify(state.toolResult)}\n`);
    return NodeOutputBuilder.of('done');
  }
}

export class OnToolErrorNode extends ScalarNode<ToolUseState, 'done'> {
  readonly name = 'onToolError';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  protected override async executeOne(state: ToolUseState) {
    process.stdout.write(`  [onToolError] ${state.finalAnswer}\n`);
    return NodeOutputBuilder.of('done');
  }
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:tool-use-demo',
  '@type':    'DAG',
  'name':       'tool-use-demo',
  'version':    '1',
  'entrypoint': 'callLlm',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:tool-use-demo/node/callLlm',
      '@type': 'SingleNode',
      'name':    'callLlm',
      'node':    'callLlm',
      'outputs': { 'tool_call': 'dispatchTool', 'text': 'onText' },
    },
    {
      '@id':   'urn:noocodex:dag:tool-use-demo/node/dispatchTool',
      '@type': 'SingleNode',
      'name':    'dispatchTool',
      'node':    'dispatchTool',
      'outputs': { 'done': 'onToolDone', 'error': 'onToolError' },
    },
    {
      '@id':   'urn:noocodex:dag:tool-use-demo/node/onText',
      '@type': 'SingleNode',
      'name':    'onText',
      'node':    'onText',
      'outputs': { 'done': 'end' },
    },
    {
      '@id':   'urn:noocodex:dag:tool-use-demo/node/onToolDone',
      '@type': 'SingleNode',
      'name':    'onToolDone',
      'node':    'onToolDone',
      'outputs': { 'done': 'end' },
    },
    {
      '@id':   'urn:noocodex:dag:tool-use-demo/node/onToolError',
      '@type': 'SingleNode',
      'name':    'onToolError',
      'node':    'onToolError',
      'outputs': { 'done': 'end' },
    },
    {
      '@id':    'urn:noocodex:dag:tool-use-demo/node/end',
      '@type':  'TerminalNode',
      'name':     'end',
      'outcome':  'completed',
    },
  ],
};
