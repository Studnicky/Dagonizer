/**
 * ToolCallCodec.decode: schema-validated decoding of a text-channel
 * tool-call envelope.
 *
 *  - A well-formed `{ tool_calls: [{ name, arguments }] }` envelope decodes
 *    to ToolCall[] with stable, namespaced ids.
 *  - Surrounding prose is tolerated (outermost braces are extracted).
 *  - A body failing the TextChannelToolCallEnvelope schema returns [].
 *  - Malformed entries are filtered after validation.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ToolCallCodec } from '../../src/adapter/ToolCallCodec.js';

void describe('ToolCallCodec.decode', () => {
  void it('decodes a well-formed envelope to ToolCall[]', () => {
    const raw = JSON.stringify({
      'tool_calls': [
        { 'name': 'search', 'arguments': { 'q': 'dune' } },
        { 'name': 'fetch', 'arguments': { 'id': 7 } },
      ],
    });
    const calls = ToolCallCodec.decode(raw, 'nano');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.name, 'search');
    assert.deepEqual(calls[0]?.arguments, { 'q': 'dune' });
    assert.ok(calls[0]?.id.startsWith('nano-'), 'id is namespaced by idPrefix');
    assert.notEqual(calls[0]?.id, calls[1]?.id);
  });

  void it('tolerates surrounding prose around the envelope', () => {
    const raw = 'Here is the call: { "tool_calls": [{ "name": "ping", "arguments": {} }] } — done.';
    const calls = ToolCallCodec.decode(raw, 'webllm');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, 'ping');
  });

  void it('returns [] when the body has no JSON object', () => {
    assert.deepEqual(ToolCallCodec.decode('no braces here', 'nano'), []);
  });

  void it('filters entries missing a string name or arguments', () => {
    const raw = JSON.stringify({
      'tool_calls': [
        { 'arguments': { 'q': 'x' } }, // no name
        { 'name': 'ok', 'arguments': { 'q': 'y' } },
      ],
    });
    const calls = ToolCallCodec.decode(raw, 'nano');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, 'ok');
  });

  void it('returns [] when tool_calls is not an array (schema mismatch)', () => {
    const raw = JSON.stringify({ 'tool_calls': 'not-an-array' });
    assert.deepEqual(ToolCallCodec.decode(raw, 'nano'), []);
  });
});
