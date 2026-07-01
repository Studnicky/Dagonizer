---
title: 'Conversational & interactive nodes'
description: 'Patterns for slot-filling, turn-based dialogs, human-in-the-loop workflows, and the canonical 8-node agent loop (AgentBuilder) within a DAG.'
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
  - text: 'Example 29: AgentBuilder'
    link: '../examples/29-agent-builder'
    description: 'working example of the 8-node agent loop with stub LLM'
  - text: 'ReAct agent: streaming + provenance recall'
    link: './react-agent'
    description: 'the 8-node loop as ReAct, trace streaming, live token deltas, provenance recall'
  - text: 'Lifecycle phases'
    link: './lifecycle-phases'
    description: 'understand when a DAG completes vs. when it pauses'
---

# Conversational & interactive nodes

Interactive DAGs — those that prompt users, wait for responses, escalate to humans, or stream results — present a challenge: the input/output cannot flow through serializable `state.params` when it is ephemeral (a live socket, a request/response pair, an SSE stream, a queue item). This guide documents two proven patterns for threading non-serializable IO through a DAG.

## Overview

Both approaches use the same core idea: **the state metadata bus** (`state.setMetadata(key, value)` to write; `state.getter.string/number/...(key)` for typed cast-free reads, or `state.getMetadata(key)` for the raw `unknown` you narrow yourself) to pass messages in and out of nodes. The differences are:

| Aspect | Turn-termination (nocturne) | Out-of-band signaling (Foundersmax) |
|--------|----------------------------|-----------------------------------|
| **When to use** | Conversational slot-filling, sequential dialogs, request/response cycles | HITL escalations, approvals, notifications, async hand-offs |
| **Pause mechanism** | Node returns a specific output → routes to a terminal → HTTP turn ends | DAG completes normally; admin action triggers SSE push to waiting client |
| **Resume** | Next HTTP request → new DAG execution with reloaded state | Out-of-band event (admin decision, callback) → client receives push |
| **Dependency injection** | Constructor args | Constructor args or request-scoped wrapper passed at construction |
| **Complexity** | Lower; familiar request/response model | Higher; requires event bus, queue, or webhook framework |

Choose turn-termination for conversational flows (the resume-generator use case). Choose out-of-band for HITL workflows where humans think in parallel to the DAG.

---

## Pattern 1: Turn-termination (conversational)

### How it works

A conversational DAG runs per HTTP request. The LLM (or a state machine) updates the conversation state. If more information is needed, the node returns a specific output that routes to a named terminal, ending the turn. The caller reads `state.getMetadata('assistantMessage')` and sends it to the user. The user's next message starts a fresh DAG execution with the persisted state object.

### Example: slot-filling trip planner

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
import type { NodeInterface } from '@studnicky/dagonizer';
import type { NodeOutputType } from '@studnicky/dagonizer/entities';
import { NodeOutputBuilder } from '@studnicky/dagonizer/entities';

export class IntakeNode implements NodeInterface<TripState, 'incomplete' | 'success'> {
  readonly name = 'intake';
  readonly outputs = ['incomplete', 'success'] as const;

  constructor(private readonly llm: LLMAdapter) {}

  async execute(batch: Batch<TripState>, context: NodeContextType): Promise<RoutedBatchType<'incomplete' | 'success', TripState>> {
    // Nodes implement execute over a Batch; this shows the per-item pattern for clarity.
    // In practice, extend ScalarNode and implement executeOne instead.
    const state = batch.items[0].state;

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
      // Return 'incomplete' → route to 'incomplete' terminal → HTTP turn ends
      return NodeOutputBuilder.of('incomplete');
    }

    // All slots filled; continue to specialist nodes
    state.setMetadata('assistantMessage', {
      role: 'assistant',
      content: 'Got it! Finding options for you...',
    });
    return NodeOutputBuilder.of('success');
  }
}
```

### Wiring the orchestrator

```typescript
// Orchestrator.ts
import { Dagonizer } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer/builder';

export class TripOrchestrator {
  private dispatcher: Dagonizer<TripState>;
  private stateStore: StateStore;

