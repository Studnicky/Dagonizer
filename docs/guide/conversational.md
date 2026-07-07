---
title: 'Conversational Agents'
description: 'Patterns for slot-filling, turn-based dialogs, human-in-the-loop workflows, and the canonical 8-node agent loop authored as a DAG.'
seeAlso:
  - text: 'State & metadata'
    link: './shared-state'
    description: 'use state.metadata as the inter-node IO bus'
  - text: 'Checkpoint & resume'
    link: './checkpoint'
    description: 'persist and reload state across process boundaries'
  - text: 'Dependency injection'
    link: './services'
    description: 'inject IO adapters via node constructors'
  - text: 'Example 29: Agent DAG'
    link: '../examples/29-agent-dag'
    description: 'working example of the 8-node agent loop with stub LLM'
  - text: 'ReAct agent: streaming + provenance recall'
    link: './react-agent'
    description: 'the 8-node loop as ReAct, trace streaming, live token deltas, provenance recall'
  - text: 'Chat Event Orchestration'
    link: './chat-event-orchestration'
    description: 'run one registered agent DAG per inbound event or request turn'
  - text: 'Lifecycle phases'
    link: './lifecycle-phases'
    description: 'understand when a DAG completes vs. when it pauses'
---

<script setup lang="ts">
import { reactAgentDAG, supportDispatcherDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Conversational Agents

## What It Is

Conversational applications are still workflows. A user message enters state, nodes classify intent or fill slots, the DAG either replies, parks for a human, dispatches tools, or loops through another model call. Dagonizer keeps those turn decisions visible as JSON-LD topology instead of hiding them in callback stacks.

This guide covers three conversation shapes that appear in the runnable examples: request/response turns, human-in-the-loop parking, and the reusable agent loop.

## How It Works

Conversational flows keep serializable domain progress on state and put ephemeral IO handles behind metadata, stores, triggers, or host code. A turn either completes with a response, parks with a cursor, or streams through a producer/channel surface while the DAG remains the explicit control-flow graph.

Interactive DAGs — those that prompt users, wait for responses, escalate to humans, or stream results — present a challenge: the input/output cannot flow through serializable `state.params` when it is ephemeral (a live socket, a request/response pair, an SSE stream, a queue item). This guide documents two proven patterns for threading non-serializable IO through a DAG.

## Diagrams, Examples, and Outputs

The runnable examples show two complementary conversational shapes. The ReAct loop is the reusable agent graph; the Dispatcher support flow shows park-and-correlate handoff:

<DagJsonMermaid :dag="reactAgentDAG" title="ReAct agent loop DAG" aria-label="ReAct agent loop JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher conversation DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

- [State & metadata](./shared-state) - use state.metadata as the inter-node IO bus
- [Checkpoint & resume](./checkpoint) - persist and reload state across process boundaries
- [Dependency injection](./services) - inject IO adapters via node constructors
- [Example 29: Agent DAG](../examples/29-agent-dag) - working example of the 8-node agent loop with stub LLM
- [The Dispatcher](../examples/the-dispatcher) - runnable support handoff and operator response flow
- [ReAct Agent Memory](../examples/react-agent-memory) - runnable trace streaming and provenance recall

## What It Lets You Do

### Use when

Use this guide when a DAG interacts with people, live transports, or turn-based agent loops. It covers slot filling, human escalation, request/response boundaries, streaming, and the canonical agent topology.

## Code Samples

The sections below describe the implementation shapes behind the runnable examples. Prefer the linked demos for copy/paste starting points; use the sketches here to understand the design tradeoffs.

## Details for Nerds

### Overview

Both approaches use the same core idea: **the state metadata bus** (`state.setMetadata(key, value)` to write; `state.getter.string/number/...(key)` for typed cast-free reads, or `state.getMetadata(key)` for the raw `unknown` you narrow yourself) to pass messages in and out of nodes. The differences are:

| Aspect | Request/response turn termination | Park-and-correlate handoff |
|--------|----------------------------|-----------------------------------|
| **When to use** | Conversational slot-filling, sequential dialogs, request/response cycles | HITL escalations, approvals, notifications, async hand-offs |
| **Pause mechanism** | Node returns a specific output → routes to a terminal → HTTP turn ends | DAG completes normally; admin action triggers SSE push to waiting client |
| **Resume** | Next HTTP request → new DAG execution with reloaded state | Out-of-band event (admin decision, callback) → client receives push |
| **Dependency injection** | Constructor args | Constructor args or request-scoped wrapper passed at construction |
| **Complexity** | Lower; familiar request/response model | Higher; requires event bus, queue, or webhook framework |

Choose turn-termination for conversational flows (the resume-generator use case). Choose out-of-band for HITL workflows where humans think in parallel to the DAG.

---

### Pattern 1: Request/response turn termination

#### How it works

A conversational DAG runs per HTTP request. The LLM (or a state machine) updates the conversation state. If more information is needed, the node returns a specific output that routes to a named terminal, ending the turn. The caller reads `state.getMetadata('assistantMessage')` and sends it to the user. The user's next message starts a fresh DAG execution with the persisted state object.

#### Example: slot-filling trip planner

```typescript
// TripState.ts — domain state
import { NodeStateBase } from '@studnicky/dagonizer';

export class TripState extends NodeStateBase {
  conversationId: string = '';
  preferences: Partial<{ budget: number; duration: string }> = {};
  handoff: HandoffState = { variant: 'empty' };
  // ... other fields
}

// HandoffState.ts — conversation machine
export type HandoffState =
  | { variant: 'empty' }
  | { variant: 'awaitingSlots'; nextQuestion: string }
  | { variant: 'ready'; normalizedPreferences: Record<string, unknown> };

// HandoffMachine.ts — reducer
export class HandoffMachine {
  static transition(
    state: HandoffState,
    event: { type: 'firstTurnExtracted' | 'slotsUpdated' | 'reset' },
    context: { extractedPreferences: Record<string, unknown> }
  ): HandoffState {
    if (state.variant === 'empty' && event.type === 'firstTurnExtracted') {
      const missing = Object.keys(context.extractedPreferences).length < 2;
      if (missing) {
        return { variant: 'awaitingSlots', nextQuestion: 'How long do you want to travel?' };
      }
      return { variant: 'ready', normalizedPreferences: context.extractedPreferences };
    }
    // ... more transitions
    return state;
  }
}

// IntakeNode.ts — the interactive node
import { Batch, MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { ItemType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';
import type { NodeContextType } from '@studnicky/dagonizer/entities';

export class IntakeNode extends MonadicNode<TripState, 'incomplete' | 'success'> {
  readonly name = 'intake';
  readonly outputs: readonly ('incomplete' | 'success')[] = ['incomplete', 'success'];

  constructor(private readonly llm: LLMAdapter) {
    super();
  }

  override get outputSchema(): Record<'incomplete' | 'success', SchemaObjectType> {
    return MonadicNode.permissiveSchema(this.outputs);
  }

  async execute(batch: Batch<TripState>, context: NodeContextType): Promise<RoutedBatchType<'incomplete' | 'success', TripState>> {
    // Nodes implement execute over a Batch; this node owns its per-item routing locally.
    const incomplete: ItemType<TripState>[] = [];
    const success: ItemType<TripState>[] = [];

    for (const item of batch) {
      const state = item.state;

      // Read inbound message from orchestrator (typed, cast-free)
      const userMessage = state.getter.string('userMessage');

      // Extract preferences with LLM or prompt
      const { extracted } = await this.llm.extract({
        message: userMessage,
        schema: PreferenceSchema,
        guidance: 'Extract travel preferences: budget, duration, destination.',
      });

      // Update state and check conversation state machine
      state.preferences = { ...state.preferences, ...extracted };
      state.handoff = HandoffMachine.transition(state.handoff, { type: 'slotsUpdated' }, {
        extractedPreferences: state.preferences,
      });

      // Write outbound message
      if (state.handoff.variant === 'awaitingSlots') {
        state.setMetadata('assistantMessage', {
          role: 'assistant',
          content: state.handoff.nextQuestion,
        });
        incomplete.push(item);
        continue;
      }

      // All slots filled; continue to specialist nodes
      state.setMetadata('assistantMessage', {
        role: 'assistant',
        content: 'Got it! Finding options for you...',
      });
      success.push(item);
    }

    return RoutedBatch.create([
      ['incomplete', Batch.from(incomplete)],
      ['success', Batch.from(success)],
    ]);
  }
}
```

#### Wiring the orchestrator

```typescript
// Orchestrator.ts
import { DAG_CONTEXT, Dagonizer } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

export class TripOrchestrator {
  private dispatcher: Dagonizer<TripState>;
  private stateStore: StateStore;

  assemble() {
    // Wire nodes with constructor injection
    const intake = new IntakeNode(this.llm);
    const retrieve = new RetrievalNode(this.searchEngine);
    const propose = new ProposalNode(this.templateEngine);

    const tripPlannerDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:trip-planner:dag',
      '@type': 'DAG',
      'name': 'trip-planner',
      'version': '1.0',
      'entrypoint': 'intake',
      'nodes': [
        {
          '@id': 'urn:noocodex:trip-planner:dag/intake',
          '@type': 'SingleNode',
          'name': 'intake',
          'node': 'intake',
          'outputs': {
            'success': 'retrieve',
            'incomplete': 'end-incomplete',
            'error': 'end-error',
          },
        },
        {
          '@id': 'urn:noocodex:trip-planner:dag/retrieve',
          '@type': 'SingleNode',
          'name': 'retrieve',
          'node': 'retrieve',
          'outputs': {
            'success': 'propose',
            'error': 'end-error',
          },
        },
        {
          '@id': 'urn:noocodex:trip-planner:dag/propose',
          '@type': 'SingleNode',
          'name': 'propose',
          'node': 'propose',
          'outputs': {
            'success': 'end-success',
            'error': 'end-error',
          },
        },
        {
          '@id': 'urn:noocodex:trip-planner:dag/end-incomplete',
          '@type': 'TerminalNode',
          'name': 'end-incomplete',
          'outcome': 'completed',
        },
        {
          '@id': 'urn:noocodex:trip-planner:dag/end-success',
          '@type': 'TerminalNode',
          'name': 'end-success',
          'outcome': 'completed',
        },
        {
          '@id': 'urn:noocodex:trip-planner:dag/end-error',
          '@type': 'TerminalNode',
          'name': 'end-error',
          'outcome': 'failed',
        },
      ],
    };

    this.dispatcher = new Dagonizer<TripState>();
    this.dispatcher.registerNode(intake);
    this.dispatcher.registerNode(retrieve);
    this.dispatcher.registerNode(propose);
    this.dispatcher.registerDAG(tripPlannerDag);
  }

  async runTurn(conversationId: string, userMessage: string): Promise<string> {
    // Load persisted state or create new
    let state = await this.stateStore.load(conversationId);
    if (!state) {
      state = new TripState();
      state.conversationId = conversationId;
    }

    // Seed metadata for this turn
    state.setMetadata('userMessage', userMessage);

    // Execute the DAG
    await this.dispatcher.execute('trip-planner', state);

    // Read response from metadata (raw unknown → narrow to your message shape)
    const raw = state.getMetadata('assistantMessage');
    const reply = (raw !== null && typeof raw === 'object' && 'content' in raw) ? raw : null;

    // Persist state for next turn
    await this.stateStore.save(conversationId, state);

    return reply?.content ?? 'Something went wrong.';
  }
}
```

#### Key properties

1. **No checkpoint/resume machinery**: Each turn is a fresh DAG execution. State is persisted in a store (database, file system, etc.), not via `Checkpoint.capture()`.

2. **Output routing is the pause trigger**: Returning `{ output: 'incomplete' }` routes to the `'incomplete'` terminal, which causes the top-level DAG to complete. The caller sees the completion and can return control to the user.

3. **State metadata is the message bus**: `userMessage` flows in, `assistantMessage` flows out. No other mechanism needed.

4. **Simple dependency injection**: Constructor args wire dependencies at instantiation time. The dispatcher is built once per orchestrator lifetime; nodes hold their dependencies as private fields.

5. **Familiar HTTP semantics**: POST /chat → runs DAG → reads `assistantMessage` → returns HTTP 200. GET /chat?id=X → loads state → GET /chat → next turn. No long-polling, no WebSocket complexity.

---

### Pattern 2: Park-and-correlate handoff

#### How it works

The DAG completes a turn normally, synchronously. A separate system (an event bus, queue, or webhook) holds HITL items (escalations, approvals, reviews). Humans act on the queue via a separate admin interface. When they decide, an event fires. A browser SSE stream, a message queue subscription, or a webhook handler receives the event and notifies the waiting client.

#### Example: refund escalation queue

```typescript
// RefundAgentServices.ts
export interface RefundAgentServices {
  readonly llm: LLMAdapter;
  readonly escalations: EscalationQueue;  // <-- HITL queue
  readonly ledger: RefundLedger;
  readonly store: Store;  // for auth state, config
  readonly eventBus: EventBus;  // for push notifications
}

// EscalationQueue.ts — the HITL queue
export interface Escalation {
  id: string;
  decision: 'refund' | 'deny' | 'escalate';
  customerId: string;
  conversationId: string;
  recommendation: string;
  createdAt: number;
}

export class EscalationQueue {
  private queue: Map<string, Escalation> = new Map();

  enqueue(
    decision: string,
    recommendation: string,
    customerId: string,
    conversationId: string,
    context: object
  ): Escalation {
    const item = {
      id: nanoid(),
      decision,
      customerId,
      conversationId,
      recommendation,
      createdAt: Date.now(),
    };
    this.queue.set(item.id, item);
    return item;
  }

  remove(id: string): void {
    this.queue.delete(id);
  }

  items(): Escalation[] {
    return Array.from(this.queue.values());
  }
}

// EventBus.ts — in-process pub/sub
export class EventBus {
  private listeners: Map<string, Set<(data: JsonValue) => void>> = new Map();

  subscribe(topic: string, listener: (data: JsonValue) => void): () => void {
    if (!this.listeners.has(topic)) {
      this.listeners.set(topic, new Set());
    }
    this.listeners.get(topic)!.add(listener);
    return () => this.listeners.get(topic)?.delete(listener);
  }

  publish(topic: string, data: JsonValue): void {
    this.listeners.get(topic)?.forEach(listener => listener(data));
  }
}

// EscalateForDecisionNode.ts — the HITL node
import { Batch, MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';
import type { NodeContextType } from '@studnicky/dagonizer/entities';

export class EscalateForDecisionNode
  extends MonadicNode<RefundAgentState, 'queued'>
{
  private readonly escalations: EscalationQueue;
  private readonly eventBus: EventBus;

  constructor(escalations: EscalationQueue, eventBus: EventBus) {
    this.escalations = escalations;
    this.eventBus = eventBus;
  }

  readonly name = 'escalate-for-decision';
  readonly outputs: readonly 'queued'[] = ['queued'];

  override get outputSchema(): Record<'queued', SchemaObjectType> {
    return { queued: { type: 'object' } };
  }

  async execute(
    batch: Batch<RefundAgentState>,
    context: NodeContextType
  ): Promise<RoutedBatchType<'queued', RefundAgentState>> {
    if (context.signal.aborted) return RoutedBatch.create();
    const { escalations, eventBus } = this;
    for (const row of batch) {
      const state = row.state;

      // Enqueue the decision for a human
      const item = escalations.enqueue(
        'review',
        `Customer requested refund for order ${state.orderId}. Policy allows if < 30 days.`,
        state.customerId,
        state.conversationId,
        { orderDate: state.orderDate }
      );

      // Publish to admin SSE stream
      eventBus.publish('escalations', { variant: 'queued', item });

      // Also publish to the customer's SSE stream (tell them to wait)
      eventBus.publish(`conversation:${state.customerId}`, {
        variant: 'pending',
        message: 'Your request is under review. You will be notified shortly.',
      });

      state.escalation = item;
    }
    return RoutedBatch.create('queued', batch);
  }
}
```

#### Wiring the orchestrator

```typescript
// ConversationEngine.ts
export class ConversationEngine {
  constructor(private eventBus: EventBus, private escalations: EscalationQueue) {}

  async runTurn(
    conversationId: string,
    customerId: string,
    userMessage: string
  ): Promise<Resolution> {
    // Dispatcher is constructed once; nodes hold their deps via constructor injection.
    const dispatcher = new Dagonizer<RefundAgentState>();

    // Load state
    let state = await this.stateStore.load(conversationId);
    if (!state) {
      state = new RefundAgentState();
      state.customerId = customerId;
      state.conversationId = conversationId;
    }

    state.setMetadata('userMessage', userMessage);

    // Execute the DAG
    const result = await dispatcher.execute('refund-turn', state);

    // Read output (raw unknown → narrow to your message shape)
    const raw = state.getMetadata('assistantMessage');
    const reply = (raw !== null && typeof raw === 'object' && 'content' in raw) ? raw : null;

    await this.stateStore.save(conversationId, state);

    return {
      reply: reply?.content ?? 'Something went wrong.',
      resolution: state.resolution, // 'approved', 'denied', or 'pending'
    };
  }
}

// Admin endpoint: approve escalation
export async function handleEscalationApprove(escalationId: string, decision: 'approve' | 'deny') {
  const item = escalations.queue.get(escalationId);
  if (!item) return { error: 'not found' };

  // Resolve in ledger
  if (decision === 'approve') {
    ledger.spend(item.customerId, 100);  // spend refund token
    const reply = 'Your refund has been approved!';

    // Notify customer via EventBus → SSE stream
    eventBus.publish(`conversation:${item.customerId}`, {
      variant: 'resolved',
      decision: 'approved',
      reply,
    });
  } else {
    eventBus.publish(`conversation:${item.customerId}`, {
      variant: 'resolved',
      decision: 'denied',
      reply: 'Unfortunately, your request does not qualify.',
    });
  }

  // Remove from queue
  escalations.remove(escalationId);

  // Notify admin stream
  eventBus.publish('escalations', { variant: 'resolved', itemId: escalationId, decision });

  return { ok: true };
}

// Customer SSE endpoint
export function makeSseStream(eventBus: EventBus, customerId: string) {
  return async function* sseGenerator() {
    const unsubscribe = eventBus.subscribe(`conversation:${customerId}`, (event) => {
      yield `data: ${JSON.stringify(event)}\n\n`;
    });

    try {
      // Keep stream alive
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 30000));
        yield `: heartbeat\n\n`;
      }
    } finally {
      unsubscribe();
    }
  };
}
```

#### Key properties

1. **DAG completes normally**: No special terminal routing. The DAG runs to completion; the caller reads `assistantMessage` and returns.

2. **Asynchronous handoff**: Humans work from a queue. The customer sees "your request is under review" immediately.

3. **Event-driven resolution**: Admin action publishes an event; the customer's SSE stream receives a push. No polling.

4. **Per-turn variation via constructor args**: When a node needs per-request context (auth, session, ledger), pass it in at construction time as a constructor argument. Nodes are registered per dispatcher instance; rebuild the dispatcher or use a factory that produces nodes with the appropriate per-turn state.

5. **Out-of-band state machine**: The escalation queue is separate from the DAG state. It can outlive an HTTP request.

---

### Choosing a pattern

| Your scenario | Pattern |
|---------------|---------|
| "I want a conversational bot that asks questions until it has all the info." | Turn-termination. Simpler, familiar. |
| "I want an LLM agent to make decisions, but escalate to a human when uncertain." | Out-of-band. The DAG completes; humans review async. |
| "I need streaming responses (Claude streaming tokens to the browser)." | Turn-termination with a `CallModelNode` subclass constructed with a `{ sink }` option — every `LlmAdapterInterface` implements `chatStream(request, sink)`. See [ReAct agent: live token streaming](./react-agent#live-token-streaming). |
| "I need multi-turn undo / branching conversations." | Either; add branches to the state machine. |
| "I need the same DAG to run from a CLI, an API, a queue worker, etc." | Out-of-band is more portable; turn-termination ties you to HTTP request/response. Both work with proper abstraction. |

---

### Dependency injection

Constructor injection is the dependency injection model. Nodes receive dependencies through their constructors and hold them as private fields.

```typescript
class IntakeNode extends MonadicNode<TripState, 'incomplete' | 'success'> {
  private readonly llm: LLMAdapter;
  readonly name = 'intake';
  readonly outputs: readonly ('incomplete' | 'success')[] = ['incomplete', 'success'];

  constructor(llm: LLMAdapter) {
    super();
    this.llm = llm;
  }
  // define execute(batch, context) — uses this.llm
}

const intake = new IntakeNode(this.llm);
dispatcher.registerNode(intake);
```

When a dependency varies per execution (for example, a per-request ledger keyed by `customerId`), construct the node with the appropriate instance before registering it, or restructure the dependency to be execution-agnostic (read the `customerId` from state inside the node, and pass a factory or a repository rather than a pre-built per-user object).

Nodes are testable in isolation: instantiate with a stub or fake, call `execute(Batch.of(state), context)` directly, and assert on the result without wiring a dispatcher.

---

### Common questions

**Q: How do I stream responses (e.g., Claude streaming tokens)?**

A: Every `LlmAdapterInterface` implements `chatStream(request, sink): Promise<ChatResponseType>` alongside the buffered `chat(request)`. Construct your `CallModelNode` subclass with a `{ sink: StreamSinkInterface<ChatStreamChunkType> }` option; the node forwards it to `adapter.chatStream(...)` and pushes one `{ delta }` chunk per token/fragment as the provider emits it. The sink is a pure observation channel — the assembled `ChatResponseType` is still written to state exactly as the buffered path writes it, so downstream nodes are unaffected. See [ReAct agent: live token streaming](./react-agent#live-token-streaming) and the [react-agent-memory example](../examples/react-agent-memory) for a complete working setup.

**Q: Can I checkpoint a turn and resume it later?**

A: Yes; see [checkpoint](./checkpoint). It's heavier than turn-termination, but necessary if you need to pause *inside* a node and resume from that exact point in a different process. Most conversational workflows don't need this.

**Q: What if a node needs to ask the user a question mid-execution?**

A: Return `'needs_more_info'` and route that output to a terminal. The caller reads `state.metadata('userQuestion')` and prompts. The next turn restarts the DAG with the answer in `state.metadata('userAnswer')`.

**Q: How do I handle multi-turn context / conversation history?**

A: Store it in `state` (not metadata). The orchestrator loads the persisted state; it already has the history. Each node appends to the history as needed.

**Q: Can I mix turn-termination and out-of-band in the same DAG?**

A: Yes. A node can enqueue an escalation (out-of-band) and continue. Or it can return `'escalated'` and route that to a terminal (turn-termination). Neither pattern is exclusive.

---

### Migration and adoption

To adopt these patterns:

1. **Start from the request/response state-machine shape** if you need slot filling. Keep the handoff state serializable and make the missing-slot question explicit in state metadata.

2. **Use the `state.metadata` bus** as documented here. It is already part of `NodeStateBase` in the framework.

3. **Use constructor injection** for all node dependencies. Pass the dependency at `new NodeClass(dep)` and hold it as a private field.

4. **Test nodes in isolation** with mock state and mocked services. The patterns are testable without a framework.

5. **Plan for persistence**: You own the state store. Use a database, file system, Redis, or whatever fits your deployment.

Reusable agent loops use `DAGBuilder` for topology, the eight agent node bases from `@studnicky/dagonizer/patterns` for state-specific behavior, and `AgentTraceProducer` for live reasoning traces.

---

### Agent loop {#agent-loop}

The patterns above describe how to structure a single DAG turn. When the agent
needs to call tools and loop back to the model with the results, the turn
contains the inner loop itself: build request → call model → inspect variant →
dispatch tools → collect results → loop.

#### The canonical 8-node topology

```
build-request
  └─ ready ──► call-model
                └─ text|tools|mixed ──► normalize-response
                     ├─ text  ──► append-assistant ──► end-done (completed)
                     └─ tools|mixed ──► decode-tools
                                          └─ decoded ──► normalize-tools
                                               └─ valid ──► worksets
                                                    └─ ready ──► dispatch-tools
                                                         (scatter: dagFrom: dagName)
                                                         └─ collect-results ──► build-request
```

Every LLM-with-tools agent repeats this structure. Author it as an explicit
JSON-LD `DAGType` so the verified topology remains visible while callers
subclass the node bases.

#### Agent DAG as JSON-LD

```ts
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer/builder';
import {
  BuildChatRequestNode,
  CallModelNode,
  NormalizeResponseNode,
  DecodeTextToolCallsNode,
  NormalizeToolCallsNode,
  BuildToolWorksetsNode,
  CollectToolResultsNode,
  AppendAssistantNode,
} from '@studnicky/dagonizer/patterns';

const nodes = {
  chatRequest:         new MyBuildChatRequestNode(),
  callModel:           new MyCallModelNode(llm),
  normalizeResponse:   new MyNormalizeResponseNode(),
  decodeTextToolCalls: new MyDecodeTextToolCallsNode(),
  normalizeToolCalls:  new MyNormalizeToolCallsNode(),
  toolWorksets:        new MyBuildToolWorksetsNode(),
  collectToolResults:  new MyCollectToolResultsNode(),
  appendAssistant:     new MyAppendAssistantNode(),
};

const dispatcher = new Dagonizer<AgentState>();
// Register all 8 nodes, tool bundle, and the authored DAG.
dispatcher.registerNode(nodes.chatRequest);
dispatcher.registerNode(nodes.callModel);
// … register remaining nodes …
dispatcher.registerBundle(toolRegistry.bundle()); // tool:<name> DAGs

const agentDag = new DAGBuilder('my-agent', '1')
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
  // Continue with normalize, decode, worksets, scatter, collect, terminals.
  .build();
dispatcher.registerDAG(agentDag);
```

#### Subclassing each base node

Each abstract base node separates framework concerns (error wrapping, routing)
from domain concerns (state reads and writes). Implement only the abstract
template methods for your state shape:

| Node | Template methods |
|------|-----------------|
| `BuildChatRequestNode` | `buildRequest(state, ctx): ChatRequestType` |
| `CallModelNode` | `getRequest(state, ctx)`, `storeResponse(state, response, ctx)` |
| `NormalizeResponseNode` | `getResponse(state, ctx): ChatResponseType \| null` |
| `DecodeTextToolCallsNode` | `getText(state, ctx)`, `storeToolCalls(state, calls, ctx)` |
| `NormalizeToolCallsNode` | `getToolCalls(state, ctx)`, `writeNormalized(state, calls, ctx)` |
| `BuildToolWorksetsNode` | `getToolCalls`, `classifyCall`, `writeSafeWorkset`, `writeExclusiveWorkset` |
| `CollectToolResultsNode` | `getGatheredResults(state, ctx)`, `writeResult(state, results, ctx)` |
| `AppendAssistantNode` | `getResponse(state, ctx)`, `append(state, response, ctx)` |

`CallModelNode` receives the `LlmAdapterInterface` via its constructor —
dependency injection at the node level:

```ts
class MyCallModelNode extends CallModelNode<AgentState> {
  readonly name = 'call-model';
  constructor(llm: LlmAdapterInterface) { super(llm); }

  protected getRequest(state: AgentState, _ctx: NodeContextType): ChatRequestType {
    if (state.chatRequest === null) throw new Error('chatRequest not set');
    return state.chatRequest;
  }

  protected storeResponse(state: AgentState, response: ChatResponseType, _ctx: NodeContextType): void {
    state.chatResponse = response;
  }
}
```

#### Tool dispatch via dagFrom

`BuildToolWorksetsNode` stamps each scatter item with
`dagName: 'tool:' + call.name`. The scatter placement uses
`{ dagFrom: 'dagName' }` so the engine resolves the body DAG from each item at
runtime. Register tool DAGs with `toolRegistry.bundle()`:

```ts
import { ToolRegistry } from '@studnicky/dagonizer/tool';

const tools = new ToolRegistry();
tools.register(new MyCalculatorTool());
tools.register(new MySearchTool());

dispatcher.registerBundle(tools.bundle());
// Registers tool:calculator and tool:search as embeddable DAGs.
```

## Related Concepts

- [State & metadata](./shared-state) - use state.metadata as the inter-node IO bus
- [Checkpoint & resume](./checkpoint) - persist and reload state across process boundaries
- [Dependency injection](./services) - inject IO adapters via node constructors
- [Example 29: Agent DAG](../examples/29-agent-dag) - working example of the 8-node agent loop with stub LLM
- [Chat Event Orchestration](./chat-event-orchestration) - run one registered agent DAG per inbound event or request turn
- [ReAct agent: streaming + provenance recall](./react-agent) - the 8-node loop as ReAct, trace streaming, live token deltas, provenance recall
- [Lifecycle phases](./lifecycle-phases) - understand when a DAG completes vs. when it pauses
- [ReAct Agent Memory](../examples/react-agent-memory) - trace streaming, live token deltas, and graph provenance recall
- [ReAct Agent Routing](../examples/react-agent-routing) - concurrent stream routing by `routeKey`
