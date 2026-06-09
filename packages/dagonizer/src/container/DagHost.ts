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
 *   abort    → fire AbortController for that requestId
 *   shutdown → destroy registered nodes; close channel
 *
 * ForwardingInstrumentation is constructed per-execute, bound to the channel
 * and requestId, and passed to the Dagonizer constructor for that run. This
 * means each execute creates a fresh Dagonizer with per-request instrumentation.
 * This is the correct wiring: a single Dagonizer per host lifetime would require
 * a mutable instrumentation slot (unsafe for concurrent executions); per-execute
 * construction is cheap and gives exact per-requestId routing of instrumentation
 * messages without synchronisation.
 *
 * All properties are initialised in constructor for V8 hidden-class stability.
 */

import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { RegistryBundleInterface, RegistryModuleInterface } from '../contracts/RegistryModuleInterface.js';
import { Dagonizer } from '../Dagonizer.js';
import type { DispatcherBundle } from '../Dagonizer.js';
import type { ExecutionResponse } from '../entities/executor/ExecutionResponse.js';
import type { ExecutorIntermediate } from '../entities/executor/ExecutorIntermediate.js';
import type { JsonObject } from '../entities/json.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { Validator } from '../validation/Validator.js';

import { ForwardingInstrumentation } from './ForwardingInstrumentation.js';

// ---------------------------------------------------------------------------
// DagHostOptions
// ---------------------------------------------------------------------------

/**
 * DagHost construction options. Currently carries no fields; the type exists
 * as the extension point for future host configuration (e.g. custom error
 * reporters) and to keep the constructor's options-object shape canonical.
 */
export type DagHostOptions = Record<string, never>;

// ---------------------------------------------------------------------------
// DagHost
// ---------------------------------------------------------------------------

export class DagHost {
  readonly #channel: MessageChannelInterface;
  /** In-flight requests: requestId → AbortController. */
  readonly #inflight: Map<string, AbortController>;
  /** Bundle loaded after init. */
  #bundle: RegistryBundleInterface | null;

  constructor(channel: MessageChannelInterface, _options: DagHostOptions = {}) {
    this.#channel = channel;
    this.#inflight = new Map();
    this.#bundle = null;
  }

