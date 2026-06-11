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

import { Dagonizer } from '@noocodex/dagonizer';
import type { ExecutionResultInterface } from '@noocodex/dagonizer';
import { PipelineState, validate, transform, dag } from './dags/18-observability.js';

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
// Run
// ---------------------------------------------------------------------------

const dispatcher = new TracingDispatcher('[trace]');
dispatcher.registerNode(validate);
dispatcher.registerNode(transform);
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
