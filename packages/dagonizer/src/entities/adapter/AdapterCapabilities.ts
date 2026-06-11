/**
 * AdapterCapabilities: capability declaration for an LLM adapter.
 *
 * The host DAG introspects this to decide whether to route through
 * tool-calling paths or degrade to direct-prose / structured-JSON paths.
 *
 * No JSON Schema needed: capabilities are runtime-only metadata set by the
 * adapter implementation, not received over the wire.
 */

/**
 * Capability declaration for an adapter. The host DAG introspects this
 * to decide whether to route through tool-calling paths or degrade to
 * direct-prose / structured-JSON paths.
 *
 *   toolUse:
 *     'full': adapter + default model produce well-formed `tool_calls`.
 *     'partial': adapter forwards `tools` but the underlying model may
 *                 return malformed calls or refuse silently. Caller
 *                 should validate aggressively or treat tool output as
 *                 advisory.
 *     'none': adapter cannot emit tool calls; caller must inline
 *                 the data the tools would have fetched.
 *
 *   structuredOutput:
 *     true: `outputSchema.kind === 'schema'` is honoured via native
 *             `response_format` / `responseConstraint` / Nano `outputSchema`.
 *     false: schema is best-effort prose; downstream parsing must tolerate
 *             prose answers.
 *
 *   jsonMode:
 *     true: adapter supports `{ "type": "json_object" }` style coarse
 *             JSON-only mode (no schema).
 */
export interface AdapterCapabilities {
  toolUse: 'full' | 'partial' | 'none';
  structuredOutput: boolean;
  jsonMode: boolean;
}
