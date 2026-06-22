import { DagTask } from '../container/DagTask.js';
import { TransportErrorCode } from '../container/TransportErrorCode.js';
import type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
import type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';
import type { ObserverRelayInterface } from '../contracts/ObserverRelayInterface.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { NodeErrorWireType } from '../entities/node/NodeError.js';
import type { NodeResultType } from '../entities/node/NodeResult.js';
import { Timeout } from '../entities/Timeout.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { RunNodesBatchType, RunOptionsType } from './ScatterDispatch.js';

/**
 * Narrow dispatcher seam `BodyExecutor` drives to run a sub-DAG body. Holds the
 * generator entry, container resolution, correlation-id minting, observer relay
 * construction, and node-context building — the five collaborators a body run
 * needs without the whole dispatcher in scope.
 *
 * `Dagonizer` (and, for the scatter per-item path, the `ScatterDispatchAdapter`)
 * provide a concrete implementation so the body-run primitive depends only on
 * these methods, never on private dispatcher members.
 */
export interface BodyRunPortInterface {
  /**
   * Run a named sub-DAG body in-process through the canonical `runNodes`
   * generator. The returned generator yields each inner node result and returns
   * the child `ExecutionResultType` (carrying `terminalOutcome`) on completion.
   */
  runBodyNodes(
    dagName: string,
    state: NodeStateInterface,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType,
    placementPath: readonly string[],
    batch?: RunNodesBatchType,
  ): AsyncGenerator<NodeResultType<NodeStateInterface>, { terminalOutcome: 'completed' | 'failed' | null }, void>;
  /** Resolve a bound container by role, or `null` to run the body in-process. */
  resolveContainer(role: string | undefined): DagContainerInterface | null;
  /** Mint a monotonic correlation id for a container request envelope. */
  nextCorrelationId(dagName: string): string;
  /** Build an observer relay bound to `state` for worker-side event forwarding. */
  relayFor(state: NodeStateInterface): ObserverRelayInterface;
  /** Build a node context for a body invocation, substituting a never-firing signal when absent. */
  bodyContext(dagName: string, nodeName: string, signal: AbortSignal | null): NodeContextType;
}

/**
 * Uniform result of running one sub-DAG body, regardless of whether the body
 * ran in-process or through a bound container.
 *
 * - `terminalOutcome`: the child run's terminal outcome (`'completed'`,
 *   `'failed'`, or `null` when the run never reached a terminal).
 * - `intermediates`: per-inner-node results, prefixed with the placement name,
 *   collected only when buffering was requested; an empty array otherwise.
 * - `infrastructureError`: the first transport/infrastructure error the
 *   container surfaced, or `null`. The body-run collects every container error
 *   into the clone regardless; this field lets the caller apply its own policy
 *   (scatter re-queues by throwing; embedded routes the collected error).
 */
export type BodyRunResultType = {
  readonly terminalOutcome: 'completed' | 'failed' | null;
  readonly intermediates: ReadonlyArray<NodeResultType<NodeStateInterface>>;
  readonly infrastructureError: NodeErrorWireType | null;
};

/**
 * Shared body-run + transport-branch primitive.
 *
 * `executeEmbeddedDAG` and the scatter per-item DAG-body path run the SAME
 * operation: take a sub-DAG name and a pre-seeded clone, run it in-process or
 * through a bound container, collect the child's errors into the clone, and
 * report a uniform terminal outcome. `BodyExecutor` is that operation in one
 * place.
 *
 * The `bufferIntermediates` O(N·M·L) guard lives here, once: buffering each
 * inner result is only safe at the top-level streaming context. Inside a
 * scatter body or a nested embedded DAG it is skipped — inner-node observability
 * is delivered live through the observer relay regardless.
 *
 * Container errors are collected into `cloneState` on both branches; the
 * `infrastructureError` field carries the first transport failure (if any) so
 * the caller applies the routing policy its cardinality requires.
 */
export class BodyExecutor {
  readonly #source: BodyRunPortInterface;

  constructor(source: BodyRunPortInterface) {
    this.#source = source;
  }

  /**
   * Run the sub-DAG `bodyDag` over `cloneState` and return a uniform outcome.
   *
   * `placementName` prefixes buffered intermediate node names; `containerRole`
   * selects the bound container (or in-process when unresolved); `signal`
   * threads cancellation; `placementPath` carries nesting context; `parentState`
   * is the relay binding for container dispatch; `bufferIntermediates` gates the
   * O(N·M·L) intermediate accumulation.
   */
  async run(
    bodyDag: string,
    placementName: string,
    cloneState: NodeStateInterface,
    parentState: NodeStateInterface,
    containerRole: string | undefined,
    signal: AbortSignal | null,
    placementPath: readonly string[],
    bufferIntermediates: boolean,
  ): Promise<BodyRunResultType> {
    const innerPath: readonly string[] = [...placementPath, placementName];
    const container = this.#source.resolveContainer(containerRole);

    if (container === null) {
      return this.#runInProcess(bodyDag, placementName, cloneState, parentState, signal, innerPath, bufferIntermediates);
    }
    return this.#runContained(bodyDag, placementName, cloneState, parentState, signal, innerPath, bufferIntermediates, container);
  }

