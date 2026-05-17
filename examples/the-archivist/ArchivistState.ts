/**
 * ArchivistState — the clipboard the Archivist's nodes mutate.
 *
 * Carries the visitor's question, the parsed intent, scout candidates,
 * the merged shortlist, the draft response, and per-execution counters.
 * Extends `NodeStateBase` so the dispatcher owns the lifecycle FSM and
 * `snapshot()` round-trips for `Checkpoint.from` / `Checkpoint.restore`.
 */

import type { Candidate } from './entities/Book.ts';

import { NodeStateBase } from '@noocodex/dagonizer';
import type { JsonObject } from '@noocodex/dagonizer/types';


/**
 * Prior-context facts recalled from the memory graph before classification.
 * `summary` is an LLM-ready 1–2 sentence hint; the structured arrays are
 * available directly on `state.recalledContext` for downstream nodes.
 */
export interface RecalledContext {
  /** Intents the classifier returned for similar prior queries. */
  readonly priorIntents: ReadonlyArray<{
    readonly query: string;
    readonly intent: string;
    readonly ts: string;
  }>;
  /** Books seen in recent state graphs (shortlisted candidates). */
  readonly recentCandidates: ReadonlyArray<Candidate>;
  /** Prior queries that overlap with the current query text. */
  readonly similarPriorQueries: ReadonlyArray<{
    readonly query: string;
    readonly ts: string;
  }>;
  /** 1–2 sentence LLM-ready hint; empty string when nothing was recalled. */
  readonly summary: string;
}

/** What the visitor asked the Archivist to do. */
export type ArchivistIntent =
  | 'lookup-author'      // visitor named an author and wants their body of work
  | 'find-reviews'       // visitor wants opinions / reviews / what readers think
  | 'describe-book'      // visitor named a specific title and wants a description
  | 'recommend-similar'  // visitor wants something like a previous read
  | 'search'             // visitor named a title / author / ISBN (generic search)
  | 'describe'           // visitor described a book without naming it
  | 'recommend'          // visitor asked for a generic recommendation
  | 'off-topic';         // visitor wandered — terminate politely

export class ArchivistState extends NodeStateBase {
  /** Raw question the visitor submitted. */
  query = '';
  /** Parsed intent — set by `classifyIntent`. */
  intent: ArchivistIntent = 'search';
  /** Structured query terms — set by `extractQuery`. */
  terms: readonly string[] = [];
  /** Candidates returned by each scout — partitioned by source. */
  candidates: readonly Candidate[] = [];
  /** Final shortlist after merge + dedupe + rank. */
  shortlist: readonly Candidate[] = [];
  /** The Archivist's draft response. */
  draft = '';
  /** Validation outcome. `null` if not yet validated. */
  approved: boolean | null = null;
  /** Compose retry counter — `RetryPolicy` reads `attempts.compose`. */
  attempts: Record<string, number> = {};
  /**
   * Tool plan emitted by the LLM via `decideTools`. The DAG inspects
   * this to gate the optional scouts (web search runs only when the
   * LLM asked for it). Empty = no tools needed.
   */
  toolPlan: ReadonlyArray<{ readonly name: string; readonly arguments: Record<string, unknown> }> = [];
  /**
   * Per-run identifier. Used to subject every triple we write so the
   * recall node can `SELECT` other runs' facts without re-reading the
   * current run's findings.
   */
  runId: string = '';
  /**
   * Prior-context facts the recall node SELECTs out of memory before
   * compose. Each entry has a `kind` (e.g. 'prior-query',
   * 'prior-recommendation') and free-text content the LLM can cite.
   */
  priorContext: ReadonlyArray<{ readonly kind: string; readonly text: string }> = [];
  /**
   * Structured context recalled from the unified memory graph by
   * `recallContext` (runs before `classifyIntent`). The `summary` field
   * is injected into the classifier prompt; all fields are available to
   * downstream nodes (decideTools, composeResponse).
   */
  recalledContext: RecalledContext = {
    'priorIntents':        [],
    'recentCandidates':    [],
    'similarPriorQueries': [],
    'summary':             '',
  };

