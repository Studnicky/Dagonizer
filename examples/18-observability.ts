/**
 * 18-observability: subclass hooks — the ONE observability surface.
 *
 * Every Dagonizer run is observed by extending `Dagonizer` and overriding
 * the protected hook methods:
 *
 *   onFlowStart  — called once when execute() begins
 *   onFlowEnd    — called once when execute() completes or fails
 *   onNodeStart  — called before each node (including embedded-DAG bodies)
 *   onNodeEnd    — called after each node
 *   onError      — called when a node throws
 *   onPhaseEnter — called before each PhaseNode (pre/post-phase)
 *   onPhaseExit  — called after each PhaseNode
 *
 * The `placementPath` argument on node hooks is the ordered list of
 * embedding placement names. It is empty for top-level nodes and non-empty
 * for nodes inside embedded DAGs — enabling disambiguation of same-named
 * inner nodes across multiple placements.
 *
 * Worker/container hooks fire the same way: WorkerObserver bridges events
 * from the isolate back through the ObserverRelay to the parent Dagonizer's
 * protected hooks. The `placementPath` for inner nodes starts with the
 * outer placement name so you see the full ancestry.
 *
 * DAG definition (state, nodes, dag): examples/dags/18-observability.ts
 *
 * Run: npx tsx examples/18-observability.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import type { ExecutionResultInterface } from '@studnicky/dagonizer';
import { PipelineState, ValidateNode, TransformNode, dag } from './dags/18-observability.js';

// ---------------------------------------------------------------------------
// Subclass: TracingDispatcher
//
// Overrides every hook to record trace lines. The protected hooks receive
// `state` as a strongly-typed second parameter; it is unused here because
// we only want structural tracing, not state inspection.
// ---------------------------------------------------------------------------

// #region subclass-observer
class TracingDispatcher extends Dagonizer<PipelineState> {
  readonly #prefix: string;
  readonly #lines: string[] = [];

  constructor(prefix: string) {
    super();
    this.#prefix = prefix;
  }

  get lines(): readonly string[] { return this.#lines; }

  protected override onFlowStart(dagName: string, _state: PipelineState): void {
    this.#lines.push(`${this.#prefix} flowStart  dag=${dagName}`);
  }

  protected override onFlowEnd(
    dagName: string,
    _state: PipelineState,
    result: ExecutionResultInterface<PipelineState>,
  ): void {
    this.#lines.push(
      `${this.#prefix} flowEnd    dag=${dagName} outcome=${result.terminalOutcome ?? result.interruptedAt?.reason ?? 'none'} nodes=${String(result.executedNodes.length)}`,
    );
  }

  protected override onNodeStart(
    nodeName: string,
    _state: PipelineState,
    placementPath: readonly string[],
  ): void {
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#lines.push(`${this.#prefix} nodeStart  ${path}${nodeName}`);
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    _state: PipelineState,
    placementPath: readonly string[],
  ): void {
    const path   = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    const outTag = output ?? '(terminal)';
    this.#lines.push(`${this.#prefix} nodeEnd    ${path}${nodeName} → ${outTag}`);
  }

  protected override onError(
    nodeName: string,
    error: Error,
    _state: PipelineState,
    placementPath: readonly string[],
  ): void {
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#lines.push(`${this.#prefix} error      ${path}${nodeName} ${error.message}`);
  }
}
// #endregion subclass-observer

// ---------------------------------------------------------------------------
// Multi-observer composition pattern
//
// When a single consumer needs multiple orthogonal observers (e.g. a logger
// AND a tracer), pass the cross-cutting concerns into the subclass via its
// constructor. Each concern is a plain function; the subclass dispatches to
// both in every hook. No callbacks on Dagonizer itself — the composition
// lives entirely inside the subclass body.
// ---------------------------------------------------------------------------

// #region multi-observer
class ComposedDispatcher extends Dagonizer<PipelineState> {
  readonly #logA: (msg: string) => void;
  readonly #logB: (msg: string) => void;

  constructor(logA: (msg: string) => void, logB: (msg: string) => void) {
    super();
    this.#logA = logA;
    this.#logB = logB;
  }

  protected override onNodeStart(
    nodeName: string,
    _state: PipelineState,
    placementPath: readonly string[],
  ): void {
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#logA(`nodeStart  ${path}${nodeName}`);
    this.#logB(`nodeStart  ${path}${nodeName}`);
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    _state: PipelineState,
    placementPath: readonly string[],
  ): void {
    const path   = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    const outTag = output ?? '(terminal)';
    this.#logA(`nodeEnd    ${path}${nodeName} → ${outTag}`);
    this.#logB(`nodeEnd    ${path}${nodeName} → ${outTag}`);
  }
}
// #endregion multi-observer

// ---------------------------------------------------------------------------
// Run: TracingDispatcher (single observer)
// ---------------------------------------------------------------------------

const dispatcher = new TracingDispatcher('[trace]');
dispatcher.registerNode(new ValidateNode());
dispatcher.registerNode(new TransformNode());
dispatcher.registerDAG(dag);

const state = new PipelineState();
await dispatcher.execute('observe-demo', state);

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

process.stdout.write('\n18-observability: subclass hooks on the same pipeline\n\n');

for (const line of dispatcher.lines) {
  process.stdout.write(`  ${line}\n`);
}

process.stdout.write('\nSubclass hooks fire at every execution boundary.\n');
process.stdout.write('For worker/container nodes the same hooks fire via ObserverRelay —\n');
process.stdout.write('the placementPath carries the full ancestry so inner nodes are\n');
process.stdout.write('identifiable even when they share names across placements.\n');

// ---------------------------------------------------------------------------
// Run: ComposedDispatcher (multi-observer — two log sinks in one subclass)
// ---------------------------------------------------------------------------

const logA: string[] = [];
const logB: string[] = [];
const composed = new ComposedDispatcher(
  (msg) => logA.push(`[A] ${msg}`),
  (msg) => logB.push(`[B] ${msg}`),
);
composed.registerNode(new ValidateNode());
composed.registerNode(new TransformNode());
composed.registerDAG(dag);

const composedState = new PipelineState();
await composed.execute('observe-demo', composedState);

process.stdout.write('\nComposedDispatcher: two log sinks in one subclass\n');
process.stdout.write(`  logA lines: ${String(logA.length)} | logB lines: ${String(logB.length)}\n`);

// ---------------------------------------------------------------------------
// AbortSignal composition: how execute() composes caller signal + deadline
// (doc region — illustrates the signal-compose pattern used internally)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Lifecycle state access: how to read kind + timestamps after execution
// (doc region — illustrates discriminated union usage)
// ---------------------------------------------------------------------------

// #region lifecycle-state
// state.lifecycle is a discriminated union narrowed by `kind`.
// Timestamps are monotonic milliseconds from Clock.monotonicMs().
//
//   { kind: 'pending',    startedAt: null,   finishedAt: null,   error: null,  reason: null }
//   { kind: 'running',    startedAt: number, finishedAt: null,   error: null,  reason: null }
//   { kind: 'completed',  startedAt: number, finishedAt: number, error: null,  reason: null }
//   { kind: 'failed',     startedAt: number, finishedAt: number, error: Error, reason: null }
//   { kind: 'cancelled',  startedAt: number, finishedAt: number, error: null,  reason: string }
//   { kind: 'timed_out',  startedAt: number, finishedAt: number, error: null,  reason: null }

const lifecycleDispatcher = new TracingDispatcher('[lifecycle]');
lifecycleDispatcher.registerNode(new ValidateNode());
lifecycleDispatcher.registerNode(new TransformNode());
lifecycleDispatcher.registerDAG(dag);

const lifecycleState = new PipelineState();
await lifecycleDispatcher.execute('observe-demo', lifecycleState);

const lc = lifecycleState.lifecycle;
if (lc.kind === 'completed') {
  // Both startedAt and finishedAt are numbers; no null-check needed here.
  const durationMs = lc.finishedAt - lc.startedAt;
  process.stdout.write(`  completed in ${String(durationMs)} ms\n`);
} else if (lc.kind === 'failed') {
  process.stdout.write(`  failed: ${lc.error.message}\n`);
} else if (lc.kind === 'cancelled') {
  process.stdout.write(`  cancelled: ${lc.reason}\n`);
}
// #endregion lifecycle-state

// #region signal-compose
// execute() composes an optional caller AbortSignal and an optional deadlineMs
// into one composed signal via AbortSignal.any. Both are optional; either alone
// is also valid. Each node receives the composed signal as context.signal.
function composeSignal(callerSignal: AbortSignal | undefined, deadlineMs: number | undefined): AbortSignal {
  const sources: AbortSignal[] = [];
  if (callerSignal !== undefined) sources.push(callerSignal);
  if (deadlineMs !== undefined) sources.push(AbortSignal.timeout(deadlineMs));
  return sources.length > 0 ? AbortSignal.any(sources) : new AbortController().signal;
}
void composeSignal; // documentation region — not called at runtime
// #endregion signal-compose
