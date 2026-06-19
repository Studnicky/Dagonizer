/**
 * custom-adapter/dags: pure module — a real, runnable LlmAdapter built by
 * extending BaseAdapter.
 *
 * No side effects, no dispatcher, no execute. Imported by
 * examples/custom-adapter.ts (the executable entry point).
 *
 * EchoAdapter is a complete adapter: it implements the one abstract method
 * BaseAdapter requires, `performChat`, and returns a well-formed
 * ChatResponseType. It hits no network — it echoes the last user message back —
 * so the example is deterministic and runs offline. A production adapter fills
 * `performChat` with a real provider call; the surrounding contract (retry,
 * error classification, capability descriptor) comes from BaseAdapter for free.
 */

import {
  BaseAdapter,
  ChatResponseMessageBuilder,
  ZERO_TOKEN_USAGE,
} from '@studnicky/dagonizer/adapter';
import type { ChatRequestType, ChatResponseType } from '@studnicky/dagonizer/adapter';

// #region custom-adapter
export class EchoAdapter extends BaseAdapter {
  constructor() {
    super('echo', 'Echo Provider', {
      toolUse: 'none',
      structuredOutput: false,
      jsonMode: false,
    });
  }

  protected override async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    // A real adapter calls its provider here. This one echoes the last user
    // message so the example is deterministic and needs no network.
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const reply = lastUser === undefined ? '(no user message)' : `echo: ${lastUser.content}`;
    return {
      message: ChatResponseMessageBuilder.from(reply, []),
      finishReason: 'stop',
      usage: ZERO_TOKEN_USAGE,
    };
  }
}
// #endregion custom-adapter
