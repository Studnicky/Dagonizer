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
 *   • Builder bodies contain ONLY directive references + slot interpolations
 *     + paragraph-break empty strings. Every static instructional line is a
 *     named primitive in the `directives` registry.
 *   • Examples in schemas describe SHAPE, never real-world content,
 *     so models can't quote example data back into the conversation.
 *   • Persistent memory is INERT context; the directive only encourages
 *     citation when the visitor explicitly references their past.
 */

import type { MemoryDigest } from '../ArchivistState.ts';
import type { Candidate } from '../entities/Book.ts';
import { UserLanguage } from '../language/UserLanguage.ts';

// ── Directive primitives ────────────────────────────────────────────────
/** Composable directive lines. Keep them positive, terse, and orthogonal. */
export const directives = {
  // ── Persona ──────────────────────────────────────────────────────────
  "persona":          'You are the Archivist, a librarian at a small independent bookstore.',
  "scope":            'Answer book-related questions: searches, descriptions, recommendations.',
  "declineOffTopic":  'Decline off-topic questions politely and redirect to books.',
  "shopSpecialty":    'The shop specialises in science fiction and philosophy.',

  // ── Response style ───────────────────────────────────────────────────
  "beTerse":          'Reply in 2–3 sentences.',
  "conversational":   'Reply in flowing prose as a librarian speaking aloud. Never use markdown headings (no `**Shortlist:**`), bullet lists, or numbered enumerations. Weave the candidates you cite into your sentences naturally — title-case the work, mention the author when it matters, drop the rest.',
  "citeShortlist":    'Cite titles only from the candidates supplied below.',
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
  "ownTheGap":        'Acknowledge which sources were searched. Explain in one sentence why nothing matched. Offer one concrete alternative angle the visitor could try.',

  // ── Slot labels ──────────────────────────────────────────────────────
  "visitorQuestionLabel":   'Visitor question:',
  "recentContextLabel":     'Recent context:',
  "conversationContextLabel":'Conversation context:',
  "searchNotesLabel":       'Search notes:',
  "shortlistedTitlesLabel": 'Shortlisted titles:',
  "draftLabel":             'Draft:',
  "candidatesPlainHeader":  'Candidates:',
  "matchedBooksHeader":     'Matched book(s):',

  // ── Intent classification ────────────────────────────────────────────
  "intentEnumerationHeader": 'Classify the visitor question as exactly one of the following intents:',
  "intentEnumeration": [
    '  lookup-author      — the visitor named an author and wants their body of work',
    '  find-reviews       — the visitor wants opinions, reviews, or what readers think',
    '  describe-book      — the visitor named a specific title and wants a description',
    '  recommend-similar  — the visitor wants something like a previous read',
    '  recall-memories    — the visitor asks about your own memory or history: what books you have looked up, what they have asked before, what has been recommended; any meta-question about your past activity',
    '  search             — the visitor named a topic / title / ISBN (no clear sub-case)',
    '  describe           — the visitor described a book without naming it',
    '  recommend          — the visitor asked for a generic recommendation',
    '  off-topic          — the visitor asked something unrelated to books and unrelated to your memory',
  ].join('\n'),
  "intentExamplesHeader": 'Examples:',
  "intentExamples": [
    '  "do you have anything exploring the ethics of AI, maybe with a sci-fi bent?" → search',
    '  "what should I read after Project Hail Mary?" → recommend-similar',
    '  "tell me about The Sun Also Rises" → describe-book',
    '  "what did Murakami write?" → lookup-author',
    '  "anything good in cosy fantasy?" → recommend',
    '  "what was that book I asked about last week?" → recall-memories',
    '  "what time is it?" → off-topic',
    '  "try again" / "another one" / "different" / "no" → REUSE THE PRIOR INTENT from recent context if any, otherwise default to `search`',
  ].join('\n'),
  "intentRules":          'Rules: prefer the most specific intent. Treat short follow-up phrases ("try again", "next", "no", "different") as continuations of the previous intent — never classify them as off-topic. Off-topic is ONLY for questions with no plausible connection to books or your memory.',
  "intentResponseFormat": 'Respond with the single token only.',

  // ── Term extraction ──────────────────────────────────────────────────
  "extractTermsTask": 'Extract 3–6 short search terms (1–3 words each) from the visitor question.',
  "jsonArrayOnly":    'Return ONLY a JSON array of strings.',

  // ── Tool decision ────────────────────────────────────────────────────
  "callAllToolsForAuthor": 'For any visitor question that names an author or describes a book to find, call ALL of the available tools — do not omit any source.',
  "shortKeywordQuery":     'Use a short, keyword-only query (no surrounding quotes, no filler phrases).',

  // ── Compose-side candidate headers ───────────────────────────────────
  "candidatesHeader":              'Candidates (cite in flowing prose; the order reflects ranking):',
  "candidatesHeaderChronological": 'Candidates (cite in flowing prose; the order is chronological):',
  "candidatesHeaderRated":         'Candidates (cite in flowing prose; the order reflects reader ratings):',
  "persistentMemoryHeader":        'PERSISTENT MEMORY (background only — cite only on explicit recall request):',
  "persistentMemoryAnchorHeader":  'PERSISTENT MEMORY (anchor — cite explicitly as the basis for similarity):',

  // ── Validation ───────────────────────────────────────────────────────
  "validateApprovalRule":   'Approve if the draft (a) mentions a shortlisted title and (b) reads as a polite on-topic reply.',
  "validateResponseFormat": 'Reply with the single token "yes" or "no".',

  // ── Starter / greeting / visitor-reply suggestion ────────────────────
  "starterGenrePool":       'Pick one acclaimed work or author from science fiction or philosophy at random — examples of the genre frame: Liu Cixin\'s Three Body Problem, William Gibson\'s Neuromancer, Ursula K. Le Guin, Stanisław Lem, Ted Chiang, Jorge Luis Borges, Albert Camus, Michel Foucault, Gilles Deleuze, Ludwig Wittgenstein. Pick something in that vein but vary your selection.',
  "starterPhraseInstruction":'Phrase ONE short curious question a first-time visitor to a bookstore might ask about it.',
  "starterLengthLimit":     'The question must be under 20 words.',
  "starterReturnFormat":    'Return just the question — no preamble, no quotation marks, no explanation.',

  "greetingInstruction":    'Write ONE fresh opening greeting for a new visitor walking into the shop.',
  "greetingTone":           'The greeting must be warm, curious, and invite a book question.',
  "greetingLengthLimit":    'Keep it under 30 words.',
  "greetingReturnFormat":   'Return just the greeting — no preamble, no quotation marks, no explanation.',

  "visitorReplyContextLine":  'A bookshop visitor has just received this greeting from the Archivist:',
  "visitorReplyInterest":     'The visitor is interested in science fiction and philosophy.',
  "visitorReplyInstruction":  'Write ONE natural first message the visitor might send in reply.',
  "visitorReplyContent":      'The reply must be a book question or request that follows naturally from the greeting.',
  "visitorReplyLengthLimit":  'Keep it under 30 words.',
  "visitorReplyReturnFormat": 'Return just the visitor message — no preamble, no quotation marks, no explanation.',

  // ── Tool explanation ─────────────────────────────────────────────────
  "explainToolPersona":      'You are a librarian explaining a backend tool to a curious visitor.',
  "explainToolInstruction":  'Explain in 2-3 plain-English sentences:',
  "explainToolPoint1":       '1. What the tool does',
  "explainToolPoint2":       '2. Why it matters',
  "explainToolPoint3":       '3. One concrete example use-case',
  "explainToolTone":         'Keep it warm and clear. No jargon. Under 80 words.',
  "explainToolReturnFormat": 'Return just the explanation, no preamble.',

  // ── Memory recall ────────────────────────────────────────────────────
  "memoryEmptyStatus": 'Memory status: my shelves are fresh — no books have been recorded yet this session.',
} as const;

