/**
 * Unit tests for the `./runner` module: `DagRunner`, `OnceTrigger`,
 * `CliTrigger`, `EventTrigger`, `RequestTrigger`.
 *
 * These tests run against the compiled `src/` tree directly (no dist needed).
 * Each test wires a minimal DAG + node + concrete runner subclass to verify
 * the canonical register→seed→execute→route→project loop.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DispatcherBundleType } from '../../src/contracts/DispatcherBundle.js';
import type { ExecuteOptionsType } from '../../src/contracts/ExecuteOptionsType.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import type { ExecutionResultType } from '../../src/entities/execution/ExecutionResult.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { CliTrigger } from '../../src/runner/CliTrigger.js';
import { DagRunner } from '../../src/runner/DagRunner.js';
import type { DagRunnerOptionsType } from '../../src/runner/DagRunner.js';
import { EventTrigger } from '../../src/runner/EventTrigger.js';
import { OnceTrigger } from '../../src/runner/OnceTrigger.js';
import { RequestTrigger } from '../../src/runner/RequestTrigger.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

// ---------------------------------------------------------------------------
// Shared state fixture
// ---------------------------------------------------------------------------

class RunnerState extends NodeStateBase {
  value = 0;
  log: string[] = [];
}

// ---------------------------------------------------------------------------
// Shared runner output type
// ---------------------------------------------------------------------------

type RunnerOutput = {
  variant: string;
  value: number;
};

// ---------------------------------------------------------------------------
// Concrete DagRunner subclass for testing
// ---------------------------------------------------------------------------

type TestInput = { value: number; label: string };

class TestDagRunner extends DagRunner<TestInput, RunnerState, RunnerOutput> {
  protected override seedState(input: TestInput): RunnerState {
    const state = new RunnerState();
    state.value = input.value;
    state.log.push(input.label);
    return state;
  }

  protected override projectResult(result: ExecutionResultType<RunnerState>): RunnerOutput {
    return {
      'variant': result.state.lifecycle.variant,
      'value': result.state.value,
    };
  }
}

// ---------------------------------------------------------------------------
// DAG + bundle fixture builders
// ---------------------------------------------------------------------------

/**
 * Build a minimal single-node DAG that routes 'done' to a terminal node.
 */
class RunnerTestBundle {
  private constructor() { /* static class */ }

  static incBundle(dagName: string): DispatcherBundleType<RunnerState> {
    const incNode = TestNode.make<RunnerState>('inc', ['done'], (state) => {
      state.value += 1;
      return 'done';
    });

    const dag: DAGType = TestDag.of(dagName, 'inc', [
      {
        '@id':   `urn:noocodex:dag:${dagName}/node/inc`,
        '@type': 'SingleNode',
        'name':  'inc',
        'node':  'inc',
        'outputs': { 'done': 'end' },
      },
      {
        '@id':    `urn:noocodex:dag:${dagName}/node/end`,
        '@type':  'TerminalNode',
        'name':   'end',
        'outcome': 'completed',
      },
    ]);

    return { 'nodes': [incNode], 'dags': [dag] };
  }
}

// ---------------------------------------------------------------------------
// Helper: build a fully wired TestDagRunner
// ---------------------------------------------------------------------------

class RunnerHarness {
  private constructor() { /* static class */ }

  static build(dagName: string): TestDagRunner {
    const dispatcher = new Dagonizer<RunnerState>();
    const options: DagRunnerOptionsType<RunnerState> = { 'dispatcher': dispatcher };
    const runner = new TestDagRunner(options);
    runner.registerBundle(RunnerTestBundle.incBundle(dagName));
    return runner;
  }
}

// ---------------------------------------------------------------------------
// DagRunner base
// ---------------------------------------------------------------------------

