/**
 * IpcChannel: MessageChannelInterface over child_process IPC.
 *
 * Accepts a structural endpoint so the same class serves both sides of the
 * IPC boundary:
 *
 *   Parent side:  IpcChannel.ofChildProcess(child)
 *   Child side:   new IpcChannel({ send: (m) => process.send!(m), on: (e, fn) => process.on(e, fn) })
 *
 * send      → endpoint.send(message)
 * onMessage → endpoint.on('message', handler)
 * close     → mark closed; IPC channel lifecycle is managed by the process
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import { BaseMessageChannel } from '@studnicky/dagonizer/container';
import { BridgeMessageBuilder } from '@studnicky/dagonizer/entities';
import type { BridgeMessageType } from '@studnicky/dagonizer/entities';
import { Validator } from '@studnicky/dagonizer/validation';

// ---------------------------------------------------------------------------
// IpcEndpointInterface: structural shape injectable from parent or child side
// ---------------------------------------------------------------------------

export interface IpcEndpointInterface {
  send(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): this;
}

// ---------------------------------------------------------------------------
// IpcProcessLikeInterface: minimal structural type satisfied by ChildProcess and
// cluster.Worker — allows IpcChannel.ofChildProcess to serve both.
// ---------------------------------------------------------------------------

export interface IpcProcessLikeInterface {
  send(message: object): unknown;
  on(event: 'message', listener: (message: unknown) => void): this;
}

// ---------------------------------------------------------------------------
// IpcChannel
// ---------------------------------------------------------------------------

export class IpcChannel extends BaseMessageChannel {
  readonly #endpoint: IpcEndpointInterface;

  /**
   * Construct an IpcChannel from any IpcProcessLikeInterface (ChildProcess or
   * cluster.Worker). Adapts the process's `.send(Serializable)` signature
   * to the IpcEndpointInterface contract with the Serializable→object cast isolated here.
   * Both ForkContainer and ClusterContainer use this factory.
   */
  static ofChildProcess(process: IpcProcessLikeInterface): IpcChannel {
    const sendFn = (message: unknown): void => { process.send(message as object); };
    const onFn = (event: 'message', listener: (message: unknown) => void): IpcEndpointInterface => {
      process.on(event, listener);
      return { 'send': sendFn, 'on': onFn };
    };
    return new IpcChannel({ 'send': sendFn, 'on': onFn });
  }

  constructor(endpoint: IpcEndpointInterface) {
    super();
    this.#endpoint = endpoint;

    // Install exactly one underlying IPC listener for the channel's lifetime.
    // Inbound messages route through the base's guarded dispatch.
    // onMessage() replaces the base handler — it never re-subscribes to the endpoint.
    this.#endpoint.on('message', (value) => {
      if (this.closed) return;
      // Validate-and-narrow at the IPC ingest boundary: the type predicate
      // narrows with zero casts; malformed payloads surface as an error message.
      if (Validator.bridgeMessage.is(value)) {
        this.dispatch(value);
      } else {
        this.dispatch(BridgeMessageBuilder.invalid(
          'INVALID_MESSAGE',
          'Received a message that does not conform to BridgeMessage schema',
        ));
      }
    });
  }

  override send(message: BridgeMessageType): void {
    if (this.closed) return;
    this.#endpoint.send(message);
  }

  // IPC channel lifecycle belongs to the process; the base `close()` flips the
  // latch and releases the handler, which is the full teardown here.
}
