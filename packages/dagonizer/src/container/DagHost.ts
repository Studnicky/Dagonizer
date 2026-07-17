/**
 * DagHost: isolate-side runtime that speaks the BridgeMessage protocol.
 *
 * Constructed with a duplex MessageChannelInterface and optional options.
 * `start()` subscribes to inbound messages; every message is narrowed via
 * Validator.bridgeMessage before dispatch.
 *
 * Lifecycle:
 *   init     → dynamic-import registry module; instantiate; reply ready
 *   execute  → restore state(s); run whole DAG per item; reply result + stream intermediates
 *   abort    → fire AbortController for that correlationId
 *   shutdown → destroy registered nodes; close channel
 *
 * For single-item requests (N=1), the existing `dagonizer.execute()` path is
 * used unchanged. For multi-item batch requests (N>1), `executeBatch()` runs
 * all items through the same DAG in one round-trip.
 *
 * Init captures the registry bundle once. Each execute request constructs an
 * isolated WorkerObserver with immutable correlation and placement-path state,
 * then registers the captured bundle on that request-scoped dispatcher.
 *
 * `registry` in `DagHostOptionsType` statically injects the isolate registry: when
 * set, init uses it directly instead of importing `registryModule` by URL.
 *
 * All properties are initialised in constructor for V8 hidden-class stability.
 */

import type { DispatcherBundleType } from '../contracts/DispatcherBundle.js';
import { DEFAULT_GRAPH_STATE_TRANSFER_FORMATS, type GraphStateTransferFormatType } from '../contracts/GraphStateTransferFormat.js';
import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { RegistryBundleInterface } from '../contracts/RegistryBundleInterface.js';
import type { RegistryModuleInterface } from '../contracts/RegistryModuleInterface.js';
import { Batch } from '../entities/batch/Batch.js';
import type { ExecutionRequestType } from '../entities/executor/ExecutionRequest.js';
import type { ExecutionResponseType, ExecutionResponseItemType } from '../entities/executor/ExecutionResponse.js';
import type { ExecutorIntermediateType } from '../entities/executor/ExecutorIntermediate.js';
import type { TransientNodeStateBatchType } from '../entities/executor/TransientNodeState.js';
import { JsonObject } from '../entities/json.js';
import type { JsonObjectType } from '../entities/json.js';
import { NodeError } from '../entities/node/NodeError.js';
import { DAGError } from '../errors/DAGError.js';
import { PlacementRouter } from '../execution/PlacementRouter.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { Scheduler } from '../runtime/Scheduler.js';
import { Validator } from '../validation/Validator.js';

import { WorkerObserver } from './WorkerObserver.js';

// ---------------------------------------------------------------------------
// DagHostOptionsType
// ---------------------------------------------------------------------------

/**
 * DagHost construction options. `registry` statically injects the isolate
 * registry: when set, init uses it directly instead of importing
 * `registryModule` by URL. Omit it for the URL-import path.
 */
export type DagHostOptionsType = {
  registry?: RegistryModuleInterface;
}

// ---------------------------------------------------------------------------
// DagHost
// ---------------------------------------------------------------------------

export class DagHost {
  readonly #channel: MessageChannelInterface;
  /** In-flight requests: correlationId → AbortController. */
  readonly #inflight: Map<string, AbortController>;
  /** Statically-injected registry, or null when init imports by URL. */
  readonly #registry: RegistryModuleInterface | null;
  readonly #capabilities: string[];
  #graphStateTransferFormats: readonly GraphStateTransferFormatType[];
  /** Whether WorkerObserver dedups identical instrumentation events per flush window. Defaults to `true`. */
  #coalesceInstrumentation: boolean;
  /** Optional cap on composed worker instrumentation placement-path depth. */
  #instrumentationPlacementPathDepth: number | undefined;
  /** Bundle loaded after init. */
  #bundle: RegistryBundleInterface | null;
  #dispatcherBundle: DispatcherBundleType<NodeStateInterface> | null;

