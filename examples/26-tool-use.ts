/**
 * 26-tool-use: tool-use surface — Tool definition, ToolCallCodec, and adapter dispatch.
 *
 * Shows how to:
 *   1. Define a Tool<TInput, TOutput> with a JSON-Schema ToolDefinition that
 *      the adapter surface forwards to the model's tool channel.
 *   2. Drive it with a real OllamaApiAdapter (llama3.2). When the model
 *      supports tool calling it emits a typed ToolCall[] via the native
 *      'tools' channel; the DAG node dispatches the call directly.
 *   3. Demonstrate the ToolCallCodec text-channel fallback path: feed a
 *      sample assistant message string with embedded JSON to ToolCallCodec.decode
 *      and dispatch the result. This path requires no model — it shows the
 *      codec decoding a fixed string so the reader understands how the text
 *      fallback works for models that embed tool calls in prose.
 *
 * Prerequisites:
 *   - Ollama installed and running on the default port (11434).
 *   - A tool-capable model pulled: ollama pull llama3.2
 *     (change OLLAMA_MODEL below to any tool-capable model you have pulled)
 *
 * DAG definition: examples/dags/26-tool-use.ts
 *
 * Run: npx tsx examples/26-tool-use.ts
 */

import { Batch, Dagonizer } from '@studnicky/dagonizer';
import { ToolCallCodec } from '@studnicky/dagonizer/adapter';
import { OllamaApiAdapter } from '@studnicky/dagonizer-adapter-ollama';

import {
  ToolUseState,
  ToolRegistry,
  CalculatorTool,
  CallLlmNode,
  DispatchToolNode,
  OnTextNode,
  OnToolDoneNode,
  OnToolErrorNode,
  dag,
} from './dags/26-tool-use.js';

// ---------------------------------------------------------------------------
// The model to use. Change to any tool-capable model you have pulled.
// ---------------------------------------------------------------------------

const OLLAMA_MODEL = 'llama3.2';

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const calculatorTool = new CalculatorTool();
const registry = new ToolRegistry();
registry.register(calculatorTool);

process.stdout.write(`\nTool registered: "${calculatorTool.definition.name}" — ${calculatorTool.definition.description}\n`);
process.stdout.write(`Tool input schema required fields: ${JSON.stringify(calculatorTool.definition.inputSchema['required'])}\n\n`);

// ---------------------------------------------------------------------------
// DAG setup
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<ToolUseState>();
dispatcher.registerNode(new CallLlmNode());
dispatcher.registerNode(new DispatchToolNode());
dispatcher.registerNode(new OnTextNode());
dispatcher.registerNode(new OnToolDoneNode());
dispatcher.registerNode(new OnToolErrorNode());
dispatcher.registerDAG(dag);

// ---------------------------------------------------------------------------
// Run A: real OllamaApiAdapter — native tool_calls channel.
//
//   Sends the tool definition to llama3.2. When the model calls the tool,
//   the adapter returns response.message.kind === 'tools' with a typed
//   ToolCall[]. The CallLlmNode dispatches the call without codec decoding.
// ---------------------------------------------------------------------------

process.stdout.write('--- Run A: OllamaApiAdapter — native tool_calls channel ---\n');

const adapter = new OllamaApiAdapter({ 'model': OLLAMA_MODEL });

const stateA = new ToolUseState();
stateA.question = 'What is 7 + 35?';
stateA.adapter  = adapter;
stateA.registry = registry;

await dispatcher.execute('tool-use-demo', stateA);

process.stdout.write(`  question:      "${stateA.question}"\n`);
process.stdout.write(`  dispatched:    "${stateA.dispatchedTool}"\n`);
process.stdout.write(`  finalAnswer:   "${stateA.finalAnswer}"\n\n`);

// ---------------------------------------------------------------------------
// Run B: ToolCallCodec text-channel fallback demonstration.
//
//   No model call here. Feed a fixed assistant message string — the kind a
//   model that embeds tool calls in prose would return — to ToolCallCodec.decode.
//   Decode extracts the { tool_calls: [...] } envelope from arbitrary prose,
//   then dispatches the result to the CalculatorTool.
//
//   This demonstrates the codec without requiring the model to produce this
//   format. The real-world use case: nano models or WebLLM that embed tool
//   calls in prose rather than using the structured tool channel.
// ---------------------------------------------------------------------------

process.stdout.write('--- Run B: ToolCallCodec.decode text-channel fallback ---\n');

const sampleProse =
  'Sure! I will compute that for you. '
  + '{"tool_calls":[{"name":"calculator","arguments":{"a":100,"b":23}}]} '
  + 'Let me process the result.';

process.stdout.write(`  Input prose: ${sampleProse}\n`);

const decodedCalls = ToolCallCodec.decode(sampleProse, 'codec-demo');
process.stdout.write(`  Decoded calls: ${JSON.stringify(decodedCalls)}\n`);

if (decodedCalls.length > 0 && decodedCalls[0] !== undefined) {
  const call = decodedCalls[0];
  const tool = registry.resolve(call.name);
  if (tool !== null) {
    const result = await tool.execute(call.arguments);
    process.stdout.write(`  Tool "${call.name}" result: ${JSON.stringify(result)}\n`);
  }
}
process.stdout.write(`\n`);

// ---------------------------------------------------------------------------
// Run C: unknown tool → error route
//
//   Feeds a decoded call for a tool that is not registered. The DAG routes
//   through the error node.
// ---------------------------------------------------------------------------

process.stdout.write('--- Run C: unknown tool → error route ---\n');

const unknownProse = '{"tool_calls":[{"name":"nonexistent","arguments":{}}]}';

const stateC = new ToolUseState();
stateC.question    = 'Do something unknown.';
stateC.adapter     = adapter;
stateC.registry    = registry;
stateC.toolCallRaw = unknownProse;
// Pre-populate dispatchedTool so DispatchToolNode can decode and route to error
const unknownCalls = ToolCallCodec.decode(unknownProse, 'error-demo');
stateC.dispatchedTool = unknownCalls[0]?.name ?? '';

// Execute only the dispatch path: manually drive DispatchToolNode via execute(batch, ctx)
const dispatchNode = new DispatchToolNode();
const ac = new AbortController();
await dispatchNode.execute(Batch.of(stateC), {
  dagName: 'tool-use-demo',
  nodeName: 'dispatchTool',
  signal: ac.signal,
  services: undefined,
});

process.stdout.write(`  finalAnswer:   "${stateC.finalAnswer}"\n\n`);

process.stdout.write('Lesson: ToolCallCodec.decode extracts tool calls from arbitrary prose.\n');
process.stdout.write('        Tool<TInput,TOutput>.execute() dispatches the call; the DAG routes on success/error.\n');
process.stdout.write('        OllamaApiAdapter with a tool-capable model emits ToolCall[] via the native channel.\n');