void describe('DagRunner', () => {
  void it('run() seeds state, executes DAG, and projects result', async () => {
    const runner = RunnerHarness.build('runner-once');
    const output = await runner.run('runner-once', { 'value': 10, 'label': 'test' });

    assert.equal(output.variant, 'completed');
    assert.equal(output.value, 11); // inc node adds 1
  });

  void it('run() collects node errors in state without throwing', async () => {
    const dispatcher = new Dagonizer<RunnerState>();
    // Node that routes to a phantom output (unwired) — engine marks state failed
    const rogueNode = TestNode.make<RunnerState>('rogue', ['ok'], () => 'phantom');
    const dag = TestDag.of('runner-rogue', 'rogue', [
      {
        '@id':   'urn:noocodex:dag:runner-rogue/node/rogue',
        '@type': 'SingleNode',
        'name':  'rogue',
        'node':  'rogue',
        'outputs': { 'ok': 'end' },
      },
      {
        '@id':    'urn:noocodex:dag:runner-rogue/node/end',
        '@type':  'TerminalNode',
        'name':   'end',
        'outcome': 'completed',
      },
    ]);

    const options: DagRunnerOptionsType<RunnerState> = { 'dispatcher': dispatcher };
    const runner = new TestDagRunner(options);
    runner.registerBundle({ 'nodes': [rogueNode], 'dags': [dag] });

    // run() must not throw; failed lifecycle is surfaced in the projected output
    const output = await runner.run('runner-rogue', { 'value': 0, 'label': 'rogue' });
    assert.equal(output.variant, 'failed');
  });

  void it('resume() calls dispatcher.resume with rehydrated state', async () => {
    const runner = RunnerHarness.build('runner-resume');

    // Seed a state as-if we loaded it from a checkpoint
    const rehydrated = new RunnerState();
    rehydrated.value = 42;

    // Resume from the 'inc' node — it will increment value to 43
    const output = await runner.resume('runner-resume', rehydrated, 'inc');
    assert.equal(output.variant, 'completed');
    assert.equal(output.value, 43);
  });
});

// ---------------------------------------------------------------------------
// OnceTrigger
// ---------------------------------------------------------------------------

void describe('OnceTrigger', () => {
  void it('fires the runner exactly once and exposes result', async () => {
    const runner = RunnerHarness.build('once-trigger');

    const trigger = new OnceTrigger<TestInput, RunnerState, RunnerOutput>(
      'once-trigger',
      { 'value': 5, 'label': 'once' },
    );

    await trigger.attach(runner);

    const result = trigger.result;
    assert.ok(result !== null);
    assert.equal(result.variant, 'completed');
    assert.equal(result.value, 6);
  });

  void it('detach before attach makes attach a no-op', async () => {
    const runner = RunnerHarness.build('once-detach');

    const trigger = new OnceTrigger<TestInput, RunnerState, RunnerOutput>(
      'once-detach',
      { 'value': 99, 'label': 'detach' },
    );

    await trigger.detach();
    await trigger.attach(runner); // should be no-op

    assert.equal(trigger.result, null);
  });
});

// ---------------------------------------------------------------------------
// CliTrigger
// ---------------------------------------------------------------------------

void describe('CliTrigger', () => {
  void it('parses argv args and fires the runner', async () => {
    const runner = RunnerHarness.build('cli-trigger');

    class TestCliTrigger extends CliTrigger<TestInput, RunnerState, RunnerOutput> {
      protected override parseArgs(_command: string, args: string[]): TestInput {
        const raw = args[0] !== undefined ? parseInt(args[0], 10) : 0;
        return { 'value': isNaN(raw) ? 0 : raw, 'label': 'cli' };
      }

      protected override selectDag(_command: string): string {
        return 'cli-trigger';
      }
    }

    const trigger = new TestCliTrigger('run', ['7']);
    await trigger.attach(runner);

    const result = trigger.result;
    assert.ok(result !== null);
    assert.equal(result.variant, 'completed');
    assert.equal(result.value, 8); // 7 + 1 from inc node
  });

  void it('default selectDag returns the command token', async () => {
    const runner = RunnerHarness.build('run');

    class PassthroughCliTrigger extends CliTrigger<TestInput, RunnerState, RunnerOutput> {
      protected override parseArgs(_command: string, _args: string[]): TestInput {
        return { 'value': 3, 'label': 'passthrough' };
      }
    }

    // Uses default selectDag → dag named 'run'
    const trigger = new PassthroughCliTrigger('run', []);
    await trigger.attach(runner);

    const result = trigger.result;
    assert.ok(result !== null);
    assert.equal(result.variant, 'completed');
    assert.equal(result.value, 4);
  });
});

