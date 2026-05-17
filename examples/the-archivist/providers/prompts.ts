/**
 * prompts.ts — every prompt the Archivist sends, composed from small
 * directive primitives.
 *
 *   Directive  = one short positive instruction (an "attractor")
 *   Prompt     = a list of directives + slots, joined deterministically
 *   Schema     = the data contract that pairs with a prompt
 *
 * Rules of the road:
 *   • Every prompt is built here. No other module assembles natural-language.
 *   • Directives state what to DO, not what to avoid (attractors beat repulsors).
 *   • Examples in schemas describe SHAPE, never real-world content,
 *     so models can't quote example data back into the conversation.
 *   • Persistent memory is INERT context; the directive only encourages
 *     citation when the visitor explicitly references their past.
 */

import type { MemoryDigest } from '../ArchivistState.ts';
import type { Candidate } from '../entities/Book.ts';

// ── Persona greeting (shown as the first turn before the visitor types).
export const ARCHIVIST_GREETING =
  'Stay a while and listen! I keep shelves on every subject under the sky — name a book, an author, or a feeling, and I will dig.';

// ── Directive primitives ────────────────────────────────────────────────
/** Composable directive lines. Keep them positive, terse, and orthogonal. */
export const directives = {
  "persona":          'You are the Archivist, a librarian at a small independent bookstore.',
  "scope":            'Answer book-related questions: searches, descriptions, recommendations.',
  "declineOffTopic":  'Decline off-topic questions politely and redirect to books.',
  "beTerse":          'Reply in 2–3 sentences.',
  "citeShortlist":    'Quote titles only from the shortlist supplied below.',
  "groundInShortlist":'Ground every claim in the metadata of the supplied shortlist.',
  "clarifyOnDoubt":   'If the shortlist is empty or the question is ambiguous, ask a single clarifying question.',
  "memoryAsContext":  'Treat persistent memory as background only. Mention it when the visitor says "last time" / "earlier" / "I mentioned before".',
  "emitJsonOnly":     'Return JSON that satisfies the supplied schema. No surrounding prose.',
  "pickTerseQuery":   'Pick a terse search query: title, author, ISBN, or two-to-five topic keywords.',
  "chronological":    'Present the works in publication order, oldest first.',
  "weightRatings":    'Weight ratings (notes.rating + notes.ratingsCount) when scoring; high counts of high ratings boost score.',
  "describeOnly":     'Describe the book in two sentences using the supplied metadata; do not recommend other titles.',
  "authorSurvey":     'Treat the shortlist as one author\'s body of work; sketch its arc, not a single recommendation.',
  "similarToPrior":   'Frame each suggestion as "similar to <prior title>" using the persistent-memory facts as the anchor.',
  "weighOpinions":    'Quote average ratings and ratings counts when present; explain what readers seem to feel about each title.',
  "continuityHint":   'Use the recent context if it suggests a likely intent or recurring interest.',
  "recallMemories":   'When the visitor asks what you remember, what books you have seen, or what they have asked before, give a warm roll-up of your memory.',
} as const;

// ── Shared system message — composed from persona directives ───────────
const SYSTEM = [
  directives.persona,
  directives.scope,
  directives.declineOffTopic,
  directives.beTerse,
  directives.citeShortlist,
  directives.groundInShortlist,
  directives.clarifyOnDoubt,
  directives.memoryAsContext,
].join(' ');

// ── Output schemas (the data contract — paired with prompts) ───────────
export const schemas = {
  "rankCandidates": {
    'type':                  'object',
    'description':           'Per-candidate ranking — score each ISBN against the visitor question.',
    'additionalProperties':  false,
    'properties': {
      'rankings': {
        'type':        'array',
        'description': 'One entry per candidate. Use the exact `isbn` shown in the input. Score in [0, 1].',
        'items': {
          'type':                  'object',
          'description':           'Required fields establish the contract; optional fields enrich it; additional key/value notes are welcome (vibe, themes, era, confidence).',
          'additionalProperties':  true,
          'properties': {
            'isbn': {
              'type':        'string',
              'description': 'Exact ISBN (or stable id) from the input candidate list.',
            },
            'score': {
              'type':        'number',
              'minimum':     0,
              'maximum':     1,
              'description': 'Relevance to the visitor question (1 = perfect, 0 = irrelevant).',
            },
            'reason': {
              'type':        'string',
              'description': 'One-sentence justification the Archivist may cite when composing.',
            },
            'confidence': {
              'type':        'number',
              'minimum':     0,
              'maximum':     1,
              'description': 'Confidence in the score itself; low when metadata is sparse.',
            },
          },
          'required': ['isbn', 'score'],
        },
      },
    },
    'required': ['rankings'],
  } as Record<string, unknown>,
};