  override clone(): ArchivistState {
    const copy = new ArchivistState();
    copy.query      = this.query;
    copy.intent     = this.intent;
    copy.terms      = [...this.terms];
    copy.candidates = [...this.candidates];
    copy.shortlist  = [...this.shortlist];
    copy.draft      = this.draft;
    copy.approved   = this.approved;
    copy.attempts     = { ...this.attempts };
    copy.toolPlan     = [...this.toolPlan];
    copy.runId        = this.runId;
    copy.priorContext = [...this.priorContext];
    copy.recalledContext = {
      'priorIntents':        [...this.recalledContext.priorIntents],
      'recentCandidates':    [...this.recalledContext.recentCandidates],
      'similarPriorQueries': [...this.recalledContext.similarPriorQueries],
      'summary':             this.recalledContext.summary,
    };
    return copy;
  }

  protected override snapshotData(): JsonObject {
    return {
      "query":      this.query,
      "intent":     this.intent,
      "terms":      [...this.terms],
      "candidates": this.candidates.map((candidate) => ({
        "book":   { ...candidate.book, "authors": [...candidate.book.authors] },
        "score":  candidate.score,
        "source": candidate.source,
      })) as unknown as JsonObject[],
      "shortlist":  this.shortlist.map((candidate) => ({
        "book":   { ...candidate.book, "authors": [...candidate.book.authors] },
        "score":  candidate.score,
        "source": candidate.source,
      })) as unknown as JsonObject[],
      "draft":      this.draft,
      "approved":   this.approved,
      "attempts":   { ...this.attempts },
      "recalledContext": {
        "priorIntents":        this.recalledContext.priorIntents as unknown as JsonObject[],
        "recentCandidates":    this.recalledContext.recentCandidates.map((c) => ({
          "book":   { ...c.book, "authors": [...c.book.authors] },
          "score":  c.score,
          "source": c.source,
        })) as unknown as JsonObject[],
        "similarPriorQueries": this.recalledContext.similarPriorQueries as unknown as JsonObject[],
        "summary":             this.recalledContext.summary,
      },
    };
  }

  protected override restoreData(snap: JsonObject): void {
    if (typeof snap['query']  === 'string')  this.query  = snap['query'];
    if (typeof snap['intent'] === 'string')  this.intent = snap['intent'] as ArchivistIntent;
    if (typeof snap['draft']  === 'string')  this.draft  = snap['draft'];
    if (typeof snap['approved'] === 'boolean') this.approved = snap['approved'];
    if (Array.isArray(snap['terms']))      this.terms      = snap['terms'] as string[];
    if (Array.isArray(snap['candidates'])) this.candidates = snap['candidates'] as unknown as Candidate[];
    if (Array.isArray(snap['shortlist']))  this.shortlist  = snap['shortlist'] as unknown as Candidate[];
    if (snap['attempts'] && typeof snap['attempts'] === 'object') {
      this.attempts = { ...snap['attempts'] as Record<string, number> };
    }
    const rc = snap['recalledContext'];
    if (rc !== null && rc !== undefined && typeof rc === 'object' && !Array.isArray(rc)) {
      const rcObj = rc as Record<string, unknown>;
      this.recalledContext = {
        'priorIntents':        Array.isArray(rcObj['priorIntents'])        ? rcObj['priorIntents'] as RecalledContext['priorIntents']        : [],
        'recentCandidates':    Array.isArray(rcObj['recentCandidates'])    ? rcObj['recentCandidates'] as RecalledContext['recentCandidates'] : [],
        'similarPriorQueries': Array.isArray(rcObj['similarPriorQueries']) ? rcObj['similarPriorQueries'] as RecalledContext['similarPriorQueries'] : [],
        'summary':             typeof rcObj['summary'] === 'string'        ? rcObj['summary']  : '',
      };
    }
  }
}
