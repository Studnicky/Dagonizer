/**
 * pattern-node/dags: pure module — a real pattern-tier node built by extending
 * DecisionNode from @studnicky/dagonizer-patterns-rag.
 *
 * No side effects, no dispatcher, no execute. Imported by
 * examples/pattern-node.ts (the executable entry point).
 *
 * IntentClassifier is a complete DecisionNode: it implements the four abstract
 * methods (composePrompt, decodeChoice, routeFor, applyChoice) and declares its
 * name + output ports. The pattern base owns the LLM dispatch, retry, abort
 * propagation, and contract-field forwarding — the subclass writes only the
 * domain logic.
 */

import { NodeStateBase } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';
import { DecisionNode } from '@studnicky/dagonizer-patterns-rag';

export type Intent = 'search' | 'describe' | 'recommend' | 'off-topic';

export class IntentState extends NodeStateBase {
  query = '';
  intent: Intent = 'off-topic';
}

// #region pattern-node
export class IntentClassifier extends DecisionNode<IntentState, Intent, Intent> {
  readonly name = 'classify-intent';
  readonly outputs = ['search', 'describe', 'recommend', 'off-topic'] as const;
  override get outputSchema(): Record<'search' | 'describe' | 'recommend' | 'off-topic', SchemaObjectType> {
    return {
      'search':     { 'type': 'object' },
      'describe':   { 'type': 'object' },
      'recommend':  { 'type': 'object' },
      'off-topic':  { 'type': 'object' },
    };
  }

  protected composePrompt(state: IntentState): string {
    return `Classify: "${state.query}" → search | describe | recommend | off-topic. Reply with one word.`;
  }

  protected decodeChoice(content: string): Intent {
    const token = content.trim().toLowerCase();
    if (token === 'search' || token === 'describe' || token === 'recommend') return token;
    return 'off-topic';
  }

  protected routeFor(intent: Intent): Intent {
    return intent;
  }

  protected applyChoice(state: IntentState, intent: Intent): void {
    state.intent = intent;
  }
}
// #endregion pattern-node
