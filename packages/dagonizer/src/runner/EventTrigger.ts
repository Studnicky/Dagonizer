/**
 * EventTrigger: fires the runner once per message off a subscription.
 *
 * Abstracts the event-loop pattern: subscribe → receive message → seed state →
 * execute → route outcome. Mirrors the `bot-runtime` consumer shape from the
 * research study (`RuntimeService.dispatchInbound`): a single subscription
 * drives a fresh DAG execution per inbound event.
 *
 * Consumers subclass `EventTrigger` and supply a subscription via `subscribe`.
 * The trigger calls `runner.run(dagIri, toInput(message))` per message until
 * `detach` is called.
 *
 * TMessage — the raw message type emitted by the subscription.
 * TInput   — the input type the runner expects; `toInput` converts TMessage → TInput.
 *
 * @example
 * ```ts
 * class BotEventTrigger extends EventTrigger<BotMessage, BotInput, BotState, BotOutput> {
 *   protected override subscribe(onMessage: (msg: BotMessage) => void): () => void {
 *     return eventBus.on('message', onMessage);
 *   }
 *   protected override toInput(message: BotMessage): BotInput {
 *     return { text: message.content, userId: message.from };
 *   }
 *   protected override selectDag(_message: BotMessage): string {
 *     return 'handle-message';
 *   }
 * }
 * ```
 */

import type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';
import type { TriggerInterface } from '../contracts/TriggerInterface.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { DagRunnerInterface } from './DagRunner.js';

export abstract class EventTrigger<
  TMessage,
  TInput,
  TState extends NodeStateInterface,
  TOutput,
> implements TriggerInterface<TInput, TState, TOutput> {
  readonly #options: ExecuteOptionsType;
  #unsubscribe: (() => void) | null;
  #attachResolve: (() => void) | null;
  #attached: boolean;

  constructor(options: ExecuteOptionsType = {}) {
    this.#options = options;
    this.#unsubscribe = null;
    this.#attachResolve = null;
    this.#attached = false;
  }

  async attach(runner: DagRunnerInterface<TInput, TState, TOutput>): Promise<void> {
    if (this.#attached) return;
    this.#attached = true;

    return new Promise<void>((resolve) => {
      this.#attachResolve = resolve;

      this.#unsubscribe = this.subscribe((message) => {
        const dagIri = this.selectDag(message);
        const input = this.toInput(message);
        // Run is intentionally not awaited here; each message fires a
        // parallel execution. Errors surface in state, not here.
        void runner.run(dagIri, input, this.#options);
      });
    });
  }

  async detach(): Promise<void> {
    if (this.#unsubscribe !== null) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
    if (this.#attachResolve !== null) {
      this.#attachResolve();
      this.#attachResolve = null;
    }
  }

  /**
   * Register a message handler with the event source. Return an unsubscribe
   * function that removes the handler when called. Subclasses MUST implement.
   *
   * @param onMessage — Called once per inbound message. Fire-and-forget; do
   *                    not await from inside this handler.
   */
  protected abstract subscribe(onMessage: (message: TMessage) => void): () => void;

  /**
   * Convert a raw message to the `TInput` the runner expects.
   * Subclasses MUST implement.
   */
  protected abstract toInput(message: TMessage): TInput;

  /**
   * Select the DAG IRI to run for a given message.
   * Default returns `'urn:noocodec:dag:default'`. Override for per-message routing.
   */
  protected selectDag(_message: TMessage): string {
    return 'urn:noocodec:dag:default';
  }
}
