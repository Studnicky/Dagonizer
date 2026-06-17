/**
 * DagHost: isolate-side runtime that speaks the BridgeMessage protocol.
 *
 * Constructed with a duplex MessageChannelInterface and optional options.
 * `start()` subscribes to inbound messages; every message is narrowed via
 * Validator.bridgeMessage before dispatch.
 *
 * Lifecycle:
 *   init     → dynamic-import registry module; createBundle; reply ready
 *   execute  → restore state; run whole DAG; reply result + stream intermediates
 *   abort    → fire AbortController for that correlationId
 *   shutdown → destroy registered nodes; close channel
 *
 * WorkerObserver is constructed per-execute, bound to the channel and
 * correlationId. Its protected hook overrides post `instrumentation`
 * BridgeMessages back to the parent. This is the correct wiring: a single
 * WorkerObserver per host lifetime would require a mutable correlationId
 * (unsafe for concurrent executions); per-execute construction is cheap and
 * gives exact per-correlationId routing without synchronisation.
 *
 * All properties are initialised in constructor for V8 hidden-class stability.
 */

import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { RegistryBundleInterface, RegistryModuleInterface } from '../contracts/RegistryModuleInterface.js';
import type { ExecutionRequest } from '../entities/executor/ExecutionRequest.js';
import type { ExecutionResponse } from '../entities/executor/ExecutionResponse.js';
import type { ExecutorIntermediate } from '../entities/executor/ExecutorIntermediate.js';
import type { JsonObject } from '../entities/json.js';
import { NodeErrorBuilder } from '../entities/node/NodeError.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { Validator } from '../validation/Validator.js';

import { WorkerObserver } from './WorkerObserver.js';

// ---------------------------------------------------------------------------
// DagHostOptions
// ---------------------------------------------------------------------------

/**
 * DagHost construction options. `registry` statically injects the isolate
 * registry: when set, init uses it directly instead of importing
 * `registryModule` by URL. Omit it for the URL-import path.
 */
export interface DagHostOptions {
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

