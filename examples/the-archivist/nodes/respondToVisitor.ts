/**
 * respondToVisitor / declineOffTopic / declineEmpty — terminal nodes.
 *
 * Three distinct exits the dispatcher routes to depending on which
 * gate the flow hit. Each marks the state with the final outcome but
 * has nothing to compute — the work happened upstream.
 *
 * Demonstrates: terminal nodes (output routes to `null`) and the
 * `state.collectWarning` accumulator for soft signals.
 */


import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';

export const respondToVisitor: NodeInterface<ArchivistState, 'success', ArchivistServices> = {
  "name": 'respond-to-visitor',
  "outputs": ['success'],
  async execute(state, context) {
    context.services.logger.info(`responded with ${String(state.shortlist.length)} candidates`);
    return { "output": 'success' };
  },
};

export const declineOffTopic: NodeInterface<ArchivistState, 'success', ArchivistServices> = {
  "name": 'decline-off-topic',
  "outputs": ['success'],
  async execute(state) {
    state.draft = "I only help with finding and identifying books — what title or topic interests you?";
    return { "output": 'success' };
  },
};

export const declineEmpty: NodeInterface<ArchivistState, 'success', ArchivistServices> = {
  "name": 'decline-empty',
  "outputs": ['success'],
  async execute(state) {
    state.draft = "I couldn't find anything matching that. Could you describe the cover, the era, or what the book is about?";
    state.collectWarning({
      "code": 'EMPTY_SHORTLIST',
      "message": 'no candidates after merge',
      "operation": 'decline-empty',
      "timestamp": new Date().toISOString(),
    });
    return { "output": 'success' };
  },
};
