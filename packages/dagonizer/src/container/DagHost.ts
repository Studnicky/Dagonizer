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
 * WorkerObserver is constructed per-execute, bound to the channel and
 * correlationId. Its protected hook overrides post `instrumentation`
 * BridgeMessages back to the parent. This is the correct wiring: a single
 * WorkerObserver per host lifetime would require a mutable correlationId
 * (unsafe for concurrent executions); per-execute construction is cheap and
 * gives exact per-correlationId routing without synchronisation.
 *
 * `registry` in `DagHostOptionsType` statically injects the isolate registry: when
 * set, init uses it directly instead of importing `registryModule` by URL.
 *
 * All properties are initialised in constructor for V8 hidden-class stability.
 */

import type { GraphStateDeltaInterface } from '../contracts/GraphStateDeltaInterface.js';
import type { GraphStateSnapshotInterface } from '../contracts/GraphStateSnapshotInterface.js';
import type { GraphStateTransferType } from '../contracts/GraphStateTransfer.js';
import type { GraphStateTransferStoreInterface } from '../contracts/GraphStateTransferStoreInterface.js';
import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { RegistryBundleInterface } from '../contracts/RegistryBundleInterface.js';
import type { RegistryModuleInterface } from '../contracts/RegistryModuleInterface.js';
import type { QuadType } from '../contracts/TripleStoreInterface.js';
import type { ExecutionRequestType } from '../entities/executor/ExecutionRequest.js';
import type { ExecutionResponseType } from '../entities/executor/ExecutionResponse.js';
import type { ExecutorIntermediateType } from '../entities/executor/ExecutorIntermediate.js';
import { JsonObject } from '../entities/json.js';
import type { JsonObjectType } from '../entities/json.js';
import { NodeError } from '../entities/node/NodeError.js';
import { DAGError } from '../errors/DAGError.js';
import { GraphStateJsonLdCodec } from '../graph/GraphStateJsonLdCodec.js';
import { GraphStateTerms } from '../graph/GraphStateTerms.js';
import { GraphStateTransferCodec } from '../graph/GraphStateTransferCodec.js';
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
  graphStateTransferStore?: GraphStateTransferStoreInterface;
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
  readonly #graphStateTransferStore: GraphStateTransferStoreInterface | null;
  readonly #capabilities: string[];
  /** Bundle loaded after init. */
  #bundle: RegistryBundleInterface | null;

  constructor(channel: MessageChannelInterface, options: DagHostOptionsType = {}) {
    this.#channel = channel;
    this.#inflight = new Map();
    this.#registry = options.registry ?? null;
    this.#graphStateTransferStore = options.graphStateTransferStore ?? null;
    // Inline N-Quads is the mandatory graph-state wire format, so it is not
    // negotiated as an optional capability. Only transfer modes that require
    // an injected adapter appear in the ready handshake.
    this.#capabilities = this.#graphStateTransferStore === null
      ? []
      : ['graph-ref', 'shared-endpoint', 'inline-delta-nquads', 'delta-ref'];
    this.#bundle = null;
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
  ): Promise<void> {
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

      this.#bundle = bundle;

      this.#channel.send({
        'variant': 'ready',
        'registryVersion': bundle.registryVersion,
        'capabilities': [...this.#capabilities],
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

    try {
      await this.#executeDAG(correlationId, request, controller, bundle);
    } finally {
      this.#inflight.delete(correlationId);
    }
  }

  async #executeDAG(
    correlationId: string,
    request: ExecutionRequestType,
    controller: AbortController,
    bundle: RegistryBundleInterface,
  ): Promise<void> {
    // Restore all item states from the request's items array.
    const requestItems = request.items;
    const restoredItems = await Promise.all(requestItems.map(async ({ id, graphState }) => {
      const state = bundle.restoreState.restore();
      if (graphState !== undefined) {
        if (!DagHost.isGraphSnapshot(state)) throw new Error('Graph-state transfer requires a graph-backed state implementation');
        await GraphStateTransferCodec.restore(state, graphState);
      }
      return { 'id': id, state, graphState };
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

    // WorkerObserver is constructed per-execute to route hook events with the
    // correct correlationId. The request.placementPath is used as the basePath
    // so that forwarded placementPaths are the full composite path (parent path
    // + inner body path), making them non-empty on the parent side.
    // A node's dependencies are constructed with the node inside the isolate's
    // registry module (from the init message's `servicesConfig`); the dispatcher
    // carries no services option, so the worker dispatcher needs no options here.
    const dagonizer = new WorkerObserver<NodeStateInterface>(
      this.#channel,
      correlationId,
      request.placementPath,
      {},
    );
    dagonizer.registerBundle(bundle.bundle);

    try {
      const intermediates: ExecutorIntermediateType[] = [];

      if (restoredItems.length === 1) {
        // Single-item path: use the standard execute() API.
        const item = restoredItems[0];
        if (item === undefined) throw new Error('DagHost: invariant — restoredItems[0] is undefined');
        const execution = dagonizer.execute(request.dagName, item.state, {
          'signal': controller.signal,
          ...(request.items[0]?.graphState === undefined ? {} : { 'runIri': request.items[0].graphState.runIri }),
        });

        // Drain the async generator, forwarding each NodeResult as an intermediate
        // message and collecting it for the result response.
        const generator = execution[Symbol.asyncIterator]();
        let terminalOutcome: string | null = null;

        while (true) {
          const next = await generator.next();
          if (next.done === true) {
            terminalOutcome = next.value.terminalOutcome ?? null;
            break;
          }
          const nodeResult = next.value;
          const intermediate: ExecutorIntermediateType = {
            'output': nodeResult.output,
            'skipped': nodeResult.skipped,
            'nodeName': nodeResult.nodeName,
          };
          intermediates.push(intermediate);
          this.#channel.send({
            'variant': 'intermediate',
            'correlationId': correlationId,
            'nodeName': nodeResult.nodeName,
            'output': nodeResult.output,
            'placementPath': [...request.placementPath],
          });
        }

        const lifecycle = item.state.lifecycle;
        const derivedTerminal = terminalOutcome !== null
          ? terminalOutcome
          : lifecycle.variant === 'completed'
            ? 'completed'
            : 'failed';

        const collectedErrors = [
          ...item.state.errors,
          ...(terminalOutcome === null && lifecycle.variant !== 'completed'
            ? [NodeError.create(
              'DAG_EXECUTION_FAILED',
              `DAG '${request.dagName}' did not complete normally (lifecycle: ${lifecycle.variant})`,
              request.dagName,
              false,
              new Date().toISOString(),
            )]
            : []),
        ];

        const graphState = await this.#graphStateOf(item.state, request, item.graphState);
        const response: ExecutionResponseType = {
          'correlationId': correlationId,
          'items': [{ 'id': item.id, 'terminalOutcome': derivedTerminal, 'graphState': graphState }],
          'errors': collectedErrors,
          intermediates,
        };

        this.#channel.send({ 'variant': 'result', 'response': response });
      } else {
        // Multi-item batch path: run each item sequentially through the same DAG.
        // The representative state (first item) is used for lifecycle/flow hooks
        // on the WorkerObserver.
        const terminalByItemId = new Map<string, string>();

        for (const item of restoredItems) {
          const execution = dagonizer.execute(request.dagName, item.state, {
            'signal': controller.signal,
            ...(item.graphState === undefined ? {} : { 'runIri': item.graphState.runIri }),
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
            // Batch path: send live only — do NOT buffer into `intermediates`.
            // Live relay delivers observability to the parent in real-time.
            // `ExecutionResponse.intermediates` is unused by Dagonizer for the
            // batch/scatter path carries outcome, errors, and graph state
            // consumed), so buffering here is pure O(N × M) retention with no
            // benefit. The `intermediates` array remains empty for the batch
            // path and is sent as `[]` in the ExecutionResponse below.
            this.#channel.send({
              'variant': 'intermediate',
              'correlationId': correlationId,
              'nodeName': nodeResult.nodeName,
              'output': nodeResult.output,
              'placementPath': [...request.placementPath],
            });
          }

          const lifecycle = item.state.lifecycle;
          const derivedTerminal = terminalOutcome !== null
            ? terminalOutcome
            : lifecycle.variant === 'completed'
              ? 'completed'
              : 'failed';

          terminalByItemId.set(item.id, derivedTerminal);
        }

        // Collect all errors across all items.
        const allErrors = restoredItems.flatMap(({ state }) => [...state.errors]);

        const responseItems = await Promise.all(restoredItems.map(async ({ id, state }) => {
          const graphState = await this.#graphStateOf(state, request, restoredItems.find((item) => item.id === id)?.graphState);
          return {
            'id': id,
            'terminalOutcome': terminalByItemId.get(id) ?? 'failed',
            'graphState': graphState,
          };
        }));

        const response: ExecutionResponseType = {
          'correlationId': correlationId,
          'items': responseItems,
          'errors': allErrors,
          intermediates,
        };

        this.#channel.send({ 'variant': 'result', 'response': response });
      }
    } catch (error) {
      const message = DAGError.messageOf(error);

      // On unhandled exception, return failed items for all items in the request.
      const failedItems = await Promise.all(restoredItems.map(async ({ id, state }) => {
        const graphState = await this.#graphStateOf(state, request, restoredItems.find((item) => item.id === id)?.graphState);
        return {
          'id': id,
          'terminalOutcome': 'failed',
          'graphState': graphState,
        };
      }));

      const response: ExecutionResponseType = {
        'correlationId': correlationId,
        'items': failedItems,
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

  private static isGraphSnapshot(state: NodeStateInterface): state is NodeStateInterface & GraphStateSnapshotInterface {
    return 'snapshotGraph' in state && typeof state.snapshotGraph === 'function'
      && 'restoreGraph' in state && typeof state.restoreGraph === 'function';
  }

  private static isGraphDelta(state: NodeStateInterface): state is NodeStateInterface & GraphStateSnapshotInterface & GraphStateDeltaInterface {
    return DagHost.isGraphSnapshot(state) && 'snapshotGraphDelta' in state && typeof state.snapshotGraphDelta === 'function';
  }

  async #graphStateOf(state: NodeStateInterface, request: ExecutionRequestType, requested: GraphStateTransferType | undefined): Promise<GraphStateTransferType> {
    if (!DagHost.isGraphSnapshot(state)) throw new Error('Every node state must expose the graph-state port');
    const quads: QuadType[] = [];
    for await (const quad of state.snapshotGraph(state.runIri)) quads.push(quad);
    const jsonLd = GraphStateJsonLdCodec.encode(quads);
    if (requested?.mode === 'shared-endpoint') {
      if (this.#graphStateTransferStore === null) throw new Error('Shared graph transfer requires a graph transfer store');
      await this.#graphStateTransferStore.writeShared({ "endpoint": requested.endpoint, "token": requested.lease, "graphIris": [...requested.graphIris], "expiresAt": Number.POSITIVE_INFINITY }, state.snapshotGraph(state.runIri));
      return { ...requested, jsonLd };
    }
    const placementIri = request.placementPath[request.placementPath.length - 1];
    if (placementIri === undefined) throw new Error('Graph transfer requires an absolute placement identity');
    const identity = {
      'dagIri': request.dagName,
      'placementPath': request.placementPath,
      'placementIri': placementIri,
      'stateGraphIri': GraphStateTerms.runGraphIri(state.runIri),
      jsonLd,
    };
    if (requested?.mode === 'graph-ref') {
      if (this.#graphStateTransferStore === null) throw new Error('Graph snapshot reference transfer requires a graph transfer store');
      return { ...(await GraphStateTransferCodec.referenceStream(this.#graphStateTransferStore, state.runIri, [GraphStateTerms.runGraphIri(state.runIri)], state.snapshotGraph(state.runIri), identity)), jsonLd };
    }
    if (requested === undefined || requested.mode === 'inline-nquads') {
      return { ...(await GraphStateTransferCodec.inlineStream(state.runIri, [GraphStateTerms.runGraphIri(state.runIri)], state.snapshotGraph(state.runIri), identity)), jsonLd };
    }
    if (requested?.mode === 'delta-ref') {
      if (this.#graphStateTransferStore === null) throw new Error('Delta-reference transfer requires a graph transfer store');
      if (!DagHost.isGraphDelta(state)) throw new Error('Delta-reference transfer requires graph delta support');
      const delta = await state.snapshotGraphDelta(state.runIri);
      return { ...GraphStateTransferCodec.deltaReference(state.runIri, requested.baseSnapshotRef, delta.additions, delta.deletions, { ...identity, "baseRevision": delta.baseRevision, "revision": delta.revision }), jsonLd };
    }
    if (requested?.mode === 'inline-delta-nquads') {
      if (!DagHost.isGraphDelta(state)) throw new Error('Inline delta transfer requires graph delta support');
      const delta = await state.snapshotGraphDelta(state.runIri);
      return { ...GraphStateTransferCodec.delta(state.runIri, requested.baseSnapshotRef, delta.additions, delta.deletions, { ...identity, "baseRevision": delta.baseRevision, "revision": delta.revision }), jsonLd };
    }
    throw new Error('Unsupported graph transfer mode');
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
