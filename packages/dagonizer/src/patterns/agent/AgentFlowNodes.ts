/**
 * Reusable agent-flow DAG nodes.
 *
 * These nodes keep the orchestration seams generic:
 * - build an adapter chat request
 * - normalize text-channel tool calls
 * - partition tool calls into execution worksets
 * - dispatch tools and collect results
 *
 * Each node is an abstract base; subclasses override the protected template
 * methods to bind a concrete state model without callback injection.
 */

import { ToolCallCodec } from '../../adapter/ToolCallCodec.js';
import type { LlmAdapterInterface } from '../../contracts/LlmAdapterInterface.js';
import { ScalarNode } from '../../core/ScalarNode.js';
import type { ChatRequestType } from '../../entities/adapter/ChatRequest.js';
import type { ChatResponseType } from '../../entities/adapter/ChatResponse.js';
import type { ToolCallType } from '../../entities/adapter/ToolCall.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import type { NodeErrorType } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';
import type { ToolInterface } from '../../tool/ToolInterface.js';

/** The variant discriminant for a tool workset: safe calls may run concurrently, exclusive calls must run alone. */
export type ToolWorksetVariantType = 'safe' | 'exclusive';

/** A partitioned set of tool calls sharing the same execution policy. */
export type ToolWorksetType = {
  readonly variant: ToolWorksetVariantType;
  readonly calls: readonly ToolCallType[];
};

/** The result record produced for a single tool call dispatch attempt. */
export type ToolDispatchRecordType = {
  readonly call: ToolCallType;
  readonly toolName: string;
  readonly status: 'success' | 'missing' | 'error';
  readonly result?: unknown;
  readonly error?: string;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function toolCallRoute(response: ChatResponseType): 'text' | 'tools' | 'mixed' {
  return response.message.variant;
}

/** Options injected into `LlmChatNode` at construction for a concrete state binding. */
export type LlmChatNodeOptionsType<TState extends NodeStateInterface, TServices = undefined> = {
  readonly name: string;
  readonly resolveAdapter: (state: TState, context: NodeContextType<TServices>) => LlmAdapterInterface;
  readonly request: (state: TState, context: NodeContextType<TServices>) => ChatRequestType;
  readonly storeResponse?: (
    state: TState,
    response: ChatResponseType,
    request: ChatRequestType,
    context: NodeContextType<TServices>,
  ) => void | Promise<void>;
  readonly onError?: (
    state: TState,
    error: Error,
    context: NodeContextType<TServices>,
  ) => void | Promise<void>;
};

export class LlmChatNode<
  TState extends NodeStateInterface,
  TServices = undefined,
> extends ScalarNode<TState, 'text' | 'tools' | 'mixed' | 'error', TServices> {
  readonly name: string;
  readonly outputs = ['text', 'tools', 'mixed', 'error'] as const;

  constructor(private readonly options: LlmChatNodeOptionsType<TState, TServices>) {
    super();
    this.name = options.name;
  }

  protected async executeOne(
    state: TState,
    context: NodeContextType<TServices>,
  ): Promise<NodeOutputType<'text' | 'tools' | 'mixed' | 'error'>> {
    try {
      const adapter = this.options.resolveAdapter(state, context);
      const request = this.options.request(state, context);
      const response = await adapter.chat(request);
      await this.options.storeResponse?.(state, response, request, context);
      return NodeOutputBuilder.of(toolCallRoute(response));
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(errorMessage(cause));
      await this.options.onError?.(state, error, context);
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'LLM_CHAT_FAILED',
            error.message,
            this.name,
            true,
            new Date().toISOString(),
            { 'context': {} },
          ),
        ],
      });
    }
  }
}

/** Options injected into `DecodeTextToolCallsNode` at construction. */
export type DecodeTextToolCallsNodeOptionsType<TState extends NodeStateInterface, TServices = undefined> = {
  readonly name: string;
  readonly getText: (state: TState, context: NodeContextType<TServices>) => string | undefined;
  readonly idPrefix: string | ((state: TState, context: NodeContextType<TServices>) => string);
  readonly storeToolCalls?: (
    state: TState,
    calls: readonly ToolCallType[],
    context: NodeContextType<TServices>,
  ) => void | Promise<void>;
};

export class DecodeTextToolCallsNode<
  TState extends NodeStateInterface,
  TServices = undefined,
