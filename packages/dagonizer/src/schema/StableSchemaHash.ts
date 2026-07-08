import { StructuralHash } from '@studnicky/json';

import type { SchemaObjectType } from '../contracts/NodeInterface.js';

const SCHEMA_CONTRACT_METADATA_KEYS = new Set([
  '$comment',
  '$id',
  'default',
  'description',
  'examples',
  'title',
]);

export class StableSchemaHash extends StructuralHash {
  private constructor() { super(); }

  protected static override isMetadataKey(key: string): boolean {
    return SCHEMA_CONTRACT_METADATA_KEYS.has(key);
  }

  static override of(schema: SchemaObjectType): string {
    return super.of(schema);
  }
}