// ── Shared system message — composed from persona directives ───────────
const SYSTEM = [
  directives.persona,
  directives.scope,
  directives.declineOffTopic,
  directives.beTerse,
  directives.conversational,
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

// ── Language preamble — top-of-prompt directive ────────────────────────
/**
 * Prepend a single language directive to every prompt body. Single
 * source of truth for the language instruction so we can evolve the
 * exact phrasing in one place.
 *
 * The directive instructs the model to:
 *   • respond in the user's device language;
 *   • use that language for every natural-language field in any JSON
 *     output (descriptions, ranking reasons, draft responses);
 *   • not echo translations of the input — respond directly in the
 *     target language.
 */
function withLanguagePreamble(language: string, body: string): string {
  const code = UserLanguage.normalize(language);
  const name = UserLanguage.displayName(code);
  const preamble = [
    `You communicate in ${name} (${code}). Every word you output, including`,
    'JSON field values that contain natural language (book descriptions, ranking',
    `reasons, draft responses), MUST be in ${name}. Do not output translations`,
    `or transliterations of the user's input — respond directly in ${name}.`,
  ].join('\n');
  return `${preamble}\n\n${body}`;
}

// ── Prompt builders ────────────────────────────────────────────────────
/** Helpers expose only the builders; nodes never assemble prose themselves. */
export const prompts = {
  classifyIntent(language: string, query: string, recalledSummary?: string): string {
    const contextBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : [
          '',
          `${directives.recentContextLabel} ${recalledSummary} ${directives.continuityHint}`,
        ].join('\n');
    const body = [
      SYSTEM,
      '',
      directives.intentEnumerationHeader,
      directives.intentEnumeration,
      '',
      directives.intentExamplesHeader,
      directives.intentExamples,
      '',
      directives.intentRules,
      directives.intentResponseFormat,
      contextBlock,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  extractTerms(language: string, query: string): string {
    const body = [
      SYSTEM,
      '',
      directives.extractTermsTask,
      directives.jsonArrayOnly,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  decideTools(language: string, query: string): string {
    // Tool descriptions / schemas flow through the adapter's native
    // tools channel (Gemini's `functionDeclarations`, Nano's
    // `responseConstraint`). The prompt itself stays lean.
    const body = [
      SYSTEM,
      directives.pickTerseQuery,
      directives.callAllToolsForAuthor,
      directives.shortKeywordQuery,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  rankCandidates(language: string, query: string, candidates: readonly Candidate[]): string {
    const rows = candidates.map((c, i) => formatCandidateRow(i + 1, c)).join('\n');
    const body = [
      SYSTEM,
      directives.emitJsonOnly,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      '',
      directives.candidatesPlainHeader,
      rows,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  compose(
    language: string,
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
          directives.persistentMemoryHeader,
          ...priorContext.map((p) => `- [${p.kind}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;
    const body = [
      SYSTEM,
      directives.beTerse,
      directives.citeShortlist,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      contextBlock,
      '',
      directives.candidatesHeader,
      rows,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  composeAuthor(
    language: string,
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
          directives.persistentMemoryHeader,
          ...priorContext.map((p) => `- [${p.kind}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;
    const body = [
      SYSTEM,
      directives.beTerse,
      directives.citeShortlist,
      directives.chronological,
      directives.authorSurvey,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      contextBlock,
      '',
      directives.candidatesHeaderChronological,
      rows,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  composeReviews(
    language: string,
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
          directives.persistentMemoryHeader,
          ...priorContext.map((p) => `- [${p.kind}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;
    const body = [
      SYSTEM,
      directives.beTerse,
      directives.citeShortlist,
      directives.weightRatings,
      directives.weighOpinions,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      contextBlock,
      '',
      directives.candidatesHeaderRated,
      rows,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  describeBook(
    language: string,
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
          directives.persistentMemoryHeader,
          ...priorContext.map((p) => `- [${p.kind}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;
    const body = [
      SYSTEM,
      directives.describeOnly,
      directives.citeShortlist,
      directives.groundInShortlist,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      contextBlock,
      '',
      directives.matchedBooksHeader,
      rows,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  composeSimilar(
    language: string,
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
          directives.persistentMemoryAnchorHeader,
          ...priorContext.map((p) => `- [${p.kind}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;
    const body = [
      SYSTEM,
      directives.beTerse,
      directives.citeShortlist,
      directives.similarToPrior,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      contextBlock,
      '',
      directives.candidatesHeader,
      rows,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  composeEmptyResponse(language: string, query: string, failureCause: string): string {
    const causeBlock = failureCause.trim().length > 0
      ? `\n${directives.searchNotesLabel} ${failureCause.trim()}`
      : '';
    const body = [
      SYSTEM,
      directives.ownTheGap,
      directives.beTerse,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      causeBlock,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  validate(language: string, draft: string, shortlist: readonly Candidate[]): string {
    const titles = shortlist.map((c) => c.book.title).join(' | ');
    const body = [
      SYSTEM,
      directives.validateApprovalRule,
      directives.validateResponseFormat,
      '',
      `${directives.shortlistedTitlesLabel} ${titles}`,
      '',
      `${directives.draftLabel} ${draft}`,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  suggestStarterQuery(language: string): string {
    const body = [
      directives.persona,
      directives.shopSpecialty,
      directives.starterGenrePool,
      directives.starterPhraseInstruction,
      directives.starterLengthLimit,
      directives.starterReturnFormat,
    ].join(' ');
    return withLanguagePreamble(language, body);
  },

  suggestGreeting(language: string): string {
    const body = [
      directives.persona,
      directives.shopSpecialty,
      directives.greetingInstruction,
      directives.greetingTone,
      directives.greetingLengthLimit,
      directives.greetingReturnFormat,
    ].join(' ');
    return withLanguagePreamble(language, body);
  },

  suggestVisitorReplyTo(language: string, greeting: string): string {
    const body = [
      directives.visitorReplyContextLine,
      `"${greeting}"`,
      directives.visitorReplyInterest,
      directives.visitorReplyInstruction,
      directives.visitorReplyContent,
      directives.visitorReplyLengthLimit,
      directives.visitorReplyReturnFormat,
    ].join(' ');
    return withLanguagePreamble(language, body);
  },

  explainTool(language: string, name: string, context: string): string {
    const body = [
      directives.explainToolPersona,
      `The tool is called "${name}".`,
      `Here is what it does: ${context}`,
      directives.explainToolInstruction,
      directives.explainToolPoint1,
      directives.explainToolPoint2,
      directives.explainToolPoint3,
      directives.explainToolTone,
      directives.explainToolReturnFormat,
    ].join('\n');
    return withLanguagePreamble(language, body);
  },

  composeMemoryRecall(
    language: string,
    query: string,
    digest: MemoryDigest,
    recalledSummary?: string,
  ): string {
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;

    const digestBlock = digest.bookCount === 0
      ? directives.memoryEmptyStatus
      : [
          `Memory status: ${String(digest.bookCount)} distinct book${digest.bookCount === 1 ? '' : 's'} recorded, ${String(digest.queryCount)} visitor ${digest.queryCount === 1 ? 'query' : 'queries'} seen.`,
          digest.recentBooks.length > 0
            ? `Recent titles: ${digest.recentBooks.map((b) => `"${b.title}"${b.author !== undefined ? ` by ${b.author}` : ''}`).join('; ')}.`
            : '',
          digest.intentBreakdown.length > 0
            ? `Intent breakdown: ${digest.intentBreakdown.map((e) => `${e.intent} (${String(e.count)})`).join(', ')}.`
            : '',
        ].filter(Boolean).join(' ');

    const body = [
      SYSTEM,
      directives.recallMemories,
      directives.beTerse,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      '',
      digestBlock,
    ].join('\n');
    return withLanguagePreamble(language, body);
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
