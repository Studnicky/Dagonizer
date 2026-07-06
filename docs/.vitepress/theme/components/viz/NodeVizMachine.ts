/**
 * NodeVizMachine: visual-state FSM for one cytoscape node.
 *
 *   ┌─────────┐  start   ┌────────┐  end    ┌───────────┐
 *   │ pending ├─────────►│ active ├────────►│ completed │
 *   └────┬────┘          └───┬────┘         └──────┬────┘
 *        │                   │                     │
 *        │ reset             │ error               │ reset
 *        │                   ▼                     │
 *        │              ┌──────────┐               │
 *        │              │ errored  │               │
 *        │              └────┬─────┘               │
 *        │                   │ reset               │
 *        └◄──────────────────┴◄────────────────────┘
 *
 * The dispatcher's observer hooks fire as named events
 * (`start` / `end` / `error` / `reset`). The transition table is the
 * single source of truth; invalid transitions are no-ops (the machine
 * never crashes on a stray event). Each transition runs an
 * `onEnter[nextState]` action that drives cytoscape via the supplied
 * `NodeVizAdapter`, keeping the FSM pure (no cytoscape import).
 */

import type { FsmStepType } from '@studnicky/fsm';
import { StateMachine } from '@studnicky/fsm';

export type NodeVizState = 'pending' | 'active' | 'completed' | 'errored';

export type NodeVizEventKind = 'start' | 'end' | 'error' | 'reset';

export interface NodeVizEvent {
  readonly type: NodeVizEventKind;
}

/** Cytoscape operations the FSM delegates to. Keeps the FSM testable. */
export interface NodeVizAdapter {
  addClass(name: string): void;
  removeClass(name: string): void;
  pulse(): void;
  shake(): void;
  /** Stop any in-flight animations on this node; used on reset. */
  stop(): void;
}

const TRANSITIONS: Readonly<Record<NodeVizState, Partial<Record<NodeVizEventKind, NodeVizState>>>> = {
  pending:   { start: 'active', reset: 'pending' },
  active:    { end:   'completed', error: 'errored', reset: 'pending' },
  // `start` re-activates a settled node so it re-pulses. A scatter routes many
  // items through the SAME body-DAG cytoscape node; without this, the node
  // latches to `completed` after the first item and every later pass is a
  // no-op, so the animation thins out and stops mid-run. Re-activation keeps
  // the graph alive under sustained throughput; single-pass flows (each node
  // fires once) are unaffected.
  completed: { start: 'active', reset: 'pending' },
  errored:   { start: 'active', reset: 'pending' },
};

/** Class names added on entry to each visual state. */
const ENTRY_CLASS: Readonly<Record<NodeVizState, string | null>> = {
  pending:   null,
  active:    'dag-active',
  completed: 'dag-completed',
  errored:   'dag-errored',
};

/** Classes to remove on entry; keeps the cytoscape class set in sync. */
const EXIT_CLASSES: Readonly<Record<NodeVizState, readonly string[]>> = {
  pending:   ['dag-active', 'dag-completed', 'dag-errored'],
  active:    ['dag-completed', 'dag-errored'],
  completed: ['dag-active', 'dag-errored'],
  errored:   ['dag-active', 'dag-completed'],
};

type NodeVizStateRecord = { readonly variant: NodeVizState };

class NodeVizReducer extends StateMachine<NodeVizStateRecord, NodeVizEvent, never> {
  constructor() {
    super();
  }

  getInitialState(): NodeVizStateRecord {
    return { 'variant': 'pending' };
  }

  reduce(state: NodeVizStateRecord, event: NodeVizEvent): FsmStepType<NodeVizStateRecord, never> {
    const next = TRANSITIONS[state.variant][event.type] ?? state.variant;
    return { 'state': { 'variant': next }, 'effects': [] };
  }
}

const NODE_VIZ_REDUCER = new NodeVizReducer();

export class NodeVizMachine {
  #state: NodeVizStateRecord = NODE_VIZ_REDUCER.getInitialState();
  readonly #adapter: NodeVizAdapter;

  constructor(adapter: NodeVizAdapter) {
    this.#adapter = adapter;
  }

  get state(): NodeVizState { return this.#state.variant; }

  /**
   * Dispatch an event. Returns the new state (which may equal the
   * previous state when the event doesn't apply; a no-op is a valid
   * outcome, not an error).
   */
  dispatch(event: NodeVizEvent): NodeVizState {
    const current = this.#state;
    const step = NODE_VIZ_REDUCER.transition(current, event);
    const next = step.state.variant;
    if (next === current.variant) return current.variant;
    this.#applyExit(current.variant, next);
    this.#state = step.state;
    this.#applyEntry(next);
    return next;
  }

  #applyExit(from: NodeVizState, to: NodeVizState): void {
    // Remove any classes that don't belong in the next state's set.
    for (const cls of EXIT_CLASSES[to]) {
      const fromClass = ENTRY_CLASS[from];
      if (fromClass === cls) this.#adapter.removeClass(cls);
    }
    if (to === 'pending') this.#adapter.stop();
  }

  #applyEntry(next: NodeVizState): void {
    const cls = ENTRY_CLASS[next];
    if (cls !== null) this.#adapter.addClass(cls);
    if (next === 'active')  this.#adapter.pulse();
    if (next === 'errored') this.#adapter.shake();
  }
}
