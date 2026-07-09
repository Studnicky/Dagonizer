/**
 * 26-tool-use/dags: pure module — state, tool, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/26-tool-use.ts (the executable entry point).
 *
 * Demonstrates: ToolInterface<TInput, TOutput> definition, ToolCallCodec.decode for
 * text-channel tool-call extraction, and a DAG node that dispatches to the
 * ToolInterface and routes on the result.
 */

import { Batch, DAG_CONTEXT, MonadicNode, NodeOutput, NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { LlmAdapterInterface, ToolCallType, ToolDefinitionType } from '@studnicky/dagonizer/adapter';
import { ChatRequest, ToolCallCodec } from '@studnicky/dagonizer/adapter';
import type { ToolInterface } from '@studnicky/dagonizer/tool';

export const TOOL_USE_DAG_IRI = 'urn:noocodec:dag:tool-use-demo';
const placement = (placementIdentifier: string): string => `${TOOL_USE_DAG_IRI}/node/${encodeURIComponent(placementIdentifier)}`;

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
export class CallLlmNode extends MonadicNode<ToolUseState, 'tool_call' | 'text'> {
  readonly name = 'callLlm';
  readonly '@id' = 'urn:noocodec:node:callLlm';
  readonly outputs = ['tool_call', 'text'] as const;
  override get outputSchema(): Record<'tool_call' | 'text', SchemaObjectType> {
    return { 'tool_call': { 'type': 'object' }, 'text': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ToolUseState>, _context?: unknown) {
    const entries: Array<readonly ['tool_call' | 'text', Batch<ToolUseState>]> = [];
    for (const item of batch) {
      const state = item.state;
      if (state.adapter === null) throw new Error('callLlm: adapter not set');

      const tools = state.registry.definitions();
      const request = ChatRequest.create({
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
          // Store as serialized text for codec demo path (codec handles prose too)
          state.toolCallRaw = JSON.stringify({ tool_calls: [{ name: firstCall.name, arguments: firstCall.arguments }] });
          entries.push([NodeOutput.create('tool_call').output, Batch.from([item])]);
          continue;
        }
      }

      if (response.message.variant === 'text') {
        // Text-channel decoder: adapter returned prose with embedded tool JSON.
        // ToolCallCodec.decode extracts { tool_calls: [...] } from arbitrary prose.
        state.toolCallRaw = response.message.content;
        const calls: ToolCallType[] = ToolCallCodec.decode(response.message.content, 'demo');
        if (calls.length > 0 && calls[0] !== undefined) {
          state.dispatchedTool = calls[0].name;
          entries.push([NodeOutput.create('tool_call').output, Batch.from([item])]);
          continue;
        }
      }

      // No tool call produced — treat as plain text answer
      state.finalAnswer = response.message.variant === 'text' ? response.message.content : '(no text)';
      entries.push([NodeOutput.create('text').output, Batch.from([item])]);
    }
    return RoutedBatch.create(entries);
  }
}

/** Dispatch the tool call to the registered ToolInterface and collect the result. */
export class DispatchToolNode extends MonadicNode<ToolUseState, 'done' | 'error'> {
  readonly name = 'dispatchTool';
  readonly '@id' = 'urn:noocodec:node:dispatchTool';
  readonly outputs = ['done', 'error'] as const;
  override get outputSchema(): Record<'done' | 'error', SchemaObjectType> {
    return { 'done': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ToolUseState>, _context?: unknown) {
    const entries: Array<readonly ['done' | 'error', Batch<ToolUseState>]> = [];
    for (const item of batch) {
      const state = item.state;
      // Decode from raw text (works for both native JSON and prose-wrapped)
      const calls: ToolCallType[] = ToolCallCodec.decode(state.toolCallRaw, 'dispatch');

      const [call] = calls;
      if (call === undefined) {
        state.finalAnswer = 'Error: could not decode tool call from adapter response.';
        entries.push([NodeOutput.create('error').output, Batch.from([item])]);
        continue;
      }
      const tool = state.registry.resolve(call.name);
      if (tool === null) {
        state.finalAnswer = `Error: unknown tool "${call.name}"`;
        entries.push([NodeOutput.create('error').output, Batch.from([item])]);
        continue;
      }

      const result = await tool.execute(call.arguments);
      state.toolResult = result;
      state.finalAnswer = `ToolInterface "${call.name}" returned: ${JSON.stringify(result)}`;
      entries.push([NodeOutput.create('done').output, Batch.from([item])]);
    }
    return RoutedBatch.create(entries);
  }
}

export class OnTextNode extends MonadicNode<ToolUseState, 'done'> {
  readonly name = 'onText';
  readonly '@id' = 'urn:noocodec:node:onText';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ToolUseState>) {
    for (const item of batch) {
      process.stdout.write(`  [onText] direct answer: "${item.state.finalAnswer}"\n`);
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

export class OnToolDoneNode extends MonadicNode<ToolUseState, 'done'> {
  readonly name = 'onToolDone';
  readonly '@id' = 'urn:noocodec:node:onToolDone';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ToolUseState>) {
    for (const item of batch) {
      const state = item.state;
      process.stdout.write(`  [onToolDone] tool="${state.dispatchedTool}" result=${JSON.stringify(state.toolResult)}\n`);
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

export class OnToolErrorNode extends MonadicNode<ToolUseState, 'done'> {
  readonly name = 'onToolError';
  readonly '@id' = 'urn:noocodec:node:onToolError';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ToolUseState>) {
    for (const item of batch) {
      process.stdout.write(`  [onToolError] ${item.state.finalAnswer}\n`);
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAGType = {
  '@context': DAG_CONTEXT,
  '@id': TOOL_USE_DAG_IRI,
  '@type':    'DAG',
  'name':       'tool-use-demo',
  'version':    '1',
  'entrypoints': { 'main': placement('callLlm') },
  'nodes': [
    {
      '@id': placement('callLlm'),
      '@type': 'SingleNode',
      'name':    'callLlm',
      'node':    'urn:noocodec:node:callLlm',
      'outputs': { 'tool_call': placement('dispatchTool'), 'text': placement('onText') },
    },
    {
      '@id': placement('dispatchTool'),
      '@type': 'SingleNode',
      'name':    'dispatchTool',
      'node':    'urn:noocodec:node:dispatchTool',
      'outputs': { 'done': placement('onToolDone'), 'error': placement('onToolError') },
    },
    {
      '@id': placement('onText'),
      '@type': 'SingleNode',
      'name':    'onText',
      'node':    'urn:noocodec:node:onText',
      'outputs': { 'done': placement('end') },
    },
    {
      '@id': placement('onToolDone'),
      '@type': 'SingleNode',
      'name':    'onToolDone',
      'node':    'urn:noocodec:node:onToolDone',
      'outputs': { 'done': placement('end') },
    },
    {
      '@id': placement('onToolError'),
      '@type': 'SingleNode',
      'name':    'onToolError',
      'node':    'urn:noocodec:node:onToolError',
      'outputs': { 'done': placement('end') },
    },
    {
      '@id': placement('end'),
      '@type':  'TerminalNode',
      'name':     'end',
      'outcome':  'completed',
    },
  ],
};
