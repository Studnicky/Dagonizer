import type { ExecuteOptionsInterface } from './contracts/ExecuteOptionsInterface.js';
import type { NodeInterface } from './contracts/NodeInterface.js';
import type { StateAccessor } from './contracts/StateAccessor.js';
import { FanInStrategies } from './core/FanInStrategies.js';
import type { FanInExecution } from './core/FanInStrategies.js';
import { ParallelCombiners } from './core/ParallelCombiners.js';
import { ContractRegistryValidator } from './derive/ContractRegistryValidator.js';
import type { DAG } from './entities/dag/DAG.js';
import type { DeepDAGNode } from './entities/dag/DeepDAGNode.js';
import type { FanInConfig } from './entities/dag/FanInConfig.js';
import type { FanOutNode } from './entities/dag/FanOutNode.js';
import type { ParallelNode } from './entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from './entities/dag/SingleNode.js';
import type { TerminalNodePlacementInterface } from './entities/dag/TerminalNode.js';
import type { ExecutionResultInterface } from './entities/execution/ExecutionResult.js';
import type { NodeContextInterface } from './entities/node/NodeContext.js';
import type { NodeResultInterface } from './entities/node/NodeResult.js';
import { DAGError, NodeTimeoutError, ValidationError } from './errors/index.js';
import { Execution } from './Execution.js';
import { DAGLifecycleMachine } from './lifecycle/DAGLifecycleMachine.js';
import type { NodeStateInterface } from './NodeStateBase.js';
import { DottedPathAccessor } from './runtime/DottedPathAccessor.js';
import { Scheduler } from './runtime/Scheduler.js';
import { SignalComposer } from './runtime/SignalComposer.js';
import { Validator } from './validation/Validator.js';

/** Default state accessor — installed when the dispatcher is constructed without one. */
const DEFAULT_STATE_ACCESSOR: StateAccessor = new DottedPathAccessor();

/**
 * Constructor options for `Dagonizer`.
 *
 * `TServices` is the consumer-defined services bag that the dispatcher
 * passes through every `NodeContextInterface`. Default `undefined` means
 * nodes receive `context.services === undefined`.
 */
export interface DagonizerOptionsInterface<TServices = undefined> {
  /**
   * Path resolver used for fan-out source reads, fan-in writes, and
   * deep-DAG state mapping. Defaults to a `DottedPathAccessor` that
   * walks `path.split('.')`.
   */
  readonly accessor?: StateAccessor;
  /**
   * Services bag exposed to every node via `context.services`. Construct
   * the dispatcher with `{ services: { logger, db, ... } }` and the same
   * reference flows into every `NodeInterface.execute(state, context)`
   * call.
   */
  readonly services?: TServices;
}


type DAGNodeType = FanOutNode | ParallelNode | SingleNodePlacementInterface | DeepDAGNode | TerminalNodePlacementInterface;
type DAGNodeAtType = DAGNodeType['@type'];

/**
 * Interface for Dagonizer. One execution path — `execute()` and `resume()`
 * both return an `Execution`, which is async-iterable (each stage as it
 * completes) and awaitable (the final summary).
 *
 * `TServices` flows through every node's `NodeContextInterface.services`
 * field — defaults to `undefined` when the dispatcher is constructed
 * without a services bag.
 */
export interface DagonizerInterface<
  TState extends NodeStateInterface,
  TServices = undefined,
> {
  /**
   * Clean up all registered nodes.
   */
  destroy(): Promise<void>;

  /**
   * Execute a DAG from its entrypoint.
   */
  execute(
    dagName: string,
    initialState: TState,
    options?: ExecuteOptionsInterface,
  ): Execution<TState>;

  /**
   * Look up a registered DAG by name.
   */
  getDAG(name: string): DAG | undefined;

  /**
   * Look up a registered node by name.
   */
  getNode(name: string): NodeInterface<TState, string, TServices> | undefined;

  /**
   * List every registered DAG. Useful for visualization, contract checks,
   * and tooling that needs to walk the registry.
   */
  listDAGs(): readonly DAG[];

  /**
   * List every registered node. Useful for visualization and tooling.
   */
  listNodes(): readonly NodeInterface<TState, string, TServices>[];

  /**
   * Resume a DAG from a given node name. The caller is responsible for
   * rehydrating `state` before the call (typically via `Checkpoint.load(raw).restoreState(fn)`).
   */
  resume(
    dagName: string,
    state: TState,
    fromStage: string,
    options?: ExecuteOptionsInterface,
  ): Execution<TState>;

  /**
   * Register a DAG configuration.
   */
  registerDAG(dag: DAG): void;

  /**
   * Register a DAG node.
   */
  registerNode<TOutput extends string>(
    node: NodeInterface<TState, TOutput, TServices>,
  ): void;
}

interface InternalNodeResultInterface<TState extends NodeStateInterface> {
  'nextStage': null | string;
  'result': NodeResultInterface<TState>;
}