// ── Prompt builders ────────────────────────────────────────────────────
/** Helpers expose only the builders; nodes never assemble prose themselves. */
export const prompts = {
  classifyIntent(query: string, recalledSummary?: string): string {
    const contextBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : [
          '',
          `Recent context: ${recalledSummary} ${directives.continuityHint}`,
        ].join('\n');
    return [
      SYSTEM,
      '',
      'Classify the visitor question as exactly one of the following intents:',
      '  lookup-author      — the visitor named an author and wants their body of work',
      '  find-reviews       — the visitor wants opinions, reviews, or what readers think',
      '  describe-book      — the visitor named a specific title and wants a description',
      '  recommend-similar  — the visitor wants something like a previous read',
      '  recall-memories    — the visitor asks about your own memory or history: what books you have looked up, what they have asked before, what has been recommended; any meta-question about your past activity',
      '  search             — the visitor named a topic / title / ISBN (no clear sub-case)',
      '  describe           — the visitor described a book without naming it',
      '  recommend          — the visitor asked for a generic recommendation',
      '  off-topic          — the visitor asked something unrelated to books and unrelated to your memory',
      'Prefer the most specific intent. Use recall-memories for any question about your activity, history, or memory. Respond with the single token only.',
      contextBlock,
      '',
      `Visitor question: ${query}`,
    ].join('\n');
  },

  extractTerms(query: string): string {
    return [
      SYSTEM,
      '',
      'Extract 3–6 short search terms (1–3 words each) from the visitor question.',
      'Return ONLY a JSON array of strings.',
      '',
      `Visitor question: ${query}`,
    ].join('\n');
  },

  decideTools(query: string): string {
    // Tool descriptions / schemas flow through the adapter's native
    // tools channel (Gemini's `functionDeclarations`, Nano's
    // `responseConstraint`). The prompt itself stays lean.
    return [
      SYSTEM,
      directives.pickTerseQuery,
      'Pick the smallest set of tool calls that would answer the visitor.',
      '',
      `Visitor question: ${query}`,
    ].join('\n');
  },

  rankCandidates(query: string, candidates: readonly Candidate[]): string {
    const rows = candidates.map((c, i) => formatCandidateRow(i + 1, c)).join('\n');
    return [
      SYSTEM,
      directives.emitJsonOnly,
      '',
      `Visitor question: ${query}`,
      '',
      'Candidates:',
      rows,
    ].join('\n');
  },

  compose(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
  ): string {
    const rows = shortlist.map((c, i) => formatCandidateRow(i + 1, c)).join('\n');
    const contextBlock = (priorContext === undefined || priorContext.length === 0)
      ? ''
      : [
          '',
          'PERSISTENT MEMORY (background only — cite only on explicit recall request):',
          ...priorContext.map((p) => `- [${p.kind}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\nConversation context: ${recalledSummary}`;
    return [
      SYSTEM,
      directives.beTerse,
      directives.citeShortlist,
      '',
      `Visitor question: ${query}`,
      continuityBlock,
      contextBlock,
      '',
      'Shortlist (ranked, top first):',
      rows,
    ].join('\n');
  },

  composeAuthor(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
  ): string {
    const rows = shortlist.map((c, i) => formatCandidateRow(i + 1, c)).join('\n');
    const contextBlock = (priorContext === undefined || priorContext.length === 0)
      ? ''
      : [
          '',
          'PERSISTENT MEMORY (background only — cite only on explicit recall request):',
          ...priorContext.map((p) => `- [${p.kind}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\nConversation context: ${recalledSummary}`;
    return [
      SYSTEM,
      directives.beTerse,
      directives.citeShortlist,
      directives.chronological,
      directives.authorSurvey,
      '',
      `Visitor question: ${query}`,
      continuityBlock,
      contextBlock,
      '',
      'Shortlist (chronological, oldest first):',
      rows,
    ].join('\n');
  },

  composeReviews(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
  ): string {
    const rows = shortlist.map((c, i) => formatCandidateRow(i + 1, c)).join('\n');
    const contextBlock = (priorContext === undefined || priorContext.length === 0)
      ? ''
      : [
          '',
          'PERSISTENT MEMORY (background only — cite only on explicit recall request):',
          ...priorContext.map((p) => `- [${p.kind}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\nConversation context: ${recalledSummary}`;
    return [
      SYSTEM,
      directives.beTerse,
      directives.citeShortlist,
      directives.weightRatings,
      directives.weighOpinions,
      '',
      `Visitor question: ${query}`,
      continuityBlock,
      contextBlock,
      '',
      'Shortlist (ranked by rating signal):',
      rows,
    ].join('\n');
  },

  describeBook(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
  ): string {
    const rows = shortlist.map((c, i) => formatCandidateRow(i + 1, c)).join('\n');
    const contextBlock = (priorContext === undefined || priorContext.length === 0)
      ? ''
      : [
          '',
          'PERSISTENT MEMORY (background only — cite only on explicit recall request):',
          ...priorContext.map((p) => `- [${p.kind}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\nConversation context: ${recalledSummary}`;
    return [
      SYSTEM,
      directives.describeOnly,
      directives.citeShortlist,
      directives.groundInShortlist,
      '',
      `Visitor question: ${query}`,
      continuityBlock,
      contextBlock,
      '',
      'Matched book(s):',
      rows,
    ].join('\n');
  },

  composeSimilar(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
  ): string {
    const rows = shortlist.map((c, i) => formatCandidateRow(i + 1, c)).join('\n');
    const contextBlock = (priorContext === undefined || priorContext.length === 0)
      ? ''
      : [
          '',
          'PERSISTENT MEMORY (anchor — cite explicitly as the basis for similarity):',
          ...priorContext.map((p) => `- [${p.kind}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\nConversation context: ${recalledSummary}`;
    return [
      SYSTEM,
      directives.beTerse,
      directives.citeShortlist,
      directives.similarToPrior,
      '',
      `Visitor question: ${query}`,
      continuityBlock,
      contextBlock,
      '',
      'Shortlist (ranked, top first):',
      rows,
    ].join('\n');
  },

  validate(draft: string, shortlist: readonly Candidate[]): string {
    const titles = shortlist.map((c) => c.book.title).join(' | ');
    return [
      SYSTEM,
      'Approve if the draft (a) mentions a shortlisted title and (b) reads as a polite on-topic reply.',
      'Reply with the single token "yes" or "no".',
      '',
      `Shortlisted titles: ${titles}`,
      '',
      `Draft: ${draft}`,
    ].join('\n');
  },

  composeMemoryRecall(
    query: string,
    digest: MemoryDigest,
    recalledSummary?: string,
  ): string {
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\nConversation context: ${recalledSummary}`;

    const digestBlock = digest.bookCount === 0
      ? 'Memory status: my shelves are fresh — no books have been recorded yet this session.'
      : [
          `Memory status: ${String(digest.bookCount)} distinct book${digest.bookCount === 1 ? '' : 's'} recorded, ${String(digest.queryCount)} visitor ${digest.queryCount === 1 ? 'query' : 'queries'} seen.`,
          digest.recentBooks.length > 0
            ? `Recent titles: ${digest.recentBooks.map((b) => `"${b.title}"${b.author !== undefined ? ` by ${b.author}` : ''}`).join('; ')}.`
            : '',
          digest.intentBreakdown.length > 0
            ? `Intent breakdown: ${digest.intentBreakdown.map((e) => `${e.intent} (${String(e.count)})`).join(', ')}.`
            : '',
        ].filter(Boolean).join(' ');

    return [
      SYSTEM,
      directives.recallMemories,
      directives.beTerse,
      '',
      `Visitor question: ${query}`,
      continuityBlock,
      '',
      digestBlock,
    ].join('\n');
  },
};

// ── Internals ──────────────────────────────────────────────────────────
function formatCandidateRow(n: number, c: Candidate): string {
  const parts: string[] = [];
  parts.push(`${String(n)}. isbn=${c.book.isbn}`);
  parts.push(`"${c.book.title}"`);
  parts.push(`by ${c.book.authors.join(', ') || '<unknown author>'}`);
  if (c.book.firstPublishYear !== undefined) parts.push(`(${String(c.book.firstPublishYear)})`);
  if (c.book.subjects !== undefined && c.book.subjects.length > 0) {
    parts.push(`subjects: ${c.book.subjects.slice(0, 5).join(', ')}`);
  }
  if (c.book.publishers !== undefined && c.book.publishers.length > 0) {
    parts.push(`pub: ${c.book.publishers[0]}`);
  }
  if (c.book.summary !== undefined && c.book.summary.length > 0) {
    parts.push(`— ${c.book.summary}`);
  }
  if (c.reason !== undefined && c.reason.length > 0) {
    parts.push(`[rank-reason: ${c.reason}]`);
  }
  return parts.join(' | ');
}
