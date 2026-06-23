/**
 * AiComposeNode: canned-response AI for routine Noocodex support queries.
 *
 * Deterministic — no LLM required. A static dispatch map keys on keyword
 * presence in the inbound message and sets state.response to the matching
 * canned reply. Falls through to a default if no keyword matches.
 *
 * Routes 'drafted' on every path.
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';

type ResponseEntry = {
  readonly pattern: RegExp;
  readonly reply: string;
};

const RESPONSE_MAP: readonly ResponseEntry[] = [
  {
    pattern: /\b(order|track|shipping|delivery)\b/i,
    reply:   "Your order is on its way! Estimated delivery in 3–5 business days. Is there anything else I can help you with?",
  },
  {
    pattern: /\b(hours|open|close|closing)\b/i,
    reply:   "We're open Monday–Friday 9am–6pm and Saturday 10am–4pm (all times local). How else can I help?",
  },
  {
    pattern: /\b(stock|available|in stock|inventory)\b/i,
    reply:   "Let me check that for you! Yes, that title is currently in stock and ready to ship.",
  },
  {
    pattern: /\b(return|exchange)\b/i,
    reply:   "Our return window is 30 days from receipt. Returns are free for defective items. Shall I start the process?",
  },
];

const DEFAULT_REPLY = "Thanks for reaching out to Noocodex Support! I've noted your message and will do my best to help. Could you give me a bit more detail?";

export class AiComposeNode extends ScalarNode<DispatcherState, 'drafted'> {
  readonly name = 'ai-compose';
  readonly outputs = ['drafted'] as const;

  override get outputSchema(): Record<'drafted', SchemaObjectType> {
    return { 'drafted': { 'type': 'object' } };
  }

  protected override async executeOne(state: DispatcherState) {
    const msg = state.message;
    let matched: string | null = null;
    for (const entry of RESPONSE_MAP) {
      if (entry.pattern.test(msg)) {
        matched = entry.reply;
        break;
      }
    }
    state.response = matched ?? DEFAULT_REPLY;
    return NodeOutputBuilder.of('drafted');
  }
}