  constructor(channel: MessageChannelInterface, options: DagHostOptions = {}) {
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
            'kind': 'error',
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
        'kind': 'error',
        'correlationId': null,
        'code': 'INVALID_MESSAGE',
        'message': 'Received a message that does not conform to BridgeMessage schema',
        'recoverable': true,
      });
      return;
    }

    // Exhaustive typed switch: TypeScript narrows `message` on each `kind` arm,
    // eliminating the need for `as` casts inside each handler. The R3
    // fire-and-forget pattern for 'execute' is preserved — the error is
    // captured and sent as a channel message rather than leaking an unhandled
    // rejection. Unknown kinds (host→parent messages) are unexpected here but
    // must not crash the host.
    switch (message.kind) {
      case 'init':
        await this.#handleInit(message.registryModule, message.registryVersion, message.servicesConfig as JsonObject);
        break;
      case 'execute':
        // R3: fire-and-forget with error capture so failures reach the caller.
        this.#handleExecute(message.request.correlationId, message.request).catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          try {
            this.#channel.send({
              'kind': 'error',
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
          'kind': 'error',
          'correlationId': null,
          'code': 'UNEXPECTED_MESSAGE',
          'message': `DagHost received unexpected message kind: ${(message as { kind: string }).kind}`,
          'recoverable': true,
        });
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------------

  async #handleInit(
    registryModule: string,
    expectedVersion: string,
    servicesConfig: JsonObject,
  ): Promise<void> {
    try {
      let registry: RegistryModuleInterface;
      if (this.#registry !== null) {
        // Statically injected: no dynamic import; `registryModule` is ignored.
        registry = this.#registry;
      } else {
        // Dynamic import is the module ingest boundary: the loaded module is
        // unknown at compile time, so the cast to { default?: unknown } is the
        // entry point for runtime narrowing that follows.
        const mod = await import(registryModule) as { default?: unknown };

        // Runtime-narrow the default export via typeof checks before the cast.
        // The guard below confirms `createBundle` is a function before the cast
        // to RegistryModuleInterface, making the subsequent typed call safe.
        const registryInterface = mod.default;
        if (
          registryInterface === null ||
          typeof registryInterface !== 'object' ||
          typeof (registryInterface as Record<string, unknown>)['createBundle'] !== 'function'
        ) {
          this.#channel.send({
            'kind': 'error',
            'correlationId': null,
            'code': 'INVALID_REGISTRY_MODULE',
            'message': `Registry module default export does not implement RegistryModuleInterface (missing createBundle)`,
            'recoverable': false,
          });
          return;
        }

        // Cast is safe: the typeof guard above confirms createBundle exists as a function.
        registry = registryInterface as RegistryModuleInterface;
      }

      const bundle = await registry.createBundle(servicesConfig);

      if (bundle.registryVersion !== expectedVersion) {
        this.#channel.send({
          'kind': 'error',
          'correlationId': null,
          'code': 'VERSION_MISMATCH',
          'message': `Registry version mismatch: expected '${expectedVersion}', got '${bundle.registryVersion}'`,
          'recoverable': false,
        });
        return;
      }

      this.#bundle = bundle;

      this.#channel.send({
        'kind': 'ready',
        'registryVersion': bundle.registryVersion,
        'capabilities': [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#channel.send({
        'kind': 'error',
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
    request: ExecutionRequest,
  ): Promise<void> {
    if (this.#bundle === null) {
      this.#channel.send({
        'kind': 'error',
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
    request: ExecutionRequest,
    controller: AbortController,
    bundle: RegistryBundleInterface,
  ): Promise<void> {
    const stateSnapshot = request.stateSnapshot as JsonObject;
    const state = bundle.restoreState.restore(stateSnapshot);

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
    const dagonizer = new WorkerObserver<NodeStateInterface>(
      this.#channel,
      correlationId,
      request.placementPath,
      { 'services': bundle.services },
    );
    dagonizer.registerBundle(bundle.bundle);

    try {
      const execution = dagonizer.execute(request.dagName, state, {
        'signal': controller.signal,
      });

      // Drain the async generator, forwarding each NodeResult as an intermediate
      // message and collecting it for the result response.
      const generator = execution[Symbol.asyncIterator]();
      let terminalOutcome: string | null = null;
      const intermediates: ExecutorIntermediate[] = [];

      while (true) {
        const next = await generator.next();
        if (next.done === true) {
          terminalOutcome = next.value.terminalOutcome ?? null;
          break;
        }
        const nodeResult = next.value;
        const intermediate: ExecutorIntermediate = {
          'output': nodeResult.output,
          'skipped': nodeResult.skipped,
          'nodeName': nodeResult.nodeName,
        };
        intermediates.push(intermediate);
        this.#channel.send({
          'kind': 'intermediate',
          'correlationId': correlationId,
          'nodeName': nodeResult.nodeName,
          'output': nodeResult.output,
          'placementPath': [...request.placementPath],
        });
      }

      // Derive terminalOutput from terminalOutcome. When terminalOutcome is null
      // the DAG did not route to a TerminalNode. Any lifecycle that is not
      // 'completed' (including 'running', 'pending', 'failed') is treated as
      // failed — a non-completed lifecycle with no terminal output is never
      // reported as success.
      const lifecycle = state.lifecycle;
      const derivedTerminal = terminalOutcome !== null
        ? terminalOutcome
        : lifecycle.kind === 'completed'
          ? 'completed'
          : 'failed';

      // Collect errors from state. Surface a synthetic DAG_EXECUTION_FAILED error
      // whenever terminalOutcome is null AND the lifecycle is not 'completed'.
      // This covers unknown DAG names, never-started DAGs (pending), aborted runs
      // still in 'running', and explicit 'failed' lifecycle. DAGs that run to
      // completion without a TerminalNode (lifecycle completed, terminalOutcome
      // null) are normal — no synthetic error.
      const collectedErrors = [
        ...state.errors,
        ...(terminalOutcome === null && lifecycle.kind !== 'completed'
          ? [NodeErrorBuilder.from(
            'DAG_EXECUTION_FAILED',
            `DAG '${request.dagName}' did not complete normally (lifecycle: ${lifecycle.kind})`,
            request.dagName,
            false,
            new Date().toISOString(),
          )]
          : []),
      ];

      const response: ExecutionResponse = {
        'correlationId': correlationId,
        'terminalOutput': derivedTerminal,
        'errors': collectedErrors,
        'stateSnapshot': state.snapshot(),
        intermediates,
      };

      this.#channel.send({ 'kind': 'result', 'response': response });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const response: ExecutionResponse = {
        'correlationId': correlationId,
        'terminalOutput': 'failed',
        'errors': [NodeErrorBuilder.from(
          'DAG_EXECUTION_FAILED',
          message,
          request.dagName,
          false,
          new Date().toISOString(),
        )],
        'stateSnapshot': state.snapshot(),
        'intermediates': [],
      };

      this.#channel.send({ 'kind': 'result', 'response': response });
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
      // R2: reconstruct the appropriate error kind so lifecycle classification
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
