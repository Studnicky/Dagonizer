import type { AdaptiveConfigEntity } from '@studnicky/throttle';

export type BatchExecutionThrottleOptionsType = {
  readonly concurrencyLimit: number;
  readonly adaptive?: AdaptiveConfigEntity.AdaptiveConfigInputType;
};

export type BatchExecutionOptionsType = {
  readonly concurrency?: number;
  readonly throttle?: BatchExecutionThrottleOptionsType | null;
};
