/**
 * ChannelDispatch: single-subscription correlationId correlator for a MessageChannelInterface.
 *
 * One instance per channel. Installs EXACTLY ONE channel.onMessage handler in
 * the constructor and demuxes inbound messages by correlationId. No per-request
 * listeners are ever registered.
 *
 * Protocol responsibilities:
 *   init()    — send init, await ready; rejects on version mismatch or error.
 *   request() — send execute, await the correlated result; forwards abort +
 *               instrumentation per request.
 *
 * Transport-error contract: request() never throws. A closed channel, send
 * failure, or unroutable error message produces a transport-error DagOutcomeInterface.
 * init() may reject; its caller (DagContainerBase.initializeChannel) handles that.
 *
 * V8 shape stability: all fields initialised in constructor in declaration order.
 */


import type { DagOutcomeInterface } from '../contracts/DagOutcomeInterface.js';
import type { InstrumentationSink } from '../contracts/InstrumentationSink.js';
import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { BridgeMessage } from '../entities/executor/BridgeMessage.js';
import type { ExecutionRequest } from '../entities/executor/ExecutionRequest.js';
import type { JsonObject } from '../entities/json.js';
import type { NodeError } from '../entities/node/NodeError.js';

import { DagOutcome } from './DagOutcome.js';

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

/** Shape of the init message sent to DagHost. */
export interface InitMessageShape {
  readonly registryModule: string;
  readonly registryVersion: string;
  readonly servicesConfig: JsonObject;
}

/** Per-request correlation entry. */
interface PendingEntry {
  correlationId: string;
  settle: (outcome: DagOutcomeInterface) => void;
  sink: InstrumentationSink;
  settled: boolean;
}

/** Pending init-waiter state. */
interface InitWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
  expectedVersion: string;
}

// ---------------------------------------------------------------------------
// ChannelDispatch
// ---------------------------------------------------------------------------

export class ChannelDispatch {
  readonly #channel: MessageChannelInterface;
  readonly #pending: Map<string, PendingEntry>;
  #initWaiter: InitWaiter | null;

  constructor(channel: MessageChannelInterface) {
    this.#channel = channel;
    this.#pending = new Map<string, PendingEntry>();
    this.#initWaiter = null;

    // EXACTLY ONE onMessage registration for the channel's lifetime.
    // All inbound messages are demuxed through #route.
    this.#channel.onMessage((msg) => { this.#route(msg); });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Send init, await ready. Rejects on version mismatch or 'error' message.
   * Call after constructing the dispatch and before the first request().
   */
  init(message: InitMessageShape): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.#initWaiter = {
        resolve,
        reject,
        'expectedVersion': message.registryVersion,
      };
      this.#channel.send({
        'kind': 'init',
        'registryModule': message.registryModule,
        'registryVersion': message.registryVersion,
        'servicesConfig': message.servicesConfig,
      });
    });
  }

  /**
   * Send execute, await the correlated result. `signal` is a required positional
   * arg; `sink` receives forwarded instrumentation messages. Never throws —
   * transport failures resolve to a transport-error DagOutcomeInterface.
   */
  request(
    request: ExecutionRequest,
    signal: AbortSignal,
    sink: InstrumentationSink,
  ): Promise<DagOutcomeInterface> {
    const { correlationId } = request;

    return new Promise<DagOutcomeInterface>((resolve) => {
      const entry: PendingEntry = {
        'correlationId': correlationId,
        'settle': resolve,
        'sink': sink,
        'settled': false,
      };

      this.#pending.set(correlationId, entry);

      // Forward abort signal to the host. R2: derive kind from signal.reason —
      // a TimeoutError on the reason means the run-level deadline expired, so
      // send 'timeout'; everything else is a caller-initiated cancel ('abort').
      const onAbort = (): void => {
        try {
          const abortReason: 'abort' | 'timeout' =
            signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
              ? 'timeout'
              : 'abort';
          this.#channel.send({
            'kind': 'abort',
            'correlationId': correlationId,
            'reason': abortReason,
          });
        } catch { /* fire-and-forget */ }
      };
      signal.addEventListener('abort', onAbort);

      // Settle helper: settles once, removes abort listener, deletes pending entry.
      const settleOnce = (outcome: DagOutcomeInterface): void => {
        if (entry.settled) return;
        entry.settled = true;
        signal.removeEventListener('abort', onAbort);
        this.#pending.delete(correlationId);
        resolve(outcome);
      };

      // Replace settle so #route can call it directly.
      entry.settle = settleOnce;

      try {
        this.#channel.send({ 'kind': 'execute', 'request': request });
      } catch {
        // Send failure: resolve immediately as transport error.
        settleOnce(DagOutcome.transportError(correlationId));
      }
    });
  }

  /**
   * Settle EVERY pending entry with a transport-error outcome and clear the
   * pending map; if an init handshake is in flight, reject its waiter.
   *
   * This is the parent backstop for crash DETECTION: a backend that observes
   * its worker/child die (exit, error, disconnect, stream close) calls this
   * to fail the in-flight request(s) instead of hanging forever. The channel-
   * scoped 'error' message path (correlationId === null) routes here too, so
   * there is exactly one code path that fails all pending work.
   *
   * Idempotent: safe to call when there is nothing pending and no init waiter.
   */
  failAll(code: string, message: string): void {
    const waiter = this.#initWaiter;
    if (waiter !== null) {
      this.#initWaiter = null;
      waiter.reject(new Error(`DagHost init error [${code}]: ${message}`));
    }

    // Snapshot entries before settling: settleOnce mutates #pending (delete).
    const entries = [...this.#pending.values()];
    for (const entry of entries) {
      entry.settle(DagOutcome.transportError(entry.correlationId, { code, message }));
    }
    // settleOnce removes each entry; ensure the map is empty regardless.
    this.#pending.clear();
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  #route(msg: BridgeMessage): void {
    switch (msg.kind) {
      case 'ready': {
        const waiter = this.#initWaiter;
        if (waiter === null) return;
        this.#initWaiter = null;
        if (msg.registryVersion !== waiter.expectedVersion) {
          waiter.reject(new Error(
            `Channel registry version mismatch: expected '${waiter.expectedVersion}', got '${msg.registryVersion}'`,
          ));
        } else {
          waiter.resolve();
        }
        break;
      }

      case 'result': {
        const correlationId = msg.response.correlationId;
        const entry = this.#pending.get(correlationId);
        if (entry === undefined) return;
        entry.settle({
          'terminalOutput': msg.response.terminalOutput,
          'errors': msg.response.errors as readonly NodeError[],
          'stateSnapshot': msg.response.stateSnapshot as JsonObject | null,
          'intermediates': msg.response.intermediates,
        });
        break;
      }

      case 'instrumentation': {
        const entry = this.#pending.get(msg.correlationId);
        if (entry === undefined) return;
        entry.sink.onInstrumentation(msg);
        break;
      }

      case 'error': {
        const correlationId = msg.correlationId;
        if (correlationId !== null) {
          // Request-scoped error: settle that specific pending entry.
          const entry = this.#pending.get(correlationId);
          if (entry !== undefined) {
            entry.settle(DagOutcome.transportError(correlationId, { "code": msg.code, "message": msg.message }));
          }
        } else {
          // Channel-scoped error (null correlationId): the host is in a bad state.
          // Single code path — failAll rejects an in-flight init and settles
          // every pending request as a transport error.
          this.failAll(msg.code, msg.message);
        }
        break;
      }

      // 'intermediate', 'log', and all other message kinds are observability-
      // only and do not require correlation action at this layer.
      default:
        break;
    }
  }
}

