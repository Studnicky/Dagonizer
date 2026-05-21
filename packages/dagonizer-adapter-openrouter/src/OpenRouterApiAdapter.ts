/**
 * OpenRouterApiAdapter — OpenRouter REST adapter.
 *
 * Defaults to the free-tier Llama 3.3 70B Instruct route. Requires
 * `HTTP-Referer` + `X-Title` headers per OpenRouter's :free tier
 * routing rules.
 */

import { OpenAiCompatibleAdapter } from '@noocodex/dagonizer/adapter';
import type { OpenAiCompatibleAdapterOptions } from '@noocodex/dagonizer/adapter';

export interface OpenRouterApiAdapterOptions extends OpenAiCompatibleAdapterOptions {}

export class OpenRouterApiAdapter extends OpenAiCompatibleAdapter {
  constructor(options: OpenRouterApiAdapterOptions) {
    super(
      {
        'id':            'openrouter',
        'displayName':   'OpenRouter (llama-3.3-70b free)',
        // ":free" routing can downgrade to non-tool endpoints; treat as partial.
        'capabilities':  { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
        'endpoint':      'https://openrouter.ai/api/v1/chat/completions',
        'defaultModel':  'meta-llama/llama-3.3-70b-instruct:free',
        'tokenField':    'max_tokens',
        'extraHeaders':  {
          'HTTP-Referer': 'https://studnicky.github.io/Dagonizer/',
          'X-Title':      'Dagonizer Archivist',
        },
      },
      options,
    );
  }
}
