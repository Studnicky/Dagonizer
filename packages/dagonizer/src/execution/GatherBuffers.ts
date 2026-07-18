import type { GatherRecordType } from '../contracts/GatherExecution.js';
import type { GraphScopeType } from '../contracts/GraphDatasetProviderInterface.js';
import { GatherStrategies } from '../core/GatherStrategies.js';
import type { GatherConfigType } from '../entities/dag/GatherConfig.js';
import type { GatherNodeType } from '../entities/dag/GatherNode.js';
import { GatherNodeDefaults } from '../entities/dag/GatherNode.js';
import type { GatherProgressType, GatherRecordProgressType } from '../entities/gather/GatherProgress.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { GatherRouteRecordType } from './Gather.js';

export type GatherReadyRecordsType = {
  readonly records: readonly GatherRecordType[];
  readonly routeRecords: readonly GatherRouteRecordType[];
  readonly preReduced: boolean;
};

type GatherReducedSummaryType = {
  readonly source: string;
  readonly output: string;
  readonly terminalOutcome: 'completed' | 'failed' | null;
  readonly contribution?: unknown;
};

type GatherProgressRestoreOptionsType = {
  // Validates a contribution record and returns a commit thunk. The thunk
  // must be the only part of restore() that mutates parent state, so every
  // record across the whole restore() call can be validated before any of
  // them are applied.
  readonly deriveContribution: (gatherKey: string, record: GatherRecordProgressType) => () => void;
};

export class GatherBuffers {
  readonly #records = new Map<string, Map<string, GatherRecordType>>();
  readonly #reduced = new Map<string, Map<string, GatherReducedSummaryType>>();
  #scalarOrdinal = 0;

