import type { AdaptiveConfigEntity } from '@studnicky/throttle';

import { DEFAULT_WRITE_POINTS, WritePointsSchema, type WritePointType } from '../../contracts/WritePoint.js';
import { DAGError } from '../../errors/index.js';

const AdaptiveConfigurationSchema = {
  'type': ['object', 'null'],
  'required': ['enabled'],
  'properties': {
    'enabled': { 'type': 'boolean' },
    'targetLatencyMs': { 'type': 'number', 'exclusiveMinimum': 0 },
    'minConcurrency': { 'type': 'integer', 'minimum': 1 },
    'maxConcurrency': { 'type': 'integer', 'minimum': 1 },
    'sampleWindow': { 'type': 'integer', 'minimum': 1 },
    'adjustmentInterval': { 'type': 'integer', 'minimum': 1 },
    'scaleUpThreshold': { 'type': 'number', 'exclusiveMinimum': 0 },
    'scaleDownThreshold': { 'type': 'number', 'exclusiveMinimum': 0 },
    'stepSize': { 'type': 'integer', 'minimum': 1 },
  },
  'additionalProperties': false,
} as const;

type TierType = DagConfiguration.InputType | undefined;
type ReservoirInputType = NonNullable<NonNullable<NonNullable<DagConfiguration.InputType['execution']>['batching']>['reservoir']>;
type ThrottleInputType = NonNullable<NonNullable<NonNullable<DagConfiguration.InputType['execution']>['batching']>['throttle']>;

function firstDefined<T>(...values: readonly (T | undefined)[]): T | undefined {
  return values.find((value) => value !== undefined);
}

function batchingOf(tier: TierType): DagConfiguration.BatchingInputType | undefined {
  return tier?.execution?.batching;
}

function resolveReservoir(global: TierType, dag: TierType, placement: TierType): DagConfiguration.ResolvedReservoirType | null {
  const placementReservoir = batchingOf(placement)?.reservoir;
  const dagReservoir = batchingOf(dag)?.reservoir;
  const globalReservoir = batchingOf(global)?.reservoir;
  const selected = firstDefined(placementReservoir, dagReservoir, globalReservoir, DagConfiguration.DEFAULT.execution.batching.reservoir);
  if (selected === null) return null;

  const layers: ReservoirInputType[] = [];
  for (const value of [placementReservoir, dagReservoir, globalReservoir]) {
    if (value === null) break;
    if (value !== undefined) layers.push(value);
  }
  return Object.freeze({
    'keyField': firstDefined(...layers.map((value) => value.keyField), DagConfiguration.DEFAULT.execution.batching.reservoir?.keyField) ?? null,
    'capacity': firstDefined(...layers.map((value) => value.capacity), DagConfiguration.DEFAULT.execution.batching.reservoir?.capacity) ?? 100,
    'idleMs': firstDefined(...layers.map((value) => value.idleMs), DagConfiguration.DEFAULT.execution.batching.reservoir?.idleMs) ?? null,
  });
}

function resolveAdaptive(layers: readonly ThrottleInputType[]): AdaptiveConfigEntity.AdaptiveConfigInputType | null {
  const selected = firstDefined(...layers.map((value) => value.adaptive));
  if (selected === undefined || selected === null) return null;

  const adaptiveLayers: AdaptiveConfigEntity.AdaptiveConfigInputType[] = [];
  for (const value of layers) {
    if (value.adaptive === null) break;
    if (value.adaptive !== undefined) adaptiveLayers.push(value.adaptive);
  }
  return Object.freeze(adaptiveLayers.reduceRight<AdaptiveConfigEntity.AdaptiveConfigInputType>(
    (resolved, value) => ({ ...resolved, ...value }),
    { 'enabled': selected.enabled },
  ));
}

function resolveThrottle(global: TierType, dag: TierType, placement: TierType): DagConfiguration.ResolvedThrottleType | null {
  const placementThrottle = batchingOf(placement)?.throttle;
  const dagThrottle = batchingOf(dag)?.throttle;
  const globalThrottle = batchingOf(global)?.throttle;
  const selected = firstDefined(placementThrottle, dagThrottle, globalThrottle);
  if (selected === undefined || selected === null) return null;

  const layers: ThrottleInputType[] = [];
  for (const value of [placementThrottle, dagThrottle, globalThrottle]) {
    if (value === null) break;
    if (value !== undefined) layers.push(value);
  }
  const concurrencyLimit = firstDefined(...layers.map((value) => value.concurrencyLimit));
  if (concurrencyLimit === undefined) {
    throw new DAGError('execution.batching.throttle requires concurrencyLimit', { 'code': 'CONFIGURATION_ERROR' });
  }
  return Object.freeze({
    concurrencyLimit,
    'adaptive': resolveAdaptive(layers),
  });
}

