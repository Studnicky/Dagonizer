/**
 * recallContext — pre-classification memory recall node.
 *
 * Runs FIRST in the DAG (before `classifyIntent`) and SPARQL-queries the
 * unified memory graph for relevant priors from previous runs. The results
 * are injected into `state.recalledContext` so downstream LLM-driven nodes
 * (classifyIntent, decideTools, composeResponse) can use them for
 * classification continuity.
 *
 * Three focused query passes (all against the MemoryStore `select()` API):
 *
 *   1. Prior intents — walk every `urn:dagonizer:state:<runId>` named graph,
 *      collect `(?run dag:visitorQuery ?q, dag:intent ?i)` pairs, filter out
 *      the current run, keep the most recent N.  Token-overlap heuristic
 *      (computed in JS) surfaces the ones most similar to the current query.
 *
 *   2. Recent candidates — from the same state graphs, collect all books
 *      that were shortlisted (`dag:inShortlist true`) with their titles.
 *      These give the classifier context about what the visitor has already
 *      seen.
 *
 *   3. Similar prior queries — subset of (1) where the prior query shares
 *      at least two tokens with the current query, surfaced explicitly for
 *      the "the visitor asked this before" continuity hint.
 *
 * The actual predicates match exactly what `StateProjection` writes:
 *   dag:visitorQuery, dag:intent, dag:candidate, dag:inShortlist, dag:title,
 *   dag:source, dag:score, dag:author
 *
 * (recordFindings writes to the default graph; we query the per-run state
 * graphs that StateProjection maintains, since those are always in sync.)
 *
 * kind: 'non-deterministic' — SPARQL output depends on accumulated memory.
 * output: 'recalled' — always routes forward, even on empty recall.
 */

import type { RecalledContext } from '../ArchivistState.ts';
import type { Candidate } from '../entities/Book.ts';
import { MemoryStore, STATE_GRAPH_PREFIX, stateGraphIri } from '../memory/MemoryStore.ts';

import type { ArchivistNode } from './ArchivistNode.ts';

const dagVisitorQuery = MemoryStore.dagIri('visitorQuery');
const dagIntent       = MemoryStore.dagIri('intent');
const dagCandidate    = MemoryStore.dagIri('candidate');
const dagInShortlist  = MemoryStore.dagIri('inShortlist');
const dagTitle        = MemoryStore.dagIri('title');
const dagSource       = MemoryStore.dagIri('source');
const dagScore        = MemoryStore.dagIri('score');
const dagAuthor       = MemoryStore.dagIri('author');

const MAX_PRIOR_INTENTS = 5;
const MAX_RECENT_CANDIDATES = 6;

/** Return a set of lowercase tokens from a query string. */
function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2),
  );
}

