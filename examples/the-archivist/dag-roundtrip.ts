/**
 * DAG round-trip: serialize → load → validate.
 *
 * Serializes `archivistDAG` to JSON, reloads it through `Dagonizer.load`,
 * asserts structural identity (name, entrypoint, node count), then
 * validates the reloaded document with `Validator.dag.validate`.
 */

// #region dag-roundtrip
import { Dagonizer } from '@noocodex/dagonizer';
import { Validator } from '@noocodex/dagonizer/validation';

import { archivistDAG } from './dag.ts';

const json     = Dagonizer.serialize(archivistDAG);
const reloaded = Dagonizer.load(json);

console.assert(reloaded.name        === archivistDAG.name,       'name mismatch');
console.assert(reloaded.entrypoint  === archivistDAG.entrypoint, 'entrypoint mismatch');
console.assert(reloaded.nodes.length === archivistDAG.nodes.length, 'node count mismatch');

const validated = Validator.dag.validate(reloaded);

console.log('dag-roundtrip: ok');
console.log(`  name:       ${validated.name}`);
console.log(`  entrypoint: ${validated.entrypoint}`);
console.log(`  nodes:      ${validated.nodes.length}`);
// #endregion dag-roundtrip
