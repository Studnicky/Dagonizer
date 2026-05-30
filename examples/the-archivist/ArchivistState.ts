/**
 * ArchivistState: the clipboard the Archivist's nodes mutate.
 *
 * Carries the visitor's question, the parsed intent, scout candidates,
 * the merged shortlist, the draft response, and per-execution counters.
 * Extends `NodeStateBase` so the dispatcher owns the lifecycle FSM and
 * `snapshot()` round-trips for `Checkpoint.capture` / `ckpt.restoreState`.
 */

import type { Candidate } from './entities/Book.ts';

import { NodeStateBase } from '@noocodex/dagonizer';
import type { JsonObject } from '@noocodex/dagonizer/types';

/**
 * A single turn in the visitor–archivist conversation.
 * Stored on `ArchivistState.conversation` and injected into LLM prompts
 * so the model can resolve pronouns and follow-ups across turns.
 */
export interface ConversationTurn {
  readonly role: 'visitor' | 'archivist';
  readonly text: string;
  readonly ts: number;
}


/**
 * A roll-up of everything the Archivist has accumulated in its memory
 * store across all prior runs, produced by `recallMemories` and consumed
 * by `composeMemoryResponse`.
 */
export interface MemoryDigest {
  /** Total distinct books recorded across all runs. */
  readonly bookCount: number;
  /** Total visitor queries issued across all runs. */
  readonly queryCount: number;
  /** Up to the last 10 distinct shortlisted books (most-recent first). */
  readonly recentBooks: ReadonlyArray<{ readonly title: string; readonly author?: string }>;
  /** Intent distribution: how many times each intent was classified. */
  readonly intentBreakdown: ReadonlyArray<{ readonly intent: string; readonly count: number }>;
  /** 1–2 sentence LLM-ready summary of the digest. */
  readonly summary: string;
}

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
  | 'recall-memories'    // visitor asked what the agent has seen / remembered
  | 'search'             // visitor named a title / author / ISBN (generic search)
  | 'describe'           // visitor described a book without naming it
  | 'recommend'          // visitor asked for a generic recommendation
  | 'off-topic';         // visitor wandered: not a book query and not memory-related

export class ArchivistState extends NodeStateBase {
  /** Raw question the visitor submitted. */
  query = '';
  /**
   * Visitor's device language as an ISO 639-1 code (e.g. `'en'`,
   * `'ja'`). Drives every LLM prompt's response-language directive
   * and the language filter scouts apply to upstream results. Set by
   * the entrypoint from `UserLanguage.detect()` (or a URL override);
   * defaulted to `'en'` so existing call sites stay correct.
   */
  userLanguage: string = 'en';
  /** Parsed intent; set by `classifyIntent`. */
  intent: ArchivistIntent = 'search';
  /** Structured query terms; set by `extractQuery`. */
  terms: readonly string[] = [];
  /** Candidates returned by each scout, partitioned by source. */
  candidates: readonly Candidate[] = [];
  /** Final shortlist after merge + dedupe + rank. */
  shortlist: readonly Candidate[] = [];
  /** The Archivist's draft response. */
  draft = '';
  /** Validation outcome. `null` if not yet validated. */
  approved: boolean | null = null;
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
   * Sanitized one-liner description of why the search produced no
   * results. Accumulated by scouts and gate nodes; consumed by
   * `composeEmptyResponse` to craft an in-character failure message.
   * Empty string when no failure has been recorded.
   */
  failureCause = '';
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
  /**
   * The N most recent turns of the conversation (visitor + archivist),
   * sliced from the runner's display buffer and injected here before each
   * run. The runner controls the window size; nodes read this to thread
   * prior context into LLM prompts for pronoun resolution and continuity.
   * Always initialised to `[]`; never undefined (V8 shape stability).
   */
  conversation: readonly ConversationTurn[] = [];
  /**
   * Prior shortlisted candidates loaded from memory by `recallContext`
   * (cap 5, low Jaccard) and overridden by `recallCandidates` inside the
   * `book-search-scatter` embedded-DAG (cap 10, Jaccard >= 0.35).
   * `mergeCandidates` falls back to this pool when live scouts return zero.
   * Always initialized; never undefined (V8 shape stability).
   */
  priorCandidates: readonly Candidate[] = [];
  /**
   * Memory roll-up produced by `recallMemories` for the `recall-memories`
   * intent. Empty/zero-valued when the intent is not `recall-memories`.
   */
  memoryDigest: MemoryDigest = {
    'bookCount':       0,
    'queryCount':      0,
    'recentBooks':     [],
    'intentBreakdown': [],
    'summary':         '',
  };

