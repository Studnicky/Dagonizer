/**
 * 28-runner/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/28-runner.ts (the executable entry point).
 */

// #region imports
import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutputBuilder,
  NodeStateBase,
  RoutedBatchBuilder,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
// #endregion imports

// #region state
/**
 * Pipeline state for the word-count DAG.
 *
 * `text`  — the raw input text (set before execute).
 * `words` — the final word count (written by CountNode).
 */
export class WordState extends NodeStateBase {
  text  = '';
  words = 0;
}
// #endregion state

// #region node
/**
 * TrimNode: strips leading/trailing whitespace from state.text.
 * Routes to 'done' on success; unreachable 'error' output satisfies
 * the schema so consumers can extend with an error handler.
 */
export class TrimNode extends MonadicNode<WordState, 'done'> {
  readonly name = 'trim';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<WordState>) {
    for (const item of batch) item.state.text = item.state.text.trim();
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('done').output, batch);
  }
}

/**
 * CountNode: counts whitespace-separated tokens in state.text.
 * Writes the count to state.words and routes to 'done'.
 */
export class CountNode extends MonadicNode<WordState, 'done'> {
  readonly name = 'count';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<WordState>) {
    for (const item of batch) {
      item.state.words = item.state.text.length === 0
        ? 0
        : item.state.text.split(/\s+/).length;
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('done').output, batch);
  }
}
// #endregion node

// #region dag
export const dag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id':        'urn:noocodex:dag:word-count',
  '@type':      'DAG',
  "name":       'word-count',
  "version":    '1',
  "entrypoint": 'trim',
  "nodes": [
    {
      '@id':     'urn:noocodex:dag:word-count/node/trim',
      '@type':   'SingleNode',
      "name":    'trim',
      "node":    'trim',
      "outputs": { "done": 'count' },
    },
    {
      '@id':     'urn:noocodex:dag:word-count/node/count',
      '@type':   'SingleNode',
      "name":    'count',
      "node":    'count',
      "outputs": { "done": 'end' },
    },
    {
      '@id':     'urn:noocodex:dag:word-count/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion dag
