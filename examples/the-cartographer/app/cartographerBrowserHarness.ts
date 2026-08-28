import type { EnrichedShipment } from '../entities/EnrichedShipment.ts';

export interface CartographerBrowserHarnessConfigType {
  readonly autorun: boolean;
  readonly loadEmbeddedTopology: boolean;
  readonly totalEvents: number | null;
  readonly poolSize: number | null;
  readonly batchCapacity: number | null;
  readonly reservoirIdleMs: number | null;
  readonly liveFlushMs: number | null;
}

export interface LiveStreamLineType {
  readonly shipmentId: string;
  readonly scanSeq: number;
  readonly status: string;
  readonly continent: string;
  readonly redacted: boolean;
}

export interface CartographerBrowserTelemetryType {
  readonly status: 'idle' | 'running' | 'completed' | 'failed';
  readonly progressPct: number;
  readonly processedCount: number;
  readonly totalEvents: number;
  readonly sampleRecordCount: number;
  readonly insightCount: number;
  readonly journeyCount: number;
  readonly errorMessage: string | null;
  readonly flushCount: number;
  readonly averageFlushMs: number;
  readonly lastFlushMs: number;
  readonly maxFlushMs: number;
  readonly stateRefreshCount: number;
  readonly skippedStateRefreshCount: number;
  readonly graphMutationCount: number;
  readonly timestamp: number;
}

export const CARTOGRAPHER_BROWSER_TELEMETRY_KEY = '__cartographerTelemetry';

type BrowserTelemetryInputsType = {
  readonly status: CartographerBrowserTelemetryType['status'];
  readonly progressPct: number;
  readonly processedCount: number;
  readonly totalEvents: number;
  readonly sampleRecordCount: number;
  readonly insightCount: number;
  readonly journeyCount: number;
  readonly errorMessage: string | null;
  readonly flushCount: number;
  readonly averageFlushMs: number;
  readonly lastFlushMs: number;
  readonly maxFlushMs: number;
  readonly stateRefreshCount: number;
  readonly skippedStateRefreshCount: number;
  readonly graphMutationCount: number;
};

function parseClampedInt(
  params: URLSearchParams,
  key: string,
  min: number,
  max: number,
): number | null {
  const raw = params.get(key);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

export function parseCartographerBrowserHarness(search: string): CartographerBrowserHarnessConfigType {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return {
    'autorun': params.get('autorun') === '1',
    'loadEmbeddedTopology': params.get('loadTopology') === '1',
    'totalEvents': parseClampedInt(params, 'totalEvents', 1, 1_000_000),
    'poolSize': parseClampedInt(params, 'poolSize', 1, 32),
    'batchCapacity': parseClampedInt(params, 'batchCapacity', 1, 10_000),
    'reservoirIdleMs': parseClampedInt(params, 'reservoirIdleMs', 0, 60_000),
    'liveFlushMs': parseClampedInt(params, 'liveFlushMs', 16, 5_000),
  };
}

export function buildCartographerBrowserTelemetry(
  inputs: BrowserTelemetryInputsType,
): CartographerBrowserTelemetryType {
  return {
    ...inputs,
    'timestamp': Date.now(),
  };
}

export function buildLiveStreamFeed(
  sampleRecords: readonly EnrichedShipment[],
  cursor: number,
  wrapped: boolean,
  maxVisible: number,
): readonly LiveStreamLineType[] {
  if (sampleRecords.length === 0 || maxVisible <= 0) return [];

  const chronological = wrapped
    ? sampleRecords.slice(cursor).concat(sampleRecords.slice(0, cursor))
    : sampleRecords;

  return chronological
    .slice(-maxVisible)
    .map((record) => ({
      'shipmentId': record.shipmentId,
      'scanSeq': record.scanSeq,
      'status': record.status,
      'continent': record.continent,
      'redacted': record.redactionApplied,
    }));
}
