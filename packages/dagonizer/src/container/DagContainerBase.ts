/**
 * DagContainerBase: abstract DagContainerInterface over a MessageChannelInterface.
 *
 * Implements request/response correlation via ChannelDispatch (one subscription
 * per channel), abort forwarding, instrumentation re-firing, and transport
 * failure → collected error semantics. W3 backends subclass this and provide
 * their channel acquisition/release strategy.
 *
 * All properties initialised in constructor for V8 shape stability.
 *
 * Abstract protected:
 *   acquireChannel()       — obtain a channel connected to a DagHost instance
 *   releaseChannel(ch)     — return it to the pool
 *
 * Protected helper:
 *   initializeChannel(ch, init) — sends init, awaits ready, rejects on mismatch.
 *     Creates the ChannelDispatch for the channel on first call (installing
 *     the single transport listener). Subsequent calls reuse the same dispatch.
 */

import type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
import type { DagOutcomeInterface } from '../contracts/DagOutcomeInterface.js';
import type { DagTaskInterface } from '../contracts/DagTaskInterface.js';
import type { Instrumentation } from '../contracts/Instrumentation.js';
import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { BridgeMessage } from '../entities/executor/BridgeMessage.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { NoopInstrumentation } from '../runtime/NoopInstrumentation.js';

import { ChannelDispatch } from './ChannelDispatch.js';
import type { InitMessageShape } from './ChannelDispatch.js';
import { DagOutcome } from './DagOutcome.js';

// ---------------------------------------------------------------------------
// DagContainerOptions
// ---------------------------------------------------------------------------

export interface DagContainerOptions {
  readonly instrumentation?: Instrumentation;
}

// ---------------------------------------------------------------------------
// DagContainerBase
// ---------------------------------------------------------------------------

export abstract class DagContainerBase<TState extends NodeStateInterface = NodeStateInterface>
  implements DagContainerInterface<TState> {

  protected readonly instrumentation: Instrumentation;
  readonly #dispatches: WeakMap<MessageChannelInterface, ChannelDispatch>;

  constructor(options: DagContainerOptions = {}) {
    this.instrumentation = options.instrumentation ?? new NoopInstrumentation();
    this.#dispatches = new WeakMap<MessageChannelInterface, ChannelDispatch>();
  }

  /**
   * Acquire a channel connected to a DagHost.
   * Implementations manage pools or singleton connections.
   */
  protected abstract acquireChannel(): Promise<MessageChannelInterface>;

  /**
   * Return the channel after use.
   * Called in finally; must not throw.
   */
  protected abstract releaseChannel(channel: MessageChannelInterface): void;

  /**
   * Send init and await ready. Rejects on version mismatch or 'error' message.
   * Call after acquiring a fresh channel before the first execute.
   *
   * Creates the ChannelDispatch for the channel (installing exactly one
   * underlying transport listener) if it does not yet exist, then sends init.
   */
  protected initializeChannel(
    channel: MessageChannelInterface,
    init: InitMessageShape,
  ): Promise<void> {
    return this.#dispatchFor(channel).init(init);
  }

  async runDag(task: DagTaskInterface<TState, unknown>): Promise<DagOutcomeInterface> {
    let acquiredChannel: MessageChannelInterface | null = null;

    try {
      acquiredChannel = await this.acquireChannel();
      const channel = acquiredChannel;
      const dispatch = this.#dispatchFor(channel);
      const request = task.toRequest();

      const outcome = await dispatch.request(request, {
        'signal': task.context.signal,
        'onInstrumentation': (msg) => { this.#fireInstrumentation(msg, task.state); },
      });

      return outcome;
    } catch {
      // Transport failure: channel closed, acquireChannel threw, etc.
      // Never throw — return a collected error outcome.
      return DagOutcome.transportError(task.requestId);
    } finally {
      if (acquiredChannel !== null) {
        this.releaseChannel(acquiredChannel);
      }
    }
  }

  /**
   * Fail every in-flight request on the given channel with a transport error.
   *
   * Backends call this from their worker/child death listeners (exit, error,
   * disconnect, stream close) so a silent isolate death fails the pending
   * request(s) instead of hanging the parent forever. This IS the parent
   * backstop Law 4 requires — death DETECTION, not a blind timer.
   *
   * No-op when no ChannelDispatch exists for the channel (the channel was
   * never used to dispatch, e.g. the worker died before first acquire).
   */
  protected failChannel(channel: MessageChannelInterface, code: string, message: string): void {
    const dispatch = this.#dispatches.get(channel);
    if (dispatch === undefined) return;
    dispatch.failAll(code, message);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Get or create the ChannelDispatch for the given channel. Creating it
   * installs exactly one onMessage handler on the channel for its lifetime.
   */
  #dispatchFor(channel: MessageChannelInterface): ChannelDispatch {
    const existing = this.#dispatches.get(channel);
    if (existing !== undefined) return existing;
    const dispatch = new ChannelDispatch(channel);
    this.#dispatches.set(channel, dispatch);
    return dispatch;
  }

  /**
   * Re-fire a forwarded instrumentation message on the parent instrumentation.
   * task.state is the parent's live seeded child clone — the closest available
   * reference to the current execution state at the parent level.
   */
  #fireInstrumentation(
    msg: BridgeMessage & { kind: 'instrumentation' },
    state: TState,
  ): void {
    const instr = this.instrumentation;
    const path = msg.placementPath;
    switch (msg.hook) {
      case 'nodeStart':
        instr.nodeStart(msg.dagName, msg.nodeName, state, path);
        break;
      case 'nodeEnd':
        instr.nodeEnd(msg.dagName, msg.nodeName, msg.output, state, path);
        break;
      case 'phaseEnter':
        if (msg.phase !== '') {
          instr.phaseEnter(msg.dagName, msg.phase, msg.nodeName, state, path);
        }
        break;
      case 'phaseExit':
        if (msg.phase !== '') {
          instr.phaseExit(msg.dagName, msg.phase, msg.nodeName, state, path);
        }
        break;
      case 'contractWarning':
        instr.contractWarning(msg.message);
        break;
      case 'error':
        instr.error(msg.dagName, msg.nodeName, new Error(msg.message), state, path);
        break;
      default:
        break;
    }
  }
}
