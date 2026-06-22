/**
 * RequestTrigger: fires the runner once per HTTP request/turn.
 *
 * The per-turn variant from the Foundersmax consumer shape in the research
 * study: each inbound request gets a scoped runner invocation, the dispatcher
 * may be rebuilt per-turn with auth-scoped services, and per-turn
 * instrumentation can be injected.
 *
 * Consumers subclass `RequestTrigger` and:
 *   1. Override `toInput(request)` to extract runner input from the raw request.
 *   2. Optionally override `selectDag(request)` to choose a DAG per request.
 *   3. Optionally override `requestOptions(request)` to supply per-turn options
 *      (signal, deadlineMs).
 *
 * The trigger is stateless with respect to request lifecycle — each call to
 * `fire(request)` is independent. `attach` is a no-op (no subscription to
 * set up); callers drive the trigger by calling `fire(request)` from their
 * HTTP handler / turn loop.
 *
 * TRequest — the raw request/turn type (e.g. `express.Request`, a message DTO).
 * TInput   — the runner input built from the request.
 *
 * @example
 * ```ts
 * class ApiRequestTrigger extends RequestTrigger<Request, ApiInput, ApiState, ApiOutput> {
 *   protected override toInput(request: Request): ApiInput {
 *     return { body: request.body, userId: request.user.id };
 *   }
 *   protected override selectDag(_request: Request): string {
 *     return 'handle-api-request';
 *   }
 * }
 *
 * const trigger = new ApiRequestTrigger();
 * await trigger.attach(runner); // no-op
 * app.post('/api', async (req, res) => {
 *   const output = await trigger.fire(req);
 *   res.json(output);
 * });
 * ```
 */

import type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';
import type { TriggerInterface } from '../contracts/TriggerInterface.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { DagRunnerInterface } from './DagRunner.js';

export abstract class RequestTrigger<
  TRequest,
  TInput,
  TState extends NodeStateInterface,
  TOutput,
> implements TriggerInterface<TInput, TState, TOutput> {
  #runner: DagRunnerInterface<TInput, TState, TOutput> | null;

  constructor() {
    this.#runner = null;
  }

  /**
   * Attach to a runner. Stores the runner reference for use in `fire`.
   * Resolves immediately — no subscription is registered.
   */
  async attach(runner: DagRunnerInterface<TInput, TState, TOutput>): Promise<void> {
    this.#runner = runner;
  }

  async detach(): Promise<void> {
    this.#runner = null;
  }

  /**
   * Fire the runner for one request/turn. Returns the projected output.
   * Callers invoke this from their HTTP handler or turn loop.
   *
   * Throws `Error` if called before `attach`.
   */
  async fire(request: TRequest): Promise<TOutput> {
    const runner = this.#runner;
    if (runner === null) {
      throw new Error('RequestTrigger.fire called before attach — call attach(runner) first.');
    }
    const dagName = this.selectDag(request);
    const input = this.toInput(request);
    const options = this.requestOptions(request);
    return runner.run(dagName, input, options);
  }

  /**
   * Convert a raw request to the `TInput` the runner expects.
   * Subclasses MUST implement.
   */
  protected abstract toInput(request: TRequest): TInput;

  /**
   * Select the DAG name to run for a given request.
   * Default returns `'default'`. Override for per-request routing.
   */
  protected selectDag(_request: TRequest): string {
    return 'default';
  }

  /**
   * Supply per-turn `ExecuteOptionsType` (signal, deadlineMs) from the request.
   * Default returns an empty options object. Override to wire request-scoped
   * abort signals or per-request deadlines.
   */
  protected requestOptions(_request: TRequest): ExecuteOptionsType {
    return {};
  }
}
