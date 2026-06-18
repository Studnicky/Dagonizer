/**
 * CerebrasApiAdapter: Cerebras REST adapter.
 *
 * Defaults to `gpt-oss-120b` on Cerebras's Wafer-Scale Engine
 * inference. Cerebras serves no `llama-3.3-70b` variant, so that model
 * id resolves to a model-not-found error.
 *
 * Tool-use is `'partial'`; model coverage varies. `shouldFallbackWithoutTools`
 * retries as plain chat when the provider signals tools are unsupported.
 */

import { LlmError, OpenAiCompatibleAdapter } from '@noocodex/dagonizer/adapter';
import type { OpenAiCompatibleAdapterOptions } from '@noocodex/dagonizer/adapter';

export class CerebrasApiAdapter extends OpenAiCompatibleAdapter {
  constructor(apiKey: string, options: OpenAiCompatibleAdapterOptions = {}) {
    super(
      apiKey,
      {
        'id':           'cerebras',
        'displayName':  'Cerebras (gpt-oss-120b)',
        'capabilities': { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
        'endpoint':     'https://api.cerebras.ai/v1/chat/completions',
        'defaultModel': 'gpt-oss-120b',
        'tokenField':   'max_completion_tokens',
        'extraHeaders': {},
      },
      options,
    );
  }

  /**
   * Cerebras returns a structured error when the selected model doesn't
   * support tools; retry the request as plain chat in that case.
   */
  protected override shouldFallbackWithoutTools(error: unknown): boolean {
    return error instanceof LlmError
      && /tool/iu.test(error.message)
      && /not support|unsupported/iu.test(error.message);
  }
}
