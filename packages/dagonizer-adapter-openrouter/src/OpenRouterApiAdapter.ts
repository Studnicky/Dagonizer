/**
 * OpenRouterApiAdapter: OpenRouter REST adapter.
 *
 * Defaults to the free-tier Llama 3.3 70B Instruct route. Requires
 * `HTTP-Referer` + `X-Title` headers per OpenRouter's :free tier
 * routing rules. Both headers are overridable via options so consuming
 * projects can set their own identity.
 */

import { OpenAiCompatibleAdapter } from '@studnicky/dagonizer/adapter';
import type { OpenAiCompatibleAdapterOptionsType } from '@studnicky/dagonizer/adapter';

const DEFAULT_REFERER = 'https://studnicky.github.io/Dagonizer/';
const DEFAULT_TITLE   = 'Dagonizer Archivist';

export type OpenRouterApiAdapterOptionsType = OpenAiCompatibleAdapterOptionsType & {
  /** `HTTP-Referer` header sent to OpenRouter. Defaults to the Dagonizer project URL. */
  readonly referer?: string;
  /** `X-Title` header sent to OpenRouter. Defaults to the Dagonizer project name. */
  readonly title?: string;
};

export class OpenRouterApiAdapter extends OpenAiCompatibleAdapter {
  constructor(apiKey: string, options: OpenRouterApiAdapterOptionsType = {}) {
    super(
      apiKey,
      {
        'id':            'openrouter',
        'displayName':   'OpenRouter (llama-3.3-70b free)',
        // ":free" routing can downgrade to non-tool endpoints; treat as partial.
        'capabilities':  { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
        'endpoint':      'https://openrouter.ai/api/v1/chat/completions',
        'defaultModel':  'meta-llama/llama-3.3-70b-instruct:free',
        'tokenField':    'max_tokens',
        'extraHeaders':  {
          'HTTP-Referer': options.referer ?? DEFAULT_REFERER,
          'X-Title':      options.title   ?? DEFAULT_TITLE,
        },
      },
      options,
    );
  }
}