  constructor(channel: MessageChannelInterface, options: DagHostOptionsType = {}) {
    this.#channel = channel;
    this.#inflight = new Map();
    this.#registry = options.registry ?? null;
    this.#graphStateTransferFormats = DEFAULT_GRAPH_STATE_TRANSFER_FORMATS;
    this.#coalesceInstrumentation = true;
    this.#instrumentationPlacementPathDepth = undefined;
    this.#capabilities = [];
    this.#bundle = null;
    this.#dispatcherBundle = null;
  }

  /** Subscribe to inbound messages. Must be called once after construction. */
  start(): void {
    this.#channel.onMessage((raw) => {
      // R3: catch unhandled rejections from message dispatch and forward them
      // as a channel-scoped error rather than leaking an unhandled rejection.
      this.#handleMessage(raw).catch((err: unknown) => {
        const msg = DAGError.messageOf(err);
        try {
          this.#channel.send({
            'variant': 'error',
            'correlationId': null,
            'code': 'INTERNAL_ERROR',
            'message': `DagHost internal error: ${msg}`,
            'recoverable': false,
          });
        } catch { /* channel closed — suppress */ }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Message dispatch
  // ---------------------------------------------------------------------------

  async #handleMessage(raw: unknown): Promise<void> {
    let message;
    try {
      message = Validator.bridgeMessage.validate(raw);
    } catch {
      this.#channel.send({
        'variant': 'error',
        'correlationId': null,
        'code': 'INVALID_MESSAGE',
        'message': 'Received a message that does not conform to BridgeMessage schema',
        'recoverable': true,
      });
      return;
    }

    // Dispatch map over variant: handlers are keyed by message variant.
    // DagHost receives only parent→host messages; host→parent messages are
    // unexpected on this side but must not crash the host; unknown variants
    // receive an UNEXPECTED_MESSAGE error.
    type HostMsg = typeof message;
    const variantDispatch: Partial<{ [K in HostMsg['variant']]: (m: Extract<HostMsg, { variant: K }>) => Promise<void> | void }> = {
      'init': async (m) => {
        const servicesConfig = JsonObject.is(m.servicesConfig) ? m.servicesConfig : {};
        await this.#handleInit(
          m.registryModule,
          m.registryVersion,
          servicesConfig,
          m.graphStateTransferFormats,
          m.coalesceInstrumentation,
          m.instrumentationPlacementPathDepth,
        );
      },
      'execute': (m) => {
        // R3: fire-and-forget with error capture so failures reach the caller.
        this.#handleExecute(m.request.correlationId, m.request).catch((err: unknown) => {
          const errMsg = DAGError.messageOf(err);
          try {
            this.#channel.send({
              'variant': 'error',
              'correlationId': m.request.correlationId,
              'code': 'INTERNAL_ERROR',
              'message': `DagHost execute error: ${errMsg}`,
              'recoverable': false,
            });
          } catch { /* channel closed — suppress */ }
        });
      },
      'abort': (m) => {
        this.#handleAbort(m.correlationId, m.reason);
      },
      'shutdown': async () => {
        await this.#handleShutdown();
      },
    };

    // Exhaustive switch over the discriminant narrows `message` per case, so each
    // handler call typechecks cast-free. Variants DagHost does not handle
    // (host→parent messages arriving on this side) receive UNEXPECTED_MESSAGE.
    switch (message.variant) {
      case 'init':     await variantDispatch.init?.(message);     break;
      case 'execute':  await variantDispatch.execute?.(message);  break;
      case 'abort':    await variantDispatch.abort?.(message);    break;
      case 'shutdown': await variantDispatch.shutdown?.(message); break;
      default:
        this.#channel.send({
          'variant': 'error',
          'correlationId': null,
          'code': 'UNEXPECTED_MESSAGE',
          'message': `DagHost received unexpected message variant: ${String(message.variant)}`,
          'recoverable': true,
        });
    }
  }

  // ---------------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------------

  /**
   * Type-guard predicate confirming a dynamically-imported default export
   * implements `RegistryModuleInterface` (an object exposing an `instantiate`
   * function). Narrows the module-ingest boundary cast-free.
   */
  static #isRegistryModule(value: unknown): value is RegistryModuleInterface {
    return value !== null
      && typeof value === 'object'
      && 'instantiate' in value
      && typeof value.instantiate === 'function';
  }

  async #handleInit(
    registryModule: string,
    expectedVersion: string,
    servicesConfig: JsonObjectType,
    graphStateTransferFormats: readonly GraphStateTransferFormatType[],
    coalesceInstrumentation?: boolean,
    instrumentationPlacementPathDepth?: number,
  ): Promise<void> {
    this.#graphStateTransferFormats = [...graphStateTransferFormats];
    this.#coalesceInstrumentation = coalesceInstrumentation ?? true;
    this.#instrumentationPlacementPathDepth = instrumentationPlacementPathDepth;
    try {
      let registry: RegistryModuleInterface;
      if (this.#registry !== null) {
        // Statically injected: no dynamic import; `registryModule` is ignored.
        registry = this.#registry;
      } else {
        // Dynamic import is the module ingest boundary: the loaded module is
        // unknown at compile time. A typed declaration narrows it without a cast.
        const mod: { default?: unknown } = await import(/* @vite-ignore */ registryModule);

        // `DagHost.#isRegistryModule` is a type-guard predicate that confirms the
        // default export implements `RegistryModuleInterface` (object with an
        // `instantiate` function) — cast-free narrowing at the ingest boundary.
        const registryInterface = mod.default;
        if (!DagHost.#isRegistryModule(registryInterface)) {
          this.#channel.send({
            'variant': 'error',
            'correlationId': null,
            'code': 'INVALID_REGISTRY_MODULE',
            'message': `Registry module default export does not implement RegistryModuleInterface (missing instantiate)`,
            'recoverable': false,
          });
          return;
        }

        registry = registryInterface;
      }

      const bundle = await registry.instantiate(servicesConfig);

      if (bundle.registryVersion !== expectedVersion) {
        this.#channel.send({
          'variant': 'error',
          'correlationId': null,
          'code': 'VERSION_MISMATCH',
          'message': `Registry version mismatch: expected '${expectedVersion}', got '${bundle.registryVersion}'`,
          'recoverable': false,
        });
        return;
      }

      const dispatcherBundle = bundle.bundle;
      this.#bundle = bundle;
      this.#dispatcherBundle = dispatcherBundle;

      this.#channel.send({
        'variant': 'ready',
        'registryVersion': bundle.registryVersion,
        'capabilities': [...this.#capabilities],
        'graphStateTransferFormats': [...this.#graphStateTransferFormats],
      });
    } catch (error) {
      const message = DAGError.messageOf(error);
      this.#channel.send({
        'variant': 'error',
        'correlationId': null,
        'code': 'INIT_FAILED',
        'message': `DagHost init failed: ${message}`,
        'recoverable': false,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // execute
  // ---------------------------------------------------------------------------

  async #handleExecute(
    correlationId: string,
    request: ExecutionRequestType,
  ): Promise<void> {
    if (this.#bundle === null) {
      this.#channel.send({
        'variant': 'error',
        'correlationId': correlationId,
        'code': 'NOT_INITIALIZED',
        'message': 'DagHost has not been initialized; send init first',
        'recoverable': false,
      });
      return;
    }

    const controller = new AbortController();
    this.#inflight.set(correlationId, controller);
    const bundle = this.#bundle;
    const dispatcherBundle = this.#dispatcherBundle;
    if (dispatcherBundle === null) throw new DAGError('DagHost dispatcher bundle is not initialized', { 'code': 'EXECUTION_ERROR' });
    const dispatcher = new WorkerObserver<NodeStateInterface>(
      this.#channel,
      { correlationId, 'basePath': request.placementPath },
      {},
      {
        'coalesceInstrumentation': this.#coalesceInstrumentation,
        ...(this.#instrumentationPlacementPathDepth === undefined
          ? {}
          : { 'instrumentationPlacementPathDepth': this.#instrumentationPlacementPathDepth }),
      },
    );
    dispatcher.registerBundle(dispatcherBundle);

    try {
      await this.#executeDAG(correlationId, request, controller, bundle, dispatcher);
    } finally {
      this.#inflight.delete(correlationId);
    }
  }

  async #executeDAG(
    correlationId: string,
    request: ExecutionRequestType,
    controller: AbortController,
    bundle: RegistryBundleInterface,
    dagonizer: WorkerObserver<NodeStateInterface>,
  ): Promise<void> {
    const requestItems = request.items;
    const stateById = new Map(request.graphState.states.map((entry) => [entry.id, entry.state]));
    const restoredItems = await Promise.all(requestItems.map(async (requestItem) => {
      const state = bundle.restoreState.restore();
      const snapshot = stateById.get(requestItem.id);
      if (snapshot !== undefined) await state.restoreTransientState(requestItem.runIri, snapshot);
      return { 'id': requestItem.id, 'runIri': requestItem.runIri, state };
    }));

    // Set up timeout abort if specified.
    const timeoutAbortController = request.timeoutMs === null ? null : new AbortController();
    const timeoutPromise = request.timeoutMs === null || timeoutAbortController === null
      ? null
      : Scheduler.current()
        .after(request.timeoutMs, { 'signal': timeoutAbortController.signal })
        .then(() => {
          const err = new Error(`dag timeout after ${request.timeoutMs}ms`);
          err.name = 'TimeoutError';
          controller.abort(err);
        })
        .catch(() => { /* timeout cancelled by normal completion or caller abort */ });
    if (request.timeoutMs !== null) {
      controller.signal.addEventListener('abort', () => {
        timeoutAbortController?.abort(controller.signal.reason);
      }, { 'once': true });
    }

    try {
      // Single-item (batch of one) buffers intermediates for the parent's
      // embedded-body stream; the multi-item batch path sends live only (relay
      // delivers per-node observability), so buffering N×M results is pure
      // retention with no consumer — `intermediates` stays empty for batches.
      const intermediates: ExecutorIntermediateType[] = [];
      const terminalByItemId = new Map<string, string>();
      const errors: ReturnType<typeof NodeError.create>[] = [];

      if (restoredItems.length === 1) {
        const item = restoredItems[0];
        if (item === undefined) throw new DAGError('DagHost received an empty restored batch', { 'code': 'VALIDATION_ERROR' });
        const execution = dagonizer.execute(request.dagName, item.state, {
          'signal': controller.signal,
          'runIri': item.runIri,
        });

        const generator = execution[Symbol.asyncIterator]();
        let terminalOutcome: string | null = null;

        while (true) {
          const next = await generator.next();
          if (next.done === true) {
            terminalOutcome = next.value.terminalOutcome ?? null;
            break;
          }
          const nodeResult = next.value;
          intermediates.push({ 'output': nodeResult.output, 'skipped': nodeResult.skipped, 'nodeName': nodeResult.nodeName });
        }

        const lifecycle = item.state.lifecycle;
        terminalByItemId.set(item.id, terminalOutcome !== null
          ? terminalOutcome
          : lifecycle.variant === 'completed' ? 'completed' : 'failed');

        errors.push(...item.state.errors);
        if (terminalOutcome === null && lifecycle.variant !== 'completed') {
          errors.push(NodeError.create(
            'DAG_EXECUTION_FAILED',
            `DAG '${request.dagName}' did not complete normally (lifecycle: ${lifecycle.variant})`,
            request.dagName,
            false,
            new Date().toISOString(),
          ));
        }
      } else {
        const batch = Batch.from(restoredItems.map((item) => ({ 'id': item.id, 'state': item.state })));
        const batchTerminalByItemId = new Map<string, 'completed' | 'failed'>();
        const execution = dagonizer.executeBatch(
          request.dagName,
          batch,
          batchTerminalByItemId,
          { 'signal': controller.signal },
        );
        const generator = execution[Symbol.asyncIterator]();
        while (!(await generator.next()).done) {
          // Multi-item observability is delivered by instrumentation events.
        }
        for (const [itemId, terminalOutcome] of batchTerminalByItemId) {
          terminalByItemId.set(itemId, terminalOutcome);
        }
        for (const item of restoredItems) {
          errors.push(...item.state.errors);
          if (!terminalByItemId.has(item.id)) {
            terminalByItemId.set(item.id, item.state.lifecycle.variant === 'completed' ? 'completed' : 'failed');
          }
        }
      }

      const { graphState, items } = await this.#composeResponseGraph(restoredItems, request, terminalByItemId);
      const response: ExecutionResponseType = {
        'correlationId': correlationId,
        graphState,
        items,
        errors,
        intermediates,
      };

      this.#channel.send({ 'variant': 'result', 'response': response });
    } catch (error) {
      const message = DAGError.messageOf(error);
      // On unhandled exception, return every item as failed with the current
      // terminal state combined into one batch transfer.
      const failedTerminals = new Map(restoredItems.map((item) => [item.id, 'failed']));
      const { graphState, items } = await this.#composeResponseGraph(restoredItems, request, failedTerminals);
      const response: ExecutionResponseType = {
        'correlationId': correlationId,
        graphState,
        items,
        'errors': [NodeError.create(
          'DAG_EXECUTION_FAILED',
          message,
          request.dagName,
          false,
          new Date().toISOString(),
        )],
        'intermediates': [],
      };

      this.#channel.send({ 'variant': 'result', 'response': response });
    } finally {
      if (timeoutAbortController !== null) {
        timeoutAbortController.abort(new DAGError('dag-host-timeout-cleanup', { 'code': 'EXECUTION_ERROR' }));
      }
      if (timeoutPromise !== null) {
        await timeoutPromise;
      }
    }
  }

  /** Snapshot every item's terminal state into ONE plain transient-state batch payload. */
  async #composeResponseGraph(
    restoredItems: readonly { readonly id: string; readonly runIri: string; readonly state: NodeStateInterface }[],
    request: ExecutionRequestType,
    terminalByItemId: ReadonlyMap<string, string>,
  ): Promise<{ graphState: TransientNodeStateBatchType; items: ExecutionResponseItemType[] }> {
    const states: TransientNodeStateBatchType['states'] = [];
    const items: ExecutionResponseItemType[] = [];
    for (const item of restoredItems) {
      const terminalOutcome = terminalByItemId.get(item.id) ?? 'failed';
      items.push({
        'id': item.id,
        'runIri': item.runIri,
        'terminalOutcome': terminalOutcome,
      });
      const hasUnrecoverable = item.state.errors.some((error) => error.recoverable === false);
      const routeOutput = PlacementRouter.route(
        terminalOutcome === 'completed' || terminalOutcome === 'failed'
          ? terminalOutcome
          : null,
        hasUnrecoverable,
      );
      const selection = request.responseState.outputSelections[routeOutput]
        ?? request.responseState.defaultSelection;
      states.push({ 'id': item.id, 'state': item.state.snapshotTransientStateSelection(selection) });
    }
    return { 'graphState': { states }, items };
  }

  // ---------------------------------------------------------------------------
  // abort
  // ---------------------------------------------------------------------------

  #handleAbort(correlationId: string, reason: 'abort' | 'timeout'): void {
    const controller = this.#inflight.get(correlationId);
    if (controller !== undefined) {
      // R2: reconstruct the appropriate error variant so lifecycle classification
      // ('timed_out' vs 'cancelled') is preserved inside the host.
      if (reason === 'timeout') {
        // A TimeoutError-named error is the signal that a run-level deadline
        // fired; the engine inspects error.name to classify the lifecycle.
        const err = new Error('timeout');
        err.name = 'TimeoutError';
        controller.abort(err);
      } else {
        controller.abort(new Error('abort'));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // shutdown
  // ---------------------------------------------------------------------------

  async #handleShutdown(): Promise<void> {
    // Abort all in-flight requests.
    for (const controller of this.#inflight.values()) {
      controller.abort(new Error('shutdown'));
    }
    this.#inflight.clear();

    // R4: destroy registered node resources so open handles are released
    // before the host process/thread exits.
    if (this.#bundle !== null) {
      try {
        await this.#bundle.destroy?.();
      } catch { /* suppress — teardown errors must not prevent channel close */ }
    }

    this.#channel.close();
  }
}
