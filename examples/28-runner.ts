/**
 * 28-runner: DagRunner and triggers.
 *
 * Demonstrates the `DagRunner` abstract base class and the concrete trigger
 * variants that decide WHEN the runner fires. The canonical register→seed→
 * execute→route→project loop lives inside `DagRunner` once; subclasses only
 * override `seedState` and `projectResult`.
 *
 * Triggers covered:
 *   - `OnceTrigger`  — fire exactly once with a literal input value
 *   - `CliTrigger`   — fire once from parsed `process.argv` tokens
 *
 * `EventTrigger` and `RequestTrigger` are shown as brief stub examples at the
 * bottom. For full API details see docs/reference/runner.md.
 *
 * DAG definition (state, nodes, dag): examples/dags/28-runner.ts
 *
 * Run: npx tsx examples/28-runner.ts
 * Run (CLI trigger): npx tsx examples/28-runner.ts "Hello world from the CLI"
 */

// #region imports
import { Dagonizer } from '@studnicky/dagonizer';
import type { ExecutionResultType } from '@studnicky/dagonizer';

import { DagRunner } from '@studnicky/dagonizer/runner';
import type { DagRunnerOptionsType } from '@studnicky/dagonizer/runner';
import { OnceTrigger }    from '@studnicky/dagonizer/runner';
import { CliTrigger }     from '@studnicky/dagonizer/runner';
import { EventTrigger }   from '@studnicky/dagonizer/runner';
import { RequestTrigger } from '@studnicky/dagonizer/runner';

import { WordState, TrimNode, CountNode, dag } from './dags/28-runner.js';
// #endregion imports

// ---------------------------------------------------------------------------
// Domain output type
// ---------------------------------------------------------------------------

// #region output-type
/** What the runner returns to its caller. */
type WordCountOutput = {
  readonly words:     number;
  readonly lifecycle: string;
};
// #endregion output-type

// ---------------------------------------------------------------------------
// Concrete DagRunner subclass
// ---------------------------------------------------------------------------

// #region runner
/**
 * WordCountInput: the trigger-specific input the runner expects.
 * `seedState` maps it onto the DAG state.
 */
type WordCountInput = { text: string };

/**
 * WordCountRunner: subclass that owns the seedState ↔ projectResult mapping.
 *
 * `seedState`    — builds a fresh `WordState` from the trigger input.
 * `projectResult` — extracts the word count and lifecycle variant.
 *
 * No other logic lives here; the engine loop runs in `DagRunner`.
 */
class WordCountRunner extends DagRunner<WordCountInput, WordState, WordCountOutput> {
  protected override seedState(input: WordCountInput): WordState {
    const state = new WordState();
    state.text = input.text;
    return state;
  }

  protected override projectResult(result: ExecutionResultType<WordState>): WordCountOutput {
    return {
      'words':     result.state.words,
      'lifecycle': result.state.lifecycle.variant,
    };
  }
}
// #endregion runner

// ---------------------------------------------------------------------------
// Runner factory
// ---------------------------------------------------------------------------

// #region harness
/**
 * WordCountHarness: builds a fully wired WordCountRunner in one call.
 */
class WordCountHarness {
  private constructor() { /* static class */ }

  static build(): WordCountRunner {
    const dispatcher = new Dagonizer<WordState>();
    dispatcher.registerNode(new TrimNode());
    dispatcher.registerNode(new CountNode());
    dispatcher.registerDAG(dag);

    const options: DagRunnerOptionsType<WordState> = { 'dispatcher': dispatcher };
    return new WordCountRunner(options);
  }
}
// #endregion harness

// ---------------------------------------------------------------------------
// OnceTrigger: fire exactly once with a literal input
// ---------------------------------------------------------------------------

// #region once-trigger
const onceRunner  = WordCountHarness.build();
const onceTrigger = new OnceTrigger<WordCountInput, WordState, WordCountOutput>(
  'word-count',
  { 'text': '  The quick brown fox jumps over the lazy dog  ' },
);

await onceTrigger.attach(onceRunner);
const onceResult = onceTrigger.result;
// #endregion once-trigger

process.stdout.write('\nOnceTrigger:\n');
process.stdout.write(`  input  = "  The quick brown fox jumps over the lazy dog  "\n`);
process.stdout.write(`  words  = ${String(onceResult?.words)}\n`);
process.stdout.write(`  status = ${onceResult?.lifecycle}\n`);

// ---------------------------------------------------------------------------
// CliTrigger: parse process.argv and fire the runner once
// ---------------------------------------------------------------------------

