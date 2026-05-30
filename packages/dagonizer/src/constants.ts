/**
 * `@noocodex/dagonizer/constants` — constant value+type pairs.
 *
 * Each named export is both a runtime value (a frozen lookup object) and a
 * `FromSchema`-derived type of the same name, alongside its source `*Schema`.
 * Consumers import the value for lookups and the type for narrowing:
 *
 *   import { NodeType } from '@noocodex/dagonizer/constants';
 *   NodeType.SCATTER;            // value
 *   const t: NodeType = 'scatter'; // type
 */

export { GatherStrategySchema, GatherStrategyName } from './entities/constants/GatherStrategy.js';
export { MetadataKeySchema, MetadataKey } from './entities/constants/MetadataKey.js';
export { NodeTypeSchema, NodeType } from './entities/constants/NodeType.js';
export { OutputSchema, Output } from './entities/constants/Output.js';
export { ParallelCombineSchema, ParallelCombine } from './entities/constants/ParallelCombine.js';
export { ScatterOutputSchema, ScatterOutput } from './entities/constants/ScatterOutput.js';
