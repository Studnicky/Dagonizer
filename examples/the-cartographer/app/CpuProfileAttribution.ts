import { JsonObject } from '@studnicky/dagonizer/entities';
import type { JsonObjectType, JsonValueType } from '@studnicky/dagonizer/entities';

import type { CpuAttributionEntry } from './CpuAttributionEntry.ts';

interface RawProfileNode extends JsonObjectType {
  readonly id: number;
  readonly callFrame: JsonObjectType & {
    readonly functionName: string;
    readonly url: string;
  };
}

interface ProfileChunkData {
  readonly id: string;
  readonly nodes: readonly RawProfileNode[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

interface MergedProfile {
  readonly nodesById: Map<number, RawProfileNode>;
  readonly samples: number[];
  readonly timeDeltas: number[];
}

const TOP_ATTRIBUTION_LIMIT = 20;

function isRawProfileNode(value: JsonValueType): value is RawProfileNode {
  if (!JsonObject.is(value) || typeof value['id'] !== 'number') return false;

  const callFrame = value['callFrame'];
  if (!JsonObject.is(callFrame)) return false;
  return typeof callFrame['functionName'] === 'string' && typeof callFrame['url'] === 'string';
}

function createMergedProfile(): MergedProfile {
  return { nodesById: new Map<number, RawProfileNode>(), samples: [], timeDeltas: [] };
}

function extractProfileChunkData(event: JsonValueType): ProfileChunkData | null {
  if (!JsonObject.is(event)) return null;

  const name = event['name'];
  const id = event['id'];
  const args = event['args'];
  if (name !== 'Profile' && name !== 'ProfileChunk') return null;
  if (typeof id !== 'string') return null;
  if (!JsonObject.is(args)) return { id, nodes: [], samples: [], timeDeltas: [] };

  const data = args['data'];
  if (!JsonObject.is(data)) return { id, nodes: [], samples: [], timeDeltas: [] };

  const cpuProfile = data['cpuProfile'];
  const nodes: RawProfileNode[] = [];
  if (JsonObject.is(cpuProfile) && Array.isArray(cpuProfile['nodes'])) {
    for (const node of cpuProfile['nodes']) {
      if (isRawProfileNode(node)) nodes.push(node);
    }
  }

  const samples: number[] = [];
  if (JsonObject.is(cpuProfile) && Array.isArray(cpuProfile['samples'])) {
    for (const sample of cpuProfile['samples']) {
      if (typeof sample === 'number') samples.push(sample);
    }
  }

  const timeDeltas: number[] = [];
  const rawTimeDeltas = data['timeDeltas'];
  if (Array.isArray(rawTimeDeltas)) {
    for (const delta of rawTimeDeltas) {
      if (typeof delta === 'number') timeDeltas.push(delta);
    }
  }

  return { id, nodes, samples, timeDeltas };
}

/**
 * Aggregates V8 CPU-profiler self-time from raw CDP `Profile`/`ProfileChunk`
 * trace events into a label-grouped, percentage-ranked report.
 */
export class CpuProfileAttribution {
  private constructor() { /* static-only */ }

  static compute(traceEvents: readonly JsonValueType[]): CpuAttributionEntry[] {
    const profiles = new Map<string, MergedProfile>();

    for (const event of traceEvents) {
      const chunk = extractProfileChunkData(event);
      if (chunk === null) continue;

      const profile = profiles.get(chunk.id) ?? createMergedProfile();
      profiles.set(chunk.id, profile);

      for (const node of chunk.nodes) profile.nodesById.set(node.id, node);
      for (const sample of chunk.samples) profile.samples.push(sample);
      for (const delta of chunk.timeDeltas) profile.timeDeltas.push(delta);
    }

    const selfTimeByLabelUs = new Map<string, number>();
    let totalSelfTimeUs = 0;

    for (const profile of profiles.values()) {
      const sampleCount = Math.min(profile.samples.length, profile.timeDeltas.length);
      for (let index = 0; index < sampleCount; index += 1) {
        const deltaUs = profile.timeDeltas[index];
        const nodeId = profile.samples[index];
        if (deltaUs === undefined || nodeId === undefined || deltaUs <= 0) continue;

        const node = profile.nodesById.get(nodeId);
        if (node === undefined) continue;
        const label = CpuProfileAttribution.#labelFor(node);
        selfTimeByLabelUs.set(label, (selfTimeByLabelUs.get(label) ?? 0) + deltaUs);
        totalSelfTimeUs += deltaUs;
      }
    }

    const entries: CpuAttributionEntry[] = [...selfTimeByLabelUs.entries()].map(([label, selfTimeUs]) => ({
      label,
      selfTimeMs: selfTimeUs / 1000,
      selfTimePct: totalSelfTimeUs > 0 ? (selfTimeUs / totalSelfTimeUs) * 100 : 0,
    }));

    entries.sort((a, b) => b.selfTimeMs - a.selfTimeMs);
    return entries.slice(0, TOP_ATTRIBUTION_LIMIT);
  }

  static #labelFor(node: RawProfileNode): string {
    if (node.callFrame.url.length === 0) {
      return node.callFrame.functionName.length > 0 ? node.callFrame.functionName : '(anonymous)';
    }

    const queryIndex = node.callFrame.url.search(/[?#]/);
    const withoutQuery = queryIndex < 0 ? node.callFrame.url : node.callFrame.url.slice(0, queryIndex);
    const filename = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
    const dotIndex = filename.lastIndexOf('.');
    return dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  }
}
