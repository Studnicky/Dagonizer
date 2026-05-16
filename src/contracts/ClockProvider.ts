/** Backend interface for the `Clock` singleton. Implement to provide a custom time source. */
export interface ClockProvider {
  /** Monotonic high-resolution time in nanoseconds since an arbitrary origin. */
  hrtime(): bigint;
}
