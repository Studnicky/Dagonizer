/**
 * constants-usage: demonstrates every typed constant from
 * @noocodex/dagonizer/constants as runtime guards.
 *
 * Each constant in the package is both a frozen runtime lookup object and a
 * FromSchema-derived TypeScript type of the same name. This example calls the
 * helper functions defined in dags/constants-usage.ts directly — no dispatcher,
 * no DAG execution required — and prints which values pass each guard.
 *
 * Run: npx tsx examples/constants-usage.ts
 */

import {
  GatherStrategyName,
  MetadataKey,
  NodeType,
  Output,
  ScatterOutput,
} from '@noocodex/dagonizer/constants';

// ── Output ─────────────────────────────────────────────────────────────────
function describeOutput(output: Output): string {
  if (output === Output.SUCCESS) return 'operation completed';
  if (output === Output.ERROR)   return 'operation failed';
  return output;
}

// ── NodeType ────────────────────────────────────────────────────────────────
function isScatterPlacement(type: NodeType): boolean {
  return type === NodeType.SCATTER;
}

// ── GatherStrategyName ──────────────────────────────────────────────────────
function isKnownGatherStrategy(name: string): name is GatherStrategyName {
  return (Object.values(GatherStrategyName) as readonly string[]).includes(name);
}

// ── MetadataKey ─────────────────────────────────────────────────────────────
function readCurrentItem(metadata: Partial<Record<MetadataKey, unknown>>): unknown {
  return metadata[MetadataKey.CURRENT_ITEM];
}

// ── ScatterOutput ───────────────────────────────────────────────────────────
function interpretScatterOutput(output: ScatterOutput): string {
  if (output === ScatterOutput.ALL_SUCCESS) return 'all clones succeeded';
  if (output === ScatterOutput.ALL_ERROR)   return 'all clones failed';
  if (output === ScatterOutput.PARTIAL)     return 'partial success';
  return 'source array was empty';
}

// ── Exercise every guard and print results ──────────────────────────────────

process.stdout.write('\n=== @noocodex/dagonizer/constants typed-guard demo ===\n\n');

// Output
process.stdout.write('Output values:\n');
for (const v of Object.values(Output)) {
  process.stdout.write(`  Output.${v} => "${describeOutput(v)}"\n`);
}

// NodeType
process.stdout.write('\nNodeType scatter check:\n');
for (const v of Object.values(NodeType)) {
  process.stdout.write(`  NodeType.${v} isScatter=${String(isScatterPlacement(v))}\n`);
}

// GatherStrategyName
process.stdout.write('\nGatherStrategyName guard:\n');
const candidates = ['map', 'collect', 'partition', 'top-n', 'unknown-strategy'];
for (const c of candidates) {
  process.stdout.write(`  "${c}" isKnown=${String(isKnownGatherStrategy(c))}\n`);
}

// MetadataKey
process.stdout.write('\nMetadataKey.CURRENT_ITEM read:\n');
const bag: Partial<Record<MetadataKey, unknown>> = {
  [MetadataKey.CURRENT_ITEM]: { title: 'The Archivist Compendium' },
};
process.stdout.write(`  currentItem=${JSON.stringify(readCurrentItem(bag))}\n`);

// ScatterOutput
process.stdout.write('\nScatterOutput interpretations:\n');
for (const v of Object.values(ScatterOutput)) {
  process.stdout.write(`  ScatterOutput.${v} => "${interpretScatterOutput(v)}"\n`);
}

process.stdout.write('\nAll constant guards exercised.\n');
