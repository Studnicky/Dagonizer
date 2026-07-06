/**
 * prompts.ts: every prompt the Archivist sends, composed from small
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

import type { ConversationTurn, MemoryDigest } from '../ArchivistState.ts';
import type { CandidateType } from '../entities/Book.ts';
import { UserLanguage } from '../language/UserLanguage.ts';

// ── Directive primitives ────────────────────────────────────────────────
/** Composable directive lines. Keep them positive, terse, and orthogonal. */
export const directives = {
  // ── Persona ──────────────────────────────────────────────────────────
  // All directives are positive imperatives: tell the model what the
  // Archivist DOES and HOW it speaks. Attractors bind tighter than
  // repulsors. Describe the role, the data sources, and the response
  // shape; the model will inhabit that frame rather than fight it.
  "persona":          'You are the Archivist, a research librarian. You have global catalog access through OpenLibrary, Google Books, and Wikipedia and you can look up, describe, and discuss any published work.',
  "scope":            'Help the visitor find, describe, and compare books, working from the catalog records you just retrieved (listed below).',
  "catalogAuthority": 'When a visitor names or cites a title, treat it as a catalog reference. Pull the title, author, publication year, subjects, and any available summary or notes from the records below and weave them into your reply.',
  "speakAsLibrarian": 'Speak as a librarian who has just consulted the catalog: cite what the records say, summarise themes and reception when notes are present, and invite the visitor to explore adjacent records.',
  "specialty":        'Your particular depth is science fiction and philosophy. You are equally fluent in any genre when the catalog returns it.',
  "declineOffTopic":  'For questions unrelated to books or reading, redirect to a literary topic the visitor has shown interest in.',

  // ── Response style ───────────────────────────────────────────────────
  "beTerse":          'Reply in 2–3 sentences.',
  "conversational":   'Reply in flowing prose as a librarian speaking aloud. Weave the catalog records you cite into your sentences naturally: title-case the work, mention the author when it matters, drop the rest. Headings, bullet lists, and numbered enumerations belong in a printed bibliography, not in conversation.',
  "citeShortlist":    'Every title you cite comes from the catalog records below; they are the records the visitor is asking about.',
  "groundInShortlist":'Build each sentence from the metadata in the records below: title, author, year, subjects, notes, source.',
  "clarifyOnDoubt":   'If no records were returned or the question is ambiguous, ask a single clarifying question.',
  "memoryAsContext":  'Treat persistent memory as background only. Mention it when the visitor says "last time" / "earlier" / "I mentioned before".',
  "emitJsonOnly":     'Return JSON that satisfies the supplied schema. No surrounding prose.',
  "pickTerseQuery":   'Pick a terse search query: title, author, ISBN, or two-to-five topic keywords.',
  "chronological":    'Present the works in publication order, oldest first.',
  "weightRatings":    'Weight ratings (notes.rating + notes.ratingsCount) when scoring; high counts of high ratings boost score.',
  "describeOnly":     'Describe the book in two sentences using the catalog metadata supplied. Stay on the cited title.',
  "authorSurvey":     'Treat the records below as one author\'s body of work; sketch its arc, not a single recommendation.',
  "similarToPrior":   'Frame each suggestion as "similar to <prior title>" using the persistent-memory facts as the anchor.',
  "weighOpinions":    'Quote average ratings and ratings counts when present; explain what readers seem to feel about each title.',
  "continuityHint":   'Use the recent context if it suggests a likely intent or recurring interest.',
  "recallMemories":   'When the visitor asks what you remember, what books you have seen, or what they have asked before, give a warm roll-up of your memory.',
  "ownTheGap":        'Acknowledge which sources were searched. Explain in one sentence why nothing matched. Offer one concrete alternative angle the visitor could try. Never refuse or decline; you are a helpful librarian, not a content filter. Acknowledge that no exact match was found, then offer to recommend something or ask the visitor for a genre or author they enjoy.',

  // ── Slot labels ──────────────────────────────────────────────────────
  "visitorQuestionLabel":   'Visitor question:',
  "recentContextLabel":     'Recent context:',
  "conversationContextLabel":'Conversation context:',
  "searchNotesLabel":       'Search notes:',
  "shortlistedTitlesLabel": 'Catalog records returned:',
  "draftLabel":             'Draft:',
  "candidatesPlainHeader":  'Catalog records:',
  "matchedBooksHeader":     'Catalog records for this title:',

  // ── Intent classification ────────────────────────────────────────────
  "intentEnumerationHeader": 'Classify the visitor question as exactly one of the following intents:',
  "intentEnumeration": [
    '  lookup-author      : the visitor named an author and wants their body of work',
    '  find-reviews       : the visitor wants opinions, reviews, or what readers think',
    '  describe-book      : the visitor named a specific existing title by name and wants a description of that exact book',
    '  recommend-similar  : the visitor wants something like a previous read',
    '  recall-memories    : the visitor asks about your own memory or history: what books you have looked up, what they have asked before, what has been recommended; any meta-question about your past activity',
    '  search             : the visitor named a topic / title / ISBN (no clear sub-case)',
    '  describe           : the visitor described a book without naming it',
    '  recommend          : the visitor asked for a good book or a good story to read without naming a title or genre (a generic recommendation)',
    '  off-topic          : the visitor asked something unrelated to books and unrelated to your memory',
  ].join('\n'),
  "intentExamplesHeader": 'Examples:',
  "intentExamples": [
    '  "do you have anything exploring the ethics of AI, maybe with a sci-fi bent?" → search',
    '  "what should I read after Project Hail Mary?" → recommend-similar',
    '  "recommend something similar to Dune" → recommend-similar',
    '  "tell me about The Sun Also Rises" → describe-book',
    '  "what did Murakami write?" → lookup-author',
    '  "anything good in cosy fantasy?" → recommend',
    '  "tell me a good story" → recommend',
    '  "what\'s a good book?" → recommend',
    '  "recommend a good read" → recommend',
    '  "what was that book I asked about last week?" → recall-memories',
    '  "use the web search tools to find me a book" → search',
    '  "search the web for books about stoicism" → search',
    '  "what time is it?" → off-topic',
    '  "what is the weather like?" → off-topic',
    '  "try again" / "another one" / "different" / "no" → REUSE THE PRIOR INTENT from recent context if any, otherwise default to `search`',
  ].join('\n'),
  "intentRules":          'Rules: prefer the most specific intent. Treat short follow-up phrases ("try again", "next", "no", "different") as continuations of the previous intent; never classify them as off-topic. If the visitor explicitly asks for tools, web search, lookups, or external sources, classify as `search`, NEVER `off-topic`. Off-topic is ONLY for queries clearly unrelated to books or reading (weather, sports scores, jokes, recipes, news). Anything book-adjacent, tool-related, or meta about the assistant is on-topic.',
  "intentResponseFormat": 'Respond with the single token only.',

  // ── Term extraction ──────────────────────────────────────────────────
  "extractTermsTask": [
    'Distill the visitor question into 2-4 catalog-searchable domain keywords.',
    'Strip filler words (do, you, have, any, tell, me, about, like, want, looking, for, please, thanks).',
    'Strip generic nouns like "book(s)", "novel(s)", "title(s)", "question(s)"; those don\'t narrow a catalog search.',
    'Normalize abbreviations: "sci-fi" → "science fiction", "AI" → "artificial intelligence".',
    'Keep proper nouns intact (author names, book titles).',
    '',
    'Examples:',
    '  "Do you have any sci-fi novels that grapple with existential questions?"',
    '    → ["existentialism", "science fiction"]',
    '  "I like robots and singularity"',
    '    → ["robots", "singularity"]',
    '  "Yea tell me about Neuromancer"',
    '    → ["Neuromancer"]',
    '  "Recommend a book by Ursula K. Le Guin about morality"',
    '    → ["Ursula K. Le Guin", "morality"]',
    '  "What books did Philip K. Dick write about androids?"',
    '    → ["Philip K. Dick", "androids"]',
  ].join('\n'),
  "jsonArrayOnly":    'Return ONLY a JSON array of strings.',

  // ── ToolInterface decision ────────────────────────────────────────────────────
  "callAllToolsForAuthor": 'For any visitor question that names an author or describes a book to find, call ALL of the available tools; do not omit any source.',
  "shortKeywordQuery":     'Use a short, keyword-only query (no surrounding quotes, no filler phrases).',

  // ── Compose-side candidate headers ───────────────────────────────────
  "candidatesHeader":              'Catalog records (cite in flowing prose; the order reflects ranking):',
  "candidatesHeaderChronological": 'Catalog records (cite in flowing prose; the order is chronological):',
  "candidatesHeaderRated":         'Catalog records (cite in flowing prose; the order reflects reader ratings):',
  "persistentMemoryHeader":        'PERSISTENT MEMORY — your own findings from earlier sessions, not the visitor\'s words (background only; cite only on explicit recall request):',
  "persistentMemoryAnchorHeader":  'PERSISTENT MEMORY — your own findings from earlier sessions, not the visitor\'s words (anchor; cite explicitly as the basis for similarity):',

  // ── Validation ───────────────────────────────────────────────────────
  "validateApprovalRule":   'Approve if the draft (a) cites a title from the catalog records and (b) reads as a polite on-topic reply.',
  "validateResponseFormat": 'Reply with the single token "yes" or "no".',

  // ── Starter / greeting / visitor-reply suggestion ────────────────────
  "starterGenrePool":       'Pick one acclaimed work or author from science fiction or philosophy at random. Examples of the genre frame: Liu Cixin\'s Three Body Problem, William Gibson\'s Neuromancer, Ursula K. Le Guin, Stanisław Lem, Ted Chiang, Jorge Luis Borges, Albert Camus, Michel Foucault, Gilles Deleuze, Ludwig Wittgenstein. Pick something in that vein but vary your selection.',
  "starterPhraseInstruction":'Phrase ONE short curious question a first-time visitor to a bookstore might ask about it.',
  "starterLengthLimit":     'The question must be under 20 words.',
  "starterReturnFormat":    'Return just the question, with no preamble, no quotation marks, and no explanation.',

  // Visitor persona: the leading system message for the bootstrap suggestion
  // calls. A `role: 'system'` message makes `BaseAdapter.#withDefaultSystemPrompt`
  // skip its default Archivist directive injection, so a weak model writes as the visitor
  // rather than echoing a librarian greeting.
  "visitorPersona":         'You are a curious visitor approaching The Archivist with book questions. Generate one short, natural visitor message as directed.',

  "greetingInstruction":    'Write ONE fresh opening greeting for a new visitor walking into the shop.',
  "greetingTone":           'The greeting must be warm, curious, and invite a book question.',
  "greetingLengthLimit":    'Keep it under 30 words.',
  "greetingReturnFormat":   'Return just the greeting, with no preamble, no quotation marks, and no explanation.',

  "visitorReplyContextLine":  'A bookshop visitor has just received this greeting from the Archivist:',
  "visitorReplyInterest":     'The visitor is interested in science fiction and philosophy.',
  "visitorReplyInstruction":  'Write ONE natural first message the visitor might send in reply.',
  "visitorReplyContent":      'The reply must be a book question or request that follows naturally from the greeting.',
  "visitorReplyLengthLimit":  'Keep it under 30 words.',
  "visitorReplyReturnFormat": 'Return just the visitor message, with no preamble, no quotation marks, and no explanation.',

  // ── ToolInterface explanation ─────────────────────────────────────────────────
  "explainToolPersona":      'You are a librarian explaining a backend tool to a curious visitor.',
  "explainToolInstruction":  'Explain in 2-3 plain-English sentences:',
  "explainToolPoint1":       '1. What the tool does',
  "explainToolPoint2":       '2. Why it matters',
  "explainToolPoint3":       '3. One concrete example use-case',
  "explainToolTone":         'Keep it warm and clear. No jargon. Under 80 words.',
  "explainToolReturnFormat": 'Return just the explanation, no preamble.',

  // ── Memory recall ────────────────────────────────────────────────────
  "memoryEmptyStatus": 'Memory status: my shelves are fresh. No books have been recorded yet this session.',

  // ── Prior memory hint ────────────────────────────────────────────────
  /**
   * Injected when any candidate in the shortlist carries
   * `notes.fromPriorMemory: true`. Instructs the model to phrase those
   * recalls as "I recall from earlier" rather than "I just searched".
   */
  "priorMemoryHint": 'Some of these books come from prior sessions where you discussed similar queries; phrase them as "I recall" or "from earlier we found" rather than "I just searched".',

  // ── Compose repair ───────────────────────────────────────────────────
  /**
   * Injected when a previous compose attempt returned raw JSON instead
   * of prose (a failure mode of weak on-device models like Gemini Nano).
   * Instructs the model to write only flowing natural language.
   */
  "repairJson": 'Write only flowing prose. Do not output JSON, code blocks, or any structured data format.',
} as const;

