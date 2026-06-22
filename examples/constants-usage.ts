/**
 * constants-usage: demonstrates every typed constant from
 * @studnicky/dagonizer/constants as runtime guards.
 *
 * Each constant in the package is both a frozen runtime lookup object and a
 * FromSchema-derived TypeScript type of the same name. This example calls the
 * helper functions defined in dags/constants-usage.ts directly — no dispatcher,
 * no DAG execution required — and prints which values pass each guard.
 *
 * DAG definition (guard helpers, CatalogueItem type): examples/dags/constants-usage.ts
 *
 * Run: npx tsx examples/constants-usage.ts
 */

import {
  MetadataKeys,
  NodeTypes,
  OutputNames,
  ScatterOutputNames,
  type MetadataKeyType,
} from '@studnicky/dagonizer/constants';
import type { CatalogueItem } from './dags/constants-usage.js';
import { ConstantUsage } from './dags/constants-usage.js';

// ── Exercise every guard and print results ──────────────────────────────────

process.stdout.write('\n=== @studnicky/dagonizer/constants typed-guard demo ===\n\n');

// OutputNames
process.stdout.write('Output values:\n');
for (const v of Object.values(OutputNames)) {
  process.stdout.write(`  OutputNames.${v} => "${ConstantUsage.describeOutput(v)}"\n`);
}

// NodeTypes
process.stdout.write('\nNodeType scatter check:\n');
for (const v of Object.values(NodeTypes)) {
  process.stdout.write(`  NodeTypes.${v} isScatter=${String(ConstantUsage.isScatterPlacement(v))}\n`);
}

// GatherStrategyName
process.stdout.write('\nGatherStrategyName guard:\n');
const candidates = ['map', 'collect', 'partition', 'top-n', 'unknown-strategy'];
for (const c of candidates) {
  process.stdout.write(`  "${c}" isKnown=${String(ConstantUsage.isKnownGatherStrategy(c))}\n`);
}

// MetadataKey
process.stdout.write('\nMetadataKey.CURRENT_ITEM read:\n');
const record: Partial<Record<MetadataKeyType, CatalogueItem>> = {
  [MetadataKeys.CURRENT_ITEM]: { title: 'The Archivist Compendium' },
};
process.stdout.write(`  currentItem=${JSON.stringify(ConstantUsage.readCurrentItem(record))}\n`);

// ScatterOutput
process.stdout.write('\nScatterOutput interpretations:\n');
for (const v of Object.values(ScatterOutputNames)) {
  process.stdout.write(`  ScatterOutputNames.${v} => "${ConstantUsage.interpretScatterOutput(v)}"\n`);
}

process.stdout.write('\nAll constant guards exercised.\n');
