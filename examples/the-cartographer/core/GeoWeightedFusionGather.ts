/**
 * GeoWeightedFusionGather: stateless accumulation gather strategy for the
 * geo-source-resolve first-class gather barrier.
 *
 * Each upstream resolver DAG resolves one geo signal and writes the result as
 * `state.candidate` (a GeoResolution). The embedding placement projects that
 * value into `GatherRecord.result`. This strategy:
 *
 *   1. reduce:   Accumulates weight>0 candidates from gather records into
 *                `state.geoCandidates`.
 *
 *   2. finalize: Merges captured errors from every scatter branch. When zero
 *                weight>0 candidates were accumulated, writes the baseline
 *                `state.resolvedGeo` / `state.geoContext` directly (nothing to
 *                consense over). Otherwise leaves `state.geoCandidates` as the
 *                sole output — the downstream `resolve-country-consensus` →
 *                `verify-point-containment` → `assemble-resolved-geo` node
 *                chain (wired in `GeoSourceResolveDAG`) derives the combined
 *                location from every accumulated signal instead of a single
 *                weight-ranked winner.
 *
 * Registered as 'geo-weighted-fusion' at module load.
 */

import type { GatherExecutionType } from '@studnicky/dagonizer/contracts';
import { GatherStrategies, GatherStrategy } from '@studnicky/dagonizer/core';
import type { GatherConfigType, NodeStateInterface } from '@studnicky/dagonizer/types';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';

import type { GeoResolution } from '../entities/GeoResolution.ts';
import { GeoBaseline } from './GeoBaseline.ts';

// ── Private structural type-guard ─────────────────────────────────────────────

class CandidateRecord {
  private constructor() { /* static-only */ }

  static is(v: unknown): v is GeoResolution {
    if (v === null || typeof v !== 'object') return false;
    return (
      typeof Reflect.get(v, 'source')      === 'string' &&
      typeof Reflect.get(v, 'weight')      === 'number' &&
      typeof Reflect.get(v, 'country')     === 'string' &&
      typeof Reflect.get(v, 'region')      === 'string' &&
      typeof Reflect.get(v, 'locality')    === 'string' &&
      typeof Reflect.get(v, 'countryName') === 'string' &&
      typeof Reflect.get(v, 'locale')      === 'string' &&
      typeof Reflect.get(v, 'timezone')    === 'string' &&
      typeof Reflect.get(v, 'lat')         === 'number' &&
      typeof Reflect.get(v, 'lng')         === 'number' &&
      typeof Reflect.get(v, 'status')      === 'string' &&
      typeof Reflect.get(v, 'secondaryLookupUsed') === 'boolean'
    );
  }
}

class GeoResolutionArray {
  private constructor() { /* static-only */ }

  static is(v: unknown): v is GeoResolution[] {
    return Array.isArray(v);
  }
}

// ── GeoWeightedFusionGather ───────────────────────────────────────────────────

export class GeoWeightedFusionGather extends GatherStrategy {
  readonly name = 'geo-weighted-fusion';
  readonly '@id' = 'urn:noocodec:node:geo-weighted-fusion';

  // ── initial: reset geoCandidates accumulator in parent state ─────────────

  override initial(
    _config: GatherConfigType,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    accessor.set(state, 'geoCandidates', []);
  }

  // ── reduce: collect weight>0 candidates from each clone ──────────────────

  override reduce(
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    for (const item of batch) {
      const record = item.state;
      const rawCandidate = CandidateRecord.is(record.result)
        ? record.result
        : accessor.get(record.cloneState, 'candidate');
      if (!CandidateRecord.is(rawCandidate)) continue;
      if (rawCandidate.weight <= 0) continue;

      // Read-array, push, set-back idiom (matches InsightsFoldGather pattern).
      const rawCandidates = accessor.get(state, 'geoCandidates');
      const candidates: GeoResolution[] = GeoResolutionArray.is(rawCandidates)
        ? rawCandidates.filter(CandidateRecord.is)
        : [];
      candidates.push(rawCandidate);
      accessor.set(state, 'geoCandidates', candidates);
    }
  }

  // ── finalize: merge captured errors; write the baseline for the empty case ─

  override async finalize(
    _config: GatherConfigType,
    execution: GatherExecutionType<NodeStateInterface>,
  ): Promise<void> {
    GeoWeightedFusionGather.mergeCapturedErrors(execution);

    const rawCandidates = execution.accessor.get(execution.state, 'geoCandidates');
    const candidates: GeoResolution[] = GeoResolutionArray.is(rawCandidates)
      ? rawCandidates.filter(CandidateRecord.is)
      : [];

    if (candidates.length === 0) {
      // EMPTY case: delegate to the single source of truth for baseline values.
      // Non-empty candidates fall through to the resolve-country-consensus →
      // verify-point-containment → assemble-resolved-geo node chain.
      execution.accessor.set(execution.state, 'resolvedGeo', GeoBaseline.resolvedGeo());
      execution.accessor.set(execution.state, 'geoContext',  GeoBaseline.geoContext());
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private static mergeCapturedErrors(execution: GatherExecutionType<NodeStateInterface>): void {
    const current = execution.accessor.get(execution.state, 'capturedErrors');
    const merged = Array.isArray(current) ? [...current] : [];
    const seen = new Set<string>(merged.map((entry) => JSON.stringify(entry)));

    for (const record of execution.records) {
      const rawErrors = execution.accessor.get(record.cloneState, 'capturedErrors');
      if (!Array.isArray(rawErrors)) continue;
      for (const error of rawErrors) {
        const key = JSON.stringify(error);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(error);
      }
    }

    execution.accessor.set(execution.state, 'capturedErrors', merged);
  }
}

// ── Module-load registration ──────────────────────────────────────────────────

GatherStrategies.register(new GeoWeightedFusionGather());
// GatherStrategies.resolve('geo-weighted-fusion') now works in any gather placement.
