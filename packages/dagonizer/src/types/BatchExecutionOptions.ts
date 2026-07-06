import type { AdaptiveConfigEntity } from '@studnicky/throttle';
import type { TimingInterface } from '@studnicky/timing/interfaces';

export type BatchExecutionThrottleOptionsType = {
  readonly concurrencyLimit: number;
  readonly adaptive?: AdaptiveConfigEntity.AdaptiveConfigInputType;
};

export type BatchExecutionOptionsType = {
  readonly concurrency?: number;
  readonly throttle?: BatchExecutionThrottleOptionsType | null;
  readonly timing?: TimingInterface | null;
};
