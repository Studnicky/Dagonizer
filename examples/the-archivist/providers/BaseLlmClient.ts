/**
 * BaseLlmClient — single LlmClient implementation that runs on any
 * `LlmAdapter`. The DAG's nodes call `classifyIntent`, `extractTerms`,
 * `decideTools`, `rankCandidates`, `compose`, `validate`; this class
 * translates each to a `chat(...)` round-trip on the supplied adapter.
 *
 * EVERY prompt and schema is imported from `./prompts.ts`. This file
 * never assembles natural-language directives itself — the prompts
 * module is the single source of truth, composed from small directive
 * primitives so the persona stays consistent across calls.
 */

import type { ConversationTurn, MemoryDigest } from '../ArchivistState.ts';
import type { Candidate } from '../entities/Book.ts';
import type { ClassifiedIntent, LlmClient, ScoredCandidate } from '../services.ts';

import type { LlmAdapter, ToolDefinition } from '@noocodex/dagonizer/adapter';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';
import type { ChatResponseMessage } from '@noocodex/dagonizer/adapter';
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
 * device language (ISO 639-1) — threaded into every prompt builder so
 * the model responds in the user's language. Defaulted to `'en'` when
 * absent so existing callers stay correct.
 *
 * `intentClassifier` is the optional vector-similarity classifier. When
 * supplied, `classifyIntent` tries the vector path first; only when the
 * top-scoring intent falls below the classifier's confidence floor does
 * it fall through to the LLM. Pass `undefined` (or omit) to keep the
 * legacy LLM-only behaviour — typically the right default in browser
 * environments where no embedder is reachable.
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

  async classifyIntent(query: string, recalledSummary?: string, conversation: readonly ConversationTurn[] = []): Promise<ClassifiedIntent> {
    if (this.intentClassifier !== null) {
      const fromVector = await this.intentClassifier.classify(query);
      if (fromVector !== null) return fromVector.intent;
    }
    const raw = (await this.#text(prompts.classifyIntent(this.language, query, recalledSummary, conversation))).toLowerCase();
    const found = VALID_INTENTS.find((intent) => raw.includes(intent));
    return found ?? 'search';
  }

  async extractTerms(query: string): Promise<readonly string[]> {
    const raw = (await this.#text(prompts.extractTerms(this.language, query))).trim();
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
  ): Promise<readonly { name: string; arguments: Record<string, unknown> }[]> {
    if (available.length === 0) return [];
    const request = ChatRequestBuilder.from({
      'messages': [{ 'role': 'user', 'content': prompts.decideTools(this.language, query), 'toolCallId': '', 'toolName': '' }],
      'tools':      available as readonly ToolDefinition[],
      'toolChoice': { 'type': 'auto' },
      'temperature': 0.1,
      'maxTokens':   512,
    });
    const response = await this.adapter.chat(request);
    return toolCallsOf(response.message).map((c) => ({ 'name': c.name, 'arguments': c.arguments }));
  }

  async rankCandidates(query: string, candidates: readonly Candidate[], signal?: AbortSignal): Promise<readonly ScoredCandidate[]> {
    if (candidates.length === 0) return [];
    const request = ChatRequestBuilder.from({
      'messages':     [{ 'role': 'user', 'content': prompts.rankCandidates(this.language, query, candidates), 'toolCallId': '', 'toolName': '' }],
      'outputSchema': { 'kind': 'schema', 'schema': schemas.rankCandidates, 'id': 'archivist-rank-v1' },
      'temperature':  0.1,
      'maxTokens':    1024,
      'signal':       signal,
    });
    const response = await this.adapter.chat(request);
    const raw = contentOf(response.message);
    type Ranking = { isbn?: string; score?: number; reason?: string } & Record<string, unknown>;
    let rankings: readonly Ranking[] = [];
    try {
      const start = raw.indexOf('{');
      const end   = raw.lastIndexOf('}');
      if (start >= 0 && end >= 0) {
        const parsed = JSON.parse(raw.slice(start, end + 1)) as { rankings?: readonly Ranking[] };
        rankings = parsed.rankings ?? [];
      }
    } catch { /* zero-score fallback */ }
    interface Entry { readonly score: number; readonly reason?: string; readonly notes?: Record<string, unknown> }
    const byIsbn = new Map<string, Entry>();
    for (const r of rankings) {
      if (typeof r.isbn !== 'string' || typeof r.score !== 'number') continue;
      const score = Math.min(1, Math.max(0, r.score));
      // additionalProperties land as freeform `notes` (vibe / themes / confidence / etc).
      const notes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === 'isbn' || k === 'score' || k === 'reason') continue;
        notes[k] = v;
      }
      const entry: Entry = {
        score,
        ...(typeof r.reason === 'string' ? { 'reason': r.reason } : {}),
        ...(Object.keys(notes).length > 0 ? { notes } : {}),
      };
      byIsbn.set(r.isbn, entry);
    }
    return candidates.map<ScoredCandidate>((candidate) => {
      const found = byIsbn.get(candidate.book.isbn);
      if (found === undefined) return { candidate, 'score': 0 };
      return {
        candidate,
        'score': found.score,
        ...(found.reason !== undefined ? { 'reason': found.reason } : {}),
        ...(found.notes  !== undefined ? { 'notes':  found.notes  } : {}),
      };
    });
  }

  async compose(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
  ): Promise<string> {
    return (await this.#text(prompts.compose(this.language, query, shortlist, priorContext, recalledSummary, conversation))).trim();
  }

  async composeAuthor(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
  ): Promise<string> {
    return (await this.#text(prompts.composeAuthor(this.language, query, shortlist, priorContext, recalledSummary, conversation))).trim();
  }

  async composeReviews(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
  ): Promise<string> {
    return (await this.#text(prompts.composeReviews(this.language, query, shortlist, priorContext, recalledSummary, conversation))).trim();
  }

  async describeBook(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
  ): Promise<string> {
    return (await this.#text(prompts.describeBook(this.language, query, shortlist, priorContext, recalledSummary, conversation))).trim();
  }

  async composeSimilar(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation: readonly ConversationTurn[] = [],
  ): Promise<string> {
    return (await this.#text(prompts.composeSimilar(this.language, query, shortlist, priorContext, recalledSummary, conversation))).trim();
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
  ): Promise<string> {
    return (await this.#text(prompts.composeMemoryRecall(this.language, query, digest, recalledSummary, conversation))).trim();
  }

  async composeEmptyResponse(query: string, failureCause: string, conversation: readonly ConversationTurn[] = []): Promise<string> {
    return (await this.#text(prompts.composeEmptyResponse(this.language, query, failureCause, conversation))).trim();
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

  async #text(prompt: string): Promise<string> {
    const response = await this.adapter.chat(ChatRequestBuilder.from({
      'messages':    [{ 'role': 'user', 'content': prompt, 'toolCallId': '', 'toolName': '' }],
      'temperature': 0.2,
      'maxTokens':   512,
    }));
    return contentOf(response.message);
  }
}

/** Discriminated-union accessors for the new ChatResponse.message shape. */
function contentOf(msg: ChatResponseMessage): string {
  return msg.kind === 'tools' ? '' : msg.content;
}

function toolCallsOf(msg: ChatResponseMessage): readonly { name: string; arguments: Record<string, unknown> }[] {
  return msg.kind === 'text' ? [] : msg.toolCalls;
}
