/**
 * StubAdapter — offline canned-responses adapter.
 *
 * Always available; ships with the demo so it works without any
 * network or API key. Implements `chat()` by routing the request to
 * pattern-matchers — the last user message is inspected and a canned
 * response is returned. Tool calls are emitted when the visitor names
 * a specific title / author / ISBN (regex match against the message),
 * otherwise the adapter returns prose.
 */

import { BaseAdapter } from './BaseAdapter.ts';
import type { ChatRequest, ChatResponse, ToolCall, ToolDefinition } from './LlmAdapter.ts';

export class StubAdapter extends BaseAdapter {
  constructor() {
    super({ 'id': 'stub', 'displayName': 'Canned responses (offline stub)', 'maxAttempts': 1 });
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const query = lastUser?.content ?? '';

    if (request.tools !== undefined && request.tools.length > 0 && shouldInvokeWebSearch(query)) {
      const calls = toolCallFor(query, request.tools);
      return { 'message': { 'toolCalls': calls }, 'finishReason': 'tool_call' };
    }

    if (request.outputSchema !== undefined) {
      // Hand back a minimal JSON shape that matches the schema for the
      // tool-decision flow — empty tool_calls array means "no tool".
      return { 'message': { 'content': JSON.stringify({ 'tool_calls': [] }) }, 'finishReason': 'stop' };
    }

    return { 'message': { 'content': cannedAnswer(query) }, 'finishReason': 'stop' };
  }
}

function shouldInvokeWebSearch(query: string): boolean {
  // ISBN-13 / ISBN-10 patterns, quoted titles, or "by <author>" hints.
  return (
    /\b97[89]\d{10}\b/u.test(query)
    || /"([^"]{3,})"/u.test(query)
    || /\bby\s+[A-Z][a-z]+/u.test(query)
    || /\bauthor\b|\bisbn\b|\btitle\b/iu.test(query)
  );
}

function toolCallFor(query: string, tools: readonly ToolDefinition[]): ToolCall[] {
  const webSearch = tools.find((t) => t.name === 'web_search_books');
  if (webSearch === undefined) return [];
  // Strip the prompt scaffolding to extract just the visitor question.
  const visitor = query.split(/visitor question:/iu)[1]?.trim() ?? query.slice(-200);
  return [{
    'id':   `stub-${String(Date.now())}`,
    'name': webSearch.name,
    'arguments': { 'query': visitor, 'limit': 5 },
  }];
}

function cannedAnswer(query: string): string {
  const q = query.toLowerCase();
  if (q.includes('house') || q.includes('library') || q.includes('labyrinth')) {
    return 'Try "Piranesi" by Susanna Clarke — a quiet, cosmic novel about a man living in an endless House.';
  }
  if (q.includes('mystery') || q.includes('detective')) {
    return 'Consider "The Library at Mount Char" by Scott Hawkins — strange, dark, modern myth-mystery.';
  }
  return 'I can help with searches, descriptions, and recommendations — tell me what kind of book you\'re after.';
}