> extends ScalarNode<TState, 'decoded' | 'empty' | 'error', TServices> {
  readonly name: string;
  readonly outputs = ['decoded', 'empty', 'error'] as const;

  constructor(private readonly options: DecodeTextToolCallsNodeOptionsType<TState, TServices>) {
    super();
    this.name = options.name;
  }

  protected async executeOne(
    state: TState,
    context: NodeContextType<TServices>,
  ): Promise<NodeOutputType<'decoded' | 'empty' | 'error'>> {
    try {
      const text = this.options.getText(state, context) ?? '';
      if (text.trim().length === 0) {
        return NodeOutputBuilder.of('empty');
      }

      const prefix = typeof this.options.idPrefix === 'function'
        ? this.options.idPrefix(state, context)
        : this.options.idPrefix;
      const calls = ToolCallCodec.decode(text, prefix);
      await this.options.storeToolCalls?.(state, calls, context);
      return NodeOutputBuilder.of(calls.length > 0 ? 'decoded' : 'empty');
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(errorMessage(cause));
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'TOOL_CALL_DECODE_FAILED',
            error.message,
            this.name,
            true,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}

/** Options injected into `PartitionToolCallsNode` at construction. */
export type PartitionToolCallsNodeOptionsType<TState extends NodeStateInterface, TServices = undefined> = {
  readonly name: string;
  readonly getToolCalls: (state: TState, context: NodeContextType<TServices>) => readonly ToolCallType[];
  readonly classifyCall: (
    call: ToolCallType,
    state: TState,
    context: NodeContextType<TServices>,
  ) => ToolWorksetVariantType;
  readonly storeWorksets?: (
    state: TState,
    worksets: Readonly<{ 'safe': readonly ToolCallType[]; 'exclusive': readonly ToolCallType[] }>,
    context: NodeContextType<TServices>,
  ) => void | Promise<void>;
};

export class PartitionToolCallsNode<
  TState extends NodeStateInterface,
  TServices = undefined,
> extends ScalarNode<TState, 'ready' | 'empty' | 'error', TServices> {
  readonly name: string;
  readonly outputs = ['ready', 'empty', 'error'] as const;

  constructor(private readonly options: PartitionToolCallsNodeOptionsType<TState, TServices>) {
    super();
    this.name = options.name;
  }

  protected async executeOne(
    state: TState,
    context: NodeContextType<TServices>,
  ): Promise<NodeOutputType<'ready' | 'empty' | 'error'>> {
    try {
      const calls = this.options.getToolCalls(state, context);
      if (calls.length === 0) {
        return NodeOutputBuilder.of('empty');
      }

      const safe: ToolCallType[] = [];
      const exclusive: ToolCallType[] = [];
      for (const call of calls) {
        const variant = this.options.classifyCall(call, state, context);
        if (variant === 'safe') safe.push(call);
        else exclusive.push(call);
      }

      await this.options.storeWorksets?.(state, { 'safe': safe, 'exclusive': exclusive }, context);
      return NodeOutputBuilder.of('ready');
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(errorMessage(cause));
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'TOOL_CALL_PARTITION_FAILED',
            error.message,
            this.name,
            true,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}

/** Options injected into `DispatchToolCallsNode` at construction. */
export type DispatchToolCallsNodeOptionsType<TState extends NodeStateInterface, TServices = undefined> = {
  readonly name: string;
  readonly getToolCalls: (state: TState, context: NodeContextType<TServices>) => readonly ToolCallType[];
  readonly resolveTool: (
    call: ToolCallType,
    state: TState,
    context: NodeContextType<TServices>,
  ) => ToolInterface<Record<string, unknown>, unknown> | undefined;
  readonly executeTool?: (
    tool: ToolInterface<Record<string, unknown>, unknown>,
    call: ToolCallType,
    context: NodeContextType<TServices>,
  ) => Promise<unknown>;
  readonly storeResult?: (
    state: TState,
    record: ToolDispatchRecordType,
    context: NodeContextType<TServices>,
  ) => void | Promise<void>;
  readonly onError?: (
    state: TState,
    record: ToolDispatchRecordType,
    context: NodeContextType<TServices>,
  ) => void | Promise<void>;
};

export class DispatchToolCallsNode<
  TState extends NodeStateInterface,
  TServices = undefined,
> extends ScalarNode<TState, 'done' | 'partial' | 'empty' | 'error', TServices> {
  readonly name: string;
  readonly outputs = ['done', 'partial', 'empty', 'error'] as const;

  constructor(private readonly options: DispatchToolCallsNodeOptionsType<TState, TServices>) {
    super();
    this.name = options.name;
  }

  protected async executeOne(
    state: TState,
    context: NodeContextType<TServices>,
  ): Promise<NodeOutputType<'done' | 'partial' | 'empty' | 'error'>> {
    try {
      const calls = this.options.getToolCalls(state, context);
      if (calls.length === 0) {
        return NodeOutputBuilder.of('empty');
      }

      const errors: NodeErrorType[] = [];
      let sawSuccess = false;
      let sawFailure = false;

      for (const call of calls) {
        const tool = this.options.resolveTool(call, state, context);
        if (tool === undefined) {
          sawFailure = true;
          const message = `Tool ${call.name} not found`;
          const record: ToolDispatchRecordType = {
            call,
            'toolName': call.name,
            'status': 'missing',
            'error': message,
          };
          await this.options.storeResult?.(state, record, context);
          await this.options.onError?.(state, record, context);
          errors.push(
            NodeErrorBuilder.from(
              'TOOL_NOT_FOUND',
              message,
              this.name,
              true,
              new Date().toISOString(),
              { 'context': { 'toolName': call.name, 'toolCallId': call.id } },
            ),
          );
          continue;
        }

        try {
          const execute = this.options.executeTool ?? (async (resolvedTool: ToolInterface<Record<string, unknown>, unknown>) => resolvedTool.execute(call.arguments));
          const result = await execute(tool, call, context);
          sawSuccess = true;
          const record: ToolDispatchRecordType = {
            call,
            'toolName': tool.definition.name,
            'status': 'success',
            result,
          };
          await this.options.storeResult?.(state, record, context);
        } catch (cause) {
          sawFailure = true;
          const error = cause instanceof Error ? cause : new Error(errorMessage(cause));
          const record: ToolDispatchRecordType = {
            call,
            'toolName': tool.definition.name,
            'status': 'error',
            'error': error.message,
          };
          await this.options.storeResult?.(state, record, context);
          await this.options.onError?.(state, record, context);
          errors.push(
            NodeErrorBuilder.from(
              'TOOL_EXECUTION_FAILED',
              error.message,
              this.name,
              true,
              new Date().toISOString(),
              { 'context': { 'toolName': tool.definition.name, 'toolCallId': call.id } },
            ),
          );
        }
      }

      if (sawFailure) {
        return NodeOutputBuilder.of(sawSuccess ? 'partial' : 'error', { errors });
      }
      return NodeOutputBuilder.of('done');
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(errorMessage(cause));
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'TOOL_DISPATCH_FAILED',
            error.message,
            this.name,
            true,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}