// #region cli-trigger
/**
 * WordCountCliTrigger: maps the first argv token (after the command) to
 * `{ text }` input for the runner.
 *
 * Consumers override `parseArgs` to produce the concrete `TInput` shape;
 * `selectDag` maps the command token to a registered DAG name (defaults to
 * the command token when not overridden, so 'word-count' selects directly).
 */
class WordCountCliTrigger extends CliTrigger<WordCountInput, WordState, WordCountOutput> {
  protected override parseArgs(_command: string, args: string[]): WordCountInput {
    // Join all remaining args as the text (supports quoted phrases from argv)
    const text = args.join(' ').trim();
    return { 'text': text.length > 0 ? text : 'no text supplied' };
  }

  protected override selectDag(_command: string): string {
    return 'word-count';
  }
}
// #endregion cli-trigger

const cliRunner  = WordCountHarness.build();
// argv: ['tsx', '28-runner.ts', ...user-supplied args]
// Slice off 'tsx' and the script name; the command token is 'word-count'.
const argv = process.argv.slice(2);
const cliTrigger = new WordCountCliTrigger('word-count', argv);

await cliTrigger.attach(cliRunner);
const cliResult = cliTrigger.result;

process.stdout.write('\nCliTrigger:\n');
process.stdout.write(`  argv   = [${argv.map((a) => `"${a}"`).join(', ')}]\n`);
process.stdout.write(`  words  = ${String(cliResult?.words)}\n`);
process.stdout.write(`  status = ${cliResult?.lifecycle}\n`);

// ---------------------------------------------------------------------------
// EventTrigger stub: one message per subscription event
// ---------------------------------------------------------------------------

// #region event-trigger
/**
 * EventTrigger stub: attach, emit one synthetic message, then detach.
 * In production, `subscribe` wires to a real event source (WebSocket,
 * EventEmitter, message queue) and `detach` tears down the listener.
 */
type WordCountMessage = { text: string };

class WordCountEventTrigger extends EventTrigger<WordCountMessage, WordCountInput, WordState, WordCountOutput> {
  readonly #handlers: Array<(msg: WordCountMessage) => void> = [];

  protected override subscribe(onMessage: (msg: WordCountMessage) => void): () => void {
    this.#handlers.push(onMessage);
    return () => {
      const idx = this.#handlers.indexOf(onMessage);
      if (idx !== -1) this.#handlers.splice(idx, 1);
    };
  }

  protected override toInput(message: WordCountMessage): WordCountInput {
    return { 'text': message.text };
  }

  protected override selectDag(_message: WordCountMessage): string {
    return 'word-count';
  }

  /** Emit a synthetic message to the attached handlers. */
  emit(msg: WordCountMessage): void {
    for (const h of this.#handlers) h(msg);
  }
}
// #endregion event-trigger

const eventRunner  = WordCountHarness.build();
const eventTrigger = new WordCountEventTrigger();
const attachPromise = eventTrigger.attach(eventRunner);
eventTrigger.emit({ 'text': 'one two three four' });
await new Promise<void>((resolve) => setImmediate(resolve));
await eventTrigger.detach();
await attachPromise;
process.stdout.write('\nEventTrigger: emitted "one two three four" (4 words expected)\n');

// ---------------------------------------------------------------------------
// RequestTrigger stub: per-turn HTTP handler pattern
// ---------------------------------------------------------------------------

// #region request-trigger
/**
 * RequestTrigger stub: `fire(request)` is the entry point from an HTTP handler
 * or turn loop. `attach` stores the runner reference; `detach` clears it.
 */
type WordCountRequest = { body: string };

class WordCountRequestTrigger extends RequestTrigger<WordCountRequest, WordCountInput, WordState, WordCountOutput> {
  protected override toInput(request: WordCountRequest): WordCountInput {
    return { 'text': request.body };
  }

  protected override selectDag(_request: WordCountRequest): string {
    return 'word-count';
  }
}
// #endregion request-trigger

const requestRunner  = WordCountHarness.build();
const requestTrigger = new WordCountRequestTrigger();
await requestTrigger.attach(requestRunner);
const requestResult = await requestTrigger.fire({ 'body': 'alpha beta gamma' });
process.stdout.write(`\nRequestTrigger: fired with "alpha beta gamma"\n`);
process.stdout.write(`  words  = ${String(requestResult.words)}\n`);
process.stdout.write(`  status = ${requestResult.lifecycle}\n`);

process.stdout.write('\nLesson: DagRunner owns the register→seed→execute→project loop once.\n');
process.stdout.write('        Triggers decide WHEN the runner fires.\n');