// ---------------------------------------------------------------------------
// EventTrigger
// ---------------------------------------------------------------------------

void describe('EventTrigger', () => {
  void it('fires the runner once per subscribed message and resolves on detach', async () => {
    const results: RunnerOutput[] = [];

    // Wrap runner to capture outputs
    class CapturingRunner extends TestDagRunner {
      override async run(
        dagName: string,
        input: TestInput,
        options?: ExecuteOptionsType,
      ): Promise<RunnerOutput> {
        const output = await super.run(dagName, input, options);
        results.push(output);
        return output;
      }
    }

    const capturingOptions: DagRunnerOptionsType<RunnerState> = {
      'dispatcher': new Dagonizer<RunnerState>(),
    };
    const capturingRunner = new CapturingRunner(capturingOptions);
    capturingRunner.registerBundle(RunnerTestBundle.incBundle('event-trigger'));

    type TestMessage = { n: number };
    const handlers: Array<(msg: TestMessage) => void> = [];

    class TestEventTrigger extends EventTrigger<TestMessage, TestInput, RunnerState, RunnerOutput> {
      protected override subscribe(onMessage: (msg: TestMessage) => void): () => void {
        handlers.push(onMessage);
        return () => {
          const idx = handlers.indexOf(onMessage);
          if (idx !== -1) handlers.splice(idx, 1);
        };
      }

      protected override toInput(message: TestMessage): TestInput {
        return { 'value': message.n, 'label': 'event' };
      }

      protected override selectDag(_message: TestMessage): string {
        return 'event-trigger';
      }
    }

    const trigger = new TestEventTrigger();
    const attachPromise = trigger.attach(capturingRunner);

    // Simulate two inbound messages
    for (const handler of handlers) {
      handler({ 'n': 10 });
      handler({ 'n': 20 });
    }

    // Allow microtasks/promises to settle before detach
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Wait a bit more for run() promises to resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    await trigger.detach();
    await attachPromise;

    // Both messages were processed: 10+1=11, 20+1=21
    assert.equal(results.length, 2);
    const values = results.map((r) => r.value).sort((a, b) => a - b);
    assert.deepEqual(values, [11, 21]);
  });
});

// ---------------------------------------------------------------------------
// RequestTrigger
// ---------------------------------------------------------------------------

void describe('RequestTrigger', () => {
  void it('fire() executes the DAG with input built from the request', async () => {
    const runner = RunnerHarness.build('request-trigger');

    type TestRequest = { n: number };

    class TestRequestTrigger extends RequestTrigger<TestRequest, TestInput, RunnerState, RunnerOutput> {
      protected override toInput(request: TestRequest): TestInput {
        return { 'value': request.n, 'label': 'request' };
      }

      protected override selectDag(_request: TestRequest): string {
        return 'request-trigger';
      }
    }

    const trigger = new TestRequestTrigger();
    await trigger.attach(runner);

    const output = await trigger.fire({ 'n': 99 });
    assert.equal(output.variant, 'completed');
    assert.equal(output.value, 100); // 99 + 1
  });

  void it('fire() throws when called before attach', async () => {
    type TestRequest = { n: number };

    class TestRequestTrigger extends RequestTrigger<TestRequest, TestInput, RunnerState, RunnerOutput> {
      protected override toInput(request: TestRequest): TestInput {
        return { 'value': request.n, 'label': 'request' };
      }
    }

    const trigger = new TestRequestTrigger();
    await assert.rejects(
      () => trigger.fire({ 'n': 1 }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('before attach'));
        return true;
      },
    );
  });

  void it('detach() clears the runner reference so fire() throws after', async () => {
    const runner = RunnerHarness.build('request-detach');

    type TestRequest = { n: number };

    class TestRequestTrigger extends RequestTrigger<TestRequest, TestInput, RunnerState, RunnerOutput> {
      protected override toInput(request: TestRequest): TestInput {
        return { 'value': request.n, 'label': 'request' };
      }
      protected override selectDag(_request: TestRequest): string {
        return 'request-detach';
      }
    }

    const trigger = new TestRequestTrigger();
    await trigger.attach(runner);
    await trigger.detach();

    await assert.rejects(
      () => trigger.fire({ 'n': 1 }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });
});
