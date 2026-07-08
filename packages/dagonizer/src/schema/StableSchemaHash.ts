import { StructuralHash } from '@studnicky/json';

import type { SchemaObjectType } from '../contracts/NodeInterface.js';

export class StableSchemaHash {
  private constructor() { /* static-only */ }

  static of(schema: SchemaObjectType): string {
    const structuralSchema: Record<string, unknown> = { ...schema };
    return StructuralHash.of(structuralSchema);
  }
}
