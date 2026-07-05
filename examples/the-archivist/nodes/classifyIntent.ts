/**
 * classifyIntent: entry node. Asks the LLM to classify the visitor's
 * question, then routes one of seven on-topic branches plus the
 * off-topic exit:
 *
 *   lookup-author      → `lookup-author-web-search` (chronological author survey)
 *   find-reviews       → `find-reviews`             (ratings tool branch)
 *   describe-book      → `describe-web-search`      (one-hit description branch)
 *   recommend-similar  → `recommend-similar`        (prior-shortlist seeding branch)
 *   recommend          → `recommend-top-rated`      (rating-ranked branch for vague "good book" asks)
 *   search | describe  → `extract-query`            (general on-topic pipeline)
 *   off-topic          → `decline-off-topic`
 *
 * Demonstrates: a wide narrowly-typed output union and dispatch into
 * embedded-DAG branches based on classifier output.
 */


// #region node-class
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices, ClassifiedIntent } from '../services.ts';

import { Batch, MonadicNode, NodeOutputBuilder, ReasoningStepBuilder, RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

type IntentOutput =
  | 'lookup-author'
  | 'find-reviews'
  | 'describe-book'
  | 'recommend-similar'
  | 'recall-memories'
  | 'on-topic'
  | 'recommend-top-rated'
  | 'off-topic'
  | 'retry'
  | 'salvage';

/** Per-node timeout: generous for Gemini Nano's constrained-output path (20-60 s typical). */
const NODE_TIMEOUT_MS = 30_000;

/** Total attempts (initial + retries) before routing to salvage. */
const RETRY_BUDGET = 2;

export class ClassifyIntentNode extends MonadicNode<ArchivistState, IntentOutput> {
  private readonly services: ArchivistServices;
  readonly name = 'classify-intent';
  constructor(services: ArchivistServices) {
    super();
    this.services = services;
  }
  readonly outputs = ['lookup-author', 'find-reviews', 'describe-book', 'recommend-similar', 'recall-memories', 'on-topic', 'recommend-top-rated', 'off-topic', 'retry', 'salvage'] as const;
  override get outputSchema(): Record<'lookup-author' | 'find-reviews' | 'describe-book' | 'recommend-similar' | 'recall-memories' | 'on-topic' | 'recommend-top-rated' | 'off-topic' | 'retry' | 'salvage', SchemaObjectType> {
    return {
      'lookup-author':       { 'type': 'object' },
      'find-reviews':        { 'type': 'object' },
      'describe-book':       { 'type': 'object' },
      'recommend-similar':   { 'type': 'object' },
      'recall-memories':     { 'type': 'object' },
      'on-topic':            { 'type': 'object' },
      'recommend-top-rated': { 'type': 'object' },
      'off-topic':           { 'type': 'object' },
      'retry':               { 'type': 'object' },
      'salvage':             { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ArchivistState>, context: NodeContextType) {
    const buckets = new Map<IntentOutput, ItemType<ArchivistState>[]>();
    for (const output of this.outputs) buckets.set(output, []);

    for (const item of batch) {
      const { state } = item;
      const summary = state.recalledContext.summary.length > 0
        ? state.recalledContext.summary
        : undefined;
      const conversation = state.conversation.length > 0 ? state.conversation : undefined;

      const controller = new AbortController();
      const handle = setTimeout(() => controller.abort(new Error('node-timeout')), this.services.nodeTimeouts[context.nodeName] ?? NODE_TIMEOUT_MS);
      const signal = AbortSignal.any([context.signal, controller.signal]);

      try {
        const intent = await this.services.llm.classifyIntent(state.query, summary, conversation, signal);
        // Guard: empty or unrecognised intent is a classification failure; the
        // retry/salvage flow decides the path.
        if (intent.length === 0) {
          if (state.withinRetryBudget(context.nodeName, RETRY_BUDGET)) {
            const result = NodeOutputBuilder.of('retry');
            for (const error of result.errors) state.collectError(error);
            buckets.get(result.output)?.push(item);
          } else {
            state.clearAttempts(context.nodeName);
            const result = NodeOutputBuilder.of('salvage');
            for (const error of result.errors) state.collectError(error);
            buckets.get(result.output)?.push(item);
          }
          continue;
        }
        state.intent = intent;
        state.reasoning = [...state.reasoning, ReasoningStepBuilder.thought(`classified intent as '${intent}'`)];
        state.clearAttempts(context.nodeName);
        // Map every ClassifiedIntent variant to its node output port.
        // 'search', 'describe' are general on-topic intents that route through
        // the main pipeline (extract-query -> decide-tools -> ...). 'recommend' is
        // a vague "good book / good story" ask: it routes through the dedicated
        // rating-ranked branch instead of the LLM-relevance-ranked one.
        const intentDispatch: Record<ClassifiedIntent, IntentOutput> = {
          'off-topic':         'off-topic',
          'lookup-author':     'lookup-author',
          'find-reviews':      'find-reviews',
          'describe-book':     'describe-book',
          'recommend-similar': 'recommend-similar',
          'recall-memories':   'recall-memories',
          'search':            'on-topic',
          'describe':          'on-topic',
          'recommend':         'recommend-top-rated',
        };
        const result = NodeOutputBuilder.of(intentDispatch[intent]);
        for (const error of result.errors) state.collectError(error);
        buckets.get(result.output)?.push(item);
      } catch (err) {
        // External cancellation / run deadline propagates unchanged.
        if (context.signal.aborted) throw err;
        // Node-local timeout or LLM failure -> retry budget decides the flow. The
        // classifier never fabricates an intent it didn't receive.
        if (state.withinRetryBudget(context.nodeName, RETRY_BUDGET)) {
          const result = NodeOutputBuilder.of('retry');
          for (const error of result.errors) state.collectError(error);
          buckets.get(result.output)?.push(item);
        } else {
          state.clearAttempts(context.nodeName);
          const result = NodeOutputBuilder.of('salvage');
          for (const error of result.errors) state.collectError(error);
          buckets.get(result.output)?.push(item);
        }
      } finally {
        clearTimeout(handle);
      }
    }

    const routes: Array<readonly [IntentOutput, Batch<ArchivistState>]> = [];
    for (const output of this.outputs) {
      const items = buckets.get(output) ?? [];
      if (items.length > 0) routes.push([output, Batch.from(items)]);
    }
    return RoutedBatchBuilder.from(routes);
  }
}
// #endregion node-class