/** Overlap score: |intersection| / |union| (Jaccard). Returns 0 when both sets are empty. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const tok of a) if (b.has(tok)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export const recallContext: ArchivistNode<'recalled'> = {
  'name':    'recall-context',
  'kind':    'non-deterministic',
  'outputs': ['recalled'],
  async execute(state, context) {
    const memory = context.services.memory;
    const currentGraphIri = stateGraphIri(state.runId).value;
    const currentTokens   = tokenise(state.query);

    // ── Collect every state graph IRI except the current run ──────────────
    // We iterate over all quads, collect unique graph IRIs that start with
    // STATE_GRAPH_PREFIX, and skip the current run's graph.
    const stateGraphs = new Set<string>();
    for (const row of memory.select({
      'subject':   '?run',
      'predicate': dagVisitorQuery,
      'object':    '?q',
      'graph':     '?graph',
    })) {
      const graphVal = row['graph']?.value;
      if (graphVal === undefined) continue;
      if (!graphVal.startsWith(STATE_GRAPH_PREFIX)) continue;
      if (graphVal === currentGraphIri) continue;
      stateGraphs.add(graphVal);
    }

    // ── Query 1: prior intents + query text ───────────────────────────────
    // For each state graph, get `dag:visitorQuery` and `dag:intent` for the
    // run subject. Collect them with a Jaccard score vs. the current query.
    const priorRaw: Array<{ query: string; intent: string; jaccard: number; graphIri: string }> = [];

    for (const graphIri of stateGraphs) {
      const graph = MemoryStore.iri(graphIri);

      // Get the run subject — it is the subject of dag:visitorQuery in this graph.
      const queryRows = memory.select({
        'subject':   '?run',
        'predicate': dagVisitorQuery,
        'object':    '?q',
        'graph':     graph,
      });
      for (const qRow of queryRows) {
        const runTerm   = qRow['run'];
        const queryText = qRow['q']?.value;
        if (runTerm === undefined || queryText === undefined) continue;

        // Get the intent for this run.
        const intentRows = memory.select({
          'subject':   runTerm,
          'predicate': dagIntent,
          'object':    '?i',
          'graph':     graph,
        });
        const intentText = intentRows[0]?.['i']?.value;
        if (intentText === undefined) continue;

        const priorTokens = tokenise(queryText);
        const score = jaccard(currentTokens, priorTokens);
        priorRaw.push({ 'query': queryText, 'intent': intentText, 'jaccard': score, 'graphIri': graphIri });
      }
    }

    // Sort descending by Jaccard similarity; take top MAX_PRIOR_INTENTS.
    priorRaw.sort((a, b) => b.jaccard - a.jaccard);
    const topPriors = priorRaw.slice(0, MAX_PRIOR_INTENTS);

    const priorIntents: RecalledContext['priorIntents'] = topPriors.map((p) => ({
      'query':  p.query,
      'intent': p.intent,
      'ts':     p.graphIri.replace(STATE_GRAPH_PREFIX, ''),
    }));

    // ── Query 2: recent candidates (shortlisted books) ────────────────────
    // Walk the same state graphs and collect books where dag:inShortlist = true.
    const seenIsbns   = new Set<string>();
    const recentCandidates: Candidate[] = [];

    for (const graphIri of stateGraphs) {
      if (recentCandidates.length >= MAX_RECENT_CANDIDATES) break;
      const graph = MemoryStore.iri(graphIri);

      // Get all candidates for this run.
      const candidateRows = memory.select({
        'subject':   '?run',
        'predicate': dagCandidate,
        'object':    '?book',
        'graph':     graph,
      });
      for (const cRow of candidateRows) {
        if (recentCandidates.length >= MAX_RECENT_CANDIDATES) break;
        const bookTerm = cRow['book'];
        if (bookTerm === undefined) continue;

        // Only shortlisted books.
        const shortlistRows = memory.select({
          'subject':   bookTerm,
          'predicate': dagInShortlist,
          'object':    MemoryStore.lit.bool(true),
          'graph':     graph,
        });
        if (shortlistRows.length === 0) continue;

        // Avoid duplicate books across graphs.
        const isbn = bookTerm.value.replace('urn:dagonizer:book:', '');
        if (seenIsbns.has(isbn)) continue;
        seenIsbns.add(isbn);

        // Collect metadata.
        const titleRows  = memory.select({ 'subject': bookTerm, 'predicate': dagTitle,  'object': '?v', 'graph': graph });
        const sourceRows = memory.select({ 'subject': bookTerm, 'predicate': dagSource, 'object': '?v', 'graph': graph });
        const scoreRows  = memory.select({ 'subject': bookTerm, 'predicate': dagScore,  'object': '?v', 'graph': graph });
        const authorRows = memory.select({ 'subject': bookTerm, 'predicate': dagAuthor, 'object': '?v', 'graph': graph });

        const title  = titleRows[0]?.['v']?.value ?? isbn;
        const source = sourceRows[0]?.['v']?.value ?? 'memory';
        const score  = parseFloat(scoreRows[0]?.['v']?.value ?? '0.5');
        const authors = authorRows.map((r) => r['v']?.value ?? '').filter(Boolean);

        recentCandidates.push({
          'book': {
            'isbn':    isbn,
            'title':   title,
            'authors': authors,
            'price':   { 'amount': 0, 'currency': 'USD' },
          },
          'score':  score,
          'source': source,
        });
      }
    }

    // ── Query 3: similar prior queries (Jaccard >= 0.15) ─────────────────
    const similarPriorQueries: RecalledContext['similarPriorQueries'] = topPriors
      .filter((p) => p.jaccard >= 0.15)
      .map((p) => ({
        'query': p.query,
        'ts':    p.graphIri.replace(STATE_GRAPH_PREFIX, ''),
      }));

    // ── Build the LLM-ready summary ───────────────────────────────────────
    let summary = '';
    if (priorIntents.length > 0 || recentCandidates.length > 0) {
      const parts: string[] = [];
      if (priorIntents.length > 0) {
        const top = priorIntents[0];
        if (top !== undefined) {
          parts.push(
            `The visitor previously asked "${top.query}" and the classifier returned intent "${top.intent}".`,
          );
        }
      }
      if (similarPriorQueries.length > 0) {
        parts.push(
          `${String(similarPriorQueries.length)} similar prior ${similarPriorQueries.length === 1 ? 'query' : 'queries'} detected — the visitor may be continuing an earlier search.`,
        );
      } else if (recentCandidates.length > 0) {
        const titleList = recentCandidates.slice(0, 3).map((c) => `"${c.book.title}"`).join(', ');
        parts.push(`Recent shortlisted titles: ${titleList}.`);
      }
      summary = parts.join(' ');
    }

    state.recalledContext = {
      'priorIntents':        priorIntents,
      'recentCandidates':    recentCandidates,
      'similarPriorQueries': similarPriorQueries,
      'summary':             summary,
    };

    if (summary.length > 0) {
      context.services.logger.info(`recall-context: ${String(priorIntents.length)} prior intents, ${String(recentCandidates.length)} recent candidates, ${String(similarPriorQueries.length)} similar queries`);
    } else {
      context.services.logger.info('recall-context: no prior context found');
    }

    return { 'output': 'recalled' };
  },
};
