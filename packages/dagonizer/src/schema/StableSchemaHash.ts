import { StructuralHash } from '@studnicky/json';

import type { SchemaObjectType } from '../contracts/NodeInterface.js';

export class StableSchemaHash extends StructuralHash {
  private constructor() { super(); }

  static override of(schema: SchemaObjectType): string {
    return super.of(schema);
  }
}