  assemble() {
    // Wire nodes with constructor injection
    const intake = new IntakeNode(this.llm);
    const retrieve = new RetrievalNode(this.searchEngine);
    const propose = new ProposalNode(this.templateEngine);

    // Build the DAG using DAGBuilder
    const dag = new DAGBuilder('trip-planner', '1.0')
      .node('intake',    intake,    { success: 'retrieve', incomplete: 'end-incomplete' })
      .node('retrieve',  retrieve,  { success: 'propose' })
      .node('propose',   propose,   { success: 'end-success' })
      .terminal('end-incomplete')
      .terminal('end-success')
      .build();

    this.dispatcher = new Dagonizer<TripState>();
    this.dispatcher.registerNode(intake);
    this.dispatcher.registerNode(retrieve);
    this.dispatcher.registerNode(propose);
    this.dispatcher.registerDAG(dag);
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

### Key properties

1. **No checkpoint/resume machinery**: Each turn is a fresh DAG execution. State is persisted in a store (database, file system, etc.), not via `Checkpoint.capture()`.

2. **Output routing is the pause trigger**: Returning `{ output: 'incomplete' }` routes to the `'incomplete'` terminal, which causes the top-level DAG to complete. The caller sees the completion and can return control to the user.

3. **State metadata is the message bus**: `userMessage` flows in, `assistantMessage` flows out. No other mechanism needed.

4. **Simple dependency injection**: Constructor args wire dependencies at instantiation time. The dispatcher is built once per orchestrator lifetime; nodes hold their dependencies as private fields.

5. **Familiar HTTP semantics**: POST /chat → runs DAG → reads `assistantMessage` → returns HTTP 200. GET /chat?id=X → loads state → GET /chat → next turn. No long-polling, no WebSocket complexity.

---

## Pattern 2: Out-of-band signaling (HITL)

### How it works

The DAG completes a turn normally, synchronously. A separate system (an event bus, queue, or webhook) holds HITL items (escalations, approvals, reviews). Humans act on the queue via a separate admin interface. When they decide, an event fires. A browser SSE stream, a message queue subscription, or a webhook handler receives the event and notifies the waiting client.

### Example: refund escalation queue

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
import type { NodeInterface } from '@studnicky/dagonizer';
import type { NodeContextType } from '@studnicky/dagonizer/entities';
import { NodeOutputBuilder } from '@studnicky/dagonizer/entities';

export class EscalateForDecisionNode
  implements NodeInterface<RefundAgentState, 'queued'>
{
  private readonly escalations: EscalationQueue;
  private readonly eventBus: EventBus;

  constructor(escalations: EscalationQueue, eventBus: EventBus) {
    this.escalations = escalations;
    this.eventBus = eventBus;
  }

  readonly name = 'escalate-for-decision';
  readonly outputs = ['queued'] as const;

  async execute(
    batch: Batch<RefundAgentState>,
    _context: NodeContextType
  ): Promise<RoutedBatchType<'queued', RefundAgentState>> {
    const { escalations, eventBus } = this;
    const state = batch.items[0].state;

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
    return NodeOutputBuilder.of('queued');
  }
}
```

### Wiring the orchestrator

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

### Key properties

1. **DAG completes normally**: No special terminal routing. The DAG runs to completion; the caller reads `assistantMessage` and returns.

2. **Asynchronous handoff**: Humans work from a queue. The customer sees "your request is under review" immediately.

3. **Event-driven resolution**: Admin action publishes an event; the customer's SSE stream receives a push. No polling.

4. **Per-turn variation via constructor args**: When a node needs per-request context (auth, session, ledger), pass it in at construction time as a constructor argument. Nodes are registered per dispatcher instance; rebuild the dispatcher or use a factory that produces nodes with the appropriate per-turn state.

5. **Out-of-band state machine**: The escalation queue is separate from the DAG state. It can outlive an HTTP request.

---

## Choosing a pattern

| Your scenario | Pattern |
|---------------|---------|
| "I want a conversational bot that asks questions until it has all the info." | Turn-termination. Simpler, familiar. |
| "I want an LLM agent to make decisions, but escalate to a human when uncertain." | Out-of-band. The DAG completes; humans review async. |
| "I need streaming responses (Claude streaming tokens to the browser)." | Turn-termination with a `CallModelNode` subclass constructed with a `{ sink }` option — every `LlmAdapterInterface` implements `chatStream(request, sink)`. See [ReAct agent: live token streaming](./react-agent#live-token-streaming). |
| "I need multi-turn undo / branching conversations." | Either; add branches to the state machine. |
| "I need the same DAG to run from a CLI, an API, a queue worker, etc." | Out-of-band is more portable; turn-termination ties you to HTTP request/response. Both work with proper abstraction. |

---

## Dependency injection

Constructor injection is the dependency injection model. Nodes receive dependencies through their constructors and hold them as private fields.

```typescript
class IntakeNode implements NodeInterface<TripState, 'incomplete' | 'success'> {
  private readonly llm: LLMAdapter;

  constructor(llm: LLMAdapter) {
    super();
    this.llm = llm;
  }
  // implements execute(batch, context) — uses this.llm
}

const intake = new IntakeNode(this.llm);
dispatcher.registerNode(intake);
```

When a dependency varies per execution (for example, a per-request ledger keyed by `customerId`), construct the node with the appropriate instance before registering it, or restructure the dependency to be execution-agnostic (read the `customerId` from state inside the node, and pass a factory or a repository rather than a pre-built per-user object).

Nodes are testable in isolation: instantiate with a stub or fake, call `execute` or `executeOne` directly, and assert on the result without wiring a dispatcher.

---

## Common questions

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

## Migration and adoption

Both nocturne and Foundersmax demonstrate these patterns. To adopt:

1. **Copy the `HandoffState` and `HandoffMachine`** from nocturne if you need a slot-filling state machine. They are domain-agnostic.

2. **Use the `state.metadata` bus** as documented here. It is already part of `NodeStateBase` in the framework.

3. **Use constructor injection** for all node dependencies. Pass the dependency at `new NodeClass(dep)` and hold it as a private field.

4. **Test nodes in isolation** with mock state and mocked services. The patterns are testable without a framework.

5. **Plan for persistence**: You own the state store. Use a database, file system, Redis, or whatever fits your deployment.

Future versions of `@studnicky/dagonizer` will export `HandoffMachine` and an `InteractiveNode` base class as optional consumables, reducing boilerplate across projects.

---

## Agent loop {#agent-loop}

The patterns above describe how to structure a single DAG turn. When the agent
needs to call tools and loop back to the model with the results, the turn
contains the inner loop itself: build request → call model → inspect variant →
dispatch tools → collect results → loop.

### The canonical 8-node topology

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

Every LLM-with-tools agent repeats this structure. `AgentBuilder.loop` captures
the verified topology so callers subclass rather than re-wire.

### AgentBuilder.loop

```ts
import {
  AgentBuilder,
  BuildChatRequestNode,
  CallModelNode,
  NormalizeResponseNode,
  DecodeTextToolCallsNode,
  NormalizeToolCallsNode,
  BuildToolWorksetsNode,
  CollectToolResultsNode,
  AppendAssistantNode,
} from '@studnicky/dagonizer/patterns';
import type { AgentLoopNodesType } from '@studnicky/dagonizer/patterns';

const nodes: AgentLoopNodesType = {
  chatRequest:         new MyBuildChatRequestNode(),
  callModel:           new MyCallModelNode(llm),
  normalizeResponse:   new MyNormalizeResponseNode(),
  decodeTextToolCalls: new MyDecodeTextToolCallsNode(),
  normalizeToolCalls:  new MyNormalizeToolCallsNode(),
  toolWorksets:        new MyBuildToolWorksetsNode(),
  collectToolResults:  new MyCollectToolResultsNode(),
  appendAssistant:     new MyAppendAssistantNode(),
};

// Assemble the DAGType in one call.
const dag = AgentBuilder.loop(nodes, { name: 'my-agent', version: '1' });

const dispatcher = new Dagonizer<AgentState>();
// Register all 8 nodes, tool bundle, and the assembled DAG.
dispatcher.registerNode(nodes.chatRequest);
dispatcher.registerNode(nodes.callModel);
// … register remaining nodes …
dispatcher.registerBundle(toolRegistry.bundle()); // tool:<name> DAGs
dispatcher.registerDAG(dag);
```

### Subclassing each base node

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

### Tool dispatch via dagFrom

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

### Cross-reference

See [Example 29: AgentBuilder](../examples/29-agent-builder) for a complete
working example with a stub LLM adapter and all 8 subclasses wired end-to-end.

See [ReAct agent: streaming + provenance recall](./react-agent) for the ReAct
vocabulary mapped onto this loop, streaming the reasoning trace, live token
streaming via `CallModelNode { sink }`, and recording/recalling reasoning with
graph provenance.
