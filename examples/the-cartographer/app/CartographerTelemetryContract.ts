import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { JsonValueType } from '@studnicky/dagonizer/entities';

import { Continent } from '../entities/Continent.ts';
import { CartographerSystemProbe } from './CartographerSystemProbe.ts';
import type { CartographerBrowserTelemetryType } from './cartographerBrowserHarness.ts';
import type { CpuAttributionEntry } from './CpuAttributionEntry.ts';

interface CartographerTelemetryOptions {
  readonly totalEvents: number;
  readonly poolSize: number;
  readonly batchCapacity: number;
  readonly reservoirIdleMs: number;
  readonly liveFlushMs: number;
  readonly loadTopology: boolean;
  readonly trace: boolean;
  readonly tracePath: string;
  readonly reportPath: string;
  readonly timeoutMs: number;
  readonly chromePath: string;
  readonly previewPort: number;
  readonly chromeDebugPort: number;
}

interface CartographerTraceEvidence {
  readonly path: string;
  readonly eventCount: number;
  readonly byteCount: number;
  readonly sha256: string;
}

interface CartographerTelemetryResult {
  readonly hardwareConcurrency: number;
  readonly telemetry: CartographerBrowserTelemetryType;
  readonly browserMetrics: {
    readonly rawJSHeapUsedSize: number | null;
    readonly retainedJSHeapUsedSize: number | null;
  };
  readonly probeTimeoutCount: number;
  readonly trace: CartographerTraceEvidence | null;
  readonly cpuAttribution: readonly CpuAttributionEntry[] | null;
  readonly runDurationMs: number;
}

const MAX_RECORD_COUNT = 200;
const MAX_INSIGHT_COUNT = Continent.values.length;
const MAX_JOURNEY_COUNT = 100;
const REQUIRED_BOUNDED_COUNTS_TOTAL = 10_000;

export class CartographerTelemetryContract {
  private constructor() {}

  static parseArguments(argv: readonly string[]): CartographerTelemetryOptions {
    const options = {
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
    };

    for (let index = 0; index < argv.length; index += 1) {
      const flag = argv[index];
      switch (flag) {
        case '--':
          break;
        case '--total-events':
          options.totalEvents = this.#parseInteger(argv, index, flag, 1, 1_000_000);
          index += 1;
          break;
        case '--pool-size':
          options.poolSize = this.#parseInteger(argv, index, flag, 1, 32);
          index += 1;
          break;
        case '--batch-capacity':
          options.batchCapacity = this.#parseInteger(argv, index, flag, 1, 10_000);
          index += 1;
          break;
        case '--reservoir-idle-ms':
          options.reservoirIdleMs = this.#parseInteger(argv, index, flag, 0, 60_000);
          index += 1;
          break;
        case '--live-flush-ms':
          options.liveFlushMs = this.#parseInteger(argv, index, flag, 16, 5_000);
          index += 1;
          break;
        case '--timeout-ms':
          options.timeoutMs = this.#parseInteger(argv, index, flag, 1000, Number.MAX_SAFE_INTEGER);
          index += 1;
          break;
        case '--trace-path':
          options.tracePath = this.#readValue(argv, index, flag);
          index += 1;
          break;
        case '--report-path':
          options.reportPath = this.#readValue(argv, index, flag);
          index += 1;
          break;
        case '--chrome-path':
          options.chromePath = this.#readValue(argv, index, flag);
          index += 1;
          break;
        case '--preview-port':
          options.previewPort = this.#parseInteger(argv, index, flag, 1, 65_535);
          index += 1;
          break;
        case '--chrome-debug-port':
          options.chromeDebugPort = this.#parseInteger(argv, index, flag, 1, 65_535);
          index += 1;
          break;
        case '--load-topology':
          options.loadTopology = true;
          break;
        case '--trace':
          options.trace = true;
          break;
        case undefined:
          throw new Error('CLI argument cannot be undefined');
        default:
          throw new Error(`Unknown CLI flag: ${flag}`);
      }
    }

    return options;
  }

  static async persistTrace(
    tracePath: string,
    traceEvents: readonly JsonValueType[],
  ): Promise<CartographerTraceEvidence> {
    if (tracePath.length === 0) throw new Error('Trace path must not be empty');

    const traceJson = `${JSON.stringify({ traceEvents })}\n`;
    await mkdir(dirname(tracePath), { recursive: true });
    await writeFile(tracePath, traceJson, 'utf8');

    return {
      path: tracePath,
      eventCount: traceEvents.length,
      byteCount: Buffer.byteLength(traceJson, 'utf8'),
      sha256: createHash('sha256').update(traceJson, 'utf8').digest('hex'),
    };
  }

