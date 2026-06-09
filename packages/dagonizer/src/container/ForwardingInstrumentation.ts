/**
 * ForwardingInstrumentation: Instrumentation implementation that forwards
 * hook invocations as `instrumentation` BridgeMessages over a channel.
 *
 * Used inside DagHost to relay observability data back to the parent
 * dispatcher. Forwards name-level data only — never serializes full state
 * objects across the boundary.
 *
 * flowStart / flowEnd are suppressed: the parent dispatcher owns flow-level
 * hooks. nodeStart / nodeEnd / phaseEnter / phaseExit / error /
 * contractWarning forward as BridgeMessage { kind: 'instrumentation' }.
 *
 * The required `basePath` is prepended to every forwarded `placementPath`.
 * This ensures instrumentation messages from the body DAG carry the full
 * composite path (parent placement path + inner body path) so the parent
 * instrumentation sees a non-empty, meaningful placementPath. Pass `[]` for a
 * top-level host with no parent placement context.
 *
 * Constructor(channel, correlationId, basePath): DI, no callbacks.
 */

import type { Instrumentation } from '../contracts/Instrumentation.js';
import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { ExecutionResultInterface } from '../entities/execution/ExecutionResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export class ForwardingInstrumentation<TState extends NodeStateInterface = NodeStateInterface>
  implements Instrumentation<TState> {

  readonly #channel: MessageChannelInterface;
  readonly #correlationId: string;
  readonly #basePath: readonly string[];

  constructor(channel: MessageChannelInterface, correlationId: string, basePath: readonly string[]) {
    this.#channel = channel;
    this.#correlationId = correlationId;
    this.#basePath = basePath;
  }

  #composePath(innerPath: readonly string[]): string[] {
    return [...this.#basePath, ...innerPath];
  }

  /** flowStart is suppressed — the parent dispatcher owns flow-level hooks. */
  flowStart(_dagName: string, _state: TState): void { /* suppressed */ }

  /** flowEnd is suppressed — the parent dispatcher owns flow-level hooks. */
  flowEnd(_dagName: string, _state: TState, _result: ExecutionResultInterface<TState>): void { /* suppressed */ }

  nodeStart(dagName: string, nodeName: string, _state: TState, placementPath: readonly string[]): void {
    this.#channel.send({
      'kind': 'instrumentation',
      'correlationId': this.#correlationId,
      'hook': 'nodeStart',
      'phase': '',
      'dagName': dagName,
      'nodeName': nodeName,
      'output': null,
      'message': '',
      'placementPath': this.#composePath(placementPath),
    });
  }

  nodeEnd(dagName: string, nodeName: string, output: string | null, _state: TState, placementPath: readonly string[]): void {
    this.#channel.send({
      'kind': 'instrumentation',
      'correlationId': this.#correlationId,
      'hook': 'nodeEnd',
      'phase': '',
      'dagName': dagName,
      'nodeName': nodeName,
      'output': output,
      'message': '',
      'placementPath': this.#composePath(placementPath),
    });
  }

  phaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, _state: TState, placementPath: readonly string[]): void {
    this.#channel.send({
      'kind': 'instrumentation',
      'correlationId': this.#correlationId,
      'hook': 'phaseEnter',
      'phase': phase,
      'dagName': dagName,
      'nodeName': placementName,
      'output': null,
      'message': '',
      'placementPath': this.#composePath(placementPath),
    });
  }

  phaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, _state: TState, placementPath: readonly string[]): void {
    this.#channel.send({
      'kind': 'instrumentation',
      'correlationId': this.#correlationId,
      'hook': 'phaseExit',
      'phase': phase,
      'dagName': dagName,
      'nodeName': placementName,
      'output': null,
      'message': '',
      'placementPath': this.#composePath(placementPath),
    });
  }

  contractWarning(message: string): void {
    this.#channel.send({
      'kind': 'instrumentation',
      'correlationId': this.#correlationId,
      'hook': 'contractWarning',
      'phase': '',
      'dagName': '',
      'nodeName': '',
      'output': null,
      'message': message,
      'placementPath': [],
    });
  }

  error(dagName: string, nodeName: string, error: Error, _state: TState, placementPath: readonly string[]): void {
    this.#channel.send({
      'kind': 'instrumentation',
      'correlationId': this.#correlationId,
      'hook': 'error',
      'phase': '',
      'dagName': dagName,
      'nodeName': nodeName,
      'output': null,
      'message': error.message,
      'placementPath': this.#composePath(placementPath),
    });
  }
}
