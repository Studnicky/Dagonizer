/**
 * WorkerObserver: Dagonizer subclass used inside DagHost to relay hook events
 * back to the parent dispatcher as `instrumentation` BridgeMessages.
 *
 * One instance is constructed per-execute with the correlationId and basePath
 * from the ExecutionRequest. Override of every protected hook forwards the
 * event over the channel; the parent's ChannelDispatch routes the message to
 * the ObserverRelayInterface bound to the parent Dagonizer's hooks.
 *
 * flowStart / flowEnd are intentionally not forwarded — the parent dispatcher
 * owns flow-level hooks. The per-execute construction pattern is correct: a
 * single WorkerObserver per host lifetime would require mutable correlationId
 * (unsafe for concurrent executions).
 *
 * V8 shape stability: all properties initialised in constructor in declaration order.
 */

import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import { Dagonizer } from '../Dagonizer.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/** Shape of the co-located `WorkerObserver.#emit()` option defaults. */
type EmitDefaultsType = {
  readonly phase: 'pre' | 'post' | '';
  readonly dagName: string;
  readonly nodeName: string;
  readonly output: string | null;
  readonly message: string;
};

/** Co-located defaults for `WorkerObserver.#emit()` options (schema-safe sentinels). */
const EMIT_DEFAULTS: EmitDefaultsType = {
  'phase': '',
  'dagName': '',
  'nodeName': '',
  'output': null,
  'message': '',
};

export class WorkerObserver<
  TState extends NodeStateInterface = NodeStateInterface,
> extends Dagonizer<TState> {

  readonly #channel: MessageChannelInterface;
  readonly #correlationId: string;
  readonly #basePath: readonly string[];

  constructor(
    channel: MessageChannelInterface,
    correlationId: string,
    basePath: readonly string[],
    dagonizerOptions: ConstructorParameters<typeof Dagonizer>[0],
  ) {
    super(dagonizerOptions);
    this.#channel = channel;
    this.#correlationId = correlationId;
    this.#basePath = basePath;
  }

  #composePath(innerPath: readonly string[]): string[] {
    return [...this.#basePath, ...innerPath];
  }

  /**
   * Emit an instrumentation BridgeMessage on the channel. Required positional:
   * `hook` and `composedPath`. Optional trailing options object for hook-specific fields;
   * all default to schema-safe sentinels so the emitted message is always valid.
   */
  #emit(
    hook: 'nodeStart' | 'nodeEnd' | 'error' | 'phaseEnter' | 'phaseExit',
    composedPath: string[],
    options: {
      phase?: 'pre' | 'post' | '';
      dagName?: string;
      nodeName?: string;
      output?: string | null;
      message?: string;
    } = {},
  ): void {
    const { phase, dagName, nodeName, output, message } = { ...EMIT_DEFAULTS, ...options };
    try {
      this.#channel.send({
        'variant': 'instrumentation',
        'correlationId': this.#correlationId,
        'hook': hook,
        'phase': phase,
        'dagName': dagName,
        'nodeName': nodeName,
        'output': output,
        'message': message,
        'placementPath': composedPath,
      });
    } catch { /* channel closed — suppress */ }
  }

  protected override onNodeStart(nodeName: string, _state: TState, placementPath: readonly string[]): void {
    this.#emit('nodeStart', this.#composePath(placementPath), { 'nodeName': nodeName });
  }

  protected override onNodeEnd(nodeName: string, output: string | null, _state: TState, placementPath: readonly string[]): void {
    this.#emit('nodeEnd', this.#composePath(placementPath), { 'nodeName': nodeName, 'output': output });
  }

  protected override onError(nodeName: string, error: Error, _state: TState, placementPath: readonly string[]): void {
    this.#emit('error', this.#composePath(placementPath), { 'nodeName': nodeName, 'message': error.message });
  }

  protected override onPhaseEnter(
    dagName: string,
    phase: 'pre' | 'post',
    placementName: string,
    _state: TState,
    placementPath: readonly string[],
  ): void {
    this.#emit('phaseEnter', this.#composePath(placementPath), { 'phase': phase, 'dagName': dagName, 'nodeName': placementName });
  }

  protected override onPhaseExit(
    dagName: string,
    phase: 'pre' | 'post',
    placementName: string,
    _state: TState,
    placementPath: readonly string[],
  ): void {
    this.#emit('phaseExit', this.#composePath(placementPath), { 'phase': phase, 'dagName': dagName, 'nodeName': placementName });
  }
}
