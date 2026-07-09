/**
 * Named leaves for `DecisionNode` and `ComposeNode`.
 *
 * Each leaf narrows the parent's generics for one of the common
 * agent-flow operations. Consumers extend the leaf when their use
 * case matches the named shape; they extend the parent directly for
 * novel shapes.
 *
 * The leaves carry no runtime behaviour beyond their parent; they're
 * named class variants that document intent and constrain TChoice /
 * output port naming. The same class extension pattern applies.
 */

import type { ToolCallType } from '@studnicky/dagonizer/adapter';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

import { ComposeNode } from './ComposeNode.js';
import { DecisionNode } from './DecisionNode.js';

// ── DecisionNode leaves ───────────────────────────────────────────────────

/**
 * ClassifyIntentNode: LLM picks one intent token from a literal-union
 * `TIntent`. The output port name equals the chosen intent string,
 * so the dispatcher routes each branch to a different downstream node.
 */
export abstract class ClassifyIntentNode<
  TState extends NodeStateInterface,
  TIntent extends string,
> extends DecisionNode<TState, TIntent, TIntent> {}

/**
 * DecideToolsNode: LLM emits a list of tool calls. The output port
 * is 'planned' when at least one tool was chosen, 'skip' otherwise.
 */
export abstract class DecideToolsNode<
  TState extends NodeStateInterface,
> extends DecisionNode<TState, readonly ToolCallType[], 'planned' | 'skip'> {}

/**
 * ValidateResponseNode: LLM judges a draft yes/no. Output port is
 * 'approved' or 'retry'.
 */
export abstract class ValidateResponseNode<
  TState extends NodeStateInterface,
> extends DecisionNode<TState, 'yes' | 'no', 'approved' | 'retry'> {}

/**
 * RankCandidatesNode: LLM scores each candidate in [0,1]. TChoice
 * is the array of `(id, score)` pairs; consumer routes 'ranked' or
 * 'empty' depending on whether any candidates were scored.
 */
export type ScoreType = {
  readonly id: string;
  readonly score: number;
};
export abstract class RankCandidatesNode<
  TState extends NodeStateInterface,
> extends DecisionNode<TState, readonly ScoreType[], 'ranked' | 'empty'> {}

// ── ComposeNode leaves ────────────────────────────────────────────────────

/**
 * ComposeResponseNode: general LLM prose generation. Default output
 * port 'success'.
 */
export abstract class ComposeResponseNode<
  TState extends NodeStateInterface,
> extends ComposeNode<TState> {}

/**
 * ComposeEmptyResponseNode: composition path for the "no data found"
 * case. Same dispatch loop; semantically distinct.
 */
export abstract class ComposeEmptyResponseNode<
  TState extends NodeStateInterface,
> extends ComposeNode<TState> {}

/**
 * ComposeMemoryResponseNode: composition that draws from a recalled
 * memory digest rather than a fresh shortlist. Same dispatch loop.
 */
export abstract class ComposeMemoryResponseNode<
  TState extends NodeStateInterface,
> extends ComposeNode<TState> {}

/**
 * DeclineNode: composition with refusal slant (polite "I can't help
 * with that" responses). Same dispatch loop.
 */
export abstract class DeclineNode<
  TState extends NodeStateInterface,
> extends ComposeNode<TState> {}
