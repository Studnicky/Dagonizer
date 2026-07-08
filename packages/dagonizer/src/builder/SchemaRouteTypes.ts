import type { FromSchema } from 'json-schema-to-ts';

import type { NodeInterface, SchemaObjectType } from '../contracts/NodeInterface.js';

type IsNever<T> = [T] extends [never] ? true : false;

type Extends<Produced, Required> = [Produced] extends [Required] ? true : false;

type NodeInputSchemaType<TNode> =
  TNode extends { readonly inputSchema: infer TInputSchema }
    ? TInputSchema extends SchemaObjectType
      ? TInputSchema
      : never
    : TNode extends NodeInterface<infer _State, infer _Output, infer TInputSchema, infer _OutputSchemas>
      ? TInputSchema
      : never;

type NodeOutputSchemasType<TNode> =
  TNode extends { readonly outputSchema: infer TOutputSchemas }
    ? TOutputSchemas extends Record<string, SchemaObjectType>
      ? TOutputSchemas
      : never
    : TNode extends NodeInterface<infer _State, infer _Output, infer _InputSchema, infer TOutputSchemas>
      ? TOutputSchemas
      : never;

/**
 * Compile-time schema compatibility helpers for builder-authored DAGs.
 *
 * These helpers derive TypeScript shapes from a node's literal JSON Schemas.
 * Runtime-loaded JSON-LD still uses registration-time graph validation; these
 * types cover the authoring case where both endpoint node classes are visible
 * to TypeScript.
 */
export namespace SchemaRouteTypes {
  export type NodeInputType<TNode> =
    FromSchema<NodeInputSchemaType<TNode>>;

  export type NodeOutputType<TNode, TPort extends string> =
    TPort extends keyof NodeOutputSchemasType<TNode>
      ? NodeOutputSchemasType<TNode>[TPort] extends SchemaObjectType
        ? FromSchema<NodeOutputSchemasType<TNode>[TPort]>
        : never
      : never;

  export type RouteCompatibleType<
    TFromNode,
    TPort extends string,
    TToNode
  > = IsNever<NodeOutputType<TFromNode, TPort>> extends true
    ? false
    : IsNever<NodeInputType<TToNode>> extends true
      ? false
      : Extends<NodeOutputType<TFromNode, TPort>, NodeInputType<TToNode>>;

  export type AssertCompatibleRouteType<
    TFromNode,
    TPort extends string,
    TToNode,
  > = RouteCompatibleType<TFromNode, TPort, TToNode> extends true
    ? unknown
    : {
        readonly __route_schema_mismatch__: {
          readonly from: TPort;
          readonly produced: NodeOutputType<TFromNode, TPort>;
          readonly required: NodeInputType<TToNode>;
        };
      };
}
