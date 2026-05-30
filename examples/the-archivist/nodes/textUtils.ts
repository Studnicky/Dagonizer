/**
 * textUtils: shared text-similarity utilities for the Archivist nodes.
 *
 * Extracted from recallCandidates, rankCandidates, recallContext,
 * pickBestMatch, and providers/IntentClassifier to eliminate copy-paste.
 *
 * `tokenise`: split text into lowercase tokens (length > 2).
 * `jaccard`:  Jaccard similarity between two token sets.
 * `cosineSimilarity`: cosine similarity between two numeric vectors.
 */

/**
 * Return a set of lowercase tokens from a string. Tokens shorter than
 * three characters are dropped (articles, prepositions, etc.).
 */
export function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2),
  );
}

/**
 * Jaccard similarity: |intersection| / |union|.
 * Returns 0 when both sets are empty.
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const tok of a) if (b.has(tok)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/**
 * Cosine similarity between two equal-length numeric vectors.
 * Returns 0 on length mismatch or zero-norm input; those are
 * degenerate cases the caller treats as "no signal".
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