// ── Shared system message, composed from persona directives ────────────
// Positive imperatives only. Describe what the Archivist DOES; the model
// inhabits that frame rather than negotiating around prohibitions.
const SYSTEM = [
  directives.persona,
  directives.scope,
  directives.catalogAuthority,
  directives.speakAsLibrarian,
  directives.specialty,
  directives.declineOffTopic,
  directives.beTerse,
  directives.conversational,
  directives.citeShortlist,
  directives.groundInShortlist,
  directives.clarifyOnDoubt,
  directives.memoryAsContext,
].join(' ');

// ── Output schemas (the data contract, paired with prompts) ───────────
//
// Index-pointer schemas: the LLM emits flat integer arrays that point at
// items in the pre-numbered prompt lists. Deterministic code in
// `BaseLlmClient` materialises the full records from those pointers.
//
// This shape is dramatically faster for slow constrained-output backends
// (Gemini Nano, WebLLM) because `responseConstraint` only validates a
// short int array instead of every field of every record.
export const schemas = {
  "rankCandidates": {
    'type':                 'object',
    'description':          'Order candidates best-to-worst by 1-based index into the candidate list.',
    'additionalProperties': false,
    'properties': {
      'order': {
        'type':        'array',
        'description': 'Indices (1-based) into the candidate list above, in best-to-worst order. Each value 1 <= n <= N. No duplicates.',
        'items': {
          'type':    'integer',
          'minimum': 1,
        },
      },
    },
    'required': ['order'],
  } satisfies Record<string, unknown>,
  "decideTools": {
    'type':                 'object',
    'description':          'Pick tools by 1-based index into the numbered tool list.',
    'additionalProperties': false,
    'properties': {
      'tools': {
        'type':        'array',
        'description': 'Indices (1-based) into the numbered tool list above, in any order. Empty array means no tools.',
        'items': {
          'type':    'integer',
          'minimum': 1,
        },
      },
    },
    'required': ['tools'],
  } satisfies Record<string, unknown>,
};

