import { DEFAULT_WEB_PROBES, WebSystemInfo } from '@studnicky/dagonizer-executor-web';

interface CartographerSystemCalibration {
  readonly workerCount: number;
  readonly maxTerminalHeapBytes: number;
  readonly maxFlushMs: number;
}

const MEBIBYTE = 1024 * 1024;
const BASE_RETAINED_HEAP_BYTES = 128 * MEBIBYTE;
const RETAINED_HEAP_PER_WORKER_BYTES = 32 * MEBIBYTE;
const FRAME_BUDGET_MS = 16;
const FLUSH_BUDGET_PER_WORKER_MS = 4;

export class CartographerSystemProbe {
  private constructor() { /* static-only */ }

  static workerCount(hardwareConcurrency: number = DEFAULT_WEB_PROBES.hardwareConcurrency): number {
    return new WebSystemInfo({ hardwareConcurrency }).recommendedWorkerCount({
      'maximumWorkers': 32,
      'mainThreadReservation': 2,
      'minimumWorkerCount': 1,
      'memoryPerWorkerBytes': null,
    });
  }

  static calibrate(
    hardwareConcurrency: number,
    poolSize: number,
    liveFlushMs: number,
  ): CartographerSystemCalibration {
    const workerCount = Math.max(CartographerSystemProbe.workerCount(hardwareConcurrency), poolSize);
    return {
      workerCount,
      'maxTerminalHeapBytes': BASE_RETAINED_HEAP_BYTES + (workerCount * RETAINED_HEAP_PER_WORKER_BYTES),
      'maxFlushMs': Math.max(
        FRAME_BUDGET_MS,
        Math.min(liveFlushMs, FRAME_BUDGET_MS + (workerCount * FLUSH_BUDGET_PER_WORKER_MS)),
      ),
    };
  }
}
