/**
 * DispatcherIntentClassifier: vector-similarity intent picker for triage.
 *
 * `DispatcherLlmClient.classify` asks an LLM to name one of three intents.
 * That works, but the LLM call sits behind the same adapter timeout as
 * every other request: when the model is cold, a trivial classification
 * (a one-line "when do you open?" message) can blow the 60s timeout and
 * gets wrongly escalated to a human "for safety" — the recovery path the node
 * takes on any LLM error. The vector route embeds three canonical intent
 * descriptions once at startup and then, for every inbound message, embeds
 * the message and picks the intent whose anchor has the highest cosine
 * similarity — no LLM round-trip, no timeout exposure, for the common case.
 *
 *   embed(intent descriptions) once → store vectors
 *   embed(message) per ask          → cosine-similarity vs each anchor
 *   pick argmax above confidence floor; else return null
 *
 * When the top score is below the floor we return `null`; the caller
 * (`ClassifyMessageNode.execute`) then routes to the LLM path,
 * preserving today's classify → escalate-on-error behavior for the
 * messages the embedder isn't confident about.
 */

import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';

/**
 * Canonical intent labels. Order matters only for tie-breaking: argmax
 * returns the first label encountered at the top score.
 */
export const DISPATCHER_INTENT_LABELS: readonly ('routine' | 'escalate' | 'off-topic')[] = [
  'routine',
  'escalate',
  'off-topic',
] as const;

/**
 * Anchor descriptions per intent, embedded once at startup. Cosine-
 * similarity vs the message at classify-time. Phrased as customer-message
 * paraphrases so the embedding sits close to where real messages land.
 */
export const DISPATCHER_INTENT_DESCRIPTIONS: Readonly<Record<'routine' | 'escalate' | 'off-topic', string>> = {
  'routine':   'a normal customer service question about the bookstore or its products: store hours and opening times, locations, whether a book title author genre comic graphic novel or manga is in stock available or carried, order status, shipping and delivery times, or product and pricing details',
  'escalate':  'an upset urgent or account-sensitive problem that needs a human agent: a refund request, a billing dispute, being charged twice or incorrectly, a payment or account problem, a complaint about a damaged wrong or missing order, or demanding to speak to a manager or supervisor',
  'off-topic': 'a message that has nothing to do with books reading or the bookstore: the weather, sports and game scores, cooking and recipes, jokes, movies, current news and politics, directions, or general small talk',
};

/**
 * Default confidence floor. Below this, the classifier returns null and the
 * caller routes to the LLM. Calibrated low for this three-anchor regime:
 * with the offline MiniLM model, short support messages score modest absolute
 * cosine (routine/escalate winners land ~0.22–0.46, off-topic ~0.03–0.18)
 * while the argmax stays well-separated, so the floor is a "similar to any
 * anchor at all" gate, not a class separator.
 */
export const DEFAULT_CONFIDENCE_FLOOR = 0.1;

interface IntentVector {
  readonly intent: 'routine' | 'escalate' | 'off-topic';
  readonly vector: readonly number[];
}

export class DispatcherIntentClassifier {
  readonly #embedder: EmbedderInterface;
  readonly #intentVectors: readonly IntentVector[];

  private constructor(embedder: EmbedderInterface, intentVectors: readonly IntentVector[]) {
    this.#embedder = embedder;
    this.#intentVectors = intentVectors;
  }

  /**
   * Build a classifier: embeds the three canonical intent descriptions
   * once, then reuses the vectors for every `classify()` call. Throws if
   * the embedder fails on any anchor; the caller chooses how to recover
   * (typically by skipping embedder classification and routing to
   * LLM-only).
   */
  static async create(embedder: EmbedderInterface): Promise<DispatcherIntentClassifier> {
    const descriptions = DISPATCHER_INTENT_LABELS.map((intent) => DISPATCHER_INTENT_DESCRIPTIONS[intent]);
    const embeddings = await embedder.embedBatch(descriptions);
    if (embeddings.length !== DISPATCHER_INTENT_LABELS.length) {
      throw new Error(`DispatcherIntentClassifier expected ${String(DISPATCHER_INTENT_LABELS.length)} embeddings, received ${String(embeddings.length)}`);
    }
    const vectors = DISPATCHER_INTENT_LABELS.map<IntentVector>((intent, index) => {
      const vector = embeddings[index];
      if (vector === undefined) {
        throw new Error(`DispatcherIntentClassifier missing embedding at index ${String(index)}`);
      }
      return { intent, vector };
    });
    return new DispatcherIntentClassifier(embedder, vectors);
  }

  /** Provider identity of the underlying embedder (for logging). */
  get embedderId(): string { return this.#embedder.id; }
  get embedderDisplayName(): string { return this.#embedder.displayName; }

  /**
   * Embed the message, compute cosine similarity vs every intent vector,
   * return the highest-scoring intent paired with its score. Returns
   * `null` when the top score is below `confidenceFloor`; the caller
   * routes to LLM classification.
   */
  async classify(
    message: string,
    confidenceFloor: number = DEFAULT_CONFIDENCE_FLOOR,
  ): Promise<{ readonly intent: 'routine' | 'escalate' | 'off-topic'; readonly score: number } | null> {
    const messageVec = await this.#embedder.embed(message);
    let bestIntent: 'routine' | 'escalate' | 'off-topic' | null = null;
    let bestScore = -Infinity;
    for (const { intent, vector } of this.#intentVectors) {
      const score = DispatcherIntentClassifier.cosine(messageVec, vector);
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }
    if (bestIntent === null || bestScore < confidenceFloor) return null;
    return { 'intent': bestIntent, 'score': bestScore };
  }

  /** Cosine similarity: dot product / (normA * normB). 0 on mismatch/zero-norm. */
  private static cosine(a: readonly number[], b: readonly number[]): number {
    if (a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dot += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