  add(gatherKey: string, record: GatherRecordType): void {
    let records = this.#records.get(gatherKey);
    if (records === undefined) {
      records = new Map<string, GatherRecordType>();
      this.#records.set(gatherKey, records);
    }
    records.set(this.#recordKey(record), record);
  }

  isEmpty(): boolean {
    return this.#records.size === 0 && this.#reduced.size === 0;
  }

  ready(node: GatherNodeType, gatherKey: string): boolean {
    const records = this.#combinedRecords(gatherKey);
    if (records.length === 0) return false;
    const policy = GatherNodeDefaults.policy(node);
    const sources = Object.keys(node.sources);
    const seenSources = new Set(
      records
        .map((record) => record.source)
        .filter((source) => sources.includes(source)),
    );
    if (policy.mode === 'any') return seenSources.size > 0;
    if (policy.mode === 'quorum') return seenSources.size >= (policy.quorum ?? sources.length);
    return sources.every((source) => seenSources.has(source));
  }

  takeReady(node: GatherNodeType, gatherKey: string): GatherReadyRecordsType {
    if (!this.ready(node, gatherKey)) return { 'records': [], 'routeRecords': [], 'preReduced': false };
    const fullRecords = this.#records.get(gatherKey);
    const reducedRecords = this.#reduced.get(gatherKey);
    this.#records.delete(gatherKey);
    this.#reduced.delete(gatherKey);
    const records = fullRecords === undefined ? [] : [...fullRecords.values()];
    const reduced = reducedRecords === undefined ? [] : [...reducedRecords.values()];
    const policy = GatherNodeDefaults.policy(node);
    const allRouteRecords = [...records, ...reduced];
    const selectedSources = GatherBuffers.selectedSources(Object.keys(node.sources), allRouteRecords, policy.mode, policy.quorum);
    const selectedRecords = GatherBuffers.recordsForSources(records, selectedSources, policy.includeErrors);
    const routeRecords = GatherBuffers.routeRecordsForSources(allRouteRecords, selectedSources, policy.includeErrors);
    return {
      'records': selectedRecords,
      routeRecords,
      'preReduced': reduced.length > 0,
    };
  }

  async restore(
    progress: GatherProgressType,
    state: NodeStateInterface,
    options: GatherProgressRestoreOptionsType,
  ): Promise<void> {
    // Two passes: derive (validate, no mutation) every contribution record
    // across the whole restore() call before committing (mutating parent
    // state) any of them. A malformed record anywhere in the set must leave
    // every other record's state mutation un-applied.
    const pendingCommits: Array<{ readonly gatherKey: string; readonly record: GatherRecordProgressType; readonly commit: () => void }> = [];
    const cloneRecords: Array<{ readonly gatherKey: string; readonly record: GatherRecordProgressType }> = [];

    for (const [gatherKey, records] of Object.entries(progress.entries)) {
      for (const record of records) {
        if (record.contribution !== undefined) {
          pendingCommits.push({ gatherKey, record, 'commit': options.deriveContribution(gatherKey, record) });
          continue;
        }
        cloneRecords.push({ gatherKey, record });
      }
    }

    for (const { gatherKey, record, commit } of pendingCommits) {
      commit();
      this.#restoreReduced(gatherKey, record);
    }

    for (const { gatherKey, record } of cloneRecords) {
      const childScope: GraphScopeType = {
        'runIri': `${state.runIri}/clone/${globalThis.crypto.randomUUID()}`,
        'dagIri': state.runIri,
        'placementIri': record.source,
      };
      const cloneState = state.clone(childScope);
      if (record.graphState !== undefined) await cloneState.restoreTransientState(cloneState.runIri, record.graphState);
      this.add(gatherKey, {
        'source': record.source,
        'index': record.index,
        'item': record.item,
        'output': record.output,
        'terminalOutcome': record.terminalOutcome,
        'result': record.result,
        cloneState,
      });
    }
  }

  toProgress(
    strategyForGather: (gatherKey: string) => GatherConfigType | undefined,
    contributionForRecord: (gatherKey: string, gather: GatherConfigType | undefined, record: GatherRecordType) => unknown | undefined,
  ): GatherProgressType {
    const entries: GatherProgressType['entries'] = {};
    for (const [gatherKey, records] of this.#records) {
      const gather = strategyForGather(gatherKey);
      entries[gatherKey] = [...records.values()]
        .map((record) => GatherBuffers.toProgressRecord(record, gather, contributionForRecord(gatherKey, gather, record)));
    }
    for (const [gatherKey, records] of this.#reduced) {
      if (entries[gatherKey] !== undefined) continue;
      entries[gatherKey] = [...records.values()].map((record) => ({
        'source': record.source,
        'index': null,
        'output': record.output,
        'terminalOutcome': record.terminalOutcome,
        ...(record.contribution === undefined ? { 'result': null } : { 'contribution': record.contribution }),
      }));
    }
    return { entries };
  }

  // A gather strategy that declares a `transientResultSelection()` narrower
  // than `mode: 'full'` has told the dispatcher it needs nothing beyond the
  // configured `resultField` projection (already captured in `record.result`)
  // to fold or replay a clone's contribution. That contract is reused here,
  // parent-facing progress retention, so any strategy — built-in or
  // consumer-registered under any name — compacts to `result` instead of a
  // full-clone `graphState` snapshot whenever it applies. A strategy that has
  // not declared a selection defaults to `mode: 'full'` and always falls
  // through to full-clone retention, preserving correctness.
  private static canCompactRecord(gather: GatherConfigType, record: GatherRecordType): boolean {
    if (record.result === undefined) return false;
    return GatherStrategies.resolve(gather.strategy).transientResultSelection(gather).mode !== 'full';
  }

  private static toProgressRecord(
    record: GatherRecordType,
    gather: GatherConfigType | undefined,
    contribution: unknown | undefined,
  ): GatherRecordProgressType {
    const item = record.item === undefined ? {} : { 'item': record.item };
    const result = record.result === undefined ? {} : { 'result': record.result };
    const base = {
      'source': record.source,
      'index': record.index,
      'output': record.output,
      'terminalOutcome': record.terminalOutcome,
      ...item,
      ...result,
    };

    if (contribution !== undefined) {
      return {
        ...base,
        contribution,
      };
    }

    if (gather !== undefined && GatherBuffers.canCompactRecord(gather, record)) {
      return {
        ...base,
        'result': record.result,
      };
    }

    return {
      ...base,
      'graphState': record.cloneState.snapshotTransientState(),
    };
  }

  private static selectedSources(
    declaredSources: readonly string[],
    records: readonly { readonly source: string }[],
    mode: 'all' | 'any' | 'quorum',
    quorum: number | null,
  ): readonly string[] {
    if (mode === 'all') return declaredSources;

    const arrived: string[] = [];
    for (const record of records) {
      if (!declaredSources.includes(record.source)) continue;
      if (!arrived.includes(record.source)) arrived.push(record.source);
    }

    if (mode === 'any') return arrived.slice(0, 1);
    return arrived.slice(0, quorum ?? declaredSources.length);
  }

  private static recordsForSources(
    records: readonly GatherRecordType[],
    sources: readonly string[],
    includeErrors: boolean,
  ): GatherRecordType[] {
    const selected: GatherRecordType[] = [];
    for (const source of sources) {
      const sourceRecords = records
        .filter((record) => record.source === source)
        .filter((record) => includeErrors || (record.output !== 'error' && record.terminalOutcome !== 'failed'))
        .sort((left, right) => GatherBuffers.indexOf(left) - GatherBuffers.indexOf(right));
      selected.push(...sourceRecords);
    }
    return selected;
  }

  private static routeRecordsForSources(
    records: readonly GatherRouteRecordType[],
    sources: readonly string[],
    includeErrors: boolean,
  ): GatherRouteRecordType[] {
    const selected: GatherRouteRecordType[] = [];
    for (const source of sources) {
      const sourceRecords = records
        .filter((record) => record.source === source)
        .filter((record) => includeErrors || (record.output !== 'error' && record.terminalOutcome !== 'failed'));
      selected.push(...sourceRecords);
    }
    return selected;
  }

  #combinedRecords(gatherName: string): Array<{ readonly source: string }> {
    const full = this.#records.get(gatherName);
    const reduced = this.#reduced.get(gatherName);
    return [
      ...(full === undefined ? [] : [...full.values()]),
      ...(reduced === undefined ? [] : [...reduced.values()]),
    ];
  }

  private static indexOf(record: GatherRecordType): number {
    return record.index ?? 0;
  }

  #recordKey(record: GatherRecordType): string {
    if (record.index !== null) return `${record.source}:${record.index}`;
    const key = `${record.source}:scalar:${this.#scalarOrdinal}`;
    this.#scalarOrdinal += 1;
    return key;
  }

  #restoreReduced(gatherKey: string, record: GatherRecordProgressType): void {
    let records = this.#reduced.get(gatherKey);
    if (records === undefined) {
      records = new Map<string, GatherReducedSummaryType>();
      this.#reduced.set(gatherKey, records);
    }
    records.set(this.#progressRecordKey(record), {
      'source': record.source,
      'output': record.output,
      'terminalOutcome': record.terminalOutcome,
      ...(record.contribution === undefined ? {} : { 'contribution': record.contribution }),
    });
  }

  #progressRecordKey(record: GatherRecordProgressType): string {
    if (record.index !== null) return `${record.source}:${record.index}`;
    const key = `${record.source}:scalar:${this.#scalarOrdinal}`;
    this.#scalarOrdinal += 1;
    return key;
  }
}
