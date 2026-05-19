---
nextSteps:
  - text: 'Architecture'
    link: '/architecture'
    description: 'node kinds, lifecycle FSM, execution model'
  - text: 'Concepts'
    link: '/concepts'
    description: 'nodes, node state, fan-in strategies'
  - text: 'Cancellation'
    link: '/guide/cancellation'
    description: 'AbortSignal integration'
  - text: 'Checkpoint'
    link: '/guide/checkpoint'
    description: 'pause, snapshot, resume'
seeAlso:
  - text: 'Concepts'
    link: './concepts'
    description: 'vocabulary'
  - text: 'Architecture'
    link: './architecture'
    description: 'submodule layout, interface taxonomy'
  - text: 'DAGBuilder'
    link: './guide/builder'
  - text: 'Example 01: Linear DAG'
    link: './examples/01-linear'
---

# Getting Started

## Requirements

⦿ Node.js 24 or later
⦿ TypeScript 5.6 or later (`strict: true` recommended)

## Installation

```bash
npm install @noocodex/dagonizer
```

## Minimal example

Define a state class, implement one node, register a one-node DAG, and execute it.

```ts
import { NodeStateBase, Dagonizer, DAG_CONTEXT } from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

// 1. Node state — carries data across every node in the DAG.
class MyState extends NodeStateBase {
  input = '';
  output = '';
}

// 2. Node — stateless unit of work. Mutates state; returns an output name.
const transform: NodeInterface<MyState, 'success'> = {
  name: 'transform',
  outputs: ['success'],
  async execute(state) {
    state.output = state.input.toUpperCase();
    return { output: 'success' };
  },
};

// 3. DAG — JSON-LD document describing the node graph.
//    '@context' declares the ontology namespace (import DAG_CONTEXT from the package).
//    '@id' is the document URN; '@type' must be 'DAG'.
//    Each node placement uses '@id' (scoped URN) and '@type' as the kind discriminator.
const dag: DAG = {
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:demo',
  '@type': 'DAG',
  name: 'demo',
  version: '1',
  entrypoint: 'transform',
  nodes: [
    {
      '@id': 'urn:noocodex:dag:demo/node/transform',
      '@type': 'SingleNode',
      name: 'transform',
      node: 'transform',
      outputs: { success: null },   // null → terminal (DAG ends here)
    },
  ],
};

// 4. Dispatcher — register once, execute many times.
const dispatcher = new Dagonizer<MyState>();
dispatcher.registerNode(transform);
dispatcher.registerDAG(dag);

// 5. Execute — await for the final result.
const state = new MyState();
state.input = 'hello';
const result = await dispatcher.execute('demo', state);

console.log(result.state.output);         // 'HELLO'
console.log(result.cursor);               // null (completed)
console.log(result.state.lifecycle.kind); // 'completed'
```

## What `execute` returns

`dispatcher.execute()` returns an `Execution<TState>`, which is both awaitable and async-iterable.

**Awaitable** (one-shot result):

```ts
const result = await dispatcher.execute('demo', state);
// result.state        — the final state
// result.cursor       — null if completed; a node name if interrupted
// result.executedNodes — nodes that ran
// result.skippedNodes  — nodes skipped (e.g. empty fan-out)
```

**Async-iterable** (streaming per node):

```ts
const execution = dispatcher.execute('demo', state);
for await (const node of execution) {
  console.log(node.nodeName, node.output);
}
const result = await execution; // cached — generator ran once
```

## Inspecting lifecycle

```ts
const state = new MyState();
const result = await dispatcher.execute('demo', state);

switch (result.state.lifecycle.kind) {
  case 'completed':
    // finished normally
    break;
  case 'failed':
    // state.lifecycle.error holds the Error
    break;
  case 'cancelled':
    // state.lifecycle.reason holds the cancellation reason
    break;
  case 'timed_out':
    // dispatcher.execute was called with deadlineMs and it expired
    break;
}
```

See [Cancellation](/guide/cancellation) for how to pass `{ signal }` and `{ deadlineMs }`.
