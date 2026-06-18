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
  MetadataKey,
  NodeType,
  Output,
  ScatterOutput,
} from '@studnicky/dagonizer/constants';
import type { CatalogueItem } from './dags/constants-usage.js';
import { ConstantUsage } from './dags/constants-usage.js';

// ── Exercise every guard and print results ──────────────────────────────────

process.stdout.write('\n=== @studnicky/dagonizer/constants typed-guard demo ===\n\n');

// Output
process.stdout.write('Output values:\n');
for (const v of Object.values(Output)) {
  process.stdout.write(`  Output.${v} => "${ConstantUsage.describeOutput(v)}"\n`);
}

// NodeType
process.stdout.write('\nNodeType scatter check:\n');
for (const v of Object.values(NodeType)) {
  process.stdout.write(`  NodeType.${v} isScatter=${String(ConstantUsage.isScatterPlacement(v))}\n`);
}

// GatherStrategyName
process.stdout.write('\nGatherStrategyName guard:\n');
const candidates = ['map', 'collect', 'partition', 'top-n', 'unknown-strategy'];
for (const c of candidates) {
  process.stdout.write(`  "${c}" isKnown=${String(ConstantUsage.isKnownGatherStrategy(c))}\n`);
}

// MetadataKey
process.stdout.write('\nMetadataKey.CURRENT_ITEM read:\n');
const bag: Partial<Record<MetadataKey, CatalogueItem>> = {
  [MetadataKey.CURRENT_ITEM]: { title: 'The Archivist Compendium' },
};
process.stdout.write(`  currentItem=${JSON.stringify(ConstantUsage.readCurrentItem(bag))}\n`);

// ScatterOutput
process.stdout.write('\nScatterOutput interpretations:\n');
for (const v of Object.values(ScatterOutput)) {
  process.stdout.write(`  ScatterOutput.${v} => "${ConstantUsage.interpretScatterOutput(v)}"\n`);
}

process.stdout.write('\nAll constant guards exercised.\n');
