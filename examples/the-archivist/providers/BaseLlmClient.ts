/**
 * BaseLlmClient: single LlmClient implementation that runs on any
 * `LlmAdapter`. The DAG's nodes call `classifyIntent`, `extractTerms`,
 * `decideTools`, `rankCandidates`, `compose`, `validate`; this class
 * translates each to a `chat(...)` round-trip on the supplied adapter.
 *
 * EVERY prompt and schema is imported from `./prompts.ts`. This file
 * never assembles natural-language directives itself; the prompts
 * module is the single source of truth, composed from small directive
 * primitives so the persona stays consistent across calls.
 */

import type { ConversationTurn, MemoryDigest } from '../ArchivistState.ts';
import type { Candidate } from '../entities/Book.ts';
import type { ClassifiedIntent, LlmClient, ScoredCandidate } from '../services.ts';

import type { LlmAdapter } from '@studnicky/dagonizer/adapter';
import { ChatRequestBuilder } from '@studnicky/dagonizer/adapter';
import type { ChatResponseMessage } from '@studnicky/dagonizer/adapter';
import type { IntentClassifier } from './IntentClassifier.ts';
import { prompts, schemas } from './prompts.ts';

// Order matters: longer / more-specific labels appear BEFORE their
// short-form siblings so a substring match never collapses
// `describe-book` to `describe`, `recommend-similar` to `recommend`,
// or `recall-memories` to any shorter token.
const VALID_INTENTS: readonly ClassifiedIntent[] = [
  'lookup-author',
  'find-reviews',
  'describe-book',
  'recommend-similar',
  'recall-memories',
  'off-topic',
  'describe',
  'recommend',
  'search',
] as const;

/**
 * Construction options for `BaseLlmClient`. `language` is the visitor's
 * device language (ISO 639-1), threaded into every prompt builder so
 * the model responds in the user's language. Defaulted to `'en'` when
 * absent so existing callers stay correct.
 *
 * `intentClassifier` is the optional vector-similarity classifier. When
 * supplied, `classifyIntent` tries the vector path first; only when the
 * top-scoring intent falls below the classifier's confidence floor does
 * it fall through to the LLM. Pass `undefined` (or omit) for
 * LLM-only classification (typically the right default in browser
 * environments where no embedder is reachable).
 */
export interface BaseLlmClientOptions {
  readonly language?: string;
  readonly intentClassifier?: IntentClassifier;
}

export class BaseLlmClient implements LlmClient {
  readonly adapter: LlmAdapter;
  /** Visitor device language; passed to every prompt builder. */
  readonly language: string;
  /** Optional vector-similarity classifier; null when not configured. */
  readonly intentClassifier: IntentClassifier | null;

  get id():          string { return this.adapter.id; }
  get displayName(): string { return this.adapter.displayName; }

  constructor(adapter: LlmAdapter, options: BaseLlmClientOptions = {}) {
    this.adapter  = adapter;
    this.language = options.language !== undefined && options.language.length > 0
      ? options.language
      : 'en';
    this.intentClassifier = options.intentClassifier ?? null;
  }

