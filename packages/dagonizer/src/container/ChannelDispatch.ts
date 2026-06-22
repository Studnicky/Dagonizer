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
  settled: boolean;
  variant: 'single';
}

/** Per-request correlation entry for multi-item batch (N>1) requests. */
type BatchPendingEntry = {
  correlationId: string;
  settle: (results: BatchRunResultType[]) => void;
  relay: ObserverRelayInterface | null;
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
    switch (msg.variant) {
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
        // Protocol-boundary narrowing: the BridgeMessage 'result' branch carries
        // an inline error shape structurally identical to the canonical
        // `NodeErrorWireType`. `item.snapshot` (schema `{ type: ['object','null'] }`)
        // is narrowed to `JsonObjectType | null` via `JsonObject.is`.
        const errors: readonly NodeErrorWireType[] = msg.response.errors;

        if (entry.variant === 'single') {
          // Single-item (N=1): unpack items[0] into a flat DagOutcomeType.
          const firstItem = msg.response.items[0];
          const firstSnapshot = firstItem?.snapshot;
          entry.settle({
            'terminalOutput': firstItem?.terminalOutcome ?? 'failed',
            'errors': errors,
            'stateSnapshot': JsonObject.is(firstSnapshot) ? firstSnapshot : null,
            'intermediates': msg.response.intermediates,
          });
        } else {
          // Batch (N>1): produce one BatchRunResultType per item.
          const results: BatchRunResultType[] = msg.response.items.map((item: { id: string; terminalOutcome: string; snapshot?: Record<string, unknown> | null }) => ({
            'id': item.id,
            'terminalOutput': item.terminalOutcome,
            'errors': errors,
            'stateSnapshot': JsonObject.is(item.snapshot) ? item.snapshot : null,
            'intermediates': msg.response.intermediates,
          }));
          entry.settle(results);
        }
        break;
      }

      case 'instrumentation': {
        const entry = this.#pending.get(msg.correlationId);
        if (entry === undefined || entry.relay === null) return;
        const { relay } = entry;
        // Ajv-validated boundary: placementPath is an array of strings by the
        // BridgeMessage schema; a `string[]` widens to the `readonly string[]`
        // the ObserverRelayInterface expects with no cast.
        const path: readonly string[] = msg.placementPath;
        // Dispatch map over switch: each hook handler is a closed-over function
        // that forwards the instrumentation event to the relay.
        type InstrMsg = typeof msg & { variant: 'instrumentation' };
        const hookDispatch: Partial<Record<InstrMsg['hook'], (m: InstrMsg) => void>> = {
          'nodeStart': (m) => {
            relay.onNodeStart(m.nodeName, path);
          },
          'nodeEnd': (m) => {
            relay.onNodeEnd(m.nodeName, m.output, path);
          },
          'error': (m) => {
            relay.onError(m.nodeName, new Error(m.message), path);
          },
          'phaseEnter': (m) => {
            if (m.phase === 'pre' || m.phase === 'post') {
              relay.onPhaseEnter(m.dagName, m.phase, m.nodeName, path);
            }
          },
          'phaseExit': (m) => {
            if (m.phase === 'pre' || m.phase === 'post') {
              relay.onPhaseExit(m.dagName, m.phase, m.nodeName, path);
            }
          },
        };
        hookDispatch[msg.hook]?.(msg);
        break;
      }

      case 'error': {
        const correlationId = msg.correlationId;
        if (correlationId !== null) {
          // Request-scoped error: settle that specific pending entry.
          const entry = this.#pending.get(correlationId);
          if (entry !== undefined) {
            if (entry.variant === 'single') {
              entry.settle(DagOutcome.transportError(correlationId, { 'code': msg.code, 'message': msg.message }));
            } else {
              entry.settle(
                entry.itemIds.map((id) =>
                  DagOutcome.batchItemTransportError(id, correlationId, { 'code': msg.code, 'message': msg.message }),
                ),
              );
            }
          }
        } else {
          // Channel-scoped error (null correlationId): the host is in a bad state.
          // Single code path — failAll rejects an in-flight init and settles
          // every pending request as a transport error.
          this.failAll(msg.code, msg.message);
        }
        break;
      }

      // 'intermediate' and all other message kinds are observability-only and
      // do not require correlation action at this layer.
      default:
        break;
    }
  }
}