/**
 * Graph-based DAG dispatcher for state-machine-style multi-step
 * node execution.
 *
 * Subclass to attach observability — override `onFlowStart`, `onFlowEnd`,
 * `onNodeStart`, `onNodeEnd`, `onError`. Default implementations are no-ops.
 *
 * Cancellation: pass `{ signal }` (and/or `{ deadlineMs }`) to `execute()`.
 * The dispatcher composes them via `AbortSignal.any()` and marks state
 * `cancelled` / `timed_out` when the signal fires.
 *
 * @example
 * ```ts
 * class MyState extends NodeStateBase { value = 0; }
 *
 * const node: NodeInterface<MyState, 'done'> = {
 *   name: 'increment', outputs: ['done'],
 *   async execute(state) { state.value++; return { output: 'done' }; },
 * };
 *
 * const dispatcher = new Dagonizer<MyState>();
 * dispatcher.registerNode(node);
 * dispatcher.registerDAG({
 *   '@context': DAG_CONTEXT, '@id': 'urn:noocodex:dag:demo', '@type': 'DAG',
 *   name: 'demo', version: '1', entrypoint: 'increment',
 *   nodes: [{ '@id': 'urn:noocodex:dag:demo/node/increment', '@type': 'SingleNode',
 *             name: 'increment', node: 'increment', outputs: { done: null } }],
 * });
 *
 * const result = await dispatcher.execute('demo', new MyState());
 * // result.state.value === 1
 * // result.cursor === null (completed)
 * ```
 */
