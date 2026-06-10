/**
 * 22-backoff-strategies/dags: pure module — flaky stub and delay-recording helper.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/22-backoff-strategies.ts (the executable entry point).
 */

/**
 * A flaky operation stub that always fails `failCount` times then succeeds.
 * Per-instance so each strategy run gets an independent failure sequence.
 */
export class FlakyStub {
  readonly #failCount: number;
  #attempts = 0;

  constructor(failCount: number) {
    this.#failCount = failCount;
  }

  get attempts(): number { return this.#attempts; }

  async call(): Promise<string> {
    this.#attempts++;
    if (this.#attempts <= this.#failCount) {
      throw new Error(`transient failure #${String(this.#attempts)}`);
    }
    return 'ok';
  }
}
