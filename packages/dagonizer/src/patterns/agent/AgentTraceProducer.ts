/**
 * AgentTraceProducer: streams an agent loop's reasoning trace as
 * ordinal-tagged `ReasoningTraceItemType` items.
 *
 * Consumers EXTEND this (class extension — never a callback): supply the
 * running agent-loop `Execution` (an `AsyncIterable<NodeResultType<NodeStateInterface>>`)
 * to the constructor, then override `describe(stage)` to map one node
 * result to the human-readable string carried by its reasoning step.
 *
 * `select(stage)` is fully implemented here: it looks up `stage.nodeName`
 * in the fixed `NODE_NAME_TO_KIND` dispatch map to decide which
 * `ReasoningStepBuilder` variant the stage produces, then calls `describe`
 * for the step's text. Node names not present in the map yield no step
 * (`[]`) — phase/terminal/tool-execution nodes that don't carry a
 * reasoning-visible moment. `action` steps carry `describe`'s return value
 * as the tool label; their `args` default to `{}` (the trace surfaces which
 * tool ran, not its full argument payload).
 *
 * Every emitted step is wrapped with a monotonic `ordinal` (via
 * `ReasoningTraceItemBuilder.of`) before being pushed to the sink. `produce`
 * (`DagStreamProducer`) awaits each push in order, so this producer is the
 * single, sequential linearization point for the stream — a per-producer
 * `#ordinal` counter is sound. The ordinal increments only for steps that
 * are actually emitted (errored stages and unmapped node names consume no
 * ordinal), so the emitted sequence is always contiguous: a downstream
 * consumer can derive a `wasInformedBy`-style chain purely from
 * `item.ordinal - 1`, with no cross-item state of its own and no dependence
 * on the order items are recorded in.
 */

import { ReasoningStepBuilder } from '../../entities/agent/ReasoningStep.js';
import { ReasoningTraceItemBuilder } from '../../entities/agent/ReasoningTraceItem.js';
import type { ReasoningTraceItemType } from '../../entities/agent/ReasoningTraceItem.js';
import type { NodeResultType } from '../../entities/node/NodeResult.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';
import { DagStreamProducer } from '../DagStreamProducer.js';

/** The four `ReasoningStepType` discriminants a node result can map to. */
type ReasoningKindType = 'thought' | 'action' | 'observation' | 'final';

/**
 * Fixed dispatch map from the canonical agent-loop node name (as registered
 * by `AgentBuilder.loop`) to the reasoning-step kind that node's result
 * represents.
 *
 * One node per kind — the node that *produces* the moment, not the ones that
 * merely normalise or route it. `call-model` yields the model's thought;
 * `decode-tools` yields the chosen action; `collect-results` yields the tool
 * observation; `append-assistant` yields the final answer. The intervening
 * `normalize-response` / `normalize-tools` nodes re-express the same state, so
 * mapping them too would emit each step twice — a duplicated trace. They are
 * intentionally absent.
 */
const NODE_NAME_TO_KIND: Readonly<Record<string, ReasoningKindType>> = {
  'call-model':       'thought',
  'decode-tools':     'action',
  'collect-results':  'observation',
  'append-assistant': 'final',
};

export abstract class AgentTraceProducer extends DagStreamProducer<ReasoningTraceItemType> {
  readonly #execution: AsyncIterable<NodeResultType<NodeStateInterface>>;
  #ordinal: number;

  constructor(execution: AsyncIterable<NodeResultType<NodeStateInterface>>) {
    super();
    this.#execution = execution;
    this.#ordinal = 0;
  }

  protected executions(): AsyncIterable<NodeResultType<NodeStateInterface>> {
    return this.#execution;
  }

  /** Map one node result to a human-readable reasoning-step description. */
  protected abstract describe(stage: NodeResultType<NodeStateInterface>): string;

  protected select(stage: NodeResultType<NodeStateInterface>): Iterable<ReasoningTraceItemType> {
    // An errored node produces no reasoning step — its output carries the
    // failure, not a thought/action/observation/final moment.
    if (stage.output === 'error') return [];
    const kind = NODE_NAME_TO_KIND[stage.nodeName];
    if (kind === undefined) return [];
    const text = this.describe(stage);
    const step = kind === 'thought'
      ? ReasoningStepBuilder.thought(text)
      : kind === 'observation'
        ? ReasoningStepBuilder.observation(text)
        : kind === 'final'
          ? ReasoningStepBuilder.final(text)
          : ReasoningStepBuilder.action(text, {});
    return [ReasoningTraceItemBuilder.of(this.#ordinal++, step)];
  }
}
