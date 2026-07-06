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

import type { FsmStepType } from '@studnicky/fsm';
import { StateMachine } from '@studnicky/fsm';

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

type EdgeVizStateRecord = { readonly variant: EdgeVizState };

class EdgeVizReducer extends StateMachine<EdgeVizStateRecord, EdgeVizEvent, never> {
  constructor() {
    super();
  }

  getInitialState(): EdgeVizStateRecord {
    return { 'variant': 'idle' };
  }

  reduce(state: EdgeVizStateRecord, event: EdgeVizEvent): FsmStepType<EdgeVizStateRecord, never> {
    const next = TRANSITIONS[state.variant][event.type] ?? state.variant;
    return { 'state': { 'variant': next }, 'effects': [] };
  }
}

const EDGE_VIZ_REDUCER = new EdgeVizReducer();

export class EdgeVizMachine {
  #state: EdgeVizStateRecord = EDGE_VIZ_REDUCER.getInitialState();
  readonly #adapter: EdgeVizAdapter;

  constructor(adapter: EdgeVizAdapter) {
    this.#adapter = adapter;
  }

  get state(): EdgeVizState { return this.#state.variant; }

  dispatch(event: EdgeVizEvent): EdgeVizState {
    // Re-traversing an already-traversed edge re-flashes it without a state
    // change. A scatter routes many items through the same edge; without this
    // the same-state guard below swallows every traversal after the first and
    // the edge flashes go static mid-run.
    if (event.type === 'traverse' && this.#state.variant === 'traversed') {
      this.#adapter.flash();
      return this.#state.variant;
    }
    const step = EDGE_VIZ_REDUCER.transition(this.#state, event);
    const next = step.state.variant;
    if (next === this.#state.variant) return this.#state.variant;
    if (next === 'idle') {
      this.#adapter.removeClass('dag-traversed');
      this.#adapter.stop();
    } else {
      this.#adapter.addClass(ENTRY_CLASS[next] ?? '');
      this.#adapter.flash();
    }
    this.#state = step.state;
    return next;
  }
}
