/**
 * @studnicky/dagonizer-patterns-rag: RAG node pattern bases.
 *
 * Three canonical pattern classes:
 *   - DecisionNode<TState, TChoice>: LLM consults and returns structured choice
 *   - ComposeNode<TState>: LLM produces prose
 *   - ScoutNode<TState, TInput, TToolOutput, TItem>: calls a Tool, normalises, writes back
 *
 * Each is an abstract class; consumers extend to inject the five
 * domain points: state shape, choice/item shape, prompt template,
 * tool reference, write-back behavior.
 */

export { LlmDispatchNode } from './LlmDispatchNode.js';
export type { RagServices } from './LlmDispatchNode.js';

export { DecisionNode } from './DecisionNode.js';

export { ComposeNode } from './ComposeNode.js';

export { ScoutNode } from './ScoutNode.js';
export type { ScoutServices } from './ScoutNode.js';

// Named leaves: narrow TChoice / output port for the common cases.
export {
  ClassifyIntentNode,
  ComposeEmptyResponseNode,
  ComposeMemoryResponseNode,
  ComposeResponseNode,
  DecideToolsNode,
  DeclineNode,
  RankCandidatesNode,
  ValidateResponseNode,
} from './leaves.js';
export type { Score } from './leaves.js';
