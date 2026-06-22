/**
 * scouts: utility helpers and gather strategy for the Archivist's
 * ToolRegistry-based multi-source scatter.
 *
 * ScoutUtils: pure static helpers for query shaping (unquote, filterByLanguage,
 * pickSubjectTerm, pickWikipediaQuery). Consumed by BuildBookWorksetsNode.
 *
 * ToolCandidateGatherStrategy ('tool-candidate-merge'): folds each tool clone's
 * output array into the parent state's `candidates` and `failureCause` fields.
 * Each clone runs a `tool:<name>` embedded DAG via ToolInvokeNode; this strategy
 * reads `cloneState.output` (via StateAccessor, no cast) to retrieve the
 * CandidateType[] the tool returned, then filters by visitor language, and
 * appends to the parent's candidates.
 */

import {
  GatherStrategies,
  GatherStrategy,
} from '@studnicky/dagonizer';
import type {
  GatherConfigType,
  GatherRecordType,
} from '@studnicky/dagonizer';
import type { Batch } from '@studnicky/dagonizer';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';
import type { NodeStateInterface } from '@studnicky/dagonizer';

import type { CandidateType } from '../entities/Book.ts';
import { UserLanguage } from '../language/UserLanguage.ts';

/**
 * ScoutUtils: pure helper methods for scout query shaping and sanitisation.
 * Static methods only; no instance state.
 */
export class ScoutUtils {
  /**
   * Filter scout-returned candidates down to those in the visitor's
   * language. Candidates with no language metadata pass through (the
   * source did not report a language; degrade gracefully). Candidates
   * whose reported language array does NOT contain the target ISO 639-2
   * code are dropped.
   */
  static filterByLanguage(
    candidates: readonly CandidateType[],
    userLanguage: string,
  ): readonly CandidateType[] {
    const target = UserLanguage.toIso6392(userLanguage);
    return candidates.filter((c) => {
      const langs = c.book.publication.languages;
      if (langs.length === 0) return true;
      return langs.includes(target);
    });
  }

  /**
   * Strip outer matching quote pairs from a string. Handles straight double
   * quotes, straight single quotes, and guillemets. Returns the inner content
   * when a matching pair is detected; returns the trimmed original otherwise.
   *
   * Examples:
   *   unquote('"strange house neil gaiman"') → 'strange house neil gaiman'
   *   unquote("'foo'")                        → 'foo'
   *   unquote('«bar»')                        → 'bar'
   *   unquote('no quotes')                    → 'no quotes'
   */
  static unquote(s: string): string {
    const t = s.trim();
    if (
      (t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'"))
    ) {
      return t.slice(1, -1).trim();
    }
    if (t.startsWith('«') && t.endsWith('»')) {
      return t.slice(1, -1).trim();
    }
    return t;
  }

  // ── Query shaping per scout ─────────────────────────────────────────────────
  //
  // Each scout operates on a different index / search engine, so the query form
  // that performs best differs per backend. All shaping is deterministic (no LLM
  // involvement) and applied to `state.terms` after the extract-query node has
  // already distilled the visitor's prose into catalog keywords.
  //
  // OpenLibrary (keyword search, `q=`): join all terms; keyword AND-match works
  //   well with multiple short terms. No transformation needed.
  //
  // Google Books (`q=`): same join; full-text keyword search, identical behaviour
  //   to OpenLibrary keyword path. No transformation needed.
  //
  // Subject Search (OpenLibrary `subject=`): the subject facet is indexed from
  //   Library of Congress Subject Headings (LCSH), which are single-concept
  //   headings. Long concatenations ("existentialism science fiction") almost
  //   never match an LCSH heading. Strategy: pick the LONGEST term from
  //   `state.terms` (heuristic: more letters = more specific) and use it alone.
  //   Falls back to `state.terms[0]` when all terms are the same length.
  //
  // Wikipedia (page/summary title): the REST endpoint resolves exact article
  //   titles and common redirects. Proper nouns (author names, book titles)
  //   surface the right article. Strategy: if any term starts with an uppercase
  //   letter (likely a proper noun, "Neuromancer", "Philip K. Dick"), use the
  //   first such term alone. Otherwise join all terms as a best-effort phrase.

  /** Pick the most-specific (longest) term for LCSH subject search. */
  static pickSubjectTerm(terms: readonly string[]): string {
    if (terms.length === 0) return '';
    return terms.reduce((best, t) => (t.length > best.length ? t : best), terms[0] ?? '');
  }

  /** Pick the first capitalised term for Wikipedia proper-noun lookup. */
  static pickWikipediaQuery(terms: readonly string[]): string {
    const properNoun = terms.find((t) => /^\p{Lu}/u.test(t));
    return properNoun ?? terms.join(' ');
  }
}

// #region tool-candidate-gather-strategy
// ── ToolCandidateGatherStrategy ('tool-candidate-merge') ─────────────────────
// Folds each tool clone's output (a CandidateType[] returned by the tool) into
// the parent state's `candidates` array. Reads clone output via StateAccessor
// so there are no unsafe casts — the strategy never knows the parent state's
// concrete class, only the state path names.
//
// Each scatter clone ran a `tool:<name>` embedded DAG on a fresh
// ToolInvocationState. On success, ToolInvokeNode sets `toolState.output` to
// the tool's return value (a CandidateType[]). On error the clone's output
// is the empty array at the default value, so the strategy safely no-ops.

class ToolCandidateGatherStrategy extends GatherStrategy {
  readonly name = 'tool-candidate-merge';

