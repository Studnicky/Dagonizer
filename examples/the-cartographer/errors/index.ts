/**
 * Cartographer errors: the DAG-flow error-collection surface. Captured
 * exceptions become first-class data (`GeoErrorRecordType`), transports return
 * an outcome carrying an optional captured error (`GeoLookupOutcomeType`), and
 * the gather folds every clone's errors into a bounded rollup (`ErrorRollupType`).
 */

export { GeoErrorRecord, GeoErrorRecordSchema } from './GeoErrorRecord.ts';
export type { GeoErrorRecordType } from './GeoErrorRecord.ts';

export { GeoLookupOutcome } from './GeoLookupOutcome.ts';
export type { GeoLookupOutcomeType } from './GeoLookupOutcome.ts';

export { ErrorRollup } from './ErrorRollup.ts';
export type { ErrorGroupType, ErrorRollupType } from './ErrorRollup.ts';
