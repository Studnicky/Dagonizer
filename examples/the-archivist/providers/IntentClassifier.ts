/**
 * IntentClassifier: vector-similarity intent picker.
 *
 * Today's `BaseLlmClient.classifyIntent` asks an LLM to name an intent
 * label. That works but drifts: short follow-ups, multilingual queries,
 * and stochastic sampling all produce misclassifications. The vector
 * route embeds a small set of canonical intent descriptions once at
 * startup and then, for every query, embeds the query and picks the
 * intent whose anchor has the highest cosine similarity.
 *
 *   embed(intent descriptions) once → store vectors
 *   embed(query) per ask           → cosine-similarity vs each anchor
 *   pick argmax above confidence floor; else return null
 *
 * When the top score is below the floor we return `null`; the caller
 * (`BaseLlmClient.classifyIntent`) then falls back to the LLM. This is
 * a guard against degenerate query embeddings (off-topic noise that
 * happens to be close to one anchor by chance).
 *
 * The intent label set is identical to `ClassifiedIntent` in
 * `services.ts`. Two definitions stay in sync because the test below
 * verifies the union narrowed correctly at the type level.
 */

import type { Embedder } from '@studnicky/dagonizer/contracts';

import type { ClassifiedIntent } from '../services.ts';

import { TextSimilarity } from '../nodes/textUtils.ts';

/** Cosine similarity over two equal-length vectors, delegating to `TextSimilarity.cosine`. */
export const cosineSimilarity = (a: readonly number[], b: readonly number[]): number =>
  TextSimilarity.cosine(a, b);

/**
 * Canonical intent labels. The order matters only for tie-breaking:
 * argmax returns the first label encountered at the top score.
 */
export const INTENT_LABELS: readonly ClassifiedIntent[] = [
  'lookup-author',
  'find-reviews',
  'describe-book',
  'recommend-similar',
  'recall-memories',
  'search',
  'describe',
  'recommend',
  'off-topic',
] as const;

/**
 * Anchor descriptions per intent, embedded once at startup. Cosine-
 * similarity vs the query at classify-time. Phrased as visitor-style
 * paraphrases so the embedding sits close to where real queries land.
 */
export const INTENT_DESCRIPTIONS: Readonly<Record<ClassifiedIntent, string>> = {
  'lookup-author':     'visitor named an author and wants their complete body of work or bibliography',
  'find-reviews':      'visitor wants opinions reviews ratings or what readers think about a book',
  'describe-book':     'visitor named a specific book title and wants a summary or description of it',
  'recommend-similar': 'visitor wants a book similar to a named title or book they already read or mentioned, like saying something similar to Dune or like the book I just described',
  'recall-memories':   'visitor asks about your own memory history past conversations what books you have seen',
  'search':            'visitor describes a topic theme genre subject or asks if a book exists about something, or explicitly asks to use web search tools lookups or external sources to find books',
  'describe':          'visitor described a book without naming it asking what book that might be',
  'recommend':         'visitor asks for a generic book recommendation without specifying a topic or prior read',
  'off-topic':         'question is clearly unrelated to books reading or libraries, such as asking about the weather sports scores jokes cooking recipes or current news events',
};

/** Default confidence floor. Below this, the classifier returns null. */
export const DEFAULT_CONFIDENCE_FLOOR = 0.4;

interface IntentVector {
  readonly intent: ClassifiedIntent;
  readonly vector: readonly number[];
}

export class IntentClassifier {
  readonly #embedder: Embedder;
  readonly #intentVectors: readonly IntentVector[];

  private constructor(embedder: Embedder, intentVectors: readonly IntentVector[]) {
    this.#embedder = embedder;
    this.#intentVectors = intentVectors;
  }

  /**
   * Build a classifier: embeds the canonical intent descriptions once,
   * then reuses the vectors for every `classify()` call. Throws if the
   * embedder fails on any anchor; the caller chooses how to recover
   * (typically by skipping vector classification and falling back to
   * LLM-only).
   */
  static async create(embedder: Embedder): Promise<IntentClassifier> {
    const vectors = await Promise.all(
      INTENT_LABELS.map<Promise<IntentVector>>(async (intent) => ({
        intent,
        'vector': await embedder.embed(INTENT_DESCRIPTIONS[intent]),
      })),
    );
    return new IntentClassifier(embedder, vectors);
  }

  /** Provider identity of the underlying embedder (for logging). */
  get embedderId(): string { return this.#embedder.id; }
  get embedderDisplayName(): string { return this.#embedder.displayName; }

  /**
   * Embed the query, compute cosine similarity vs every intent vector,
   * return the highest-scoring intent paired with its score. Returns
   * `null` when the top score is below `confidenceFloor`; the caller
   * falls back to LLM classification.
   */
  async classify(
    query: string,
    confidenceFloor: number = DEFAULT_CONFIDENCE_FLOOR,
  ): Promise<{ readonly intent: ClassifiedIntent; readonly score: number } | null> {
    const queryVec = await this.#embedder.embed(query);
    let bestIntent: ClassifiedIntent | null = null;
    let bestScore = -Infinity;
    for (const { intent, vector } of this.#intentVectors) {
      const score = TextSimilarity.cosine(queryVec, vector);
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }
    if (bestIntent === null || bestScore < confidenceFloor) return null;
    return { 'intent': bestIntent, 'score': bestScore };
  }
}
