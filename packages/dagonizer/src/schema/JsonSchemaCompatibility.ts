import type { SchemaObjectType } from '../contracts/NodeInterface.js';

import { SchemaIdentity } from './SchemaIdentity.js';

export type SchemaCompatibilityResultType =
  | { readonly status: 'compatible' }
  | { readonly status: 'incompatible'; readonly reason: string }
  | { readonly status: 'unknown'; readonly reason: string };

export class JsonSchemaCompatibility {
  private constructor() { /* static-only */ }

  static produces(produced: SchemaObjectType, required: SchemaObjectType): SchemaCompatibilityResultType {
    if (SchemaIdentity.for(produced) === SchemaIdentity.for(required)) {
      return { 'status': 'compatible' };
    }
    const unsupported = unsupportedKeyword(produced) ?? unsupportedKeyword(required);
    if (unsupported !== null) {
      return { 'status': 'unknown', 'reason': `unsupported JSON Schema keyword '${unsupported}'` };
    }
    if (isPermissiveObject(required)) {
      return { 'status': 'compatible' };
    }
    if (schemaType(produced) !== 'object' || schemaType(required) !== 'object') {
      return { 'status': 'unknown', 'reason': 'only object schema compatibility is implemented' };
    }

    const producedProperties = objectProperties(produced);
    const requiredProperties = objectProperties(required);
    if (producedProperties === null || requiredProperties === null) {
      return { 'status': 'unknown', 'reason': 'object schemas must declare properties for structural comparison' };
    }

    for (const key of requiredFields(required)) {
      const targetProperty = requiredProperties[key];
      const producedProperty = producedProperties[key];
      if (targetProperty === undefined) {
        return { 'status': 'unknown', 'reason': `required field '${key}' has no target property schema` };
      }
      if (producedProperty === undefined) {
        return { 'status': 'incompatible', 'reason': `producer does not declare required field '${key}'` };
      }
      if (!requiredFields(produced).includes(key)) {
        return { 'status': 'incompatible', 'reason': `producer does not guarantee required field '${key}'` };
      }
      const propertyResult = primitivePropertyCompatible(producedProperty, targetProperty);
      if (propertyResult.status !== 'compatible') return propertyResult;
    }

    return { 'status': 'compatible' };
  }
}

function isPermissiveObject(schema: SchemaObjectType): boolean {
  return schemaType(schema) === 'object'
    && requiredFields(schema).length === 0
    && Object.keys(objectProperties(schema) ?? {}).length === 0;
}

function unsupportedKeyword(schema: SchemaObjectType): string | null {
  for (const key of ['oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', '$ref'] as const) {
    if (Reflect.has(schema, key)) return key;
  }
  return null;
}

function schemaType(schema: SchemaObjectType): string | null {
  const value = Reflect.get(schema, 'type');
  return typeof value === 'string' ? value : null;
}

function requiredFields(schema: SchemaObjectType): readonly string[] {
  const value = Reflect.get(schema, 'required');
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function objectProperties(schema: SchemaObjectType): Record<string, SchemaObjectType> | null {
  const value = Reflect.get(schema, 'properties');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const result: Record<string, SchemaObjectType> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      result[key] = entry;
    }
  }
  return result;
}

function primitivePropertyCompatible(produced: SchemaObjectType, required: SchemaObjectType): SchemaCompatibilityResultType {
  const producedType = schemaType(produced);
  const requiredType = schemaType(required);
  if (requiredType === null) {
    return { 'status': 'unknown', 'reason': 'target property schema does not declare a primitive type' };
  }
  if (producedType === null) {
    return { 'status': 'unknown', 'reason': 'producer property schema does not declare a primitive type' };
  }
  if (producedType !== requiredType) {
    return { 'status': 'incompatible', 'reason': `producer property type '${producedType}' does not satisfy required type '${requiredType}'` };
  }
  return { 'status': 'compatible' };
}
