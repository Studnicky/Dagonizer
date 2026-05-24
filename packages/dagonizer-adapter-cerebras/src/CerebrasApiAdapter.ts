/**
 * CerebrasApiAdapter — Cerebras REST adapter.
 *
 * `gpt-oss-120b` on Cerebras's Wafer-Scale Engine inference. Cerebras
 * has no `llama-3.3-70b` variant; the previous default returned a
 * model-not-found error every call.
 *
 * Tool-use is `'partial'` — model coverage varies. The shared
 * `toolsFallback` hook retries as plain chat when the provider
 * signals tools are unsupported.
 */

import { LlmError, OpenAiCompatibleAdapter } from '@noocodex/dagonizer/adapter';
import type { OpenAiCompatibleAdapterOptions } from '@noocodex/dagonizer/adapter';

export interface CerebrasApiAdapterOptions extends OpenAiCompatibleAdapterOptions {}

export class CerebrasApiAdapter extends OpenAiCompatibleAdapter {
  constructor(apiKey: string, options: CerebrasApiAdapterOptions = {}) {
    super(
      apiKey,
      {
        'id':            'cerebras',
        'displayName':   'Cerebras (gpt-oss-120b)',
        'capabilities':  { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
        'endpoint':      'https://api.cerebras.ai/v1/chat/completions',
        'defaultModel':  'gpt-oss-120b',
        'tokenField':    'max_completion_tokens',
        'extraHeaders':  {},
        // Cerebras returns a structured error when the selected model
        // doesn't support tools; retry as plain chat.
        'toolsFallback': (err) => err instanceof LlmError
          && /tool/iu.test(err.message)
          && /not support|unsupported/iu.test(err.message),
      },
      options,
    );
  }
}