  static async persistReport(reportPath: string, report: object): Promise<void> {
    if (reportPath.length === 0) throw new Error('Report path must not be empty');

    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  static assertResult(
    options: CartographerTelemetryOptions,
    result: CartographerTelemetryResult,
  ): void {
    const violations: string[] = [];
    const { telemetry } = result;
    const budget = CartographerSystemProbe.calibrate(
      result.hardwareConcurrency,
      options.poolSize,
      options.liveFlushMs,
    );

    if (!Number.isInteger(result.hardwareConcurrency) || result.hardwareConcurrency <= 0) {
      violations.push(`hardware concurrency must be a positive integer, received ${result.hardwareConcurrency}`);
    }

    if (telemetry.status !== 'completed') {
      violations.push(`status must be completed, received ${telemetry.status}`);
    }
    if (telemetry.errorMessage !== null) {
      violations.push(`error must be null, received ${telemetry.errorMessage}`);
    }
    if (telemetry.totalEvents !== options.totalEvents) {
      violations.push(`telemetry total must equal requested total ${options.totalEvents}, received ${telemetry.totalEvents}`);
    }
    if (telemetry.processedCount !== options.totalEvents) {
      violations.push(`processed count must equal requested total ${options.totalEvents}, received ${telemetry.processedCount}`);
    }
    if (telemetry.progressPct !== 100) {
      violations.push(`progress must be 100, received ${telemetry.progressPct}`);
    }
    if (result.probeTimeoutCount !== 0) {
      violations.push(`probe timeout count must be zero, received ${result.probeTimeoutCount}`);
    }

    const rawTerminalHeapBytes = result.browserMetrics.rawJSHeapUsedSize;
    if (
      rawTerminalHeapBytes === null
      || !Number.isFinite(rawTerminalHeapBytes)
      || rawTerminalHeapBytes <= 0
    ) {
      violations.push(`raw terminal JS heap must be finite and positive, received ${rawTerminalHeapBytes}`);
    }

    const retainedTerminalHeapBytes = result.browserMetrics.retainedJSHeapUsedSize;
    if (
      retainedTerminalHeapBytes === null
      || !Number.isFinite(retainedTerminalHeapBytes)
      || retainedTerminalHeapBytes <= 0
      || retainedTerminalHeapBytes > budget.maxTerminalHeapBytes
    ) {
      violations.push(`retained terminal JS heap must be finite, positive, and at most ${budget.maxTerminalHeapBytes} bytes for ${budget.workerCount} workers, received ${retainedTerminalHeapBytes}`);
    }

    this.#validateBoundedCount(violations, 'record count', telemetry.sampleRecordCount, MAX_RECORD_COUNT);
    this.#validateBoundedCount(violations, 'insight count', telemetry.insightCount, MAX_INSIGHT_COUNT);
    this.#validateBoundedCount(violations, 'journey count', telemetry.journeyCount, MAX_JOURNEY_COUNT);

    if (options.totalEvents >= REQUIRED_BOUNDED_COUNTS_TOTAL) {
      if (telemetry.sampleRecordCount !== MAX_RECORD_COUNT) {
        violations.push(`record count must equal ${MAX_RECORD_COUNT} for required runs, received ${telemetry.sampleRecordCount}`);
      }
      if (telemetry.journeyCount !== MAX_JOURNEY_COUNT) {
        violations.push(`journey count must equal ${MAX_JOURNEY_COUNT} for required runs, received ${telemetry.journeyCount}`);
      }
    }

    if (!Number.isFinite(telemetry.maxFlushMs) || telemetry.maxFlushMs < 0 || telemetry.maxFlushMs > budget.maxFlushMs) {
      violations.push(`maximum flush must be finite, non-negative, and at most ${budget.maxFlushMs}ms for ${budget.workerCount} workers, received ${telemetry.maxFlushMs}`);
    }
    if (!Number.isFinite(result.runDurationMs) || result.runDurationMs <= 0) {
      violations.push(`run duration must be finite and positive, received ${result.runDurationMs}`);
    }

    if (options.trace) this.#validateTraceEvidence(violations, options.tracePath, result.trace);

    if (violations.length > 0) {
      throw new Error(`Cartographer telemetry gate failed:\n${violations.map((violation) => `- ${violation}`).join('\n')}`);
    }
  }

  static #readValue(argv: readonly string[], flagIndex: number, flag: string): string {
    const value = argv[flagIndex + 1];
    if (value === undefined || value.length === 0 || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  }

  static #parseInteger(
    argv: readonly string[],
    flagIndex: number,
    flag: string,
    minimum: number,
    maximum: number,
  ): number {
    const value = this.#readValue(argv, flagIndex, flag);
    if (!/^\d+$/.test(value)) throw new Error(`Value for ${flag} must be an integer, received ${value}`);

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(`Value for ${flag} must be a safe integer, received ${value}`);
    }
    if (parsed < minimum || parsed > maximum) {
      throw new Error(`Value for ${flag} must be between ${minimum} and ${maximum}, received ${value}`);
    }
    return parsed;
  }

  static #validateBoundedCount(
    violations: string[],
    label: string,
    count: number,
    maximum: number,
  ): void {
    if (!Number.isInteger(count) || count < 0 || count > maximum) {
      violations.push(`${label} must be an integer between 0 and ${maximum}, received ${count}`);
    }
  }

  static #validateTraceEvidence(
    violations: string[],
    requestedPath: string,
    trace: CartographerTraceEvidence | null,
  ): void {
    if (trace === null) {
      violations.push('trace evidence must be present when --trace is enabled');
      return;
    }
    if (trace.path.length === 0 || trace.path !== requestedPath) {
      violations.push(`trace path must equal the requested path ${requestedPath}, received ${trace.path}`);
    }
    if (!Number.isInteger(trace.eventCount) || trace.eventCount <= 0) {
      violations.push(`trace event count must be a positive integer, received ${trace.eventCount}`);
    }
    if (!Number.isInteger(trace.byteCount) || trace.byteCount <= 0) {
      violations.push(`trace byte count must be a positive integer, received ${trace.byteCount}`);
    }
    if (!/^[a-f0-9]{64}$/.test(trace.sha256)) {
      violations.push(`trace SHA-256 must be a 64-character lowercase hexadecimal digest, received ${trace.sha256}`);
    }
  }
}