// ── Prompt builders ────────────────────────────────────────────────────
/** Helpers expose only the builders; nodes never assemble prose themselves. */
export const prompts = {
  /**
   * The language-independent shared system prompt: persona, scope, catalog
   * authority, librarian voice, specialty, response style, shortlist grounding,
   * and memory-as-context rules — the whole standing frame, not just a persona
   * line. The adapter injects it as a leading system message via the
   * `BaseAdapter.systemPrompt` seam, so pipeline bodies no longer prepend it
   * inline; pass this value to the adapter constructor once and it arrives as a
   * real leading system turn on every backend.
   */
  systemPrompt(): string { return SYSTEM; },

  classifyIntent(language: string, query: string, recalledSummary?: string, conversation: readonly ConversationTurn[] = []): string {
    const contextBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : [
          '',
          `${directives.recentContextLabel} ${recalledSummary} ${directives.continuityHint}`,
        ].join('\n');
    const conversationBlock = PromptFormat.formatConversationBlock(conversation);
    const body = [
      directives.intentEnumerationHeader,
      directives.intentEnumeration,
      '',
      directives.intentExamplesHeader,
      directives.intentExamples,
      '',
      directives.intentRules,
      directives.intentResponseFormat,
      contextBlock,
      conversationBlock,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  extractTerms(language: string, query: string): string {
    const body = [
      directives.extractTermsTask,
      directives.jsonArrayOnly,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  decideTools(
    language: string,
    query: string,
    available: readonly { name: string; description: string }[],
  ): string {
    // Index-pointer schema: the LLM picks tools by 1-based index into a
    // numbered list rendered in the prompt. ToolInterface arguments are
    // synthesised deterministically by `BaseLlmClient.decideTools` from
    // `state.query` and `state.userLanguage`; the model never touches
    // arguments. Massive token savings vs the per-call adapter tools
    // channel on Nano / WebLLM.
    const toolList = available
      .map((t, i) => `  ${String(i + 1)}. ${t.name}: ${t.description}`)
      .join('\n');
    const body = [
      directives.emitJsonOnly,
      '',
      'Available tools:',
      toolList,
      '',
      `Reply with {"tools": [n, n, ...]} where each n is a tool number from the list above. Include every tool you want to call (use all that apply). Use [] for no tools.`,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  rankCandidates(language: string, query: string, candidates: readonly CandidateType[]): string {
    const rows = candidates.map((c, i) => PromptFormat.formatCandidateRow(i + 1, c)).join('\n');
    const body = [
      directives.emitJsonOnly,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      '',
      directives.candidatesPlainHeader,
      rows,
      '',
      `Reply with {"order": [n, n, n, ...]} where each n is a candidate number from the list above, ordered best to worst. No duplicates, no other fields.`,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  compose(
    language: string,
    query: string,
    shortlist: readonly CandidateType[],
    priorContext?: readonly { variant: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
    repairHint = '',
  ): string {
    const rows = shortlist.map((c, i) => PromptFormat.formatCandidateRow(i + 1, c)).join('\n');
    const contextBlock = (priorContext === undefined || priorContext.length === 0)
      ? ''
      : [
          '',
          directives.persistentMemoryHeader,
          ...priorContext.map((p) => `- [${p.variant}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;
    const conversationBlock = PromptFormat.formatConversationBlock(conversation);
    const memoryHint = PromptFormat.priorMemoryHintLine(shortlist);
    const repairLines: string[] = repairHint.length > 0
      ? [
          '',
          directives.repairJson,
          `A previous attempt returned raw JSON instead of prose. Do NOT output JSON or code blocks. Write flowing prose only. Data in plain text: ${repairHint}`,
        ]
      : [];
    const body = [
      directives.beTerse,
      directives.citeShortlist,
      ...(memoryHint.length > 0 ? [memoryHint] : []),
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      conversationBlock,
      contextBlock,
      ...repairLines,
      '',
      directives.candidatesHeader,
      rows,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  composeAuthor(
    language: string,
    query: string,
    shortlist: readonly CandidateType[],
    priorContext?: readonly { variant: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
    repairHint = '',
  ): string {
    const rows = shortlist.map((c, i) => PromptFormat.formatCandidateRow(i + 1, c)).join('\n');
    const contextBlock = (priorContext === undefined || priorContext.length === 0)
      ? ''
      : [
          '',
          directives.persistentMemoryHeader,
          ...priorContext.map((p) => `- [${p.variant}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;
    const conversationBlock = PromptFormat.formatConversationBlock(conversation);
    const memoryHintAuthor = PromptFormat.priorMemoryHintLine(shortlist);
    const repairLines: string[] = repairHint.length > 0
      ? [
          '',
          directives.repairJson,
          `A previous attempt returned raw JSON instead of prose. Do NOT output JSON or code blocks. Write flowing prose only. Data in plain text: ${repairHint}`,
        ]
      : [];
    const body = [
      directives.beTerse,
      directives.citeShortlist,
      directives.chronological,
      directives.authorSurvey,
      ...(memoryHintAuthor.length > 0 ? [memoryHintAuthor] : []),
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      conversationBlock,
      contextBlock,
      ...repairLines,
      '',
      directives.candidatesHeaderChronological,
      rows,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  composeReviews(
    language: string,
    query: string,
    shortlist: readonly CandidateType[],
    priorContext?: readonly { variant: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
    repairHint = '',
  ): string {
    const rows = shortlist.map((c, i) => PromptFormat.formatCandidateRow(i + 1, c)).join('\n');
    const contextBlock = (priorContext === undefined || priorContext.length === 0)
      ? ''
      : [
          '',
          directives.persistentMemoryHeader,
          ...priorContext.map((p) => `- [${p.variant}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;
    const conversationBlock = PromptFormat.formatConversationBlock(conversation);
    const memoryHintReviews = PromptFormat.priorMemoryHintLine(shortlist);
    const repairLines: string[] = repairHint.length > 0
      ? [
          '',
          directives.repairJson,
          `A previous attempt returned raw JSON instead of prose. Do NOT output JSON or code blocks. Write flowing prose only. Data in plain text: ${repairHint}`,
        ]
      : [];
    const body = [
      directives.beTerse,
      directives.citeShortlist,
      directives.weightRatings,
      directives.weighOpinions,
      ...(memoryHintReviews.length > 0 ? [memoryHintReviews] : []),
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      conversationBlock,
      contextBlock,
      ...repairLines,
      '',
      directives.candidatesHeaderRated,
      rows,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  describeBook(
    language: string,
    query: string,
    shortlist: readonly CandidateType[],
    priorContext?: readonly { variant: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
    repairHint = '',
  ): string {
    const rows = shortlist.map((c, i) => PromptFormat.formatCandidateRow(i + 1, c)).join('\n');
    const contextBlock = (priorContext === undefined || priorContext.length === 0)
      ? ''
      : [
          '',
          directives.persistentMemoryHeader,
          ...priorContext.map((p) => `- [${p.variant}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;
    const conversationBlock = PromptFormat.formatConversationBlock(conversation);
    const memoryHintDescribe = PromptFormat.priorMemoryHintLine(shortlist);
    const repairLines: string[] = repairHint.length > 0
      ? [
          '',
          directives.repairJson,
          `A previous attempt returned raw JSON instead of prose. Do NOT output JSON or code blocks. Write flowing prose only. Data in plain text: ${repairHint}`,
        ]
      : [];
    const body = [
      directives.describeOnly,
      directives.citeShortlist,
      directives.groundInShortlist,
      ...(memoryHintDescribe.length > 0 ? [memoryHintDescribe] : []),
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      conversationBlock,
      contextBlock,
      ...repairLines,
      '',
      directives.matchedBooksHeader,
      rows,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  composeSimilar(
    language: string,
    query: string,
    shortlist: readonly CandidateType[],
    priorContext?: readonly { variant: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
    repairHint = '',
  ): string {
    const rows = shortlist.map((c, i) => PromptFormat.formatCandidateRow(i + 1, c)).join('\n');
    const contextBlock = (priorContext === undefined || priorContext.length === 0)
      ? ''
      : [
          '',
          directives.persistentMemoryAnchorHeader,
          ...priorContext.map((p) => `- [${p.variant}] ${p.text}`),
        ].join('\n');
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;
    const conversationBlock = PromptFormat.formatConversationBlock(conversation);
    const memoryHintSimilar = PromptFormat.priorMemoryHintLine(shortlist);
    const repairLines: string[] = repairHint.length > 0
      ? [
          '',
          directives.repairJson,
          `A previous attempt returned raw JSON instead of prose. Do NOT output JSON or code blocks. Write flowing prose only. Data in plain text: ${repairHint}`,
        ]
      : [];
    const body = [
      directives.beTerse,
      directives.citeShortlist,
      directives.similarToPrior,
      ...(memoryHintSimilar.length > 0 ? [memoryHintSimilar] : []),
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      conversationBlock,
      contextBlock,
      ...repairLines,
      '',
      directives.candidatesHeader,
      rows,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  composeEmptyResponse(language: string, query: string, failureCause: string, conversation: readonly ConversationTurn[] = []): string {
    const causeBlock = failureCause.trim().length > 0
      ? `\n${directives.searchNotesLabel} ${failureCause.trim()}`
      : '';
    const conversationBlock = PromptFormat.formatConversationBlock(conversation);
    const body = [
      directives.ownTheGap,
      directives.beTerse,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      conversationBlock,
      causeBlock,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  validate(language: string, draft: string, shortlist: readonly CandidateType[]): string {
    const titles = shortlist.map((c) => c.book.identity.title).join(' | ');
    const body = [
      directives.validateApprovalRule,
      directives.validateResponseFormat,
      '',
      `${directives.shortlistedTitlesLabel} ${titles}`,
      '',
      `${directives.draftLabel} ${draft}`,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  /** System directive for the visitor-role bootstrap calls (starter query, visitor reply). */
  visitorPersona(): string { return directives.visitorPersona; },

  suggestStarterQuery(language: string): string {
    // Runs under the visitorPersona() system message, so the Archivist directive
    // directives are intentionally omitted here; starterGenrePool supplies the
    // full genre frame.
    const body = [
      directives.starterGenrePool,
      directives.starterPhraseInstruction,
      directives.starterLengthLimit,
      directives.starterReturnFormat,
    ].join(' ');
    return PromptFormat.withLanguagePreamble(language, body);
  },

  suggestGreeting(language: string): string {
    const body = [
      directives.persona,
      directives.specialty,
      directives.greetingInstruction,
      directives.greetingTone,
      directives.greetingLengthLimit,
      directives.greetingReturnFormat,
    ].join(' ');
    return PromptFormat.withLanguagePreamble(language, body);
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
    return PromptFormat.withLanguagePreamble(language, body);
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
    return PromptFormat.withLanguagePreamble(language, body);
  },

  composeMemoryRecall(
    language: string,
    query: string,
    digest: MemoryDigest,
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
  ): string {
    const continuityBlock = (recalledSummary === undefined || recalledSummary.length === 0)
      ? ''
      : `\n${directives.conversationContextLabel} ${recalledSummary}`;
    const conversationBlock = PromptFormat.formatConversationBlock(conversation);

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
      directives.recallMemories,
      directives.beTerse,
      '',
      `${directives.visitorQuestionLabel} ${query}`,
      continuityBlock,
      conversationBlock,
      '',
      digestBlock,
    ].join('\n');
    return PromptFormat.withLanguagePreamble(language, body);
  },
};

// ── Internals ──────────────────────────────────────────────────────────
/** Prompt formatting utilities: language preamble, conversation blocks, candidate rows. */
export class PromptFormat {
  /**
   * Prepend a single language directive to every prompt body. Single
   * source of truth for the language instruction so we can evolve the
   * exact phrasing in one place.
   *
   * The directive instructs the model to:
   *   • respond in the user's device language;
   *   • use that language for every natural-language field in any JSON
   *     output (descriptions, ranking reasons, draft responses);
   *   • not echo translations of the input; respond directly in the
   *     target language.
   */
  static withLanguagePreamble(language: string, body: string): string {
    const code = UserLanguage.normalize(language);
    const name = UserLanguage.displayName(code);
    const preamble = [
      `You communicate in ${name} (${code}). Every word you output, including`,
      'JSON field values that contain natural language (book descriptions, ranking',
      `reasons, draft responses), MUST be in ${name}. Do not output translations`,
      `or transliterations of the user's input. Respond directly in ${name}.`,
    ].join('\n');
    return `${preamble}\n\n${body}`;
  }

  /**
   * Returns the `priorMemoryHint` directive line when any candidate in the
   * shortlist carries `notes.fromPriorMemory: true`. Returns empty string
   * otherwise so callers can splice it directly into the prompt body array.
   */
  static priorMemoryHintLine(shortlist: readonly CandidateType[]): string {
    const hasPriorMemory = shortlist.some((c) => c.notes?.['fromPriorMemory'] === true);
    return hasPriorMemory ? directives.priorMemoryHint : '';
  }

  /** Format prior conversation turns as a terse "Conversation so far" block. */
  static formatConversationBlock(turns: readonly ConversationTurn[]): string {
    if (turns.length === 0) return '';
    // Attribute each line to its speaker explicitly. "Visitor" is the person
    // the Archivist is helping; "You" is the Archivist's own earlier words. A
    // weak model otherwise reads its own prior `archivist:` line and echoes the
    // title back as "you mentioned <title>", misattributing the source of data.
    const lines = turns
      .map((t) => (t.role === 'visitor' ? `  Visitor said: ${t.text}` : `  You (the Archivist) said: ${t.text}`))
      .join('\n');
    return `\nConversation so far (most recent last); attribute each line to its speaker:\n${lines}`;
  }

  static formatCandidateRow(n: number, c: CandidateType): string {
    const parts: string[] = [];
    parts.push(`${String(n)}. isbn=${c.book.identity.isbn}`);
    parts.push(`"${c.book.identity.title}"`);
    parts.push(`by ${c.book.identity.authors.join(', ') || '<unknown author>'}`);
    if (c.book.publication.firstPublishYear !== null) parts.push(`(${String(c.book.publication.firstPublishYear)})`);
    if (c.book.publication.subjects.length > 0) {
      parts.push(`subjects: ${c.book.publication.subjects.slice(0, 5).join(', ')}`);
    }
    if (c.book.publication.publishers.length > 0) {
      parts.push(`pub: ${c.book.publication.publishers[0]}`);
    }
    if (c.book.publication.summary !== null && c.book.publication.summary.length > 0) {
      parts.push(`summary: ${c.book.publication.summary}`);
    }
    if (c.reason !== undefined && c.reason.length > 0) {
      parts.push(`[rank-reason: ${c.reason}]`);
    }
    return parts.join(' | ');
  }
}
