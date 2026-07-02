/**
 * ChannelDispatch: single-subscription correlationId correlator for a MessageChannelInterface.
 *
 * One instance per channel. Installs EXACTLY ONE channel.onMessage handler in
 * the constructor and demuxes inbound messages by correlationId. No per-request
 * listeners are ever registered.
 *
 * Protocol responsibilities:
 *   init()         — send init, await ready; rejects on version mismatch or error.
 *   request()      — send execute (single-item N=1), await result; unpacks items[0].
 *                    Forwards abort + observer relay hook calls per request.
 *   requestBatch() — send execute (multi-item N>1), await result; returns BatchRunResultType[].
 *
 * Transport-error contract: request() and requestBatch() never throw. A closed
 * channel, send failure, or unroutable error message produces transport-error
 * outcome(s). init() may reject; its caller (DagContainerBase.initializeChannel)
 * handles that.
 *
 * V8 shape stability: all fields initialised in constructor in declaration order.
 */


import type { DagOutcomeType } from '../contracts/DagOutcomeType.js';
import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { ObserverRelayInterface } from '../contracts/ObserverRelayInterface.js';
import type { BridgeMessageType } from '../entities/executor/BridgeMessage.js';
import type { ExecutionRequestType } from '../entities/executor/ExecutionRequest.js';
import { JsonObject } from '../entities/json.js';
import type { NodeErrorWireType } from '../entities/node/NodeError.js';

import { DagOutcome } from './DagOutcome.js';
import type { BatchRunResultType } from './DagOutcome.js';

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

/**
 * Shape of the init message sent to DagHost. Derived from the 'init' branch of
 * BridgeMessage so it cannot drift from the canonical schema definition.
 * Extracting `& { variant: 'init' }` narrows BridgeMessage to the init discriminant
 * and then omits the `variant` field (which the init sender does not supply as a
 * separate argument — it is added by ChannelDispatch.init() internally).
 */
export type InitMessageShapeType = Omit<BridgeMessageType & { variant: 'init' }, 'variant'>;

/** Per-request correlation entry for single-item (N=1) requests. */
type PendingEntry = {
  correlationId: string;
  settle: (outcome: DagOutcomeType) => void;
  relay: ObserverRelayInterface | null;
  /** The parent's own signal for this container-node dispatch — see `ObserverRelayInterface`. */
  signal: AbortSignal;
  settled: boolean;
  variant: 'single';
}

/** Per-request correlation entry for multi-item batch (N>1) requests. */
type BatchPendingEntry = {
  correlationId: string;
  settle: (results: BatchRunResultType[]) => void;
  relay: ObserverRelayInterface | null;
  /** The parent's own signal for this container-node dispatch — see `ObserverRelayInterface`. */
  signal: AbortSignal;
  settled: boolean;
  variant: 'batch';
  itemIds: readonly string[];
}

/** Pending init-waiter state. */
type InitWaiter = {
  resolve: () => void;
  reject: (err: Error) => void;
  expectedVersion: string;
}

// ---------------------------------------------------------------------------
// ChannelDispatch
// ---------------------------------------------------------------------------

export class ChannelDispatch {
  readonly #channel: MessageChannelInterface;
  readonly #pending: Map<string, PendingEntry | BatchPendingEntry>;
  #initWaiter: InitWaiter | null;
  // Stable bound handler — allocated once at construction so the same
  // function reference is always registered with the channel. An inline
  // closure would create a fresh function on every construction, preventing
  // any identity-based deregistration and complicating V8 inline-cache stability.
  readonly #onMessage: (msg: BridgeMessageType) => void;

