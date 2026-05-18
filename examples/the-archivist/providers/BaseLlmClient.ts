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

import type { MemoryDigest } from '../ArchivistState.ts';
import type { Candidate } from '../entities/Book.ts';
import type { ClassifiedIntent, LlmClient, ScoredCandidate } from '../services.ts';

import type { ChatRequest, LlmAdapter, ToolDefinition } from './adapters/LlmAdapter.ts';
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

export class BaseLlmClient implements LlmClient {
  readonly adapter: LlmAdapter;

  get id():          string { return this.adapter.id; }
  get displayName(): string { return this.adapter.displayName; }

  constructor(adapter: LlmAdapter) {
    this.adapter = adapter;
  }

  async classifyIntent(query: string, recalledSummary?: string): Promise<ClassifiedIntent> {
    const raw = (await this.#text(prompts.classifyIntent(query, recalledSummary))).toLowerCase();
    const found = VALID_INTENTS.find((intent) => raw.includes(intent));
    return found ?? 'search';
  }

  async extractTerms(query: string): Promise<readonly string[]> {
    const raw = (await this.#text(prompts.extractTerms(query))).trim();
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
    const request: ChatRequest = {
      'messages': [{ 'role': 'user', 'content': prompts.decideTools(query) }],
      'tools':      available as readonly ToolDefinition[],
      'toolChoice': { 'type': 'auto' },
      'temperature': 0.1,
      'maxTokens':   512,
    };
    const response = await this.adapter.chat(request);
    return (response.message.toolCalls ?? []).map((c) => ({ 'name': c.name, 'arguments': c.arguments }));
  }

  async rankCandidates(query: string, candidates: readonly Candidate[]): Promise<readonly ScoredCandidate[]> {
    if (candidates.length === 0) return [];
    const request: ChatRequest = {
      'messages':     [{ 'role': 'user', 'content': prompts.rankCandidates(query, candidates) }],
      'outputSchema': { 'schema': schemas.rankCandidates, 'id': 'archivist-rank-v1' },
      'temperature':  0.1,
      'maxTokens':    1024,
    };
    const response = await this.adapter.chat(request);
    const raw = response.message.content ?? '';
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
  ): Promise<string> {
    return (await this.#text(prompts.compose(query, shortlist, priorContext, recalledSummary))).trim();
  }

  async composeAuthor(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
  ): Promise<string> {
    return (await this.#text(prompts.composeAuthor(query, shortlist, priorContext, recalledSummary))).trim();
  }

  async composeReviews(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
  ): Promise<string> {
    return (await this.#text(prompts.composeReviews(query, shortlist, priorContext, recalledSummary))).trim();
  }

  async describeBook(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
  ): Promise<string> {
    return (await this.#text(prompts.describeBook(query, shortlist, priorContext, recalledSummary))).trim();
  }

  async composeSimilar(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
  ): Promise<string> {
    return (await this.#text(prompts.composeSimilar(query, shortlist, priorContext, recalledSummary))).trim();
  }

  async validate(draft: string, shortlist: readonly Candidate[]): Promise<boolean> {
    const raw = (await this.#text(prompts.validate(draft, shortlist))).trim().toLowerCase();
    return raw.startsWith('yes');
  }

  async composeMemoryRecall(
    query: string,
    digest: MemoryDigest,
    recalledSummary?: string,
  ): Promise<string> {
    return (await this.#text(prompts.composeMemoryRecall(query, digest, recalledSummary))).trim();
  }

  async composeEmptyResponse(query: string, failureCause: string): Promise<string> {
    return (await this.#text(prompts.composeEmptyResponse(query, failureCause))).trim();
  }

  async #text(prompt: string): Promise<string> {
    const response = await this.adapter.chat({
      'messages':    [{ 'role': 'user', 'content': prompt }],
      'temperature': 0.2,
      'maxTokens':   512,
    });
    return response.message.content ?? '';
  }
}
