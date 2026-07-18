import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CartographerTelemetryContract } from '../../app/CartographerTelemetryContract.ts';
import { CartographerSystemProbe } from '../../app/CartographerSystemProbe.ts';
import type { CartographerBrowserTelemetryType } from '../../app/cartographerBrowserHarness.ts';
import { Continent } from '../../entities/Continent.ts';

function createValidResult(totalEvents = 10_000) {
  const hardwareConcurrency = 10;
  const budget = CartographerSystemProbe.calibrate(hardwareConcurrency, 4, 100);
  const telemetry: CartographerBrowserTelemetryType = {
    status: 'completed',
    progressPct: 100,
    processedCount: totalEvents,
    totalEvents,
    sampleRecordCount: 200,
    insightCount: Continent.values.length - 1,
    journeyCount: 100,
    errorMessage: null,
    flushCount: 100,
    averageFlushMs: 4,
    lastFlushMs: 5,
    maxFlushMs: budget.maxFlushMs,
    stateRefreshCount: 100,
    skippedStateRefreshCount: 0,
    graphMutationCount: 100,
    timestamp: Date.now(),
  };

  return {
    targetUrl: 'http://127.0.0.1:5175/?autorun=1',
    hardwareConcurrency,
    telemetry,
    browserMetrics: {
      TaskDuration: 1,
      ScriptDuration: 1,
      LayoutDuration: 1,
      RecalcStyleDuration: 1,
      rawJSHeapUsedSize: budget.maxTerminalHeapBytes + 1,
      retainedJSHeapUsedSize: budget.maxTerminalHeapBytes,
      Nodes: 100,
    },
    probeTimeoutCount: 0,
    trace: null,
    cpuAttribution: null,
    runDurationMs: 1000,
  };
}

