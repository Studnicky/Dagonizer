/**
 * RunnerMachine — UI-side FSM for the Archivist demo.
 *
 *   ┌──────┐  submit   ┌─────────┐  flowEnd(ok)   ┌──────┐
 *   │ idle ├──────────►│ running ├───────────────►│ done │
 *   └──────┘           └────┬────┘                └──┬───┘
 *      ▲                    │ flowEnd(err)            │
 *      │                    ▼                         │
 *      │              ┌────────┐                      │
 *      │              │ error  │                      │
 *      │              └───┬────┘                      │
 *      │                  │ reset                     │
 *      └──────────────────┴───────────────────────────┘
 *
 * Mirrors the Dagonizer pattern (typed states + transition table +
 * named events) at the UI layer. The runner subscribes via
 * `.subscribe(fn)`; every state change fans out so reactive views
 * derive their UI from `machine.state` instead of independent refs.
 *
 * Parallel updates that arrive mid-run (node-start, node-end, tool
 * outcomes) flow through `pulse(event)` — these are sub-events that
 * don't change the top-level state but listeners can observe.
 */

export type RunnerState = 'idle' | 'running' | 'done' | 'error';

export type RunnerEvent =
  | { readonly type: 'submit' }
  | { readonly type: 'flowEnd';  readonly lifecycle: string }
  | { readonly type: 'flowError'; readonly error: Error }
  | { readonly type: 'reset' };

/** Sub-events that don't shift top-level state — for live observers. */
export type RunnerPulse =
  | { readonly type: 'nodeStart'; readonly node: string }
  | { readonly type: 'nodeEnd';   readonly node: string; readonly output?: string }
  | { readonly type: 'nodeError'; readonly node: string; readonly error: Error }
  | { readonly type: 'log';       readonly level: 'info' | 'warn' | 'result'; readonly message: string };

type Listener = (state: RunnerState, event?: RunnerEvent | RunnerPulse) => void;

const TRANSITIONS: Readonly<Record<RunnerState, Partial<Record<RunnerEvent['type'], RunnerState>>>> = {
  'idle':    { 'submit':    'running' },
  'running': { 'flowEnd':   'done', 'flowError': 'error' },
  'done':    { 'submit':    'running', 'reset': 'idle' },
  'error':   { 'submit':    'running', 'reset': 'idle' },
};

export class RunnerMachine {
  #state: RunnerState = 'idle';
  #lifecycle: string = '';
  #error: Error | null = null;
  readonly #listeners = new Set<Listener>();

  get state():     RunnerState { return this.#state; }
  get lifecycle(): string      { return this.#lifecycle; }
  get error():     Error | null { return this.#error; }
  get isRunning(): boolean     { return this.#state === 'running'; }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    fn(this.#state);
    return (): void => { this.#listeners.delete(fn); };
  }

  dispatch(event: RunnerEvent): RunnerState {
    const next = TRANSITIONS[this.#state][event.type];
    if (next === undefined || next === this.#state) return this.#state;
    if (event.type === 'flowEnd')   this.#lifecycle = event.lifecycle;
    if (event.type === 'flowError') this.#error     = event.error;
    if (event.type === 'reset')     { this.#lifecycle = ''; this.#error = null; }
    this.#state = next;
    for (const fn of this.#listeners) fn(this.#state, event);
    return next;
  }

  /**
   * Pulse — sub-event that doesn't shift the top-level state. Listeners
   * see it alongside the current state. Useful for trace/log streams.
   */
  pulse(event: RunnerPulse): void {
    for (const fn of this.#listeners) fn(this.#state, event);
  }
}