export class Dagonizer<TState extends NodeStateInterface, TServices = undefined>
implements DagonizerInterface<TState, TServices> {
  private readonly dags = new Map<string, DAG>();
  private readonly nodes = new Map<string, NodeInterface<TState, string, TServices>>();
  private readonly nodeIndex = new Map<string, DAGNodeType>();
  private readonly accessor: StateAccessor;
  private readonly services: TServices;

  /**
   * Construct a dispatcher. Subclass and override the protected hooks
   * (`onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`)
   * for observability — no factory indirection, no callbacks.
   *
   * `options.accessor` swaps the path resolver used for fan-out source
   * reads, fan-in writes, and deep-DAG state mapping. Defaults to
   * `DottedPathAccessor`.
   *
   * `options.services` is the typed services bag exposed to every node
   * via `context.services`. Defaults to `undefined`.
   */
  constructor(options: DagonizerOptionsInterface<TServices> = {}) {
    this.accessor = options.accessor ?? DEFAULT_STATE_ACCESSOR;
    this.services = options.services as TServices;
  }

  // ---------------------------------------------------------------------------
  // Observability hooks — protected, no-op defaults. Subclass + override.
  // ---------------------------------------------------------------------------

  protected onFlowStart(_dagName: string, _state: TState): void { /* override */ }
  protected onFlowEnd(_dagName: string, _state: TState, _result: ExecutionResultInterface<TState>): void { /* override */ }
  protected onNodeStart(_nodeName: string, _state: TState): void { /* override */ }
  protected onNodeEnd(_nodeName: string, _output: string | undefined, _state: TState): void { /* override */ }
  protected onError(_nodeName: string, _error: Error, _state: TState): void { /* override */ }

  /**
   * Called for each non-fatal contract warning surfaced during DAG
   * registration when the DAG was derived from a node registry. Default
   * is a no-op. Subclasses can override to log or surface dead-write
   * warnings to operators.
   *
   * @param _message - Human-readable warning from `ContractRegistryValidator`.
   */
  protected onContractWarning(_message: string): void { /* override */ }

  // ---------------------------------------------------------------------------

  private createChildState(parentState: TState, inputMapping?: Record<string, string>): TState {
    const childState = parentState.clone() as TState;

    if (inputMapping) {
      for (const [
        childKey,
        parentKey
      ] of Object.entries(inputMapping)) {
        const value = this.accessor.get(parentState, parentKey);

        this.accessor.set(childState, childKey, value);
      }
    }

    return childState;
  }

  async destroy(): Promise<void> {
    for (const node of this.nodes.values()) {
      if (node.destroy) {
        await node.destroy();
      }
    }
    this.nodes.clear();
    this.dags.clear();
    this.nodeIndex.clear();
  }

  /**
   * Look up a registered DAG by name. Returns `undefined` when the DAG has
   * not been registered.
   */
  getDAG(name: string): DAG | undefined {
    return this.dags.get(name);
  }

  /**
   * Look up a registered node by name. Returns `undefined` when the node
   * has not been registered.
   */
  getNode(name: string): NodeInterface<TState, string, TServices> | undefined {
    return this.nodes.get(name);
  }

  /**
   * Snapshot of every registered DAG. The returned array is a fresh
   * shallow copy; mutating it does not affect the registry.
   */
  listDAGs(): readonly DAG[] {
    return [...this.dags.values()];
  }

  /**
   * Snapshot of every registered node. The returned array is a fresh
   * shallow copy; mutating it does not affect the registry.
   */
  listNodes(): readonly NodeInterface<TState, string, TServices>[] {
    return [...this.nodes.values()];
  }

  /**
   * Execute a flow from its entrypoint.
   *
   * Returns an `Execution<TState>` that is both async-iterable (yields
   * each node as it completes) and awaitable (resolves to the final
   * `ExecutionResultInterface`). One execution path — sync-style is just
   * iteration that consumes every node before resolving.
   *
   * On abort (signal aborted, deadline expired, node threw, output
   * unwired) the iterator stops cleanly and the final result's `cursor`
   * carries the next node to run. State lifecycle records what happened.
   */
  execute(
    dagName: string,
    initialState: TState,
    options: ExecuteOptionsInterface = {},
  ): Execution<TState> {
    return new Execution<TState>(() => this.runNodes(dagName, initialState, null, options));
  }

  /**
   * Resume a flow from `fromStage`. Same generator as `execute()` but
   * begins at the given cursor instead of the flow's entrypoint. Caller
   * is responsible for rehydrating `state` (typically via
   * `Checkpoint.load(raw).restoreState(fn)`) before calling.
   */
  resume(
    dagName: string,
    state: TState,
    fromStage: string,
    options: ExecuteOptionsInterface = {},
  ): Execution<TState> {
    return new Execution<TState>(() => this.runNodes(dagName, state, fromStage, options));
  }

  /**
   * Canonical generator. Yields each node result (including the
   * intermediate yields from parallel / fan-out / sub-flow nodes) and
   * returns the final `ExecutionResultInterface` with `cursor` set.
   * Never throws.
   *
   * `isDeepDag` is a private implementation detail for recursive deep-DAG
   * re-entry. When `true`, lifecycle transitions (`markRunning`,
   * `markCompleted`) and flow hooks (`onFlowStart`, `onFlowEnd`) are
   * suppressed — those are top-level concerns owned by the consumer's
   * `execute()` / `resume()` call. Node hooks (`onNodeStart`, `onNodeEnd`,
   * `onError`) still fire for every child node.
   */
  private async *runNodes(
    dagName: string,
    state: TState,
    fromStage: string | null,
    options: ExecuteOptionsInterface,
    isDeepDag: boolean = false,
  ): AsyncGenerator<NodeResultInterface<TState>, ExecutionResultInterface<TState>, void> {
    const dag = this.dags.get(dagName);

    if (!dag) {
      // Unknown DAG: synthesize an error result without starting the
      // lifecycle. `state` may not have been touched yet, so don't mark
      // running. The cursor is null because there is no DAG to resume.
      const error = new DAGError(`Unknown DAG: ${dagName}`);
      this.onError('<unknown>', error, state);
      if (!isDeepDag) {
        try { state.markFailed(error); } catch { /* state may already be terminal */ }
      }
      const result: ExecutionResultInterface<TState> = {
        'cursor': null, 'executedNodes': [], 'skippedNodes': [], state, 'terminalOutcome': null,
      };
      if (!isDeepDag) this.onFlowEnd(dagName, state, result);
      return result;
    }

    const signal = SignalComposer.compose(options);

    if (!isDeepDag) {
      state.markRunning();
      this.onFlowStart(dagName, state);
    }

    const executedNodes: string[] = [];
    const skippedNodes: string[] = [];
    let currentNodeName: null | string = fromStage ?? dag.entrypoint;
    let cursor: null | string = currentNodeName;
    let terminalOutcome: 'completed' | 'failed' | null = null;

    while (currentNodeName !== null) {
      if (signal?.aborted) {
        this.handleAbort(state, signal);
        const reason = signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'aborted'));
        this.onError(currentNodeName, reason, state);
        const result: ExecutionResultInterface<TState> = {
          cursor, executedNodes, skippedNodes, state, terminalOutcome,
        };
        if (!isDeepDag) this.onFlowEnd(dagName, state, result);
        return result;
      }

      const node = this.nodeIndex.get(`${dagName}:${currentNodeName}`);

      if (!node) {
        const error = new DAGError(`Unknown node: ${currentNodeName} in DAG ${dagName}`);
        this.onError(currentNodeName, error, state);
        if (!isDeepDag) {
          try { state.markFailed(error); } catch { /* already terminal */ }
        }
        const result: ExecutionResultInterface<TState> = {
          cursor, executedNodes, skippedNodes, state, terminalOutcome,
        };
        if (!isDeepDag) this.onFlowEnd(dagName, state, result);
        return result;
      }

      this.onNodeStart(node.name, state);

      // TerminalNode is a no-op execution — capture outcome, synthesize result,
      // fire onNodeEnd, and break the loop. No call to executeDAGNode needed.
      if (node['@type'] === 'TerminalNode') {
        const terminal = node as TerminalNodePlacementInterface;
        terminalOutcome = terminal.outcome;
        executedNodes.push(terminal.name);
        const terminalResult: NodeResultInterface<TState> = {
          'output': terminal.outcome,
          'skipped': false,
          'nodeName': terminal.name,
          state,
        };
        this.onNodeEnd(terminal.name, terminal.outcome, state);
        yield terminalResult;
        break;
      }

      let nodeOutcome: InternalNodeResultInterface<TState>;
      try {
        nodeOutcome = await this.executeDAGNode(node, state, dagName, signal);
      } catch (caughtError) {
        const error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
        this.onError(currentNodeName, error, state);
        if (!isDeepDag) {
          if (signal?.aborted) {
            this.handleAbort(state, signal);
          } else if (!DAGLifecycleMachine.isTerminal(state.lifecycle)) {
            try { state.markFailed(error); } catch { /* already terminal */ }
          }
        }
        const result: ExecutionResultInterface<TState> = {
          cursor, executedNodes, skippedNodes, state, terminalOutcome,
        };
        if (!isDeepDag) this.onFlowEnd(dagName, state, result);
        return result;
      }

      const { nextStage, "result": nodeResult } = nodeOutcome;

      // Yield intermediate results from parallel/fan-out/deep-DAG nodes
      if ('intermediateResults' in nodeResult) {
        const inter = (nodeResult as NodeResultInterface<TState> & { 'intermediateResults': Array<NodeResultInterface<TState>> }).intermediateResults;
        for (const intermediate of inter) {
          yield intermediate;
        }
      }

      if (nodeResult.skipped) {
        skippedNodes.push(nodeResult.nodeName);
      } else {
        executedNodes.push(nodeResult.nodeName);
      }

      this.onNodeEnd(node.name, nodeResult.output, state);

      yield nodeResult;

      currentNodeName = nextStage;
      cursor = nextStage;
    }

    if (!isDeepDag) {
      if (terminalOutcome === 'failed') {
        try {
          state.markFailed(new DAGError(`Flow terminated at '${executedNodes[executedNodes.length - 1] ?? '<unknown>'}' with outcome=failed`));
        } catch { /* state may already be terminal */ }
      } else {
        // terminalOutcome === 'completed' OR null (ran out of work naturally)
        try { state.markCompleted(); } catch { /* state may already be terminal */ }
      }
    }
    const result: ExecutionResultInterface<TState> = {
      'cursor': null, executedNodes, skippedNodes, state, terminalOutcome,
    };
    if (!isDeepDag) this.onFlowEnd(dagName, state, result);
    return result;
  }

  /**
   * Build the per-node context. Falls back to a never-aborting signal
   * when no cancellation was requested. Carries the dispatcher's
   * services bag (or `undefined`) on the `services` field.
   */
  private buildContext(
    dagName: string,
    nodeName: string,
    signal: AbortSignal | null,
  ): NodeContextInterface<TServices> {
    return {
      'signal': signal ?? new AbortController().signal,
      'dagName': dagName,
      nodeName,
      'services': this.services,
    };
  }

  /**
   * Inspect a triggered abort and mark the lifecycle terminal accordingly.
   * Returns the error to surface on the dispatcher boundary.
   */
  private handleAbort(state: TState, signal: AbortSignal): Error {
    const reason = signal.reason;
    const isTimeout = reason instanceof Error && reason.name === 'TimeoutError';
    if (isTimeout) {
      try { state.markTimedOut(); } catch { /* lifecycle already terminal */ }
      return reason;
    }
    const message = reason instanceof Error
      ? reason.message
      : (typeof reason === 'string' ? reason : 'aborted');
    try { state.markCancelled(message); } catch { /* lifecycle already terminal */ }
    return reason instanceof Error ? reason : new Error(message);
  }

  private async executeFanOut(
    fanOut: FanOutNode,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
  ): Promise<InternalNodeResultInterface<TState>> {
    const sourceArray = this.accessor.get(state, fanOut.source) as unknown[];

    if (!Array.isArray(sourceArray) || sourceArray.length === 0) {
      const nextStage = fanOut.outputs['empty'] ?? null;
      const result: NodeResultInterface<TState> = {
        'output': 'empty',
        'skipped': true,
        'nodeName': fanOut.name,
        state
      };

      return {
        nextStage,
        result
      };
    }

    const node = this.nodes.get(fanOut.node);

    if (!node) {
      throw new DAGError(`Unknown node: ${fanOut.node}`);
    }
    const itemKey = fanOut.itemKey ?? 'currentItem';
    const concurrency = fanOut.concurrency ?? sourceArray.length;

    const resultsByOutput = new Map<string, unknown[]>();
    const itemResults: Array<{ 'item': unknown;
      'output': string }> = [];

    for (let i = 0; i < sourceArray.length; i += concurrency) {
      const batch = sourceArray.slice(i, i + concurrency);
      const batchPromises = batch.map(async (item, batchIndex) => {
        const itemState = state.clone() as TState;

        itemState.setMetadata(itemKey, item);
        itemState.setMetadata('itemIndex', i + batchIndex);

        const context = this.buildContext(dagName, fanOut.name, signal);
        const opResult = await node.execute(itemState, context);

        if (opResult.errors) {
          for (const error of opResult.errors) {
            state.collectError(error);
          }
        }

        return {
          item,
          'output': opResult.output
        };
      });

      const batchResults = await Promise.all(batchPromises);

      itemResults.push(...batchResults);
    }

    for (const {
      item, output
    } of itemResults) {
      const outputArray = resultsByOutput.get(output);

      if (outputArray) {
        outputArray.push(item);
      } else {
        resultsByOutput.set(output, [item]);
      }
    }

    await this.fanIn(state, fanOut.fanIn, resultsByOutput, dagName, signal);

    const successCount = resultsByOutput.get('success')?.length ?? 0;
    const errorCount = itemResults.length - successCount;
    let aggregateOutput: string;

    if (errorCount === 0) {
      aggregateOutput = 'all-success';
    } else if (successCount === 0) {
      aggregateOutput = 'all-error';
    } else {
      aggregateOutput = 'partial';
    }

    const nextStage = fanOut.outputs[aggregateOutput] ?? null;
    const result: NodeResultInterface<TState> = {
      'output': aggregateOutput,
      'skipped': false,
      'nodeName': fanOut.name,
      state
    };

    return {
      nextStage,
      result
    };
  }

  private async executeParallelGroup(
    group: ParallelNode,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
  ): Promise<InternalNodeResultInterface<TState>> {
    const nodes = group.nodes.map((nodeName) => {
      const node = this.nodeIndex.get(`${dagName}:${nodeName}`);

      if (node?.['@type'] !== 'SingleNode') {
        throw new DAGError(`Parallel group ${group.name} references invalid node: ${String(nodeName)}`);
      }

      return node;
    });

    const promises = nodes.map(async (nodeConfig) => {
      const dagNode = this.nodes.get(nodeConfig.node);

      if (!dagNode) {
        throw new DAGError(`Unknown node: ${nodeConfig.node}`);
      }
      const context = this.buildContext(dagName, nodeConfig.name, signal);
      const opResult = await dagNode.execute(state, context);

      return {
        opResult,
        'node': nodeConfig
      };
    });

    const results = await Promise.all(promises);

    for (const { opResult } of results) {
      if (opResult.errors) {
        for (const error of opResult.errors) {
          state.collectError(error);
        }
      }
    }

    const intermediateResults: Array<NodeResultInterface<TState>> = results.map(({
      opResult, node
    }) => ({
      'output': opResult.output,
      'skipped': false,
      'nodeName': node.name,
      state
    }));

    const outputs = results.map((resultItem) => resultItem.opResult.output);
    const combiner = ParallelCombiners.resolve(group.combine);
    const combinedOutput = combiner.combine(outputs, results, state);

    const nextStage = group.outputs[combinedOutput] ?? null;
    const result: NodeResultInterface<TState> & { 'intermediateResults': Array<NodeResultInterface<TState>> } = {
      intermediateResults,
      'output': combinedOutput,
      'skipped': false,
      'nodeName': group.name,
      state
    };

    return {
      nextStage,
      result
    };
  }

  /**
   * Wrap a node execute call with a per-node timeout when `dagNode.timeoutMs`
   * is set. Derives a child `AbortController` from the run's signal, arms a
   * Scheduler timer, and races the node's execute against a deadline rejection.
   *
   * The child signal is passed to the node so signal-aware IO (fetch, retry)
   * also cancels. Nodes that do not observe the signal are hard-stopped by the
   * race. On expiry `NodeTimeoutError` propagates; `executeSingleNode` re-throws
   * so the `runNodes` catch block fires `onError` and marks state failed.
   *
   * Timer and parent-abort listener are cleaned up in `finally`.
   */
  private async withNodeTimeout<TResult>(
    dagNode: NodeInterface<TState, string, TServices>,
    parentSignal: AbortSignal | null,
    fn: (signal: AbortSignal) => Promise<TResult>,
  ): Promise<TResult> {
    const { timeoutMs } = dagNode;

    if (timeoutMs === undefined) {
      // No per-node budget — pass parent signal through unchanged.
      const sig = parentSignal ?? new AbortController().signal;
      return fn(sig);
    }

    const childCtrl = new AbortController();
    const onParentAbort = (): void => { childCtrl.abort(parentSignal?.reason); };

    if (parentSignal !== null) {
      if (parentSignal.aborted) {
        // Parent already aborted before node started.
        childCtrl.abort(parentSignal.reason);
      } else {
        parentSignal.addEventListener('abort', onParentAbort, { 'once': true });
      }
    }

    const timeoutError = new NodeTimeoutError(dagNode.name, timeoutMs);

    // Deadline race: resolves when time elapses (child not yet aborted),
    // rejects immediately if child is already aborted (parent propagation).
    // The Scheduler is swappable via VirtualScheduler in tests.
    let deadlineReject!: (reason: Error) => void;
    const deadlinePromise = new Promise<never>((_resolve, reject) => {
      deadlineReject = reject;
    });

    const schedulerPromise = Scheduler.current()
      .after(timeoutMs, childCtrl.signal)
      .then(() => {
        childCtrl.abort(timeoutError);
        deadlineReject(timeoutError);
      })
      .catch(() => { /* scheduler aborted early (cleanup or parent abort) */ });

    // Start the node execute. Attach a no-op catch so the rejected promise
    // does not surface as an unhandled rejection when the deadline race wins
    // and the finally block aborts the child signal (causing execute to reject
    // after Promise.race has already settled).
    const nodePromise = fn(childCtrl.signal);
    nodePromise.catch(() => { /* swallowed — deadline race already settled */ });

    try {
      // Race the node execute against the deadline rejection.
      return await Promise.race([nodePromise, deadlinePromise]);
    } finally {
      // Cancel the pending Scheduler entry (no-op if already resolved/aborted)
      // and detach the parent-abort listener.
      childCtrl.abort(new Error('node-timeout-cleanup'));
      if (parentSignal !== null) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
      await schedulerPromise;
    }
  }

  private async executeSingleNode(
    nodeConfig: SingleNodePlacementInterface,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
  ): Promise<InternalNodeResultInterface<TState>> {
    const dagNode = this.nodes.get(nodeConfig.node);

    if (!dagNode) {
      throw new DAGError(`Unknown node: ${nodeConfig.node}`);
    }

    const opResult = await this.withNodeTimeout(dagNode, signal, (nodeSignal) => {
      const context = this.buildContext(dagName, nodeConfig.name, nodeSignal);
      return dagNode.execute(state, context);
    });

    if (opResult.errors) {
      for (const error of opResult.errors) {
        state.collectError(error);
      }
    }

    const nextStage = nodeConfig.outputs[opResult.output];

    if (nextStage === undefined) {
      throw new DAGError(`Node ${dagNode.name} returned output '${opResult.output}' but node ${nodeConfig.name} has no routing for it. `
        + `Available outputs: ${Object.keys(nodeConfig.outputs).join(', ')}`);
    }

    const result: NodeResultInterface<TState> = {
      'output': opResult.output,
      'skipped': false,
      'nodeName': nodeConfig.name,
      state
    };

    return {
      nextStage,
      result
    };
  }

  private async executeDAGNode(
    entry: DAGNodeType,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
  ): Promise<InternalNodeResultInterface<TState>> {
    const dispatch: Readonly<Record<DAGNodeAtType, () => Promise<InternalNodeResultInterface<TState>>>> = {
      'FanOutNode':   () => this.executeFanOut(entry as FanOutNode, state, dagName, signal),
      'ParallelNode': () => this.executeParallelGroup(entry as ParallelNode, state, dagName, signal),
      'SingleNode':   () => this.executeSingleNode(entry as SingleNodePlacementInterface, state, dagName, signal),
      'DeepDAGNode':  () => this.executeDeepDAG(entry as DeepDAGNode, state, signal),
      'TerminalNode': () => {
        // TerminalNode is handled before executeDAGNode in runNodes; this
        // branch is unreachable in normal operation but satisfies the
        // exhaustive dispatch table.
        const terminal = entry as TerminalNodePlacementInterface;
        const result: NodeResultInterface<TState> = {
          'output': terminal.outcome,
          'skipped': false,
          'nodeName': terminal.name,
          state,
        };
        return Promise.resolve({ 'nextStage': null, result });
      },
    };
    const handler = dispatch[entry['@type']];
    if (handler === undefined) {
      throw new DAGError(`Unknown node type: ${(entry as DAGNodeType)['@type']}`);
    }
    return handler();
  }

  private async executeDeepDAG(
    deepDAG: DeepDAGNode,
    state: TState,
    signal: AbortSignal | null,
  ): Promise<InternalNodeResultInterface<TState>> {
    const childState = this.createChildState(state, deepDAG.stateMapping?.input);

    const intermediateResults: Array<NodeResultInterface<TState>> = [];

    // Forward the signal into the nested execution so child nodes also
    // observe cancellation/timeouts.
    const childOptions: ExecuteOptionsInterface = signal ? { 'signal': signal } : {};

    // Iterate manually so we can capture the inner generator's return
    // value (which carries `terminalOutcome`). `for await` only sees
    // yields; the final return is lost without explicit `.next()` calls.
    const iter = this.runNodes(deepDAG.dag, childState, null, childOptions, true);
    let innerTerminalOutcome: 'completed' | 'failed' | null;
    while (true) {
      const step = await iter.next();
      if (step.done) {
        innerTerminalOutcome = step.value.terminalOutcome;
        break;
      }
      const nodeResult = step.value;
      const intermediate: NodeResultInterface<TState> = {
        'skipped': nodeResult.skipped,
        'nodeName': `${deepDAG.name}.${nodeResult.nodeName}`,
        state,
      };
      if (nodeResult.output !== undefined) {
        intermediate.output = nodeResult.output;
      }
      intermediateResults.push(intermediate);
    }

    this.mapOutputState(childState, state, deepDAG.stateMapping?.output);

    for (const error of childState.errors) {
      state.collectError(error);
    }
    for (const warning of childState.warnings) {
      state.collectWarning(warning);
    }

    // Parent routing: inner TerminalNode(failed) propagates as 'error'
    // even when the child collected no NodeError. This is how an inner
    // DAG signals failure to the parent without the producing node
    // needing to call state.collectError().
    const childOutput = (innerTerminalOutcome === 'failed' || childState.errors.length > 0)
      ? 'error'
      : 'success';
    const nextStage = deepDAG.outputs[childOutput] ?? null;

    const result: NodeResultInterface<TState> & { 'intermediateResults': Array<NodeResultInterface<TState>> } = {
      intermediateResults,
      'output': childOutput,
      'skipped': false,
      'nodeName': deepDAG.name,
      state
    };

    return {
      nextStage,
      result
    };
  }

  private async fanIn(
    state: TState,
    config: FanInConfig,
    resultsByOutput: Map<string, unknown[]>,
    dagName: string,
    signal: AbortSignal | null,
  ): Promise<void> {
    const strategy = FanInStrategies.resolve(config.strategy);
    const execution = this.buildFanInExecution(state, resultsByOutput, dagName, signal);
    await strategy.apply(config, execution);
  }

  /**
   * Build the per-fan-in execution context handed to a `FanInStrategy`.
   * Carries the state accessor, the results map, the dag/signal, and the
   * `invokeNode` method that strategies use to dispatch a registered
   * node back through the engine.
   */
  private buildFanInExecution(
    state: TState,
    resultsByOutput: Map<string, unknown[]>,
    dagName: string,
    signal: AbortSignal | null,
  ): FanInExecution<TState> {
    const dispatcher = this;
    const readonlyResults: ReadonlyMap<string, readonly unknown[]> = resultsByOutput;
    return {
      state,
      'results': readonlyResults,
      dagName,
      signal,
      'accessor': dispatcher.accessor,
      async invokeNode(nodeName: string): Promise<void> {
        const dagNode = dispatcher.nodes.get(nodeName);
        if (!dagNode) {
          throw new DAGError(`Unknown custom node: ${nodeName}`);
        }
        const context = dispatcher.buildContext(dagName, nodeName, signal);
        await dagNode.execute(state, context);
      },
    };
  }

  private mapOutputState(
    childState: TState,
    parentState: TState,
    outputMapping?: Record<string, string>
  ): void {
    if (outputMapping) {
      for (const [
        parentKey,
        childKey
      ] of Object.entries(outputMapping)) {
        const value = this.accessor.get(childState, childKey);

        this.accessor.set(parentState, parentKey, value);
      }
    }
  }

  private static validateDAGConfig<TState extends NodeStateInterface, TServices>(
    dag: DAG,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    dags: Map<string, DAG>
  ): void {
    const errors: string[] = [];
    const nodeNames = new Set<string>();

    for (const node of dag.nodes) {
      if (nodeNames.has(node.name)) {
        errors.push(`Duplicate node name: ${node.name}`);
      }
      nodeNames.add(node.name);
    }

    if (!nodeNames.has(dag.entrypoint)) {
      errors.push(`Entrypoint '${dag.entrypoint}' does not exist in nodes`);
    }

    for (const node of dag.nodes) {
      Dagonizer.validateDAGNode(node, nodes, dags, nodeNames, errors);
    }

    const deepDAGRefs = new Set<string>();
    Dagonizer.collectDeepDAGReferences(dag, dags, deepDAGRefs, new Set([dag.name]), errors);

    if (errors.length > 0) {
      throw new DAGError(`Invalid DAG '${dag.name}':\n  - ${errors.join('\n  - ')}`);
    }
  }

  private static validateDAGNode<TState extends NodeStateInterface, TServices>(
    entry: DAGNodeType,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    dags: Map<string, DAG>,
    nodeNames: Set<string>,
    errors: string[]
  ): void {
    const validators: Readonly<Record<DAGNodeAtType, () => void>> = {
      'FanOutNode':   () => Dagonizer.validateFanOutNode(entry as FanOutNode, nodes, nodeNames, errors),
      'ParallelNode': () => Dagonizer.validateParallelNode(entry as ParallelNode, nodeNames, errors),
      'SingleNode':   () => Dagonizer.validateSingleNode(entry as SingleNodePlacementInterface, nodes, nodeNames, errors),
      'DeepDAGNode':  () => Dagonizer.validateDeepDAGNode(entry as DeepDAGNode, dags, nodeNames, errors),
      'TerminalNode': () => { /* TerminalNode has no outputs to validate; schema pass is sufficient */ },
    };
    validators[entry['@type']]?.();
  }

  private static validateSingleNode<TState extends NodeStateInterface, TServices>(
    nodeConfig: SingleNodePlacementInterface,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    nodeNames: Set<string>,
    errors: string[]
  ): void {
    const dagNode = nodes.get(nodeConfig.node);

    if (!dagNode) {
      errors.push(`Node '${nodeConfig.name}' references unknown registered node: ${nodeConfig.node}`);
      return;
    }

    for (const output of dagNode.outputs) {
      if (!(output in nodeConfig.outputs)) {
        errors.push(`Node '${nodeConfig.name}': registered node '${dagNode.name}' declares output '${output}' but no routing is defined`);
      }
    }

    for (const [output, target] of Object.entries(nodeConfig.outputs)) {
      if (target !== null && !nodeNames.has(target)) {
        errors.push(`Node '${nodeConfig.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateParallelNode(
    group: ParallelNode,
    nodeNames: Set<string>,
    errors: string[]
  ): void {
    for (const nodeName of group.nodes) {
      if (!nodeNames.has(nodeName)) {
        errors.push(`Parallel group '${group.name}' references unknown node: ${nodeName}`);
      }
    }

    for (const [output, target] of Object.entries(group.outputs)) {
      if (target !== null && !nodeNames.has(target)) {
        errors.push(`Parallel group '${group.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateFanOutNode<TState extends NodeStateInterface, TServices>(
    fanOut: FanOutNode,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    nodeNames: Set<string>,
    errors: string[]
  ): void {
    const dagNode = nodes.get(fanOut.node);

    if (!dagNode) {
      errors.push(`Fan-out '${fanOut.name}' references unknown registered node: ${fanOut.node}`);
    }

    if (fanOut.fanIn.strategy === 'append' && fanOut.fanIn.target === undefined) {
      errors.push(`Fan-out '${fanOut.name}': 'append' strategy requires 'target' path`);
    }
    if (fanOut.fanIn.strategy === 'partition' && fanOut.fanIn.partitions === undefined) {
      errors.push(`Fan-out '${fanOut.name}': 'partition' strategy requires 'partitions' config`);
    }
    if (fanOut.fanIn.strategy === 'custom') {
      if (fanOut.fanIn.customNode === undefined) {
        errors.push(`Fan-out '${fanOut.name}': 'custom' strategy requires 'customNode'`);
      } else if (!nodes.has(fanOut.fanIn.customNode)) {
        errors.push(`Fan-out '${fanOut.name}': custom node '${fanOut.fanIn.customNode}' not found`);
      }
    }

    for (const [output, target] of Object.entries(fanOut.outputs)) {
      if (target !== null && !nodeNames.has(target)) {
        errors.push(`Fan-out '${fanOut.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateDeepDAGNode(
    deepDAG: DeepDAGNode,
    dags: Map<string, DAG>,
    nodeNames: Set<string>,
    errors: string[]
  ): void {
    if (!dags.has(deepDAG.dag)) {
      errors.push(`Deep-DAG '${deepDAG.name}' references unknown DAG: ${deepDAG.dag}`);
    }

    for (const [output, target] of Object.entries(deepDAG.outputs)) {
      if (target !== null && !nodeNames.has(target)) {
        errors.push(`Deep-DAG '${deepDAG.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static collectDeepDAGReferences(
    dag: DAG,
    dags: Map<string, DAG>,
    visited: Set<string>,
    path: Set<string>,
    errors: string[]
  ): void {
    for (const node of dag.nodes) {
      if (node['@type'] === 'DeepDAGNode') {
        if (path.has(node.dag)) {
          errors.push(`Circular deep-DAG reference detected: ${Array.from(path).join(' -> ')} -> ${node.dag}`);
          continue;
        }

        if (!visited.has(node.dag)) {
          visited.add(node.dag);
          const deepDAG = dags.get(node.dag);

          if (deepDAG) {
            const newPath = new Set(path);
            newPath.add(node.dag);
            Dagonizer.collectDeepDAGReferences(deepDAG, dags, visited, newPath, errors);
          }
        }
      }
    }
  }

  /**
   * Register a DAG configuration.
   *
   * Runs two validation passes:
   * 1. Schema pass — `Validator.dag.validate(dag)` checks structure (required fields, valid
   *    `type` and `strategy` enumerations).
   * 2. Semantic pass — verifies entrypoint exists, all node references are resolvable,
   *    no circular deep-DAG references, and every registered node output has a routing
   *    entry in the placement's `outputs` map.
   */
  registerDAG(dag: DAG): void {
    // Schema pre-pass: catches malformed JSON (missing fields, wrong
    // node `type`, fan-in strategy mismatch) before semantic validation
    // surfaces node/DAG cross-references.
    Validator.dag.validate(dag);

    Dagonizer.validateDAGConfig(dag, this.nodes, this.dags);

    // Contract validation: for each SingleNode placement whose registered
    // node carries a co-located `contract`, run dangling-read / dead-write
    // checks. Dangling reads throw DAGError; dead writes call onContractWarning.
    const contractBearingNodes = dag.nodes
      .filter((placement) => placement['@type'] === 'SingleNode')
      .map((placement) => this.nodes.get((placement as { node: string }).node))
      .filter((node): node is NodeInterface<TState, string, TServices> => node?.contract !== undefined);

    if (contractBearingNodes.length > 0) {
      const contracts = contractBearingNodes.map((node) => {
        const contract = node.contract;
        if (contract === undefined) return null;
        return { 'name': node.name, 'outputs': node.outputs, 'hardRequired': contract.hardRequired, 'produces': contract.produces };
      }).filter((c): c is Exclude<typeof c, null> => c !== null);
      try {
        ContractRegistryValidator.validate(contracts, (msg) => { this.onContractWarning(msg); }, dag.entrypoint);
      } catch (err) {
        throw err instanceof Error ? err : new DAGError(String(err));
      }
    }

    this.dags.set(dag.name, dag);
    for (const node of dag.nodes) {
      this.nodeIndex.set(`${dag.name}:${node.name}`, node);
    }
  }

  /**
   * Parse JSON and validate against `DAGSchema`. The single permitted
   * ingest boundary where `unknown` enters the package.
   *
   * Throws `ValidationError` for malformed JSON or schema-noncompliant input.
   */
  static load(json: string): DAG {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ValidationError(`Invalid JSON: ${message}`);
    }
    return Validator.dag.validate(parsed);
  }

  /**
   * Parse an already-decoded value and validate. Same boundary semantics
   * as `load` but skips JSON.parse for callers that have already decoded.
   */
  static fromValue(value: unknown): DAG {
    return Validator.dag.validate(value);
  }

  /** Serialize a DAG to pretty JSON (2-space indent). */
  static serialize(dag: DAG): string {
    return JSON.stringify(dag, null, 2);
  }

  /** Serialize a DAG to compact JSON (no whitespace). */
  static serializeCompact(dag: DAG): string {
    return JSON.stringify(dag);
  }

  /**
   * Register a node. Accepts narrowly-typed nodes
   * (`NodeInterface<TState, 'success' | 'error', TServices>`) and stores
   * them widened to `NodeInterface<TState, string, TServices>` — narrow →
   * wide is sound covariantly on both `outputs` and the result `output`.
   */
  registerNode<TOutput extends string>(
    node: NodeInterface<TState, TOutput, TServices>,
  ): void {
    if (node.validate) {
      const result = node.validate();

      if (!result.valid) {
        throw new DAGError(`Invalid node ${node.name}: ${result.errors.join(', ')}`);
      }
    }
    this.nodes.set(node.name, node as NodeInterface<TState, string, TServices>);
  }
}