  override clone(): ArchivistState {
    const copy = new ArchivistState();
    copy.query        = this.query;
    copy.userLanguage = this.userLanguage;
    copy.intent       = this.intent;
    copy.terms      = [...this.terms];
    copy.candidates = [...this.candidates];
    copy.shortlist  = [...this.shortlist];
    copy.draft      = this.draft;
    copy.approved   = this.approved;
    copy.toolPlan     = [...this.toolPlan];
    copy.runId        = this.runId;
    copy.failureCause = this.failureCause;
    copy.priorContext = [...this.priorContext];
    copy.recalledContext = {
      'priorIntents':        [...this.recalledContext.priorIntents],
      'recentCandidates':    [...this.recalledContext.recentCandidates],
      'similarPriorQueries': [...this.recalledContext.similarPriorQueries],
      'summary':             this.recalledContext.summary,
    };
    copy.conversation      = [...this.conversation];
    copy.priorCandidates   = [...this.priorCandidates];
    copy.memoryDigest = {
      'bookCount':       this.memoryDigest.bookCount,
      'queryCount':      this.memoryDigest.queryCount,
      'recentBooks':     [...this.memoryDigest.recentBooks],
      'intentBreakdown': [...this.memoryDigest.intentBreakdown],
      'summary':         this.memoryDigest.summary,
    };
    return copy;
  }

  // #region snapshot-restore
  protected override snapshotData(): JsonObject {
    return {
      "query":        this.query,
      "userLanguage": this.userLanguage,
      "intent":       this.intent,
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
      "draft":        this.draft,
      "approved":     this.approved,
      "failureCause": this.failureCause,
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
      "priorCandidates": this.priorCandidates.map((candidate) => ({
        "book":   { ...candidate.book, "authors": [...candidate.book.authors] },
        "score":  candidate.score,
        "source": candidate.source,
        "notes":  candidate.notes ?? {},
      })) as unknown as JsonObject[],
      "conversation": this.conversation as unknown as JsonObject[],
      "memoryDigest": {
        "bookCount":       this.memoryDigest.bookCount,
        "queryCount":      this.memoryDigest.queryCount,
        "recentBooks":     this.memoryDigest.recentBooks as unknown as JsonObject[],
        "intentBreakdown": this.memoryDigest.intentBreakdown as unknown as JsonObject[],
        "summary":         this.memoryDigest.summary,
      },
    };
  }

  protected override restoreData(snap: JsonObject): void {
    if (typeof snap['query']        === 'string') this.query        = snap['query'];
    if (typeof snap['userLanguage'] === 'string') this.userLanguage = snap['userLanguage'];
    if (typeof snap['intent']       === 'string') this.intent       = snap['intent'] as ArchivistIntent;
    if (typeof snap['draft']        === 'string')  this.draft  = snap['draft'];
    if (typeof snap['approved']    === 'boolean') this.approved = snap['approved'];
    if (typeof snap['failureCause'] === 'string') this.failureCause = snap['failureCause'];
    if (Array.isArray(snap['terms']))      this.terms      = snap['terms'] as string[];
    if (Array.isArray(snap['candidates'])) this.candidates = snap['candidates'] as unknown as Candidate[];
    if (Array.isArray(snap['shortlist']))  this.shortlist  = snap['shortlist'] as unknown as Candidate[];
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
    if (Array.isArray(snap['priorCandidates'])) {
      this.priorCandidates = snap['priorCandidates'] as unknown as Candidate[];
    }
    if (Array.isArray(snap['conversation'])) {
      this.conversation = snap['conversation'] as unknown as ConversationTurn[];
    }
    const md = snap['memoryDigest'];
    if (md !== null && md !== undefined && typeof md === 'object' && !Array.isArray(md)) {
      const mdObj = md as Record<string, unknown>;
      this.memoryDigest = {
        'bookCount':       typeof mdObj['bookCount']  === 'number' ? mdObj['bookCount']  : 0,
        'queryCount':      typeof mdObj['queryCount'] === 'number' ? mdObj['queryCount'] : 0,
        'recentBooks':     Array.isArray(mdObj['recentBooks'])     ? mdObj['recentBooks']     as MemoryDigest['recentBooks']     : [],
        'intentBreakdown': Array.isArray(mdObj['intentBreakdown']) ? mdObj['intentBreakdown'] as MemoryDigest['intentBreakdown'] : [],
        'summary':         typeof mdObj['summary'] === 'string'    ? mdObj['summary'] : '',
      };
    }
  }
  // #endregion snapshot-restore
}
