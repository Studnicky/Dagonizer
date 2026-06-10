/**
 * 26-tool-use: tool-use surface — Tool definition, ToolCallCodec, and adapter dispatch.
 *
 * Shows how to:
 *   1. Define a `Tool<TInput, TOutput>` with a JSON-Schema `ToolDefinition`
 *      that the adapter surface forwards to the model's tool channel.
 *   2. Use a `StubAdapter` subclass that returns a tool call in two different
 *      modes to demonstrate both paths:
 *        a) Native `tools` channel: adapter emits a typed `ToolCall[]`.
 *        b) Text-channel fallback: adapter embeds JSON in prose; `ToolCallCodec.decode`
 *           extracts the `{ tool_calls: [...] }` envelope — tolerant of surrounding text.
 *   3. Dispatch the decoded tool call to the matching registered `Tool` instance
 *      and route the DAG on whether the call succeeded or failed.
 *
 * No credentials required: `StubAdapter` returns canned tool calls offline.
 *
 * DAG definition: examples/dags/26-tool-use.ts
 *
 * Run: npx tsx examples/26-tool-use.ts
 */

import { Dagonizer } from '@noocodex/dagonizer';
import { ZERO_TOKEN_USAGE } from '@noocodex/dagonizer/adapter';
import type { ChatRequest, ChatResponse } from '@noocodex/dagonizer/adapter';
import { StubAdapter } from '@noocodex/dagonizer-adapter-stub';

import {
  ToolUseState,
  ToolRegistry,
  calculatorTool,
  callLlm,
  dispatchTool,
  onText,
  onToolDone,
  onToolError,
  dag,
} from './dags/26-tool-use.js';

// ---------------------------------------------------------------------------
// Stub adapter A: returns tool call via the native `tools` channel.
//   Demonstrates: adapter emits a structured ToolCall; the node routes on
//   response.message.kind === 'tools' and extracts the call directly.
// ---------------------------------------------------------------------------

class NativeToolCallAdapter extends StubAdapter {
  constructor() {
    super();
  }

  override async probe(): Promise<boolean> {
    return Promise.resolve(true);
  }

  protected override async performChat(_request: ChatRequest): Promise<ChatResponse> {
    // Simulate a model that returns a well-formed native tool call
    return Promise.resolve({
      'message': {
        'kind':      'tools',
        'toolCalls': [
          { 'id': 'call-0', 'name': 'calculator', 'arguments': { 'a': 7, 'b': 35 } },
        ],
      },
      'finishReason': 'tool_call',
      'usage':        ZERO_TOKEN_USAGE,
    });
  }
}

// ---------------------------------------------------------------------------
// Stub adapter B: returns tool call encoded in prose text.
//   Demonstrates: ToolCallCodec.decode extracts { tool_calls: [...] } from
//   arbitrary prose. The tolerant parser strips surrounding text and parses
//   the outermost JSON object.
// ---------------------------------------------------------------------------

class TextChannelToolCallAdapter extends StubAdapter {
  constructor() {
    super();
  }

  override async probe(): Promise<boolean> {
    return Promise.resolve(true);
  }

  protected override async performChat(_request: ChatRequest): Promise<ChatResponse> {
    // Simulate a model that embeds the tool call in prose (Nano / WebLLM style)
    const prose =
      'Sure! I will compute that for you. '
      + '{"tool_calls":[{"name":"calculator","arguments":{"a":100,"b":23}}]} '
      + 'Let me process the result.';
    return Promise.resolve({
      'message':      { 'kind': 'text', 'content': prose },
      'finishReason': 'stop',
      'usage':        ZERO_TOKEN_USAGE,
    });
  }
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const registry = new ToolRegistry();
registry.register(calculatorTool);

process.stdout.write(`\nTool registered: "${calculatorTool.definition.name}" — ${calculatorTool.definition.description}\n`);
process.stdout.write(`Tool input schema: ${JSON.stringify(calculatorTool.definition.inputSchema['required'])}\n\n`);

// ---------------------------------------------------------------------------
// DAG setup
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<ToolUseState>();
dispatcher.registerNode(callLlm);
dispatcher.registerNode(dispatchTool);
dispatcher.registerNode(onText);
dispatcher.registerNode(onToolDone);
dispatcher.registerNode(onToolError);
dispatcher.registerDAG(dag);

// ---------------------------------------------------------------------------
// Run A: native tool_calls channel
// ---------------------------------------------------------------------------

process.stdout.write('--- Run A: native tool_calls channel ---\n');

const stateA = new ToolUseState();
stateA.question = 'What is 7 + 35?';
stateA.adapter  = new NativeToolCallAdapter();
stateA.registry = registry;

await dispatcher.execute('tool-use-demo', stateA);

process.stdout.write(`  question:      "${stateA.question}"\n`);
process.stdout.write(`  dispatched:    "${stateA.dispatchedTool}"\n`);
process.stdout.write(`  finalAnswer:   "${stateA.finalAnswer}"\n\n`);

// ---------------------------------------------------------------------------
// Run B: text-channel ToolCallCodec decode
// ---------------------------------------------------------------------------

process.stdout.write('--- Run B: text-channel (ToolCallCodec.decode) ---\n');

const stateB = new ToolUseState();
stateB.question = 'What is 100 + 23?';
stateB.adapter  = new TextChannelToolCallAdapter();
stateB.registry = registry;

await dispatcher.execute('tool-use-demo', stateB);

process.stdout.write(`  question:      "${stateB.question}"\n`);
process.stdout.write(`  dispatched:    "${stateB.dispatchedTool}"\n`);
process.stdout.write(`  finalAnswer:   "${stateB.finalAnswer}"\n\n`);

// ---------------------------------------------------------------------------
// Run C: unknown tool → error route
// ---------------------------------------------------------------------------

process.stdout.write('--- Run C: unknown tool → error route ---\n');

class UnknownToolAdapter extends StubAdapter {
  override async probe(): Promise<boolean> { return Promise.resolve(true); }
  protected override async performChat(_r: ChatRequest): Promise<ChatResponse> {
    return Promise.resolve({
      'message':      { 'kind': 'text', 'content': '{"tool_calls":[{"name":"nonexistent","arguments":{}}]}' },
      'finishReason': 'stop',
      'usage':        ZERO_TOKEN_USAGE,
    });
  }
}

const stateC = new ToolUseState();
stateC.question = 'Do something unknown.';
stateC.adapter  = new UnknownToolAdapter();
stateC.registry = registry;

await dispatcher.execute('tool-use-demo', stateC);

process.stdout.write(`  question:      "${stateC.question}"\n`);
process.stdout.write(`  finalAnswer:   "${stateC.finalAnswer}"\n\n`);

process.stdout.write('Lesson: ToolCallCodec.decode extracts tool calls from arbitrary prose.\n');
process.stdout.write('        Tool<TInput,TOutput>.execute() dispatches the call; the DAG routes on success/error.\n');
