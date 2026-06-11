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
 *               observer relay hook calls per request.
 *
 * Transport-error contract: request() never throws. A closed channel, send
 * failure, or unroutable error message produces a transport-error DagOutcomeInterface.
 * init() may reject; its caller (DagContainerBase.initializeChannel) handles that.
 *
 * V8 shape stability: all fields initialised in constructor in declaration order.
 */


import type { DagOutcomeInterface } from '../contracts/DagOutcomeInterface.js';
import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { ObserverRelay } from '../Dagonizer.js';
import type { BridgeMessage } from '../entities/executor/BridgeMessage.js';
import type { ExecutionRequest } from '../entities/executor/ExecutionRequest.js';
import type { JsonObject } from '../entities/json.js';
import type { NodeError } from '../entities/node/NodeError.js';

import { DagOutcome } from './DagOutcome.js';

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

/**
 * Shape of the init message sent to DagHost. Derived from the 'init' branch of
 * BridgeMessage so it cannot drift from the canonical schema definition.
 * Extracting `& { kind: 'init' }` narrows BridgeMessage to the init discriminant
 * and then omits the `kind` field (which the init sender does not supply as a
 * separate argument — it is added by ChannelDispatch.init() internally).
 */
export type InitMessageShape = Omit<BridgeMessage & { kind: 'init' }, 'kind'>;

/** Per-request correlation entry. */
interface PendingEntry {
  correlationId: string;
  settle: (outcome: DagOutcomeInterface) => void;
  relay: ObserverRelay | null;
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
  // Stable bound handler — allocated once at construction so the same
  // function reference is always registered with the channel. An inline
  // closure would create a fresh function on every construction, preventing
  // any identity-based deregistration and complicating V8 inline-cache stability.
  readonly #onMessage: (msg: BridgeMessage) => void;

  constructor(channel: MessageChannelInterface) {
    this.#channel = channel;
    this.#pending = new Map<string, PendingEntry>();
    this.#initWaiter = null;
    this.#onMessage = (msg: BridgeMessage): void => { this.#route(msg); };

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
   * arg; `relay` receives forwarded worker hook events (nodeStart, nodeEnd, etc.)
   * and may be null when no observer is bound. Never throws —
   * transport failures resolve to a transport-error DagOutcomeInterface.
   */
  request(
    request: ExecutionRequest,
    signal: AbortSignal,
    relay: ObserverRelay | null,
  ): Promise<DagOutcomeInterface> {
    const { correlationId } = request;

    return new Promise<DagOutcomeInterface>((resolve) => {
      const entry: PendingEntry = {
        'correlationId': correlationId,
        'settle': resolve,
        'relay': relay,
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
        // Protocol-boundary narrowing: BridgeMessage's 'result' branch carries
        // inline schema copies (InlineNodeErrorShape, InlineExecutionResponseShape)
        // that are structurally identical to the canonical NodeError and JsonObject
        // types but produce distinct FromSchema derivations. Ajv has validated the
        // wire message, so these casts are safe:
        //   errors: same required fields/types as NodeErrorSchema; only nominal gap.
        //   stateSnapshot: schema { type: ['object', 'null'] } → Ajv-validated JSON
        //     object, values confirmed JSON-compatible by the validator; safe to narrow
        //     from { [k: string]: unknown } | null to JsonObject | null.
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
        if (entry === undefined || entry.relay === null) return;
        const { relay } = entry;
        // Ajv-validated boundary: placementPath is confirmed an array of strings
        // by the BridgeMessage schema; cast from schema-inferred type to the
        // narrower readonly string[] used by ObserverRelay.
        const path = msg.placementPath as readonly string[];
        // Dispatch map over switch: each hook handler is a closed-over function
        // that forwards the instrumentation event to the relay.
        type InstrMsg = typeof msg & { kind: 'instrumentation' };
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
          'contractWarning': (m) => {
            relay.onContractWarning(m.message);
          },
        };
        hookDispatch[msg.hook]?.(msg as InstrMsg);
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