describe('CartographerTelemetryContract', () => {
  it('calibrates heap and flush budgets from the shared worker probe policy', () => {
    const constrained = CartographerSystemProbe.calibrate(4, 1, 100);
    const parallel = CartographerSystemProbe.calibrate(12, 1, 100);
    const explicitPool = CartographerSystemProbe.calibrate(4, 8, 100);
    const shortCadence = CartographerSystemProbe.calibrate(12, 1, 24);

    assert.equal(constrained.workerCount, 2);
    assert.equal(parallel.workerCount, 10);
    assert.equal(explicitPool.workerCount, 8);
    assert.ok(parallel.maxTerminalHeapBytes > constrained.maxTerminalHeapBytes);
    assert.ok(explicitPool.maxTerminalHeapBytes > constrained.maxTerminalHeapBytes);
    assert.ok(parallel.maxFlushMs > constrained.maxFlushMs);
    assert.equal(shortCadence.maxFlushMs, 24);
  });

  it('preserves defaults and strictly parses every supported flag', () => {
    const defaults = CartographerTelemetryContract.parseArguments([]);
    assert.deepEqual(defaults, {
      totalEvents: 1000,
      poolSize: 4,
      batchCapacity: 100,
      reservoirIdleMs: 0,
      liveFlushMs: 100,
      loadTopology: false,
      trace: false,
      tracePath: '.orchestration/perf/cartographer-browser-trace.json',
      reportPath: '.orchestration/perf/cartographer-browser-report.json',
      timeoutMs: 180_000,
      chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      previewPort: 5175,
      chromeDebugPort: 9222,
    });

    const parsed = CartographerTelemetryContract.parseArguments([
      '--',
      '--total-events', '1000000',
      '--pool-size', '8',
      '--batch-capacity', '100',
      '--reservoir-idle-ms', '0',
      '--live-flush-ms', '100',
      '--timeout-ms', '600000',
      '--trace',
      '--trace-path', '/tmp/cartographer-browser-current-10k-trace.json',
      '--report-path', '/tmp/cartographer-browser-current-10k-report.json',
      '--chrome-path', '/opt/chrome',
      '--preview-port', '55175',
      '--chrome-debug-port', '59222',
      '--load-topology',
    ]);

    assert.deepEqual(parsed, {
      totalEvents: 1_000_000,
      poolSize: 8,
      batchCapacity: 100,
      reservoirIdleMs: 0,
      liveFlushMs: 100,
      loadTopology: true,
      trace: true,
      tracePath: '/tmp/cartographer-browser-current-10k-trace.json',
      reportPath: '/tmp/cartographer-browser-current-10k-report.json',
      timeoutMs: 600_000,
      chromePath: '/opt/chrome',
      previewPort: 55_175,
      chromeDebugPort: 59_222,
    });
  });

  it('accepts the exact section 9 telemetry invocations', () => {
    const traced = CartographerTelemetryContract.parseArguments([
      '--total-events', '10000', '--pool-size', '8', '--batch-capacity', '100',
      '--trace', '--trace-path', '/tmp/cartographer-browser-current-10k-trace.json',
    ]);
    const million = CartographerTelemetryContract.parseArguments([
      '--total-events', '1000000', '--pool-size', '8', '--batch-capacity', '100',
      '--timeout-ms', '600000',
    ]);

    assert.equal(traced.totalEvents, 10_000);
    assert.equal(traced.trace, true);
    assert.equal(million.totalEvents, 1_000_000);
    assert.equal(million.timeoutMs, 600_000);
  });

  it('rejects unknown flags', () => {
    assert.throws(
      () => CartographerTelemetryContract.parseArguments(['--unknown']),
      /Unknown CLI flag: --unknown/,
    );
  });

  it('rejects missing values', () => {
    assert.throws(
      () => CartographerTelemetryContract.parseArguments(['--total-events']),
      /Missing value for --total-events/,
    );
    assert.throws(
      () => CartographerTelemetryContract.parseArguments(['--trace-path', '--trace']),
      /Missing value for --trace-path/,
    );
  });

  it('rejects non-integer numeric values', () => {
    for (const value of ['ten', '10.5', '10events']) {
      assert.throws(
        () => CartographerTelemetryContract.parseArguments(['--total-events', value]),
        /must be an integer/,
      );
    }
  });

  it('rejects out-of-range numeric values', () => {
    const invalidArguments = [
      ['--total-events', '0'],
      ['--total-events', '1000001'],
      ['--pool-size', '33'],
      ['--batch-capacity', '10001'],
      ['--reservoir-idle-ms', '60001'],
      ['--live-flush-ms', '15'],
      ['--timeout-ms', '999'],
      ['--preview-port', '65536'],
      ['--chrome-debug-port', '0'],
    ];

    for (const argv of invalidArguments) {
      assert.throws(() => CartographerTelemetryContract.parseArguments(argv), /must be between/);
    }
  });

  it('accepts a valid result', () => {
    const options = CartographerTelemetryContract.parseArguments(['--total-events', '10000']);
    assert.doesNotThrow(() => CartographerTelemetryContract.assertResult(options, createValidResult()));
  });

  it('rejects status, error, total, processed count, progress, and probe timeout violations', () => {
    const options = CartographerTelemetryContract.parseArguments(['--total-events', '10000']);
    const valid = createValidResult();

    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        telemetry: { ...valid.telemetry, status: 'failed' },
      }),
      /status must be completed/,
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        telemetry: { ...valid.telemetry, errorMessage: 'failed' },
      }),
      /error must be null/,
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        telemetry: { ...valid.telemetry, totalEvents: 9999 },
      }),
      /telemetry total must equal requested total/,
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        telemetry: { ...valid.telemetry, processedCount: 9999 },
      }),
      /processed count must equal requested total/,
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        telemetry: { ...valid.telemetry, progressPct: 99 },
      }),
      /progress must be 100/,
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, { ...valid, probeTimeoutCount: 1 }),
      /probe timeout count must be zero/,
    );
  });

  it('rejects invalid raw terminal heap evidence', () => {
    const options = CartographerTelemetryContract.parseArguments(['--total-events', '10000']);
    const valid = createValidResult();

    for (const rawJSHeapUsedSize of [null, Number.NaN, 0]) {
      assert.throws(
        () => CartographerTelemetryContract.assertResult(options, {
          ...valid,
          browserMetrics: { ...valid.browserMetrics, rawJSHeapUsedSize },
        }),
        /raw terminal JS heap must be finite and positive/,
      );
    }
  });

  it('rejects invalid retained terminal heap evidence', () => {
    const options = CartographerTelemetryContract.parseArguments(['--total-events', '10000']);
    const valid = createValidResult();
    const budget = CartographerSystemProbe.calibrate(
      valid.hardwareConcurrency,
      options.poolSize,
      options.liveFlushMs,
    );

    for (const retainedJSHeapUsedSize of [null, Number.NaN, 0, budget.maxTerminalHeapBytes + 1]) {
      assert.throws(
        () => CartographerTelemetryContract.assertResult(options, {
          ...valid,
          browserMetrics: { ...valid.browserMetrics, retainedJSHeapUsedSize },
        }),
        /retained terminal JS heap must be finite, positive/,
      );
    }
  });

  it('rejects bounded-count overflow and required-run count mismatches', () => {
    const options = CartographerTelemetryContract.parseArguments(['--total-events', '10000']);
    const valid = createValidResult();

    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        telemetry: { ...valid.telemetry, sampleRecordCount: 201 },
      }),
      /record count must be an integer between 0 and 200/,
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        telemetry: { ...valid.telemetry, insightCount: Continent.values.length + 1 },
      }),
      new RegExp(`insight count must be an integer between 0 and ${Continent.values.length}`),
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        telemetry: { ...valid.telemetry, journeyCount: 101 },
      }),
      /journey count must be an integer between 0 and 100/,
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        telemetry: { ...valid.telemetry, sampleRecordCount: 199 },
      }),
      /record count must equal 200 for required runs/,
    );
    assert.doesNotThrow(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        telemetry: { ...valid.telemetry, insightCount: Continent.values.length - 2 },
      }),
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        telemetry: { ...valid.telemetry, journeyCount: 99 },
      }),
      /journey count must equal 100 for required runs/,
    );
  });

  it('rejects negative, non-finite, and excessive maximum flush duration', () => {
    const options = CartographerTelemetryContract.parseArguments(['--total-events', '10000']);
    const valid = createValidResult();
    const budget = CartographerSystemProbe.calibrate(
      valid.hardwareConcurrency,
      options.poolSize,
      options.liveFlushMs,
    );

    for (const maxFlushMs of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, budget.maxFlushMs + 0.01]) {
      assert.throws(
        () => CartographerTelemetryContract.assertResult(options, {
          ...valid,
          telemetry: { ...valid.telemetry, maxFlushMs },
        }),
        /maximum flush must be finite, non-negative, and at most/,
      );
    }
  });

  it('rejects invalid hardware probe evidence', () => {
    const options = CartographerTelemetryContract.parseArguments(['--total-events', '10000']);
    const valid = createValidResult();

    for (const hardwareConcurrency of [0, Number.NaN, 1.5]) {
      assert.throws(
        () => CartographerTelemetryContract.assertResult(options, { ...valid, hardwareConcurrency }),
        /hardware concurrency must be a positive integer/,
      );
    }
  });

  it('rejects non-finite and non-positive run duration evidence', () => {
    const options = CartographerTelemetryContract.parseArguments(['--total-events', '10000']);
    const valid = createValidResult();

    for (const runDurationMs of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      assert.throws(
        () => CartographerTelemetryContract.assertResult(options, { ...valid, runDurationMs }),
        /run duration must be finite and positive/,
      );
    }
  });

  it('persists parseable trace JSON and reports exact evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cartographer-trace-contract-'));
    const tracePath = join(directory, 'nested', 'trace.json');

    try {
      const trace = await CartographerTelemetryContract.persistTrace(tracePath, [
        { name: 'first', timestamp: 1 },
        { name: 'second', timestamp: 2 },
      ]);
      const contents = await readFile(tracePath, 'utf8');

      assert.deepEqual(JSON.parse(contents), {
        traceEvents: [
          { name: 'first', timestamp: 1 },
          { name: 'second', timestamp: 2 },
        ],
      });
      assert.equal(trace.path, tracePath);
      assert.equal(trace.eventCount, 2);
      assert.equal(trace.byteCount, Buffer.byteLength(contents, 'utf8'));
      assert.match(trace.sha256, /^[a-f0-9]{64}$/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects every invalid trace evidence class', () => {
    const options = CartographerTelemetryContract.parseArguments([
      '--total-events', '10000', '--trace', '--trace-path', '/tmp/trace.json',
    ]);
    const valid = {
      ...createValidResult(),
      trace: {
        path: '/tmp/trace.json',
        eventCount: 1,
        byteCount: 32,
        sha256: 'a'.repeat(64),
      },
    };

    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, { ...valid, trace: null }),
      /trace evidence must be present/,
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        trace: { ...valid.trace, path: '/tmp/wrong.json' },
      }),
      /trace path must equal the requested path/,
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        trace: { ...valid.trace, eventCount: 0 },
      }),
      /trace event count must be a positive integer/,
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        trace: { ...valid.trace, byteCount: 0 },
      }),
      /trace byte count must be a positive integer/,
    );
    assert.throws(
      () => CartographerTelemetryContract.assertResult(options, {
        ...valid,
        trace: { ...valid.trace, sha256: 'invalid' },
      }),
      /trace SHA-256 must be a 64-character lowercase hexadecimal digest/,
    );
  });
});