  /** Subscribe to inbound messages. Must be called once after construction. */
  start(): void {
    this.#channel.onMessage((raw) => {
      void this.#handleMessage(raw);
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
        'requestId': null,
        'code': 'INVALID_MESSAGE',
        'message': 'Received a message that does not conform to BridgeMessage schema',
        'recoverable': true,
      });
      return;
    }

    switch (message.kind) {
      case 'init':
        await this.#handleInit(message.registryModule, message.registryVersion, message.servicesConfig as JsonObject);
        break;
      case 'execute':
        void this.#handleExecute(message.request.requestId, message.request);
        break;
      case 'abort':
        this.#handleAbort(message.requestId, message.reason);
        break;
      case 'shutdown':
        await this.#handleShutdown();
        break;
      default:
        // DagHost receives only parent→host messages; host→parent messages are
        // unexpected on this side but must not crash the host.
        this.#channel.send({
          'kind': 'error',
          'requestId': null,
          'code': 'UNEXPECTED_MESSAGE',
          'message': `DagHost received unexpected message kind: ${(message as { kind: string }).kind}`,
          'recoverable': true,
        });
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
      // Dynamic import is the module ingest boundary.
      const mod = await import(registryModule) as { default?: unknown };

      // Runtime-narrow the default export via typeof checks.
      const registryInterface = mod.default;
      if (
        registryInterface === null ||
        typeof registryInterface !== 'object' ||
        typeof (registryInterface as Record<string, unknown>)['createBundle'] !== 'function'
      ) {
        this.#channel.send({
          'kind': 'error',
          'requestId': null,
          'code': 'INVALID_REGISTRY_MODULE',
          'message': `Registry module default export does not implement RegistryModuleInterface (missing createBundle)`,
          'recoverable': false,
        });
        return;
      }

      const registry = registryInterface as RegistryModuleInterface;
      const bundle = await registry.createBundle(servicesConfig);

      if (bundle.registryVersion !== expectedVersion) {
        this.#channel.send({
          'kind': 'error',
          'requestId': null,
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
        'requestId': null,
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
    requestId: string,
    request: {
      readonly dagName: string;
      readonly placementPath: readonly string[];
      readonly stateSnapshot: Record<string, unknown>;
      readonly timeoutMs: number | null;
      readonly requestId: string;
    },
  ): Promise<void> {
    if (this.#bundle === null) {
      this.#channel.send({
        'kind': 'error',
        'requestId': requestId,
        'code': 'NOT_INITIALIZED',
        'message': 'DagHost has not been initialized; send init first',
        'recoverable': false,
      });
      return;
    }

    const controller = new AbortController();
    this.#inflight.set(requestId, controller);
    const bundle = this.#bundle;

    try {
      await this.#executeDAG(requestId, request, controller, bundle);
    } finally {
      this.#inflight.delete(requestId);
    }
  }

  async #executeDAG(
    requestId: string,
    request: {
      readonly dagName: string;
      readonly placementPath: readonly string[];
      readonly stateSnapshot: Record<string, unknown>;
      readonly timeoutMs: number | null;
    },
    controller: AbortController,
    bundle: RegistryBundleInterface,
  ): Promise<void> {
    const state = bundle.restoreState(request.stateSnapshot as JsonObject);

    // Set up timeout abort if specified.
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (request.timeoutMs !== null) {
      timeoutHandle = setTimeout(() => {
        controller.abort(new Error(`dag timeout after ${request.timeoutMs}ms`));
      }, request.timeoutMs);
    }

    // ForwardingInstrumentation is constructed per-execute to route instrumentation
    // messages with the correct requestId. The request.placementPath is used as
    // the basePath so that forwarded placementPaths are the full composite path
    // (parent path + inner body path), making them non-empty on the parent side.
    const forwarding = new ForwardingInstrumentation(this.#channel, requestId, request.placementPath);
    const dagonizer = new Dagonizer<NodeStateInterface, unknown>({
      'services': bundle.services,
      'instrumentation': forwarding,
    });
    dagonizer.registerBundle(bundle.bundle as DispatcherBundle<NodeStateInterface, unknown>);

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
          'requestId': requestId,
          'nodeName': nodeResult.nodeName,
          'output': nodeResult.output,
          'placementPath': [...request.placementPath],
        });
      }

      // Derive terminalOutput from terminalOutcome. If null, the DAG did not
      // complete normally (e.g. unknown DAG name). Treat as 'failed' when the
      // lifecycle never advanced past 'pending' (the DAG never started running)
      // or when the lifecycle is in a failed terminal state.
      const lifecycle = state.lifecycle;
      const derivedTerminal = terminalOutcome !== null
        ? terminalOutcome
        : (lifecycle.kind === 'failed' || lifecycle.kind === 'pending')
          ? 'failed'
          : 'completed';

      // Collect errors from state. For unknown or never-started DAGs
      // (terminalOutcome null, lifecycle pending/failed), there are no errors in
      // state.errors because the engine swallows them into the lifecycle.
      // Surface a synthetic error in that case. DAGs that run to completion
      // without a TerminalNode (lifecycle completed) are normal — do NOT add a
      // synthetic error simply because terminalOutcome is null.
      const collectedErrors = [
        ...state.errors,
        ...(terminalOutcome === null && state.errors.length === 0 && lifecycle.kind !== 'completed'
          ? [{
            'code': 'DAG_EXECUTION_FAILED' as const,
            'message': `DAG '${request.dagName}' did not complete normally`,
            'operation': request.dagName,
            'recoverable': false,
            'timestamp': new Date().toISOString(),
          }]
          : []),
      ];

      const response: ExecutionResponse = {
        'requestId': requestId,
        'terminalOutput': derivedTerminal,
        'errors': collectedErrors,
        'stateSnapshot': state.snapshot(),
        intermediates,
      };

      this.#channel.send({ 'kind': 'result', 'response': response });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const response: ExecutionResponse = {
        'requestId': requestId,
        'terminalOutput': 'failed',
        'errors': [{
          'code': 'DAG_EXECUTION_FAILED',
          'message': message,
          'operation': request.dagName,
          'recoverable': false,
          'timestamp': new Date().toISOString(),
        }],
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

  #handleAbort(requestId: string, reason: string): void {
    const controller = this.#inflight.get(requestId);
    if (controller !== undefined) {
      controller.abort(new Error(reason));
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

    this.#channel.close();
  }
}
