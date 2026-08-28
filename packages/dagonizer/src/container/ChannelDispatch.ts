/**
 * ChannelDispatch: single-subscription correlationId correlator for a MessageChannelInterface.
 *
 * One instance per channel. Installs EXACTLY ONE channel.onMessage handler in
 * the constructor and demuxes inbound messages by correlationId. No per-request
 * listeners are ever registered.
 *
 * Protocol responsibilities:
 *   init()    — send init, await ready; rejects on version mismatch or error.
 *   request() — send execute for N items (N=1 is a batch of one through the
 *               identical path), await one batch result, and return its item
 *               outcomes plus its single graph transfer. Forwards abort +
 *               observer relay hook calls per request.
 *
 * Transport-error contract: request() never throws. A closed channel, send
 * failure, or unroutable error message produces transport-error result(s),
 * one per item. init() may reject; its caller (DagContainerBase.initializeChannel)
 * handles that.
 *
 * V8 shape stability: all fields initialised in constructor in declaration order.
 */


import type { GraphStateTransferFormatType } from '../contracts/GraphStateTransferFormat.js';
import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { ObserverRelayInterface } from '../contracts/ObserverRelayInterface.js';
import type { BridgeMessageType } from '../entities/executor/BridgeMessage.js';
import type { ExecutionRequestType } from '../entities/executor/ExecutionRequest.js';
import type { GraphStateTransferType } from '../entities/executor/GraphStateTransferSchema.js';

import { DagOutcome } from './DagOutcome.js';
import type { RunResultType } from './DagOutcome.js';

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

type BatchDispatchResult = {
  readonly results: RunResultType[];
  readonly graphState?: GraphStateTransferType;
}

