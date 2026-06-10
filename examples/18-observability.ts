/**
 * 18-observability: two observability surfaces side-by-side on one DAG.
 *
 * Demonstrates both ways to observe a Dagonizer run:
 *
 *   (a) Subclass hooks — extend `Dagonizer` and override `onFlowStart`,
 *       `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`. The class owns
 *       the observer; no extra objects are required.
 *
 *   (b) Instrumentation plugin — extend `NoopInstrumentation` (from
 *       `@noocodex/dagonizer/runtime`) and override only the hooks you need.
 *       Pass the instance via the `instrumentation:` constructor option.
 *       The dispatcher fires both the subclass hooks AND the instrumentation
 *       hooks at every boundary; the two surfaces coexist.
 *
 * The same trivial two-node pipeline (validate → transform) runs twice so
 * you can compare the trace output produced by each approach.
 *
 * DAG definition (state, nodes, dag): examples/dags/18-observability.ts
 *
 * Run: npx tsx examples/18-observability.ts
 */

import { Dagonizer, NoopInstrumentation } from '@noocodex/dagonizer';
import type { ExecutionResultInterface } from '@noocodex/dagonizer';
import type { Instrumentation } from '@noocodex/dagonizer/contracts';
import { PipelineState, validate, transform, dag } from './dags/18-observability.js';

// ---------------------------------------------------------------------------
// (a) Subclass surface
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
      `${this.#prefix} flowEnd    dag=${dagName} outcome=${result.terminalOutcome ?? 'null-route'} nodes=${String(result.executedNodes.length)}`,
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

// ── Run (a) ─────────────────────────────────────────────────────────────────

const subclassDispatcher = new TracingDispatcher('[subclass]');
subclassDispatcher.registerNode(validate);
subclassDispatcher.registerNode(transform);
subclassDispatcher.registerDAG(dag);

const stateA = new PipelineState();
await subclassDispatcher.execute('observe-demo', stateA);

// ---------------------------------------------------------------------------
// (b) Instrumentation plugin surface
// ---------------------------------------------------------------------------

// #region plugin-observer
class TracingPlugin extends NoopInstrumentation<PipelineState>
implements Instrumentation<PipelineState> {
  readonly #prefix: string;
  readonly #lines: string[] = [];

  constructor(prefix: string) {
    super();
    this.#prefix = prefix;
  }

  get lines(): readonly string[] { return this.#lines; }

  override flowStart(dagName: string, _state: PipelineState): void {
    this.#lines.push(`${this.#prefix} flowStart  dag=${dagName}`);
  }

  override flowEnd(
    dagName: string,
    _state: PipelineState,
    result: ExecutionResultInterface<PipelineState>,
  ): void {
    this.#lines.push(
      `${this.#prefix} flowEnd    dag=${dagName} outcome=${result.terminalOutcome ?? 'null-route'} nodes=${String(result.executedNodes.length)}`,
    );
  }

  override nodeStart(
    _dagName: string,
    nodeName: string,
    _state: PipelineState,
    placementPath: readonly string[],
  ): void {
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#lines.push(`${this.#prefix} nodeStart  ${path}${nodeName}`);
  }

  override nodeEnd(
    _dagName: string,
    nodeName: string,
    output: string | null,
    _state: PipelineState,
    placementPath: readonly string[],
  ): void {
    const path   = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    const outTag = output ?? '(terminal)';
    this.#lines.push(`${this.#prefix} nodeEnd    ${path}${nodeName} → ${outTag}`);
  }

  override error(
    _dagName: string,
    nodeName: string,
    err: Error,
    _state: PipelineState,
    placementPath: readonly string[],
  ): void {
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#lines.push(`${this.#prefix} error      ${path}${nodeName} ${err.message}`);
  }
}
// #endregion plugin-observer

// ── Run (b) ─────────────────────────────────────────────────────────────────

const plugin = new TracingPlugin('[plugin]  ');
const pluginDispatcher = new Dagonizer<PipelineState>({ instrumentation: plugin });
pluginDispatcher.registerNode(validate);
pluginDispatcher.registerNode(transform);
pluginDispatcher.registerDAG(dag);

const stateB = new PipelineState();
await pluginDispatcher.execute('observe-demo', stateB);

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

process.stdout.write('\n18-observability: two tracing surfaces on the same pipeline\n\n');

process.stdout.write('(a) Subclass hooks (TracingDispatcher extends Dagonizer):\n');
for (const line of subclassDispatcher.lines) {
  process.stdout.write(`  ${line}\n`);
}

process.stdout.write('\n(b) Instrumentation plugin (TracingPlugin extends NoopInstrumentation):\n');
for (const line of plugin.lines) {
  process.stdout.write(`  ${line}\n`);
}

process.stdout.write('\nLesson: subclass hooks and instrumentation plugins fire at the same\n');
process.stdout.write('        execution boundaries. Subclass hooks suit single-observer needs;\n');
process.stdout.write('        plugins compose multiple observers without deep class hierarchies.\n');
process.stdout.write('        Both surfaces coexist: a dispatcher may use both simultaneously.\n');