  async #runInProcess(
    bodyDag: string,
    placementName: string,
    cloneState: NodeStateInterface,
    parentState: NodeStateInterface,
    signal: AbortSignal | null,
    innerPath: readonly string[],
    bufferIntermediates: boolean,
  ): Promise<BodyRunResultType> {
    const childOptions: ExecuteOptionsType = { ...(signal !== null && { 'signal': signal }) };
    const iter = this.#source.runBodyNodes(bodyDag, cloneState, null, childOptions, { 'embedded': true }, innerPath);

    const intermediates: Array<NodeResultType<NodeStateInterface>> = [];
    let terminalOutcome: 'completed' | 'failed' | null;

    // When bufferIntermediates is true (top-level streaming context), collect
    // each inner stage so the parent runNodes loop can yield them to the
    // consumer before the placement's own result. When false (inside a scatter
    // body or another embedded DAG), skip buffering: at scatter scale
    // (N items × M inner nodes × L nesting levels) the accumulation is
    // O(N*M*L) and causes unbounded heap growth. Inner-node observability is
    // delivered live through onNodeStart/onNodeEnd regardless of this flag.
    if (bufferIntermediates) {
      let step = await iter.next();
      while (!step.done) {
        const nr = step.value;
        intermediates.push({
          'output': nr.output,
          'skipped': nr.skipped,
          'nodeName': `${placementName}.${nr.nodeName}`,
          'state': parentState,
          'intermediateResults': [],
        });
        step = await iter.next();
      }
      terminalOutcome = step.value.terminalOutcome;
    } else {
      // Drain without buffering.
      while (true) {
        const step = await iter.next();
        if (step.done) {
          terminalOutcome = step.value.terminalOutcome;
          break;
        }
      }
    }

    return { terminalOutcome, intermediates, 'infrastructureError': null };
  }

  async #runContained(
    bodyDag: string,
    placementName: string,
    cloneState: NodeStateInterface,
    parentState: NodeStateInterface,
    signal: AbortSignal | null,
    innerPath: readonly string[],
    bufferIntermediates: boolean,
    container: DagContainerInterface,
  ): Promise<BodyRunResultType> {
    const correlationId = this.#source.nextCorrelationId(bodyDag);
    const context = this.#source.bodyContext(bodyDag, placementName, signal);
    const task = new DagTask(
      bodyDag,
      innerPath,
      correlationId,
      Timeout.none(),
      cloneState,
      context,
    );

    const relay = this.#source.relayFor(parentState);
    const outcome = await container.runDag(task, { relay });

    // Apply terminal state snapshot back to clone for domain state (in-place;
    // parent state identity is preserved). outcome.errors is the single
    // authoritative error channel — always collect it regardless of whether a
    // snapshot is present. Errors are intentionally not serialized into the
    // snapshot; the snapshot carries domain state only (metadata, retries,
    // warnings, subclass fields).
    if (outcome.stateSnapshot !== null) {
      cloneState.applySnapshot(outcome.stateSnapshot);
    }
    for (const err of outcome.errors) cloneState.collectError(err);

    // Re-yield each intermediate as a NodeResultType only when buffering is
    // requested (top-level streaming). Inside a scatter body the observer relay
    // delivers per-node observability live; buffering at scatter scale is
    // O(N*M*L).
    const intermediates: Array<NodeResultType<NodeStateInterface>> = [];
    if (bufferIntermediates) {
      for (const wi of outcome.intermediates) {
        intermediates.push({
          'output': wi.output,
          'skipped': wi.skipped,
          'nodeName': `${placementName}.${wi.nodeName}`,
          'state': parentState,
          'intermediateResults': [],
        });
      }
    }

    // The first transport/infrastructure error (host crash, channel loss), or
    // null. Already collected into cloneState above; surfaced so the caller can
    // re-queue (scatter, at-least-once) or route the collected error (embedded,
    // cardinality-1, Law 3 — no throw).
    const infrastructureError = outcome.errors.find((e) => TransportErrorCode.isInfrastructureFailure(e.code)) ?? null;

    // Derive terminalOutcome from terminalOutput.
    const terminalOutcome: 'completed' | 'failed' = outcome.terminalOutput === 'failed' ? 'failed' : 'completed';

    return { terminalOutcome, intermediates, infrastructureError };
  }
}
