/**
 * `@studnicky/dagonizer/constants`: constant value+type pairs.
 *
 * Each constant ships a runtime value (a frozen lookup object under a plural
 * name) and a `FromSchema`-derived type (the singular name), alongside its
 * source `*Schema`. Consumers import the value for lookups and the type for
 * narrowing:
 *
 *   import { NodeTypes, type NodeType } from '@studnicky/dagonizer/constants';
 *   NodeTypes.SCATTER;            // value
 *   const t: NodeType = 'scatter'; // type
 */

export { GatherStrategySchema, GatherStrategyNames } from './entities/constants/GatherStrategy.js';
export type { GatherStrategyNameType } from './entities/constants/GatherStrategy.js';
export { MetadataKeySchema, MetadataKeys } from './entities/constants/MetadataKey.js';
export type { MetadataKeyType } from './entities/constants/MetadataKey.js';
export { NodeTypeSchema, NodeTypes } from './entities/constants/NodeType.js';
export type { NodeType } from './entities/constants/NodeType.js';
export { OutputSchema, OutputNames } from './entities/constants/Output.js';
export type { OutputType } from './entities/constants/Output.js';
export { ScatterOutputSchema, ScatterOutputNames } from './entities/constants/ScatterOutput.js';
export type { ScatterOutputType } from './entities/constants/ScatterOutput.js';