  async classifyIntent(query: string, recalledSummary?: string, conversation: readonly ConversationTurn[] = [], signal?: AbortSignal): Promise<ClassifiedIntent> {
    if (this.intentClassifier !== null) {
      const fromVector = await this.intentClassifier.classify(query);
      if (fromVector !== null) return fromVector.intent;
    }
    const raw = (await this.#text(prompts.classifyIntent(this.language, query, recalledSummary, conversation), signal)).toLowerCase();
    const found = VALID_INTENTS.find((intent) => raw.includes(intent));
    return found ?? 'search';
  }

  async extractTerms(query: string, signal?: AbortSignal): Promise<readonly string[]> {
    const raw = (await this.#text(prompts.extractTerms(this.language, query), signal)).trim();
    try {
      const arr: unknown = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
      if (Array.isArray(arr)) {
        return arr.filter((s): s is string => typeof s === 'string').slice(0, 6);
      }
    } catch { /* fallthrough */ }
    return raw.split(/[,\n]/u).map((s) => s.trim().replace(/^["']|["']$/gu, '')).filter(Boolean).slice(0, 6);
  }

  async decideTools(
    query: string,
    available: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[],
    signal?: AbortSignal,
  ): Promise<readonly { name: string; arguments: Record<string, unknown> }[]> {
    if (available.length === 0) return [];
    // Index-pointer schema: the LLM emits `{tools: [1, 3, ...]}` only.
    // Token-economy win for slow constrained-output backends (Nano, WebLLM).
    const request = ChatRequestBuilder.from({
      'messages':     [{ 'role': 'user', 'content': prompts.decideTools(this.language, query, available) }],
      'outputSchema': { 'kind': 'schema', 'schema': schemas.decideTools, 'id': 'archivist-decide-tools-v1' },
      'temperature':  0.1,
      'maxTokens':    256,
      ...(signal !== undefined ? { 'signal': signal } : {}),
    });
    const response = await this.adapter.chat(request);
    const raw = BaseLlmClient.contentOf(response.message);
    let indices: readonly number[] = [];
    try {
      const start = raw.indexOf('{');
      const end   = raw.lastIndexOf('}');
      if (start >= 0 && end >= 0) {
        const parsed = JSON.parse(raw.slice(start, end + 1)) as { tools?: readonly unknown[] };
        if (Array.isArray(parsed.tools)) {
          indices = parsed.tools.filter((n): n is number => typeof n === 'number' && Number.isInteger(n));
        }
      }
    } catch { /* fall through with empty indices */ }
    // Dedupe + bounds-check; materialise arguments deterministically.
    const seen = new Set<number>();
    const calls: { name: string; arguments: Record<string, unknown> }[] = [];
    for (const n of indices) {
      if (n < 1 || n > available.length || seen.has(n)) continue;
      seen.add(n);
      const tool = available[n - 1];
      if (tool === undefined) continue;
      calls.push({ 'name': tool.name, 'arguments': BaseLlmClient.defaultToolArguments(tool.name, query, this.language) });
    }
    return calls;
  }

  async rankCandidates(query: string, candidates: readonly Candidate[], signal?: AbortSignal): Promise<readonly ScoredCandidate[]> {
    if (candidates.length === 0) return [];
    const request = ChatRequestBuilder.from({
      'messages':     [{ 'role': 'user', 'content': prompts.rankCandidates(this.language, query, candidates) }],
      'outputSchema': { 'kind': 'schema', 'schema': schemas.rankCandidates, 'id': 'archivist-rank-v1' },
      'temperature':  0.1,
      'maxTokens':    256,
      ...(signal !== undefined ? { 'signal': signal } : {}),
    });
    const response = await this.adapter.chat(request);
    const raw = BaseLlmClient.contentOf(response.message);
    let order: readonly number[] = [];
    try {
      const start = raw.indexOf('{');
      const end   = raw.lastIndexOf('}');
      if (start >= 0 && end >= 0) {
        const parsed = JSON.parse(raw.slice(start, end + 1)) as { order?: readonly unknown[] };
        if (Array.isArray(parsed.order)) {
          order = parsed.order.filter((n): n is number => typeof n === 'number' && Number.isInteger(n));
        }
      }
    } catch { /* fall through with empty order */ }
    // Walk the order: assign synthetic linear-decay scores.
    // 1 - (rank/N) → top item gets ~1.0, last gets ~0.
    const total = candidates.length;
    const seen = new Set<number>();
    const scored = new Map<number, number>(); // candidate index → score
    let rank = 0;
    for (const n of order) {
      if (n < 1 || n > total || seen.has(n)) continue;
      seen.add(n);
      const score = total > 1 ? 1 - (rank / (total - 1)) : 1;
      scored.set(n - 1, score);
      rank += 1;
    }
    // Build the ScoredCandidate[] in the original candidates order; the
    // node sorts the list descending so unmentioned items (score 0)
    // sink to the bottom.
    return candidates.map<ScoredCandidate>((candidate, idx) => {
      const score = scored.get(idx) ?? 0;
      return { candidate, score };
    });
  }

  async compose(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
    signal?: AbortSignal,
  ): Promise<string> {
    return (await this.#text(prompts.compose(this.language, query, shortlist, priorContext, recalledSummary, conversation), signal)).trim();
  }

  async composeAuthor(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
    signal?: AbortSignal,
  ): Promise<string> {
    return (await this.#text(prompts.composeAuthor(this.language, query, shortlist, priorContext, recalledSummary, conversation), signal)).trim();
  }

  async composeReviews(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
    signal?: AbortSignal,
  ): Promise<string> {
    return (await this.#text(prompts.composeReviews(this.language, query, shortlist, priorContext, recalledSummary, conversation), signal)).trim();
  }

  async describeBook(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
    signal?: AbortSignal,
  ): Promise<string> {
    return (await this.#text(prompts.describeBook(this.language, query, shortlist, priorContext, recalledSummary, conversation), signal)).trim();
  }

  async composeSimilar(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
    signal?: AbortSignal,
  ): Promise<string> {
    return (await this.#text(prompts.composeSimilar(this.language, query, shortlist, priorContext, recalledSummary, conversation), signal)).trim();
  }

  async validate(draft: string, shortlist: readonly Candidate[]): Promise<boolean> {
    const raw = (await this.#text(prompts.validate(this.language, draft, shortlist))).trim().toLowerCase();
    return raw.startsWith('yes');
  }

  async composeMemoryRecall(
    query: string,
    digest: MemoryDigest,
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
    signal?: AbortSignal,
  ): Promise<string> {
    return (await this.#text(prompts.composeMemoryRecall(this.language, query, digest, recalledSummary, conversation), signal)).trim();
  }

  async composeEmptyResponse(query: string, failureCause: string, conversation: readonly ConversationTurn[] = [], signal?: AbortSignal): Promise<string> {
    return (await this.#text(prompts.composeEmptyResponse(this.language, query, failureCause, conversation), signal)).trim();
  }

  async suggestStarterQuery(): Promise<string> {
    return (await this.#text(prompts.suggestStarterQuery(this.language))).trim();
  }

  async suggestGreeting(): Promise<string> {
    return (await this.#text(prompts.suggestGreeting(this.language))).trim();
  }

  async suggestVisitorReplyTo(greeting: string): Promise<string> {
    return (await this.#text(prompts.suggestVisitorReplyTo(this.language, greeting))).trim();
  }

  async explainTool(name: string, context: string): Promise<string> {
    return (await this.#text(prompts.explainTool(this.language, name, context))).trim();
  }

  async #text(prompt: string, signal?: AbortSignal): Promise<string> {
    const response = await this.adapter.chat(ChatRequestBuilder.from({
      'messages':    [{ 'role': 'user', 'content': prompt }],
      'temperature': 0.2,
      'maxTokens':   512,
      ...(signal !== undefined ? { 'signal': signal } : {}),
    }));
    return BaseLlmClient.contentOf(response.message);
  }

  /** Discriminated-union accessor for the ChatResponse.message shape. */
  private static contentOf(msg: ChatResponseMessage): string {
    return msg.kind === 'tools' ? '' : msg.content;
  }

  /**
   * Deterministic argument defaults for known scout tool names.
   * `decideTools` only emits indices now; argument generation lives here.
   *
   * The `query` / `subject` field is intentionally omitted: every scout
   * already falls back to `state.terms.join(' ')` when its query arg is
   * missing, and `state.terms` is the keyword set produced by the
   * `extract-query` node (which ran before `decide-tools` in the DAG).
   * Letting scouts use the extracted terms instead of the raw visitor
   * sentence means OpenLibrary / Google Books / Subject Search receive
   * proper keyword queries, not prose questions.
   */
  private static defaultToolArguments(name: string, _query: string, language: string): Record<string, unknown> {
    switch (name) {
      case 'web_search_books':
        return { 'limit': 8, 'lang': language };
      case 'google_books_search':
        return { 'maxResults': 8, 'langRestrict': language };
      case 'subject_search':
        return { 'limit': 8, 'lang': language };
      case 'wikipedia_summary':
        return { 'lang': language };
      default:
        return {};
    }
  }
}
