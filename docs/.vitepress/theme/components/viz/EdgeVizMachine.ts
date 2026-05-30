/**
 * EdgeVizMachine: visual-state FSM for one cytoscape edge.
 *
 *   ┌──────┐  traverse   ┌───────────┐
 *   │ idle ├────────────►│ traversed │
 *   └──┬───┘             └─────┬─────┘
 *      │                       │
 *      └────────reset──────────┘
 *
 * Entering `traversed` plays a brief flash animation (line color +
 * width pulse) so the visitor catches the moment the dispatcher
 * routes through that edge. The persistent `dag-traversed` class
 * styles the edge afterwards so it stays distinguishable.
 */

export type EdgeVizState = 'idle' | 'traversed';

export type EdgeVizEventKind = 'traverse' | 'reset';

export interface EdgeVizEvent {
  readonly type: EdgeVizEventKind;
}

export interface EdgeVizAdapter {
  addClass(name: string): void;
  removeClass(name: string): void;
  /** Brief line-color + width flash. */
  flash(): void;
  stop(): void;
}

const TRANSITIONS: Readonly<Record<EdgeVizState, Partial<Record<EdgeVizEventKind, EdgeVizState>>>> = {
  idle:      { traverse: 'traversed', reset: 'idle' },
  traversed: { reset: 'idle' },
};

const ENTRY_CLASS: Readonly<Record<EdgeVizState, string | null>> = {
  idle:      null,
  traversed: 'dag-traversed',
};

export class EdgeVizMachine {
  #state: EdgeVizState = 'idle';
  readonly #adapter: EdgeVizAdapter;

  constructor(adapter: EdgeVizAdapter) {
    this.#adapter = adapter;
  }

  get state(): EdgeVizState { return this.#state; }

  dispatch(event: EdgeVizEvent): EdgeVizState {
    const next = TRANSITIONS[this.#state][event.type];
    if (next === undefined || next === this.#state) return this.#state;
    if (next === 'idle') {
      this.#adapter.removeClass('dag-traversed');
      this.#adapter.stop();
    } else {
      this.#adapter.addClass(ENTRY_CLASS[next] ?? '');
      this.#adapter.flash();
    }
    this.#state = next;
    return next;
  }
}
