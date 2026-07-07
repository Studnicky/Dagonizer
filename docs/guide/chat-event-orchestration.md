---
title: 'Chat Event Orchestration'
description: 'Run one registered DAG per inbound chat event or request turn using DAGBuilder, DagRunner, EventTrigger, and RequestTrigger.'
seeAlso:
  - text: 'Conversational Agents'
    link: './conversational'
    description: 'turn-based conversation, HITL, and the canonical agent loop'
  - text: 'Runner'
    link: '../reference/runner'
    description: 'DagRunner, EventTrigger, and RequestTrigger reference'
  - text: 'ReAct Agent'
    link: './react-agent'
    description: 'streaming trace, live token deltas, provenance recall, and routeKey routing'
  - text: 'The Dispatcher'
    link: '../examples/the-dispatcher'
    description: 'runnable in-browser support handoff flow'
  - text: 'Example 29: Agent DAG with JSON-LD'
    link: '../examples/29-agent-dag'
    description: 'runnable DAGBuilder topology with concrete agent nodes'
---

<script setup lang="ts">
import {
  reactAgentDAG,
  reactRoutingDAG,
  reactTraceDAG,
  supportDispatcherDAG,
} from '../.vitepress/theme/exampleDags.ts';
</script>

# Chat Event Orchestration

## What It Is

Chat event orchestration is the host pattern for agent applications: register the DAG once, then run a fresh execution for every inbound message, queue event, browser action, or HTTP request turn.

The DAG remains the canonical assembly. `DAGBuilder` emits your graph as JSON-LD, `Dagonizer` registers it, `DagRunner` seeds and projects state, and `EventTrigger` or `RequestTrigger` adapts the outside world into `runner.run(...)`.

## How It Works

The host owns transport concerns. The DAG owns control flow. Each inbound event becomes:

1. A raw host message or request.
2. A typed runner input.
3. A fresh state instance with correlation data, user text, and injected context.
4. One `dispatcher.execute(dagName, state, options)` call through `DagRunner`.
5. A projected output returned to the host, published to a socket, or written to a stream.

Long-lived subscriptions use `EventTrigger`. Request/response APIs use `RequestTrigger`. Both surfaces run the same registered DAG; they differ only in how the host decides when to fire.

## Diagrams, Examples, and Outputs

The inner loop is a ReAct-style agent DAG authored with plain `DAGBuilder`: build request, call model, normalize the response, dispatch tools through scatter, collect observations, and loop until the assistant response is final.

<<< @/../examples/dags/29-agent-dag.ts

<DagJsonMermaid :dag="reactAgentDAG" title="Agent event loop DAG" aria-label="Agent event loop JSON-LD DAG beside Mermaid generated from it." />

The Dispatcher runnable shows how a real in-browser support flow surrounds that style of agent work: classify an inbound message, compose a response or park for an operator, converge on `send-response`, and end the turn.

<<< @/../examples/the-dispatcher/dag.ts#dispatcher-bundle

<DagJsonMermaid :dag="supportDispatcherDAG" title="Dispatcher support conversation DAG" aria-label="Dispatcher support conversation JSON-LD DAG beside Mermaid generated from it." />

The ReAct memory and routing examples show the two pieces chat hosts usually need after the first turn: trace persistence and concurrent stream demultiplexing.

<<< @/../examples/dags/react-agent-memory.ts#react-trace-dag

<DagJsonMermaid :dag="reactTraceDAG" title="Reasoning trace memory DAG" aria-label="Reasoning trace memory JSON-LD DAG beside Mermaid generated from it." />

<<< @/../examples/dags/react-agent-routing.ts#react-routing-dag

<DagJsonMermaid :dag="reactRoutingDAG" title="Routed stream sink DAG" aria-label="Routed stream sink JSON-LD DAG beside Mermaid generated from it." />

## What It Lets You Do

Use this pattern when an app needs to accept chat events from several host shapes without making the DAG depend on sockets, HTTP frameworks, queues, or UI components.

The same agent graph can serve:

- A browser demo button through a request-like trigger.
- A WebSocket or event-bus subscription through `EventTrigger`.
- An HTTP route through `RequestTrigger`.
- A CLI or worker command through the same `DagRunner` subclass.
- Concurrent conversations through per-run `conversationId` or `routeKey` fields on state.

## Code Samples

### Author the agent DAG