/** Serializable DAG policy and its deterministic inheritance contract. */
export class DagConfiguration {
  static readonly Schema = {
    'type': 'object',
    'properties': {
      'execution': {
        'type': 'object',
        'properties': {
          'batching': {
            'type': 'object',
            'properties': {
              'mode': { 'type': 'string', 'enum': ['item', 'reservoir'] },
              'concurrency': { 'type': 'integer', 'minimum': 1 },
              'throttle': {
                'oneOf': [
                  { 'type': 'null' },
                  {
                    'type': 'object',
                    'properties': {
                      'concurrencyLimit': { 'type': 'integer', 'minimum': 1 },
                      'adaptive': AdaptiveConfigurationSchema,
                    },
                    'additionalProperties': false,
                  },
                ],
              },
              'reservoir': {
                'oneOf': [
                  { 'type': 'null' },
                  {
                    'type': 'object',
                    'properties': {
                      'keyField': { 'type': ['string', 'null'], 'minLength': 1 },
                      'capacity': { 'type': 'integer', 'minimum': 1 },
                      'idleMs': { 'type': ['integer', 'null'], 'minimum': 1 },
                    },
                    'additionalProperties': false,
                  },
                ],
              },
            },
            'additionalProperties': false,
          },
        },
        'additionalProperties': false,
      },
      'durability': {
        'type': 'object',
        'properties': {
          'writePoints': WritePointsSchema,
          'foldJournalStoreKey': { 'type': ['string', 'null'], 'minLength': 1 },
        },
        'additionalProperties': false,
      },
    },
    'additionalProperties': false,
  } as const;

  static readonly DEFAULT: DagConfiguration.ResolvedType = Object.freeze({
    'execution': Object.freeze({
      'batching': Object.freeze({
        'mode': 'item',
        'concurrency': 1,
        'throttle': null,
        'reservoir': null,
      }),
    }),
    'durability': Object.freeze({
      'writePoints': Object.freeze([...DEFAULT_WRITE_POINTS]),
      'foldJournalStoreKey': null,
    }),
  });

  static resolve(
    global?: DagConfiguration.InputType,
    dag?: DagConfiguration.InputType,
    placement?: DagConfiguration.InputType,
  ): DagConfiguration.ResolvedType {
    const placementBatching = batchingOf(placement);
    const dagBatching = batchingOf(dag);
    const globalBatching = batchingOf(global);
    const mode = firstDefined(
      placementBatching?.mode,
      dagBatching?.mode,
      globalBatching?.mode,
      this.DEFAULT.execution.batching.mode,
    ) ?? 'item';
    const concurrency = firstDefined(
      placementBatching?.concurrency,
      dagBatching?.concurrency,
      globalBatching?.concurrency,
      this.DEFAULT.execution.batching.concurrency,
    ) ?? 1;
    const batching: DagConfiguration.ResolvedBatchingType = mode === 'item'
      ? Object.freeze({
          mode,
          concurrency,
          'throttle': resolveThrottle(global, dag, placement),
          'reservoir': null,
        })
      : DagConfiguration.reservoirBatching(global, dag, placement, concurrency);
    const writePoints = firstDefined(
      placement?.durability?.writePoints,
      dag?.durability?.writePoints,
      global?.durability?.writePoints,
      this.DEFAULT.durability.writePoints,
    ) ?? this.DEFAULT.durability.writePoints;
    return Object.freeze({
      'execution': Object.freeze({
        batching,
      }),
      'durability': Object.freeze({
        'writePoints': Object.freeze([...writePoints]),
        'foldJournalStoreKey': firstDefined(
          placement?.durability?.foldJournalStoreKey,
          dag?.durability?.foldJournalStoreKey,
          global?.durability?.foldJournalStoreKey,
          this.DEFAULT.durability.foldJournalStoreKey,
        ) ?? null,
      }),
    });
  }

  private static reservoirBatching(
    global: DagConfiguration.InputType | undefined,
    dag: DagConfiguration.InputType | undefined,
    placement: DagConfiguration.InputType | undefined,
    concurrency: number,
  ): DagConfiguration.ResolvedBatchingType {
    const reservoir = resolveReservoir(global, dag, placement);
    if (reservoir?.keyField === null || reservoir === null) {
      throw new DAGError('execution.batching mode reservoir requires reservoir.keyField', {
        'code': 'CONFIGURATION_ERROR',
      });
    }
    return Object.freeze({
      'mode': 'reservoir',
      concurrency,
      'throttle': null,
      'reservoir': Object.freeze({ ...reservoir, 'keyField': reservoir.keyField }),
    });
  }
}

export namespace DagConfiguration {
  export type BatchingInputType = {
    readonly mode?: 'item' | 'reservoir';
    readonly concurrency?: number;
    readonly throttle?: null | {
      readonly concurrencyLimit?: number;
      readonly adaptive?: AdaptiveConfigEntity.AdaptiveConfigInputType | null;
    };
    readonly reservoir?: null | {
      readonly keyField?: string | null;
      readonly capacity?: number;
      readonly idleMs?: number | null;
    };
  };

  export type InputType = {
    readonly execution?: { readonly batching?: BatchingInputType };
    readonly durability?: {
      readonly writePoints?: WritePointType[];
      readonly foldJournalStoreKey?: string | null;
    };
  };

  export type ResolvedReservoirType = {
    readonly keyField: string | null;
    readonly capacity: number;
    readonly idleMs: number | null;
  };

  export type ResolvedThrottleType = {
    readonly concurrencyLimit: number;
    readonly adaptive: AdaptiveConfigEntity.AdaptiveConfigInputType | null;
  };

  export type ResolvedBatchingType =
    | {
      readonly mode: 'item';
      readonly concurrency: number;
      readonly throttle: ResolvedThrottleType | null;
      readonly reservoir: null;
    }
    | {
      readonly mode: 'reservoir';
      readonly concurrency: number;
      readonly throttle: null;
      readonly reservoir: { readonly keyField: string; readonly capacity: number; readonly idleMs: number | null };
    };

  export type ResolvedType = {
    readonly execution: {
      readonly batching: ResolvedBatchingType;
    };
    readonly durability: {
      readonly writePoints: readonly WritePointType[];
      readonly foldJournalStoreKey: string | null;
    };
  };

}
