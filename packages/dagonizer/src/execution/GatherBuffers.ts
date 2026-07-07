import type { GatherRecordType } from '../contracts/GatherExecution.js';
import type { GatherNodeType } from '../entities/dag/GatherNode.js';
import { GatherNodeDefaults } from '../entities/dag/GatherNode.js';

export class GatherBuffers {
  readonly #records = new Map<string, Map<string, GatherRecordType>>();

  add(gatherName: string, record: GatherRecordType): void {
    let records = this.#records.get(gatherName);
    if (records === undefined) {
      records = new Map<string, GatherRecordType>();
      this.#records.set(gatherName, records);
    }
    records.set(`${record.source}:${record.index ?? 0}`, record);
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
    return records === undefined ? [] : [...records.values()];
  }
}