The framework does not own a prebuilt agent loop. Use `DAGBuilder` to author the graph your application needs, then register concrete node subclasses with matching names.

That is deliberate API design: reusable shapes belong in docs, examples, or plugin packages. Core gives you the assembly language (`DAGBuilder` and JSON-LD), the registry, and the host trigger surfaces; your application owns the topology.

```typescript
import { DAGBuilder } from '@studnicky/dagonizer/builder';

const agentDag = new DAGBuilder('support-agent', '1')
  .node('build-request', nodes.chatRequest, {
    ready: 'call-model',
    error: 'end-error',
  })
  .node('call-model', nodes.callModel, {
    text: 'normalize-response',
    tools: 'normalize-response',
    mixed: 'normalize-response',
    error: 'end-error',
  })
  .node('normalize-response', nodes.normalizeResponse, {
    text: 'append-assistant',
    tools: 'decode-tools',
    mixed: 'decode-tools',
    empty: 'end-error',
    error: 'end-error',
  })
  .node('append-assistant', nodes.appendAssistant, {
    done: 'end-done',
    error: 'end-error',
  })
  .node('decode-tools', nodes.decodeTextToolCalls, {
    decoded: 'normalize-tools',
    empty: 'end-error',
    error: 'end-error',
  })
  .node('normalize-tools', nodes.normalizeToolCalls, {
    valid: 'worksets',
    empty: 'end-error',
    error: 'end-error',
  })
  .node('worksets', nodes.toolWorksets, {
    ready: 'dispatch-tools',
    empty: 'end-error',
    error: 'end-error',
  })
  .scatter('dispatch-tools', 'safeWorkset', { dagFrom: 'dagName' }, {
    'all-success': 'collect-results',
    partial: 'collect-results',
    'all-error': 'collect-results',
    empty: 'collect-results',
  }, {
    itemKey: 'currentItem',
    gather: { strategy: 'map', mapping: { output: 'toolOutputs' } },
  })
  .node('collect-results', nodes.collectToolResults, {
    done: 'build-request',
    empty: 'build-request',
    error: 'end-error',
  })
  .terminal('end-done')
  .terminal('end-error', { outcome: 'failed' })
  .build();

dispatcher.registerNode(nodes.chatRequest);
dispatcher.registerNode(nodes.callModel);
dispatcher.registerNode(nodes.normalizeResponse);
dispatcher.registerNode(nodes.decodeTextToolCalls);
dispatcher.registerNode(nodes.normalizeToolCalls);
dispatcher.registerNode(nodes.toolWorksets);
dispatcher.registerNode(nodes.collectToolResults);
dispatcher.registerNode(nodes.appendAssistant);
dispatcher.registerDAG(agentDag);
```

The tool scatter reads `safeWorkset`, dispatches each item to `{ dagFrom: 'dagName' }`, gathers `output` into `toolOutputs`, and loops through `collect-results -> build-request`. Change those names directly in your builder chain when your state shape uses different fields.

### Put host code behind `DagRunner`

`DagRunner` is the only place the host converts inbound input into state and final state into output.

```typescript
import { DagRunner } from '@studnicky/dagonizer/runner';
import type { ExecutionResultType } from '@studnicky/dagonizer';

type ChatTurnInput = {
  conversationId: string;
  message: string;
};

type ChatTurnOutput = {
  conversationId: string;
  reply: string;
  completed: boolean;
};

class ChatTurnRunner extends DagRunner<ChatTurnInput, AgentState, ChatTurnOutput> {
  protected override seedState(input: ChatTurnInput): AgentState {
    const state = new AgentState();
    state.conversationId = input.conversationId;
    state.prompt = input.message;
    return state;
  }

  protected override projectResult(result: ExecutionResultType<AgentState>): ChatTurnOutput {
    return {
      conversationId: result.state.conversationId,
      reply: result.state.assistantText,
      completed: result.state.lifecycle.variant === 'completed',
    };
  }
}
```

The runner is deliberately boring. Keep authentication, sockets, framework request objects, and UI handles outside the DAG. Put only serializable per-run facts on state.

### Fire one run per subscription event

Use `EventTrigger` when the host is a subscription: WebSocket messages, queue items, DOM events, app-level event buses, or server push.

