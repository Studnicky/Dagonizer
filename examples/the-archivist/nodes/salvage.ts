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

import { NodeOutputBuilder, ScalarNode } from '@noocodex/dagonizer';
import type { NodeContextInterface } from '@noocodex/dagonizer';

import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

/** Cap on naive split terms; matches the old in-catch fallback. */
const MAX_NAIVE_TERMS = 6;

/**
 * extract-query salvage: naive whitespace term split. Drops words ≤ 2 chars,
 * caps at six. Deterministic; no LLM. Writes `state.terms` and rejoins at
 * decide-tools.
 */
export class ExtractQuerySalvageNode extends ScalarNode<ArchivistState, 'done', ArchivistServices> {
  readonly name = 'extract-query-salvage';
  readonly outputs = ['done'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    state.terms = state.query
      .toLowerCase()
      .split(/\s+/u)
      .filter((t) => t.length > 2)
      .slice(0, MAX_NAIVE_TERMS);
    context.services.logger.info(`extract-query-salvage: naive term split → [${state.terms.join(', ')}]`);
    return NodeOutputBuilder.of('done');
  }
}

/**
 * decide-tools salvage: minimal tool plan so the scouts still run. No `query`
 * arg; each scout falls back to `state.terms.join(' ')`. Rejoins at
 * recall-candidates.
 */
export class DecideToolsSalvageNode extends ScalarNode<ArchivistState, 'done', ArchivistServices> {
  readonly name = 'decide-tools-salvage';
  readonly outputs = ['done'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    state.toolPlan = [{ 'name': 'web_search_books', 'arguments': {} }];
    context.services.logger.info('decide-tools-salvage: minimal tool plan (web_search_books)');
    return NodeOutputBuilder.of('done');
  }
}

/**
 * classify-intent salvage: default to the broadest on-topic intent (`search`)
 * so the visitor still gets a book search. Rejoins at the on-topic search
 * branch.
 */
export class ClassifyIntentSalvageNode extends ScalarNode<ArchivistState, 'done', ArchivistServices> {
  readonly name = 'classify-intent-salvage';
  readonly outputs = ['done'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    state.intent = 'search';
    context.services.logger.info('classify-intent-salvage: defaulting intent → search');
    return NodeOutputBuilder.of('done');
  }
}

/**
 * rank-candidates salvage: keep the candidates in their scout-produced order
 * (deterministic given the same inputs). No fabricated scores. Rejoins at
 * merge-candidates, which soft-gates on emptiness.
 */
export class RankCandidatesSalvageNode extends ScalarNode<ArchivistState, 'done', ArchivistServices> {
  readonly name = 'rank-candidates-salvage';
  readonly outputs = ['done'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    context.services.logger.info(
      `rank-candidates-salvage: passing ${String(state.candidates.length)} candidates through unranked`,
    );
    return NodeOutputBuilder.of('done');
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
export class ComposeResponseSalvageNode extends ScalarNode<ArchivistState, 'done', ArchivistServices> {
  readonly name = 'compose-salvage';
  readonly outputs = ['done'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    state.draft = COMPOSE_SALVAGE_DRAFT;
    context.services.logger.warn('compose-salvage: emitting canned acknowledgement after retry budget exhausted');
    return NodeOutputBuilder.of('done');
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
export class ComposeEmptyResponseSalvageNode extends ScalarNode<ArchivistState, 'done', ArchivistServices> {
  readonly name = 'compose-empty-salvage';
  readonly outputs = ['done'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    state.draft = EMPTY_SALVAGE_DRAFT;
    context.services.logger.warn('compose-empty-salvage: emitting canned empty-result acknowledgement after retry budget exhausted');
    return NodeOutputBuilder.of('done');
  }
}

/** Canned message when the memory-recall composer exhausts its retry budget. */
const MEMORY_SALVAGE_DRAFT =
  'I had trouble putting my memory into words just now. Ask me again, or tell me a title or author and I will look it up fresh.';

/**
 * compose-memory-response salvage: the recall composer exhausted its budget.
 * Emit a deterministic acknowledgement and route on to respond-to-visitor.
 */
export class ComposeMemoryResponseSalvageNode extends ScalarNode<ArchivistState, 'done', ArchivistServices> {
  readonly name = 'compose-memory-salvage';
  readonly outputs = ['done'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    state.draft = MEMORY_SALVAGE_DRAFT;
    context.services.logger.warn('compose-memory-salvage: emitting canned acknowledgement after retry budget exhausted');
    return NodeOutputBuilder.of('done');
  }
}

/** Backward-compatible const exports for existing bundle/DAG references. */
export const extractQuerySalvage = new ExtractQuerySalvageNode();
export const decideToolsSalvage = new DecideToolsSalvageNode();
export const classifyIntentSalvage = new ClassifyIntentSalvageNode();
export const rankCandidatesSalvage = new RankCandidatesSalvageNode();
export const composeResponseSalvage = new ComposeResponseSalvageNode();
export const composeEmptyResponseSalvage = new ComposeEmptyResponseSalvageNode();
export const composeMemoryResponseSalvage = new ComposeMemoryResponseSalvageNode();
