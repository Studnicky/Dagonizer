/**
 * Salvage nodes: deterministic recovery reached by a flow decision.
 *
 * When an LLM node exhausts its retry budget it routes to `salvage`; the DAG
 * wires that edge to one of these nodes, which performs a deterministic,
 * service-free fallback and rejoins the happy path. The recovery is a real
 * node in the topology (NOT logic hidden inside the failing node's catch
 * block. That keeps execution (what a node computes) separate from flow
 * decisioning (which edge the DAG takes), and means a consumer can swap or
 * re-route any salvage without touching the producing node.
 *
 * Each salvage node routes a single `done` output back onto the branch the
 * failed node would have continued to.
 */

import { MonadicNode, RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ArchivistState } from '../ArchivistState.ts';

/** Cap on naive split terms. */
const MAX_NAIVE_TERMS = 6;

/**
 * extract-query salvage: naive whitespace term split. Drops words ≤ 2 chars,
 * caps at six. Deterministic; no LLM. Writes `state.terms` and rejoins at
 * decide-tools.
 */
export class ExtractQuerySalvageNode extends MonadicNode<ArchivistState, 'done'> {
  readonly name = 'extract-query-salvage';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    for (const { state } of batch) {
      state.terms = state.query
        .toLowerCase()
        .split(/\s+/u)
        .filter((t) => t.length > 2)
        .slice(0, MAX_NAIVE_TERMS);
    }
    return RoutedBatchBuilder.of('done', batch);
  }
}

/**
 * decide-tools salvage: minimal tool plan so the scouts still run. No `query`
 * arg; each scout falls back to `state.terms.join(' ')`. Rejoins at
 * recall-candidates.
 */
export class DecideToolsSalvageNode extends MonadicNode<ArchivistState, 'done'> {
  readonly name = 'decide-tools-salvage';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    for (const { state } of batch) {
      state.toolPlan = [{ 'name': 'web_search_books', 'arguments': {} }];
    }
    return RoutedBatchBuilder.of('done', batch);
  }
}

/**
 * classify-intent salvage: default to the broadest on-topic intent (`search`)
 * so the visitor still gets a book search. Rejoins at the on-topic search
 * branch.
 */
export class ClassifyIntentSalvageNode extends MonadicNode<ArchivistState, 'done'> {
  readonly name = 'classify-intent-salvage';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    for (const { state } of batch) {
      state.intent = 'search';
    }
    return RoutedBatchBuilder.of('done', batch);
  }
}

/**
 * rank-candidates salvage: keep the candidates in their scout-produced order
 * (deterministic given the same inputs). No fabricated scores. Rejoins at
 * merge-candidates, which soft-gates on emptiness.
 */
export class RankCandidatesSalvageNode extends MonadicNode<ArchivistState, 'done'> {
  readonly name = 'rank-candidates-salvage';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    return RoutedBatchBuilder.of('done', batch);
  }
}

/** Canned message when compose can't reach the LLM after exhausting retries. */
const COMPOSE_SALVAGE_DRAFT =
  'I had trouble composing a full response just now. Here is what I found; ask me to expand on any title and I will try again.';

/**
 * compose-response salvage: transient LLM failure exhausted the compose
 * budget. Emit a deterministic acknowledgement rather than fabricating a
 * fluent answer, then exit the compose loop.
 */
export class ComposeResponseSalvageNode extends MonadicNode<ArchivistState, 'done'> {
  readonly name = 'compose-salvage';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    for (const { state } of batch) {
      state.draft = COMPOSE_SALVAGE_DRAFT;
    }
    return RoutedBatchBuilder.of('done', batch);
  }
}

/** Canned empty-result message when compose-empty exhausts its retry budget. */
const EMPTY_SALVAGE_DRAFT =
  'I searched OpenLibrary, Google Books, the subject index, and Wikipedia but nothing came back for that description. Try a single keyword: the author name alone, or one strong image from the book, and I will cast a wider net.';

/**
 * compose-empty salvage: the empty-result composer couldn't reach the LLM
 * after retries. Emit the deterministic acknowledgement so the visitor always
 * gets a response, then route on to respond-to-visitor.
 */
export class ComposeEmptyResponseSalvageNode extends MonadicNode<ArchivistState, 'done'> {
  readonly name = 'compose-empty-salvage';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    for (const { state } of batch) {
      state.draft = EMPTY_SALVAGE_DRAFT;
    }
    return RoutedBatchBuilder.of('done', batch);
  }
}

/** Canned message when the memory-recall composer exhausts its retry budget. */
const MEMORY_SALVAGE_DRAFT =
  'I had trouble putting my memory into words just now. Ask me again, or tell me a title or author and I will look it up fresh.';

/**
 * compose-memory-response salvage: the recall composer exhausted its budget.
 * Emit a deterministic acknowledgement and route on to respond-to-visitor.
 */
export class ComposeMemoryResponseSalvageNode extends MonadicNode<ArchivistState, 'done'> {
  readonly name = 'compose-memory-salvage';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    for (const { state } of batch) {
      state.draft = MEMORY_SALVAGE_DRAFT;
    }
    return RoutedBatchBuilder.of('done', batch);
  }
}

/** Singleton node instances referenced by the DAG wiring. */
export const extractQuerySalvage = new ExtractQuerySalvageNode();
export const decideToolsSalvage = new DecideToolsSalvageNode();
export const classifyIntentSalvage = new ClassifyIntentSalvageNode();
export const rankCandidatesSalvage = new RankCandidatesSalvageNode();
export const composeResponseSalvage = new ComposeResponseSalvageNode();
export const composeEmptyResponseSalvage = new ComposeEmptyResponseSalvageNode();
export const composeMemoryResponseSalvage = new ComposeMemoryResponseSalvageNode();
