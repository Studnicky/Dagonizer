import { StructuralHash } from '@studnicky/json';

import type { SchemaObjectType } from '../contracts/NodeInterface.js';

export class StableSchemaHash extends StructuralHash {
  private constructor() { super(); }

  protected static override isMetadataKey(key: string): boolean {
    return key === 'description' || key === 'title';
  }

  static override of(schema: SchemaObjectType): string {
    return super.of(schema);
  }
}
