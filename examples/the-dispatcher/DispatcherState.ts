/**
 * DispatcherState: the clipboard the Dispatcher's nodes mutate.
 *
 * Carries the current inbound customer message, the composed response,
 * escalation context, the trolley switch flag, and full conversation history.
 * Extends `NodeStateBase` so the dispatcher owns the lifecycle FSM and
 * `snapshot()` round-trips for `Checkpoint.capture` / `ckpt.restoreState`.
 */

import { NodeStateBase } from '@studnicky/dagonizer';
import type { JsonObjectType, StateFieldsType } from '@studnicky/dagonizer/types';

/**
 * A single turn in the customer–agent conversation.
 * Stored on `DispatcherState.conversation` and appended after each message exchange.
 */
export type ConversationTurnType = {
  readonly role: 'customer' | 'agent' | 'operator';
  readonly text: string;
  readonly ts: number;
};

export class DispatcherState extends NodeStateBase {
  /** Declared scalar fields for schema-driven snapshot/restore. */
  static readonly FIELDS: StateFieldsType = {
    'message':            'string',
    'response':           'string',
    'escalationReason':   'string',
    'humanMode':          'boolean',
    'classificationMode': 'string',
  };

  /** Current inbound customer message. */
  message: string = '';
  /** Composed response (AI or human). */
  response: string = '';
  /** Why escalation happened (empty when not escalated). */
  escalationReason: string = '';
  /**
   * Trolley switch: when true, ALL messages route to the human operator
   * regardless of content. Set externally before execute() to force human mode.
   */
  humanMode: boolean = false;
  /**
   * Classification strategy for `ClassifyMessageNode`: `'embedder'` runs
   * cosine-similarity triage via `services.intent` with automatic LLM
   * fallback; `'llm'` runs the LLM classifier exclusively.
   */
  classificationMode: 'embedder' | 'llm' = 'embedder';
  /** Full conversation history across turns. */
  conversation: ConversationTurnType[] = [];

  // #region snapshot-restore
  protected override snapshotData(): JsonObjectType {
    return {
      ...NodeStateBase.snapshotFields(this, DispatcherState.FIELDS),
      'conversation': this.conversation.map(DispatcherState.turnToJson),
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
    NodeStateBase.restoreFields(this, snap, DispatcherState.FIELDS);
    this.classificationMode = DispatcherState.isClassificationMode(snap['classificationMode'])
      ? snap['classificationMode']
      : 'embedder';
    const rawConversation = snap['conversation'];
    if (Array.isArray(rawConversation)) {
      this.conversation = DispatcherState.filterConversation(rawConversation);
    }
  }
  // #endregion snapshot-restore

  // #region type-guards
  private static turnToJson(t: ConversationTurnType): JsonObjectType {
    return { 'role': t.role, 'text': t.text, 'ts': t.ts };
  }

  private static isClassificationMode(v: unknown): v is 'embedder' | 'llm' {
    return v === 'embedder' || v === 'llm';
  }

  private static isConversationTurn(v: unknown): v is ConversationTurnType {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    if (!('role' in v && 'text' in v && 'ts' in v)) return false;
    return (v.role === 'customer' || v.role === 'agent' || v.role === 'operator')
      && typeof v.text === 'string'
      && typeof v.ts   === 'number';
  }

  private static filterConversation(arr: unknown[]): ConversationTurnType[] {
    const out: ConversationTurnType[] = [];
    for (const item of arr) {
      if (DispatcherState.isConversationTurn(item)) out.push(item);
    }
    return out;
  }
  // #endregion type-guards
}
