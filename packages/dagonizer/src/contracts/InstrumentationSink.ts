/**
 * InstrumentationSink: adapter contract for receiving forwarded instrumentation
 * messages inside ChannelDispatch.request().
 *
 * Replaces the raw `onInstrumentation` callback so no bare function crosses
 * the API boundary. DagContainerBase constructs an InstrumentationSinkImpl
 * per-request and passes it to ChannelDispatch.request().
 *
 * Lives in contracts/ (adapter contract taxonomy).
 */

import type { BridgeMessage } from '../entities/executor/BridgeMessage.js';

export interface InstrumentationSink {
  /** Called when the channel delivers an instrumentation bridge message. */
  onInstrumentation(msg: BridgeMessage & { kind: 'instrumentation' }): void;
}