  /**
   * Type predicate: narrows an element to CandidateType without a cast.
   * A CandidateType must carry a `book` object with an `identity` sub-object.
   */
  static isCandidateType(el: unknown): el is CandidateType {
    return (
      typeof el === 'object' &&
      el !== null &&
      'book' in el &&
      typeof el.book === 'object' &&
      el.book !== null
    );
  }

  override reduce(
    _config: GatherConfigType,
    batch: Batch<GatherRecordType>,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const languageValue = accessor.get(state, 'userLanguage');
    const userLanguage = typeof languageValue === 'string' ? languageValue : 'en';
    const candidatesValue = accessor.get(state, 'candidates');
    const existing: CandidateType[] = Array.isArray(candidatesValue)
      ? candidatesValue.filter(ToolCandidateGatherStrategy.isCandidateType)
      : [];
    const merged: CandidateType[] = [...existing];

    for (const item of batch) {
      const record = item.state;
      const rawOutput = accessor.get(record.cloneState, 'output');
      if (!Array.isArray(rawOutput)) continue;

      const toolCandidates = rawOutput.filter(ToolCandidateGatherStrategy.isCandidateType);
      const filtered = ScoutUtils.filterByLanguage(toolCandidates, userLanguage);

      if (filtered.length === 0 && toolCandidates.length > 0) {
        // All candidates were language-filtered out; note the loss but don't log the source name
        // (the strategy doesn't know which tool produced this clone).
        const causeValue = accessor.get(state, 'failureCause');
        const current = typeof causeValue === 'string' ? causeValue : '';
        accessor.set(state, 'failureCause', `${current}Tool scout: 0 hits after language filter. `);
      } else if (filtered.length === 0) {
        const causeValue = accessor.get(state, 'failureCause');
        const current = typeof causeValue === 'string' ? causeValue : '';
        accessor.set(state, 'failureCause', `${current}Tool scout: 0 results. `);
      }

      for (const candidate of filtered) {
        merged.push(candidate);
      }
    }

    accessor.set(state, 'candidates', merged);
  }
}

GatherStrategies.register(new ToolCandidateGatherStrategy());
// GatherStrategies.resolve('tool-candidate-merge') now works in any scatter placement.
// #endregion tool-candidate-gather-strategy