/** Per-request correlation entry. Every request carries one or more item ids. */
type PendingEntry = {
  correlationId: string;
  settle: (result: BatchDispatchResult) => void;
  relay: ObserverRelayInterface | null;
  /** The parent's own signal for this container-node dispatch — see `ObserverRelayInterface`. */
  signal: AbortSignal;
  settled: boolean;
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
  readonly #pending: Map<string, PendingEntry>;
  #initWaiter: InitWaiter | null;
  /** Capabilities declared by the initialized host. */
  #capabilities: readonly string[];
  #graphStateTransferFormats: readonly GraphStateTransferFormatType[];
  // Stable bound handler — allocated once at construction so the same
  // function reference is always registered with the channel. An inline
  // closure would create a fresh function on every construction, preventing
  // any identity-based deregistration and complicating V8 inline-cache stability.
  readonly #onMessage: (msg: BridgeMessageType) => void;

  constructor(channel: MessageChannelInterface) {
    this.#channel = channel;
    this.#pending = new Map<string, PendingEntry>();
    this.#initWaiter = null;
    this.#capabilities = [];
    this.#graphStateTransferFormats = [];
    this.#onMessage = (msg: BridgeMessageType): void => { this.#route(msg); };

    // EXACTLY ONE onMessage registration for the channel's lifetime.
    // All inbound messages are demuxed through #route via the stable handler.
    this.#channel.onMessage(this.#onMessage);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Capabilities declared by the host during the last successful init. */
  get capabilities(): readonly string[] {
    return this.#capabilities;
  }

  get graphStateTransferFormats(): readonly GraphStateTransferFormatType[] {
    return this.#graphStateTransferFormats;
  }

  supports(capability: string): boolean {
    return this.#capabilities.includes(capability);
  }

  supportsGraphStateTransferFormat(format: GraphStateTransferFormatType): boolean {
    return this.#graphStateTransferFormats.includes(format);
  }

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
        'graphStateTransferFormats': [...message['graphStateTransferFormats']],
        ...(message['coalesceInstrumentation'] === undefined ? {} : { 'coalesceInstrumentation': message['coalesceInstrumentation'] }),
        ...(message['instrumentationPlacementPathDepth'] === undefined ? {} : { 'instrumentationPlacementPathDepth': message['instrumentationPlacementPathDepth'] }),
      });
    });
  }

  /**
   * Send execute for every item in the request and await one correlated batch
   * result. The batch owns its graph transfer; item results contain only
   * per-item fields. Never throws: transport failures resolve to per-item
   * transport errors with no graph transfer.
   */
  request(
    request: ExecutionRequestType,
    signal: AbortSignal,
    relay: ObserverRelayInterface | null,
  ): Promise<BatchDispatchResult> {
    const { correlationId } = request;
    const itemIds = request.items.map((item) => item.id);

    return new Promise<BatchDispatchResult>((resolve) => {
      const entry: PendingEntry = {
        'correlationId': correlationId,
        'settle': resolve,
        'relay': relay,
        'signal': signal,
        'settled': false,
        'itemIds': itemIds,
      };

      this.#pending.set(correlationId, entry);

      const onAbort = this.#withAbortHandler(signal, correlationId);

      const settleOnce = (result: BatchDispatchResult): void => {
        this.#settle(entry, signal, onAbort, resolve, result);
      };

      entry.settle = settleOnce;

      try {
        this.#channel.send({ 'variant': 'execute', 'request': request });
      } catch {
        // Send failure: return transport-error results for all items.
        settleOnce({
          'results': itemIds.map((id: string) => DagOutcome.transportError(id, correlationId)),
        });
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
   * promise with the batch result.
   */
  #settle(
    entry: PendingEntry,
    signal: AbortSignal,
    onAbort: () => void,
    resolve: (result: BatchDispatchResult) => void,
    result: BatchDispatchResult,
  ): void {
    if (entry.settled) return;
    entry.settled = true;
    signal.removeEventListener('abort', onAbort);
    this.#pending.delete(entry.correlationId);
    resolve(result);
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
      entry.settle({
        'results': entry.itemIds.map((id) =>
          DagOutcome.transportError(id, entry.correlationId, { code, message }),
        ),
      });
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
    // require no correlation action.
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
          this.#capabilities = [...m.capabilities];
          this.#graphStateTransferFormats = [...m.graphStateTransferFormats];
          waiter.resolve();
        }
      },

      'result': (m) => {
        const correlationId = m.response.correlationId;
        const entry = this.#pending.get(correlationId);
        if (entry === undefined) return;

        // Item outcomes remain item-scoped; the response retains sole ownership
        // of the combined graph transfer for one container restore operation.
        const results: RunResultType[] = m.response.items.map((item) => ({
          'id': item.id,
          'terminalOutput': item.terminalOutcome,
          'errors': item.errors,
          'intermediates': item.intermediates,
          'runIri': item.runIri,
        }));
        entry.settle({ 'results': results, 'graphState': m.response.graphState });
      },

      'instrumentation': (m) => {
        const entry = this.#pending.get(m.correlationId);
        if (entry !== undefined && entry.relay !== null) this.#routeInstrumentation(m, entry);
      },

      'instrumentationBatch': (m) => {
        const entry = this.#pending.get(m.correlationId);
        if (entry === undefined || entry.relay === null) return;
        for (const item of m.items) {
          this.#routeInstrumentation(item, entry);
        }
      },

      'error': (m) => {
        const correlationId = m.correlationId;
        if (correlationId !== null) {
          // Request-scoped error: settle that specific pending entry.
          const entry = this.#pending.get(correlationId);
          if (entry !== undefined) {
            entry.settle({
              'results': entry.itemIds.map((id) =>
                DagOutcome.transportError(id, correlationId, { 'code': m.code, 'message': m.message }),
              ),
            });
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
      case 'ready':             variantDispatch.ready?.(msg);             break;
      case 'result':            variantDispatch.result?.(msg);            break;
      case 'instrumentation':   variantDispatch.instrumentation?.(msg);   break;
      case 'instrumentationBatch': variantDispatch.instrumentationBatch?.(msg); break;
      case 'error':             variantDispatch.error?.(msg);             break;
      case 'init':
      case 'execute':
      case 'abort':
      case 'shutdown':
      case 'intermediate':    break;
    }
  }

  #routeInstrumentation(
    item: Omit<Extract<BridgeMessageType, { variant: 'instrumentation' }>, 'variant'>,
    entry: PendingEntry,
  ): void {
    const { relay } = entry;
    const { signal } = entry;
    if (relay === null) return;
    const path: readonly string[] = item.placementPath;
    type InstrMsg = typeof item;
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
    hookDispatch[item.hook]?.(item);
  }
}