```typescript
import { EventTrigger } from '@studnicky/dagonizer/runner';

type InboundChatMessage = {
  conversationId: string;
  body: string;
};

class ChatMessageTrigger extends EventTrigger<InboundChatMessage, ChatTurnInput, AgentState, ChatTurnOutput> {
  constructor(private readonly bus: ChatBus) {
    super();
  }

  protected override subscribe(onMessage: (message: InboundChatMessage) => void): () => void {
    return this.bus.subscribe('message', onMessage);
  }

  protected override toInput(message: InboundChatMessage): ChatTurnInput {
    return {
      conversationId: message.conversationId,
      message: message.body,
    };
  }

  protected override selectDag(_message: InboundChatMessage): string {
    return 'support-agent';
  }
}
```

`EventTrigger` intentionally does not await each run inside the subscription handler. That makes inbound events independent. If the host needs strict per-conversation ordering, enforce it in the host queue keyed by `conversationId`, not by sharing mutable node state.

### Fire one run per request turn

Use `RequestTrigger` when the caller expects a returned value for the current request.

```typescript
import { RequestTrigger } from '@studnicky/dagonizer/runner';
import type { ExecuteOptionsType } from '@studnicky/dagonizer';

type ChatHttpRequest = {
  body: { conversationId: string; message: string };
  signal: AbortSignal;
};

class ChatRequestTrigger extends RequestTrigger<ChatHttpRequest, ChatTurnInput, AgentState, ChatTurnOutput> {
  protected override toInput(request: ChatHttpRequest): ChatTurnInput {
    return {
      conversationId: request.body.conversationId,
      message: request.body.message,
    };
  }

  protected override selectDag(_request: ChatHttpRequest): string {
    return 'support-agent';
  }

  protected override requestOptions(request: ChatHttpRequest): ExecuteOptionsType {
    return {
      signal: request.signal,
      deadlineMs: 30_000,
    };
  }
}
```

`RequestTrigger.fire(request)` returns the runner's projected output. This is the right fit for browser demos, server routes, chat webhooks, and turn-based APIs.

## Details for Nerds

### Event trigger vs. request trigger

| Host shape | Trigger | Execution model | Output path |
|---|---|---|---|
| WebSocket, queue, app event bus | `EventTrigger` | Subscribes once, fires parallel `runner.run(...)` calls per message | Host publishes projected output asynchronously |
| HTTP route, webhook, browser action | `RequestTrigger` | Stores the runner on attach, fires when the route calls `fire(request)` | `fire(...)` resolves to the projected output |
| CLI or one-shot worker | `CliTrigger` / `OnceTrigger` | Fires once | Trigger stores the result after attach |

The DAG should not care which trigger invokes it. If the topology changes when the transport changes, the app is mixing host concerns into workflow concerns.

### Correlation and stream routing

Every concurrent chat run needs a stable key on state: `conversationId`, `runId`, tenant id, or route key. Nodes read that key when they emit progress, stream model tokens, or write trace records.

The [ReAct routing example](../examples/react-agent-routing) demonstrates the sink side. One shared stream sink receives chunks from multiple conversations, and the routing DAG scatters over those chunks by `routeKey` so the transcripts do not bleed together.

### Abort and deadline propagation

`RequestTrigger.requestOptions(request)` is the host boundary for cancellation. Forward the request's `AbortSignal` and set a deadline there. The engine passes that signal through node context and embedded/scatter execution, so nodes and adapters can stop work without importing the host framework.

### Registration checklist

- Register every concrete node instance once on the dispatcher.
- Register tool DAGs or plugin bundles before the agent DAG if `dispatch-tools` resolves them by `dagName`.
- Register the `DAGBuilder` DAG under the same name the trigger returns from `selectDag`.
- Seed a fresh state per event or request; do not reuse a state object across concurrent runs.
- Put per-run ids on state and use them for stream routing, trace persistence, and response correlation.

## Related Concepts

- [Conversational Agents](./conversational) - turn structure, HITL, and the agent-loop node responsibilities
- [Runner](../reference/runner) - `DagRunner`, `EventTrigger`, and `RequestTrigger` API reference
- [ReAct Agent](./react-agent) - trace streaming, token streaming, provenance recall, and route-key demultiplexing
- [The Dispatcher](../examples/the-dispatcher) - runnable in-browser support flow
- [Example 29: Agent DAG with JSON-LD](../examples/29-agent-dag) - runnable `DAGBuilder` agent DAG
