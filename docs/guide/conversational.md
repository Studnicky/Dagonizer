---
title: 'Conversational & interactive nodes'
description: 'Patterns for slot-filling, turn-based dialogs, and human-in-the-loop workflows within a DAG.'
seeAlso:
  - text: 'State & metadata'
    link: './shared-state'
    description: 'use state.metadata as the inter-node IO bus'
  - text: 'Checkpoint & resume'
    link: './checkpoint'
    description: 'persist and reload state across process boundaries'
  - text: 'Services container'
    link: './services'
    description: 'inject IO adapters via constructor or context.services'
  - text: 'Lifecycle phases'
    link: './lifecycle-phases'
    description: 'understand when a DAG completes vs. when it pauses'
---

# Conversational & interactive nodes

Interactive DAGs — those that prompt users, wait for responses, escalate to humans, or stream results — present a challenge: the input/output cannot flow through serializable `state.params` when it is ephemeral (a live socket, a request/response pair, an SSE stream, a queue item). This guide documents two proven patterns for threading non-serializable IO through a DAG.

## Overview

Both approaches use the same core idea: **the state metadata bus** (`state.getMetadata<T>(key)` / `state.setMetadata(key, value)`) to pass messages in and out of nodes. The differences are:

| Aspect | Turn-termination (nocturne) | Out-of-band signaling (Foundersmax) |
|--------|----------------------------|-----------------------------------|
| **When to use** | Conversational slot-filling, sequential dialogs, request/response cycles | HITL escalations, approvals, notifications, async hand-offs |
| **Pause mechanism** | Node returns a specific output → routes to a terminal → HTTP turn ends | DAG completes normally; admin action triggers SSE push to waiting client |
| **Resume** | Next HTTP request → new DAG execution with reloaded state | Out-of-band event (admin decision, callback) → client receives push |
| **Dependency injection** | Constructor args (recommended) or `context.services` | `context.services` per-turn (flexible for auth/session scope) |
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
  handoff: HandoffState = { kind: 'empty' };
  // ... other fields
}

// HandoffState.ts — conversation machine
export type HandoffState =
  | { kind: 'empty' }
  | { kind: 'awaiting_slots'; nextQuestion: string }
  | { kind: 'ready'; normalizedPreferences: Record<string, unknown> };

// HandoffMachine.ts — reducer
export class HandoffMachine {
  static transition(
    state: HandoffState,
    event: { type: 'firstTurnExtracted' | 'slotsUpdated' | 'reset' },
    context: { extractedPreferences: Record<string, unknown> }
  ): HandoffState {
    if (state.kind === 'empty' && event.type === 'firstTurnExtracted') {
      const missing = Object.keys(context.extractedPreferences).length < 2;
      if (missing) {
        return { kind: 'awaiting_slots', nextQuestion: 'How long do you want to travel?' };
      }
      return { kind: 'ready', normalizedPreferences: context.extractedPreferences };
    }
    // ... more transitions
    return state;
  }
}

// IntakeNode.ts — the interactive node
import type { NodeInterface, NodeOutputInterface } from '@studnicky/dagonizer';

export class IntakeNode implements NodeInterface<TripState, 'incomplete' | 'success'> {
  readonly name = 'intake';
  readonly outputs = ['incomplete', 'success'] as const;

  constructor(private readonly llm: LLMAdapter) {}

  async execute(state: TripState): Promise<NodeOutputInterface<'incomplete' | 'success'>> {
    // Read inbound message from orchestrator
    const userMessage = state.getMetadata<string>('userMessage') ?? '';

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
    if (state.handoff.kind === 'awaiting_slots') {
      state.setMetadata('assistantMessage', {
        role: 'assistant',
        content: state.handoff.nextQuestion,
      });
      // Return 'incomplete' → route to 'incomplete' terminal → HTTP turn ends
      return { output: 'incomplete' };
    }

    // All slots filled; continue to specialist nodes
    state.setMetadata('assistantMessage', {
      role: 'assistant',
      content: 'Got it! Finding options for you...',
    });
    return { output: 'success' };
  }
}
```

### Wiring the orchestrator

```typescript
// Orchestrator.ts
import { Dagonizer, DagBlueprint } from '@studnicky/dagonizer';

export class TripOrchestrator {
  private dagonizer: Dagonizer<TripState>;
  private stateStore: StateStore;

