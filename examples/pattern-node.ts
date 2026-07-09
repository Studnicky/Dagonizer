/**
 * pattern-node: runnable exercise of IntentClassifier — a real DecisionNode from
 * the patterns-rag tier — inside a DAG.
 *
 * The pattern base (DecisionNode → LlmDispatchNode → MonadicNode) owns the LLM
 * call, retry, and abort propagation. IntentClassifier supplies only the four
 * domain methods. A tiny in-process LLM (FixedIntentLlm) returns a deterministic
 * intent word so the example runs offline; production passes a real adapter as
 * the `llm` constructor argument.
 *
 * Definition (the DecisionNode subclass): examples/dags/pattern-node.ts
 *
 * Run: npx tsx examples/pattern-node.ts
 */

import { DAG_CONTEXT, Dagonizer } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';
import type { ChatRequestType, ChatResponseType } from '@studnicky/dagonizer/adapter';
import type { LlmClientInterface } from '@studnicky/dagonizer/contracts';

import { IntentClassifier, IntentState } from './dags/pattern-node.js';

// A deterministic in-process LLM: replies with a fixed intent word. A real
// deployment passes an LlmAdapter here instead.
class FixedIntentLlm implements LlmClientInterface {
  readonly #reply: string;
  constructor(reply: string) {
    this.#reply = reply;
  }
  async chat(_request: ChatRequestType): Promise<ChatResponseType> {
    return {
      message: { variant: 'text', content: this.#reply },
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
    };
  }
}

const dag: DAGType = {
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:intent-demo',
  '@type': 'DAG',
  name: 'intent-demo',
  version: '1',
  entrypoints: { main: 'urn:noocodec:dag:intent-demo/node/classify-intent' },
  nodes: [
    {
      '@id': 'urn:noocodec:dag:intent-demo/node/classify-intent',
      '@type': 'SingleNode',
      name: 'classify-intent',
      node: 'urn:noocodec:node:classify-intent',
      outputs: { search: 'urn:noocodec:dag:intent-demo/node/end', describe: 'urn:noocodec:dag:intent-demo/node/end', recommend: 'urn:noocodec:dag:intent-demo/node/end', 'off-topic': 'urn:noocodec:dag:intent-demo/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:intent-demo/node/end',
      '@type': 'TerminalNode',
      name: 'end',
      outcome: 'completed',
    },
  ],
};

process.stdout.write('\n=== pattern-node: IntentClassifier extends DecisionNode ===\n\n');

const dispatcher = new Dagonizer<IntentState>();
dispatcher.registerNode(new IntentClassifier(new FixedIntentLlm('search')));
dispatcher.registerDAG(dag);

const state = new IntentState();
state.query = 'find me books about graph theory';

const result = await dispatcher.execute('urn:noocodec:dag:intent-demo', state);

process.stdout.write(`[classify] query="${state.query}"\n`);
process.stdout.write(`[classify] intent="${result.state.intent}"\n\n`);

if (result.state.intent !== 'search') {
  throw new Error(`Expected intent='search', got '${result.state.intent}'`);
}

process.stdout.write('Assertion passed.\n');
process.stdout.write('Lesson: a DecisionNode subclass writes composePrompt/decodeChoice/\n');
process.stdout.write('        routeFor/applyChoice; the pattern base owns LLM dispatch + routing.\n');
