/**
 * recallContext: pre-classification memory recall node.
 *
 * Runs FIRST in the DAG (before `classifyIntent`) and SPARQL-queries the
 * unified memory graph for relevant priors from previous runs. The results
 * are injected into `state.recalledContext` so downstream LLM-driven nodes
 * (classifyIntent, decideTools, composeResponse) can use them for
 * classification continuity.
 *
 * Three focused query passes (all against the MemoryStore `select()` API):
 *
 *   1. Prior intents: walk every `urn:dagonizer:state:<runId>` named graph,
 *      collect `(?run dag:visitorQuery ?q, dag:intent ?i)` pairs, filter out
 *      the current run, keep the most recent N.  Token-overlap heuristic
 *      (computed in JS) surfaces the ones most similar to the current query.
 *
 *   2. Recent candidates: from the same state graphs, collect all books
 *      that were shortlisted (`dag:inShortlist true`) with their titles.
 *      These give the classifier context about what the visitor has already
 *      seen.
 *
 *   3. Similar prior queries: subset of (1) where the prior query shares
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
 * kind: 'non-deterministic': SPARQL output depends on accumulated memory.
 * output: 'recalled': always routes forward, even on empty recall.
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextType } from '@studnicky/dagonizer';

import type { RecalledContext } from '../ArchivistState.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import { BookBuilder } from '../entities/Book.ts';
import type { CandidateType } from '../entities/Book.ts';
import { BOOK_NS, GRAPH_MEMORY, MemoryStore, STATE_GRAPH_PREFIX } from '../memory/MemoryStore.ts';
import type { ArchivistServices } from '../services.ts';
import { TextSimilarity } from './textUtils.ts';

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
const MAX_PRIOR_CANDIDATES_CONTEXT = 5;
const JACCARD_THRESHOLD_CONTEXT = 0.35;

export class RecallContextNode extends ScalarNode<ArchivistState, 'recalled', ArchivistServices> {
  readonly name = 'recall-context';
  readonly outputs = ['recalled'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextType<ArchivistServices>) {
    const memory = context.services.memory;
    const currentGraphIri = MemoryStore.stateGraphIri(state.runId).value;
    const currentTokens   = TextSimilarity.tokenise(state.query);

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

      // Get the run subject: it is the subject of dag:visitorQuery in this graph.
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

        const priorTokens = TextSimilarity.tokenise(queryText);
        const score = TextSimilarity.jaccard(currentTokens, priorTokens);
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
    const recentCandidates: CandidateType[] = [];

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
          'book': BookBuilder.from({
            'isbn':    isbn,
            'title':   title,
            'authors': authors,
            'price':   { 'amount': 0, 'currency': 'USD' },
          }),
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
          `${String(similarPriorQueries.length)} similar prior ${similarPriorQueries.length === 1 ? 'query' : 'queries'} detected; the visitor may be continuing an earlier search.`,
        );
      } else if (recentCandidates.length > 0) {
        const titleList = recentCandidates.slice(0, 3).map((c) => `"${c.book.identity.title}"`).join(', ');
        parts.push(`Recent shortlisted titles: ${titleList}.`);
      }
      summary = parts.join(' ');
    }

    // ── Boost summary with in-turn conversation context ───────────────────
    // When the current query is a short pronoun-acceptance ("yes", "that",
    // "let's do that") and the last archivist turn proposed something, append
    // it so the classifier and compose nodes can resolve the reference.
    const conv = state.conversation;
    if (conv.length >= 2) {
      const lastArchivist = [...conv].reverse().find((t) => t.role === 'archivist');
      const lastVisitor   = conv[conv.length - 1];
      const isPronouns    = lastVisitor !== undefined && /^(yes|sure|ok|okay|let.s|that|it|do it|go ahead|sounds good)/iu.test(lastVisitor.text.trim());
      if (isPronouns && lastArchivist !== undefined) {
        const boost = `The visitor appears to be accepting the previous Archivist suggestion: "${lastArchivist.text.slice(0, 120)}".`;
        summary = summary.length > 0 ? `${summary} ${boost}` : boost;
      }
    }

    state.recalledContext = {
      'priorIntents':        priorIntents,
      'recentCandidates':    recentCandidates,
      'similarPriorQueries': similarPriorQueries,
      'summary':             summary,
    };

    // ── Seed priorCandidates from high-similarity prior runs ──────────────
    // Collect shortlisted books from runs with Jaccard >= 0.35 (same threshold
    // as recallCandidates). Capped at 5; recallCandidates inside the embedded-
    // DAG overwrites with a richer cap-10 set when the scatter fires.
    const highSimilarGraphs = priorRaw
      .filter((p) => p.jaccard >= JACCARD_THRESHOLD_CONTEXT)
      .map((p) => p.graphIri);

    const priorCandidatesFromContext: import('../entities/Book.ts').CandidateType[] = [];
    const seenContextIsbns = new Set<string>();

    const dagShortlisted = MemoryStore.dagIri('shortlisted');

    for (const graphIri of highSimilarGraphs) {
      if (priorCandidatesFromContext.length >= MAX_PRIOR_CANDIDATES_CONTEXT) break;

      // Derive the run IRI from the state graph IRI.
      const runId  = graphIri.replace(STATE_GRAPH_PREFIX, '');
      const runTerm = MemoryStore.iri(`urn:dagonizer:run:${runId}`);

      const shortlistedRows = memory.select({
        'subject':   runTerm,
        'predicate': dagShortlisted,
        'object':    '?book',
        'graph':     GRAPH_MEMORY,
      });

      for (const sRow of shortlistedRows) {
        if (priorCandidatesFromContext.length >= MAX_PRIOR_CANDIDATES_CONTEXT) break;
        const bookTerm = sRow['book'];
        if (bookTerm === undefined) continue;

        const isbn = bookTerm.value.replace(BOOK_NS, '');
        if (seenContextIsbns.has(isbn)) continue;
        seenContextIsbns.add(isbn);

        const titleRows  = memory.select({ 'subject': bookTerm, 'predicate': dagTitle,  'object': '?v', 'graph': GRAPH_MEMORY });
        const sourceRows = memory.select({ 'subject': bookTerm, 'predicate': dagSource, 'object': '?v', 'graph': GRAPH_MEMORY });
        const authorRows = memory.select({ 'subject': bookTerm, 'predicate': dagAuthor, 'object': '?v', 'graph': GRAPH_MEMORY });

        const title   = titleRows[0]?.['v']?.value ?? isbn;
        const source  = sourceRows[0]?.['v']?.value ?? 'memory';
        const authors = authorRows.map((r) => r['v']?.value ?? '').filter(Boolean);

        priorCandidatesFromContext.push({
          'book': BookBuilder.from({
            'isbn':    isbn,
            'title':   title,
            'authors': authors,
            'price':   { 'amount': 0, 'currency': 'USD' },
          }),
          'score':  0.5,
          'source': source,
          'notes':  { 'fromPriorMemory': true },
        });
      }
    }

    if (priorCandidatesFromContext.length > 0) {
      state.priorCandidates = priorCandidatesFromContext;
    }

    if (summary.length > 0) {
    } else {
    }

    return NodeOutputBuilder.of('recalled');
  }
}

/** Singleton node instance referenced by the DAG wiring. */
export const recallContext = new RecallContextNode();