  async assemble() {
    // Wire nodes with constructor injection (no services bag needed)
    const intake = new IntakeNode(this.llm);
    const retrieve = new RetrievalNode(this.searchEngine);
    const propose = new ProposalNode(this.templateEngine);

    // Build the DAG
    const blueprint = DagBlueprint.create<TripState>('trip-planner')
      .route('intake', 'success', 'retrieve')
      .route('intake', 'incomplete', 'incomplete')  // terminal
      .route('retrieve', 'success', 'propose')
      .route('propose', 'success', 'respond')
      .terminal('incomplete')
      .terminal('success');

    // Construct dispatcher with no services (optional; could use context.services too)
    this.dagonizer = new Dagonizer<TripState>(blueprint);
    this.dagonizer.register('intake', intake);
    this.dagonizer.register('retrieve', retrieve);
    this.dagonizer.register('propose', propose);
    // ... register other nodes
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
    const result = await this.dagonizer.execute('trip-planner', state);

    // Read response from metadata
    const reply = state.getMetadata<AssistantMessage>('assistantMessage');

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

4. **Simple dependency injection**: Constructor args or `context.services` both work. Use constructor args when the dispatcher is built once per orchestrator lifetime (as here).

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
import type { NodeContextInterface } from '@studnicky/dagonizer';

export class EscalateForDecisionNode
  implements NodeInterface<RefundAgentState, 'queued'>
{
  readonly name = 'escalate-for-decision';
  readonly outputs = ['queued'] as const;

  async execute(
    state: RefundAgentState,
    context: NodeContextInterface<RefundAgentServices>
  ): Promise<NodeOutputInterface<'queued'>> {
    const { escalations, eventBus } = context.services;

    // Enqueue the decision for a human
    const item = escalations.enqueue(
      'review',
      `Customer requested refund for order ${state.orderId}. Policy allows if < 30 days.`,
      state.customerId,
      state.conversationId,
      { orderDate: state.orderDate }
    );

    // Publish to admin SSE stream
    eventBus.publish('escalations', { kind: 'queued', item });

    // Also publish to the customer's SSE stream (tell them to wait)
    eventBus.publish(`conversation:${state.customerId}`, {
      kind: 'pending',
      message: 'Your request is under review. You will be notified shortly.',
    });

    state.escalation = item;
    return { output: 'queued' };
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
    // Build per-turn services (auth, session state, etc. are fresh)
    const turnServices: RefundAgentServices = {
      llm: this.llm,
      escalations: this.escalations,
      eventBus: this.eventBus,
      ledger: new RefundLedger(customerId),
      store: this.store,
    };

    // Create dispatcher with services
    const dispatcher = new Dagonizer<RefundAgentState, RefundAgentServices>({
      services: turnServices,
    });

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

    // Read output
    const reply = state.getMetadata<AssistantMessage>('assistantMessage');

    await this.stateStore.save(conversationId, state);

    return {
      reply: reply?.content ?? 'Something went wrong.',
      resolutionKind: state.resolutionKind, // 'approved', 'denied', or 'pending'
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
      kind: 'resolved',
      decision: 'approved',
      reply,
    });
  } else {
    eventBus.publish(`conversation:${item.customerId}`, {
      kind: 'resolved',
      decision: 'denied',
      reply: 'Unfortunately, your request does not qualify.',
    });
  }

  // Remove from queue
  escalations.remove(escalationId);

  // Notify admin stream
  eventBus.publish('escalations', { kind: 'resolved', itemId: escalationId, decision });

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

4. **Per-turn service rebuild**: Each HTTP request gets fresh services (auth, session, ledger state, etc.). Useful when sessions have mutable context.

5. **Out-of-band state machine**: The escalation queue is separate from the DAG state. It can outlive an HTTP request.

---

## Choosing a pattern

| Your scenario | Pattern |
|---------------|---------|
| "I want a conversational bot that asks questions until it has all the info." | Turn-termination. Simpler, familiar. |
| "I want an LLM agent to make decisions, but escalate to a human when uncertain." | Out-of-band. The DAG completes; humans review async. |
| "I need streaming responses (Claude streaming tokens to the browser)." | Turn-termination with a per-node streaming callback. See [observability](./observability). |
| "I need multi-turn undo / branching conversations." | Either; add branches to the state machine. |
| "I need the same DAG to run from a CLI, an API, a queue worker, etc." | Out-of-band is more portable; turn-termination ties you to HTTP request/response. Both work with proper abstraction. |

---

## Dependency injection patterns

### Option A: Constructor injection (recommended for turn-termination)

```typescript
class IntakeNode implements NodeInterface<TripState, 'incomplete' | 'success'> {
  constructor(private readonly llm: LLMAdapter) {}
  async execute(state: TripState) { /* uses this.llm */ }
}

orchestrator.assemble();
const intake = new IntakeNode(this.llm);
dagonizer.register('intake', intake);
```

**Pros**: Simple, testable in isolation, no framework container.  
**Cons**: Must wire all dependencies at `assemble()` time.

### Option B: context.services (better for per-turn variation)

```typescript
interface MyServices {
  readonly llm: LLMAdapter;
  readonly ledger: Ledger;
}

class IntakeNode implements NodeInterface<TripState, 'incomplete' | 'success', MyServices> {
  async execute(state: TripState, context: NodeContextInterface<MyServices>) {
    const { llm } = context.services;
    // uses context.services.llm
  }
}

const dispatcher = new Dagonizer<TripState, MyServices>({
  services: { llm: this.llm, ledger: this.ledger },
});
```

**Pros**: Services can vary per execution (rebuild dispatcher per turn with fresh auth, etc.).  
**Cons**: Dispatcher is constructor-scoped; same services flow to all nodes. Use shared node state if you need execution-scoped variation.

---

## Common questions

**Q: How do I stream responses (e.g., Claude streaming tokens)?**

A: The DAG doesn't know about HTTP streams. Return `'incomplete'` or `'success'` and let the caller handle streaming. Or pass a callback in `state.metadata` that the node invokes to write chunks. See [observability](./observability) for instrumentation hooks.

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

3. **Pick constructor injection or context.services** based on your service lifetime (once per orchestrator vs. once per turn).

4. **Test nodes in isolation** with mock state and mocked services. The patterns are testable without a framework.

5. **Plan for persistence**: You own the state store. Use a database, file system, Redis, or whatever fits your deployment.

Future versions of `@studnicky/dagonizer` will export `HandoffMachine` and an `InteractiveNode` base class as optional consumables, reducing boilerplate across projects.
