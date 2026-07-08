import type { GatherRecordType } from '../contracts/GatherExecution.js';
import type { GatherConfigType } from '../entities/dag/GatherConfig.js';
import type { GatherNodeType } from '../entities/dag/GatherNode.js';
import { GatherNodeDefaults } from '../entities/dag/GatherNode.js';
import type { GatherProgressType, GatherRecordProgressType } from '../entities/gather/GatherProgress.js';
import { JsonObject } from '../entities/json.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export class GatherBuffers {
  static readonly #BASE_SNAPSHOT_FIELDS = new Set(['metadata', 'retries', 'warnings']);

  readonly #records = new Map<string, Map<string, GatherRecordType>>();
  #scalarOrdinal = 0;

  add(gatherName: string, record: GatherRecordType): void {
    let records = this.#records.get(gatherName);
    if (records === undefined) {
      records = new Map<string, GatherRecordType>();
      this.#records.set(gatherName, records);
    }
    records.set(this.#recordKey(record), record);
  }

  isEmpty(): boolean {
    return this.#records.size === 0;
  }

  ready(node: GatherNodeType): boolean {
    const records = this.#records.get(node.name);
    if (records === undefined) return false;
    const policy = GatherNodeDefaults.policy(node);
    const seenSources = new Set([...records.values()].map((record) => record.source));
    if (policy.mode === 'any') return seenSources.size > 0;
    if (policy.mode === 'quorum') return seenSources.size >= (policy.quorum ?? node.sources.length);
    return node.sources.every((source) => seenSources.has(source));
  }

  takeReady(node: GatherNodeType): GatherRecordType[] {
    if (!this.ready(node)) return [];
    const records = this.#records.get(node.name);
    this.#records.delete(node.name);
    if (records === undefined) return [];
    const policy = GatherNodeDefaults.policy(node);
    const selectedSources = GatherBuffers.selectedSources(node.sources, [...records.values()], policy.mode, policy.quorum);
    return GatherBuffers.recordsForSources([...records.values()], selectedSources, policy.includeErrors);
  }

  restore(progress: GatherProgressType, state: NodeStateInterface): void {
    for (const [gatherName, records] of Object.entries(progress.entries)) {
      for (const record of records) {
        const cloneState = state.clone();
        const snapshot = JsonObject.is(record.snapshot) ? record.snapshot : {};
        cloneState.applySnapshot(snapshot);
        GatherBuffers.restoreSnapshotFields(cloneState, snapshot);
        this.add(gatherName, {
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
  }

  toProgress(strategyForGather: (gatherName: string) => GatherConfigType | undefined): GatherProgressType {
    const entries: GatherProgressType['entries'] = {};
    for (const [gatherName, records] of this.#records) {
      const gather = strategyForGather(gatherName);
      entries[gatherName] = [...records.values()]
        .map((record) => GatherBuffers.toProgressRecord(record, gather));
    }
    return { entries };
  }

  private static canCompactRecord(gather: GatherConfigType, record: GatherRecordType): boolean {
    if (record.result === undefined) return false;
    return gather.strategy === 'custom' || gather.strategy === 'discard';
  }

  private static toProgressRecord(
    record: GatherRecordType,
    gather: GatherConfigType | undefined,
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

    if (gather !== undefined && GatherBuffers.canCompactRecord(gather, record)) {
      return {
        ...base,
        'result': record.result,
      };
    }

    return {
      ...base,
      'snapshot': record.cloneState.snapshot(),
    };
  }

  private static restoreSnapshotFields(state: NodeStateInterface, snapshot: Readonly<Record<string, unknown>>): void {
    for (const [key, value] of Object.entries(snapshot)) {
      if (GatherBuffers.#BASE_SNAPSHOT_FIELDS.has(key)) continue;
      Reflect.set(state, key, value);
    }
  }

  private static selectedSources(
    declaredSources: readonly string[],
    records: readonly GatherRecordType[],
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

  private static indexOf(record: GatherRecordType): number {
    return record.index ?? 0;
  }

  #recordKey(record: GatherRecordType): string {
    if (record.index !== null) return `${record.source}:${record.index}`;
    const key = `${record.source}:scalar:${this.#scalarOrdinal}`;
    this.#scalarOrdinal += 1;
    return key;
  }
}
