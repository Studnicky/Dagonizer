/**
 * ModelCost: cost-rank heuristics shared by every adapter's `listModels()`.
 *
 * Produces the `costRank` field of an `LlmModelType`: a non-negative number
 * where LOWER means cheaper. Ranks are comparable ONLY within a single
 * provider's catalogue — each adapter uses one consistent signal for all its
 * models (OpenRouter token pricing, Ollama on-disk size, or this name
 * heuristic), so `selectChatModel` can pick the cheapest available model when
 * a configured default is absent. Never compare a rank from one provider
 * against a rank from another.
 *
 * The name heuristic reads, cheapest-wins:
 *   - an explicit free tag (`:free`) → 0, the cheapest possible;
 *   - a parameter count (`8b`, `70b`, `405b`) → that many billions, a direct
 *     size-as-cost proxy;
 *   - else a size keyword (`nano`, `mini`, `haiku`, `small`, `opus`, `large`,
 *     …) mapped to a representative billion-parameter figure;
 *   - else `DEFAULT_RANK`.
 */

/** A catalogue entry whose cost may be derived from OpenAI-style pricing. */
export type OpenAiCostEntryType = {
  readonly id: string;
  readonly pricing?: {
    readonly prompt?: string;
    readonly completion?: string;
  };
}

export class ModelCost {
  /** Rank assigned when a model name carries no size signal at all. */
  static readonly DEFAULT_RANK = 40;

  /**
   * Size keywords → representative billion-parameter rank, scanned in array
   * order so the first (cheapest) match wins.
   */
  static readonly #KEYWORD_RANKS: readonly (readonly [string, number])[] = [
    ['nano', 1],
    ['instant', 6],
    ['flash', 8],
    ['haiku', 8],
    ['mini', 8],
    ['tiny', 8],
    ['lite', 8],
    ['small', 12],
    ['medium', 32],
    ['plus', 64],
    ['pro', 70],
    ['large', 80],
    ['max', 180],
    ['ultra', 200],
    ['opus', 200],
  ];

  /**
   * Cost rank from a model name alone. Lower is cheaper. Used by every adapter
   * whose provider exposes no richer cost signal.
   */
  static rankFromName(name: string): number {
    const lower = name.toLowerCase();
    if (lower.includes(':free')) return 0;
    const params = ModelCost.#paramBillions(lower);
    if (params !== null) return params;
    for (const [marker, rank] of ModelCost.#KEYWORD_RANKS) {
      if (lower.includes(marker)) return rank;
    }
    return ModelCost.DEFAULT_RANK;
  }

  /**
   * Cost rank for an OpenAI-style catalogue entry. When the provider reports
   * token pricing (OpenRouter), the sum of prompt + completion price is the
   * rank — a real per-token cost. Otherwise the name heuristic applies.
   */
  static rankFromOpenAiEntry(entry: OpenAiCostEntryType): number {
    const pricing = entry.pricing;
    if (pricing !== undefined) {
      const prompt = Number.parseFloat(pricing.prompt ?? '');
      const completion = Number.parseFloat(pricing.completion ?? '');
      return (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0);
    }
    return ModelCost.rankFromName(entry.id);
  }

  /**
   * Cost rank from an on-disk model size in bytes — Ollama's local-cost proxy
   * (a smaller pulled model is cheaper and faster to run). Falls back to the
   * name heuristic when the daemon omits a usable size.
   */
  static rankFromSize(name: string, sizeBytes: number | undefined): number {
    return sizeBytes !== undefined && Number.isFinite(sizeBytes) && sizeBytes > 0
      ? sizeBytes
      : ModelCost.rankFromName(name);
  }

  /** Parse a parameter count like `70b`, `405b`, `1.5b` → billions, or null. */
  static #paramBillions(lower: string): number | null {
    const match = /(?<![a-z0-9.])(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/u.exec(lower);
    if (match === null) return null;
    const value = Number.parseFloat(match[1] ?? '');
    return Number.isFinite(value) ? value : null;
  }
}
