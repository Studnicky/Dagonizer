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

import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { RegistryBundleInterface } from '../contracts/RegistryBundleInterface.js';
import type { RegistryModuleInterface } from '../contracts/RegistryModuleInterface.js';
import type { ExecutionRequestType } from '../entities/executor/ExecutionRequest.js';
import type { ExecutionResponseType } from '../entities/executor/ExecutionResponse.js';
import type { ExecutorIntermediateType } from '../entities/executor/ExecutorIntermediate.js';
import { JsonObject } from '../entities/json.js';
import type { JsonObjectType } from '../entities/json.js';
import { NodeErrorBuilder } from '../entities/node/NodeError.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
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
  /** Bundle loaded after init. */
  #bundle: RegistryBundleInterface | null;

  constructor(channel: MessageChannelInterface, options: DagHostOptionsType = {}) {
    this.#channel = channel;
    this.#inflight = new Map();
    this.#registry = options.registry ?? null;
    this.#bundle = null;
  }

  /** Subscribe to inbound messages. Must be called once after construction. */
  start(): void {
    this.#channel.onMessage((raw) => {
      // R3: catch unhandled rejections from message dispatch and forward them
      // as a channel-scoped error rather than leaking an unhandled rejection.
      this.#handleMessage(raw).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
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

    // Exhaustive typed switch: TypeScript narrows `message` on each `variant` arm,
    // eliminating the need for `as` casts inside each handler. The R3
    // fire-and-forget pattern for 'execute' is preserved — the error is
    // captured and sent as a channel message rather than leaking an unhandled
    // rejection. Unknown variants (host→parent messages) are unexpected here but
    // must not crash the host.
    const messageVariant = message.variant;
    switch (message.variant) {
      case 'init': {
        const servicesConfig = JsonObject.is(message.servicesConfig) ? message.servicesConfig : {};
        await this.#handleInit(
          message.registryModule,
          message.registryVersion,
          servicesConfig,
          message.keyingScheme ?? 'name',
        );
        break;
      }
      case 'execute':
        // R3: fire-and-forget with error capture so failures reach the caller.
        this.#handleExecute(message.request.correlationId, message.request).catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          try {
            this.#channel.send({
              'variant': 'error',
              'correlationId': message.request.correlationId,
              'code': 'INTERNAL_ERROR',
              'message': `DagHost execute error: ${errMsg}`,
              'recoverable': false,
            });
          } catch { /* channel closed — suppress */ }
        });
        break;
      case 'abort':
        this.#handleAbort(message.correlationId, message.reason);
        break;
      case 'shutdown':
        await this.#handleShutdown();
        break;
      default:
        // DagHost receives only parent→host messages; host→parent messages are
        // unexpected on this side but must not crash the host.
        this.#channel.send({
          'variant': 'error',
          'correlationId': null,
          'code': 'UNEXPECTED_MESSAGE',
          'message': `DagHost received unexpected message variant: ${messageVariant}`,
          'recoverable': true,
        });
        break;
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
    parentKeyingScheme: 'name' | 'iri' = 'name',
  ): Promise<void> {
    try {
      let registry: RegistryModuleInterface;
      if (this.#registry !== null) {
        // Statically injected: no dynamic import; `registryModule` is ignored.
        registry = this.#registry;
      } else {
        // Dynamic import is the module ingest boundary: the loaded module is
        // unknown at compile time. A typed declaration narrows it without a cast.
        const mod: { default?: unknown } = await import(registryModule);

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

      // Keying-scheme handshake: parent and bundle must agree on whether names
      // are bare or IRI-expanded. A mismatch means the bundle was built for a
      // different namespace strategy and cannot run in this host.
      const bundleKeyingScheme = bundle.keyingScheme ?? 'name';
      if (parentKeyingScheme !== bundleKeyingScheme) {
        this.#channel.send({
          'variant': 'error',
          'correlationId': null,
          'code': 'VERSION_MISMATCH',
          'message': `Keying scheme mismatch: parent expects '${parentKeyingScheme}', bundle provides '${bundleKeyingScheme}'`,
          'recoverable': false,
        });
        return;
      }

      this.#bundle = bundle;

      this.#channel.send({
        'variant': 'ready',
        'registryVersion': bundle.registryVersion,
        'capabilities': [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
    const restoredItems = requestItems.map(({ id, snapshot }: { id: string; snapshot: Record<string, unknown> }) => ({
      'id': id,
      'state': bundle.restoreState.restore(JsonObject.is(snapshot) ? snapshot : {}),
    }));

    // Set up timeout abort if specified.
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (request.timeoutMs !== null) {
      timeoutHandle = setTimeout(() => {
        controller.abort(new Error(`dag timeout after ${request.timeoutMs}ms`));
      }, request.timeoutMs);
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
            ? [NodeErrorBuilder.from(
              'DAG_EXECUTION_FAILED',
              `DAG '${request.dagName}' did not complete normally (lifecycle: ${lifecycle.variant})`,
              request.dagName,
              false,
              new Date().toISOString(),
            )]
            : []),
        ];

        const response: ExecutionResponseType = {
          'correlationId': correlationId,
          'items': [{ 'id': item.id, 'snapshot': item.state.snapshot(), 'terminalOutcome': derivedTerminal }],
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
            // batch/scatter path (only outcome, errors, and stateSnapshot are
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

        const responseItems = restoredItems.map(({ id, state }) => ({
          'id': id,
          'snapshot': state.snapshot(),
          'terminalOutcome': terminalByItemId.get(id) ?? 'failed',
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
      const message = error instanceof Error ? error.message : String(error);

      // On unhandled exception, return failed items for all items in the request.
      const failedItems = restoredItems.map(({ id, state }) => ({
        'id': id,
        'snapshot': state.snapshot(),
        'terminalOutcome': 'failed',
      }));

      const response: ExecutionResponseType = {
        'correlationId': correlationId,
        'items': failedItems,
        'errors': [NodeErrorBuilder.from(
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
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
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
