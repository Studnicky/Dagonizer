/**
 * NodeVizMachine — visual-state FSM for one cytoscape node.
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
 * `NodeVizAdapter` — keeping the FSM pure (no cytoscape import).
 */

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
  /** Stop any in-flight animations on this node — used on reset. */
  stop(): void;
}

const TRANSITIONS: Readonly<Record<NodeVizState, Partial<Record<NodeVizEventKind, NodeVizState>>>> = {
  pending:   { start: 'active', reset: 'pending' },
  active:    { end:   'completed', error: 'errored', reset: 'pending' },
  completed: { reset: 'pending' },
  errored:   { reset: 'pending' },
};

/** Class names added on entry to each visual state. */
const ENTRY_CLASS: Readonly<Record<NodeVizState, string | null>> = {
  pending:   null,
  active:    'dag-active',
  completed: 'dag-completed',
  errored:   'dag-errored',
};

/** Classes to remove on entry — keeps the cytoscape class set in sync. */
const EXIT_CLASSES: Readonly<Record<NodeVizState, readonly string[]>> = {
  pending:   ['dag-active', 'dag-completed', 'dag-errored'],
  active:    ['dag-completed', 'dag-errored'],
  completed: ['dag-active', 'dag-errored'],
  errored:   ['dag-active', 'dag-completed'],
};

export class NodeVizMachine {
  #state: NodeVizState = 'pending';
  readonly #adapter: NodeVizAdapter;

  constructor(adapter: NodeVizAdapter) {
    this.#adapter = adapter;
  }

  get state(): NodeVizState { return this.#state; }

  /**
   * Dispatch an event. Returns the new state (which may equal the
   * previous state when the event doesn't apply — a no-op is a valid
   * outcome, not an error).
   */
  dispatch(event: NodeVizEvent): NodeVizState {
    const next = TRANSITIONS[this.#state][event.type];
    if (next === undefined || next === this.#state) return this.#state;
    this.#applyExit(this.#state, next);
    this.#state = next;
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