  constructor(channel: MessageChannelInterface) {
    this.#channel = channel;
    this.#pending = new Map<string, PendingEntry | BatchPendingEntry>();
    this.#initWaiter = null;
    this.#onMessage = (msg: BridgeMessageType): void => { this.#route(msg); };

    // EXACTLY ONE onMessage registration for the channel's lifetime.
    // All inbound messages are demuxed through #route via the stable handler.
    this.#channel.onMessage(this.#onMessage);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Send init, await ready. Rejects on version mismatch or 'error' message.
   * Call after constructing the dispatch and before the first request().
   */
  init(message: InitMessageShapeType): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.#initWaiter = {
        resolve,
        reject,
        'expectedVersion': message['registryVersion'],
      };
      this.#channel.send({
        'variant': 'init',
        'registryModule': message['registryModule'],
        'registryVersion': message['registryVersion'],
        'servicesConfig': message['servicesConfig'],
      });
    });
  }

  /**
   * Send execute, await the correlated result. `signal` is a required positional
   * arg; `relay` receives forwarded worker hook events (nodeStart, nodeEnd, etc.)
   * and may be null when no observer is bound. Never throws —
   * transport failures resolve to a transport-error DagOutcomeType.
   */
  request(
    request: ExecutionRequestType,
    signal: AbortSignal,
    relay: ObserverRelayInterface | null,
  ): Promise<DagOutcomeType> {
    const { correlationId } = request;

    return new Promise<DagOutcomeType>((resolve) => {
      const entry: PendingEntry = {
        'correlationId': correlationId,
        'settle': resolve,
        'relay': relay,
        'signal': signal,
        'settled': false,
        'variant': 'single',
      };

      this.#pending.set(correlationId, entry);

      const onAbort = this.#withAbortHandler(signal, correlationId);

      // Settle helper: settles once, removes abort listener, deletes pending entry.
      const settleOnce = (outcome: DagOutcomeType): void => {
        this.#settle(entry, signal, onAbort, resolve, outcome);
      };

      // Replace settle so #route can call it directly.
      entry.settle = settleOnce;

      try {
        this.#channel.send({ 'variant': 'execute', 'request': request });
      } catch {
        // Send failure: resolve immediately as transport error.
        settleOnce(DagOutcome.transportError(correlationId));
      }
    });
  }

  /**
   * Send a multi-item batch execute request, await the correlated result, and
   * return a `BatchRunResultType[]` — one entry per item in the request. `signal`
   * is a required positional arg; `relay` receives forwarded worker hook events
   * and may be null when no observer is bound. Never throws — transport failures
   * resolve to transport-error `BatchRunResultType` entries.
   */
  requestBatch(
    request: ExecutionRequestType,
    signal: AbortSignal,
    relay: ObserverRelayInterface | null,
  ): Promise<BatchRunResultType[]> {
    const { correlationId } = request;
    const itemIds = request.items.map((item: { id: string; snapshot: Record<string, unknown> }) => item.id);

    return new Promise<BatchRunResultType[]>((resolve) => {
      const entry: BatchPendingEntry = {
        'correlationId': correlationId,
        'settle': resolve,
        'relay': relay,
        'signal': signal,
        'settled': false,
        'variant': 'batch',
        'itemIds': itemIds,
      };

      this.#pending.set(correlationId, entry);

      const onAbort = this.#withAbortHandler(signal, correlationId);

      const settleOnce = (results: BatchRunResultType[]): void => {
        this.#settle(entry, signal, onAbort, resolve, results);
      };

      entry.settle = settleOnce;

      try {
        this.#channel.send({ 'variant': 'execute', 'request': request });
      } catch {
        // Send failure: return transport-error results for all items.
        settleOnce(itemIds.map((id: string) =>
          DagOutcome.batchItemTransportError(id, correlationId),
        ));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle helpers
  // ---------------------------------------------------------------------------

  /**
   * Register an abort listener that forwards the cancellation to the host and
   * return the handler reference so the caller can deregister it on settle.
   *
   * Derives the abort variant from `signal.reason`: a `TimeoutError` on the reason
   * means the run-level deadline expired, so it sends `'timeout'`; everything
   * else is a caller-initiated cancel (`'abort'`). The send is fire-and-forget.
   */
  #withAbortHandler(signal: AbortSignal, correlationId: string): () => void {
    const onAbort = (): void => {
      try {
        const abortReason: 'abort' | 'timeout' =
          signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
            ? 'timeout'
            : 'abort';
        this.#channel.send({
          'variant': 'abort',
          'correlationId': correlationId,
          'reason': abortReason,
        });
      } catch { /* fire-and-forget */ }
    };
    signal.addEventListener('abort', onAbort);
    return onAbort;
  }

  /**
   * Settle a pending entry exactly once: flip the `settled` latch, remove the
   * abort listener, drop the correlation entry, then resolve the request's
   * promise with `value`. Generic over the resolved type so both the
   * single-item (`DagOutcomeType`) and batch (`BatchRunResultType[]`) paths
   * share one implementation.
   */
  #settle<T>(
    entry: PendingEntry | BatchPendingEntry,
    signal: AbortSignal,
    onAbort: () => void,
    resolve: (value: T) => void,
    value: T,
  ): void {
    if (entry.settled) return;
    entry.settled = true;
    signal.removeEventListener('abort', onAbort);
    this.#pending.delete(entry.correlationId);
    resolve(value);
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
      if (entry.variant === 'single') {
        entry.settle(DagOutcome.transportError(entry.correlationId, { code, message }));
      } else {
        // Batch entry: produce one transport-error result per item.
        entry.settle(
          entry.itemIds.map((id) =>
            DagOutcome.batchItemTransportError(id, entry.correlationId, { code, message }),
          ),
        );
      }
    }
    // settleOnce removes each entry; ensure the map is empty regardless.
    this.#pending.clear();
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  #route(msg: BridgeMessageType): void {
    // Dispatch map over variant: handlers are keyed by message variant.
    // Unknown variants (e.g. 'intermediate') are observability-only and
    // require no correlation action — the fallback is a no-op.
    type RouteMsg = BridgeMessageType;
    const variantDispatch: Partial<{ [K in RouteMsg['variant']]: (m: Extract<RouteMsg, { variant: K }>) => void }> = {
      'ready': (m) => {
        const waiter = this.#initWaiter;
        if (waiter === null) return;
        this.#initWaiter = null;
        if (m.registryVersion !== waiter.expectedVersion) {
          waiter.reject(new Error(
            `Channel registry version mismatch: expected '${waiter.expectedVersion}', got '${m.registryVersion}'`,
          ));
        } else {
          waiter.resolve();
        }
      },

      'result': (m) => {
        const correlationId = m.response.correlationId;
        const entry = this.#pending.get(correlationId);
        if (entry === undefined) return;
        // Protocol-boundary narrowing: the BridgeMessage 'result' branch carries
        // an inline error shape structurally identical to the canonical
        // `NodeErrorWireType`. `item.snapshot` (schema `{ type: ['object','null'] }`)
        // is narrowed to `JsonObjectType | null` via `JsonObject.is`.
        const errors: readonly NodeErrorWireType[] = m.response.errors;

        if (entry.variant === 'single') {
          // Single-item (N=1): unpack items[0] into a flat DagOutcomeType.
          const firstItem = m.response.items[0];
          const firstSnapshot = firstItem?.snapshot;
          entry.settle({
            'terminalOutput': firstItem?.terminalOutcome ?? 'failed',
            'errors': errors,
            'stateSnapshot': JsonObject.is(firstSnapshot) ? firstSnapshot : null,
            'intermediates': m.response.intermediates,
          });
        } else {
          // Batch (N>1): produce one BatchRunResultType per item.
          const results: BatchRunResultType[] = m.response.items.map((item: { id: string; terminalOutcome: string; snapshot?: Record<string, unknown> | null }) => ({
            'id': item.id,
            'terminalOutput': item.terminalOutcome,
            'errors': errors,
            'stateSnapshot': JsonObject.is(item.snapshot) ? item.snapshot : null,
            'intermediates': m.response.intermediates,
          }));
          entry.settle(results);
        }
      },

      'instrumentation': (m) => {
        const entry = this.#pending.get(m.correlationId);
        if (entry === undefined || entry.relay === null) return;
        const { relay } = entry;
        // Ajv-validated boundary: placementPath is an array of strings by the
        // BridgeMessage schema; a `string[]` widens to the `readonly string[]`
        // the ObserverRelayInterface expects with no cast.
        const path: readonly string[] = m.placementPath;
        const { signal } = entry;
        // Dispatch map over hook type: each hook handler forwards the event to the relay.
        // InstrMsg is a single flat shape (not a union on hook), so the map is
        // Record<hook, (hm: InstrMsg) => void>. The call site passes m directly.
        type InstrMsg = typeof m;
        const hookDispatch: Partial<Record<InstrMsg['hook'], (hm: InstrMsg) => void>> = {
          'nodeStart': (hm) => {
            relay.onNodeStart(hm.nodeName, path, signal);
          },
          'nodeEnd': (hm) => {
            relay.onNodeEnd(hm.nodeName, hm.output, path, signal);
          },
          'error': (hm) => {
            relay.onError(hm.nodeName, new Error(hm.message), path, signal);
          },
          'phaseEnter': (hm) => {
            if (hm.phase === 'pre' || hm.phase === 'post') {
              relay.onPhaseEnter(hm.dagName, hm.phase, hm.nodeName, path, signal);
            }
          },
          'phaseExit': (hm) => {
            if (hm.phase === 'pre' || hm.phase === 'post') {
              relay.onPhaseExit(hm.dagName, hm.phase, hm.nodeName, path, signal);
            }
          },
        };
        hookDispatch[m.hook]?.(m);
      },

      'error': (m) => {
        const correlationId = m.correlationId;
        if (correlationId !== null) {
          // Request-scoped error: settle that specific pending entry.
          const entry = this.#pending.get(correlationId);
          if (entry !== undefined) {
            if (entry.variant === 'single') {
              entry.settle(DagOutcome.transportError(correlationId, { 'code': m.code, 'message': m.message }));
            } else {
              entry.settle(
                entry.itemIds.map((id) =>
                  DagOutcome.batchItemTransportError(id, correlationId, { 'code': m.code, 'message': m.message }),
                ),
              );
            }
          }
        } else {
          // Channel-scoped error (null correlationId): the host is in a bad state.
          // Single code path — failAll rejects an in-flight init and settles
          // every pending request as a transport error.
          this.failAll(m.code, m.message);
        }
      },
    };

    // Exhaustive switch over the discriminant narrows `msg` per case, so each
    // handler call typechecks cast-free. Unhandled variants (init/execute/abort/
    // shutdown/intermediate) are observability-only on this side and fall through
    // as no-ops, preserving the prior optional-chaining absence semantics.
    switch (msg.variant) {
      case 'ready':           variantDispatch.ready?.(msg);           break;
      case 'result':          variantDispatch.result?.(msg);          break;
      case 'instrumentation': variantDispatch.instrumentation?.(msg); break;
      case 'error':           variantDispatch.error?.(msg);           break;
      case 'init':
      case 'execute':
      case 'abort':
      case 'shutdown':
      case 'intermediate':    break;
    }
  }
}

