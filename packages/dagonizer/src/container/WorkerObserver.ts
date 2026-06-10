/**
 * WorkerObserver: Dagonizer subclass used inside DagHost to relay hook events
 * back to the parent dispatcher as `instrumentation` BridgeMessages.
 *
 * One instance is constructed per-execute with the correlationId and basePath
 * from the ExecutionRequest. Override of every protected hook forwards the
 * event over the channel; the parent's ChannelDispatch routes the message to
 * the ObserverRelay bound to the parent Dagonizer's hooks.
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

export class WorkerObserver<
  TState extends NodeStateInterface = NodeStateInterface,
> extends Dagonizer<TState, unknown> {

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

  #emit(
    hook: 'nodeStart' | 'nodeEnd' | 'error' | 'phaseEnter' | 'phaseExit' | 'contractWarning',
    phase: '' | 'pre' | 'post',
    dagName: string,
    nodeName: string,
    output: string | null,
    message: string,
    composedPath: string[],
  ): void {
    try {
      this.#channel.send({
        'kind': 'instrumentation',
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
    this.#emit('nodeStart', '', '', nodeName, null, '', this.#composePath(placementPath));
  }

  protected override onNodeEnd(nodeName: string, output: string | null, _state: TState, placementPath: readonly string[]): void {
    this.#emit('nodeEnd', '', '', nodeName, output, '', this.#composePath(placementPath));
  }

  protected override onError(nodeName: string, error: Error, _state: TState, placementPath: readonly string[]): void {
    this.#emit('error', '', '', nodeName, null, error.message, this.#composePath(placementPath));
  }

  protected override onPhaseEnter(
    dagName: string,
    phase: 'pre' | 'post',
    placementName: string,
    _state: TState,
    placementPath: readonly string[],
  ): void {
    this.#emit('phaseEnter', phase, dagName, placementName, null, '', this.#composePath(placementPath));
  }

  protected override onPhaseExit(
    dagName: string,
    phase: 'pre' | 'post',
    placementName: string,
    _state: TState,
    placementPath: readonly string[],
  ): void {
    this.#emit('phaseExit', phase, dagName, placementName, null, '', this.#composePath(placementPath));
  }

  protected override onContractWarning(message: string): void {
    this.#emit('contractWarning', '', '', '', null, message, []);
  }
}
