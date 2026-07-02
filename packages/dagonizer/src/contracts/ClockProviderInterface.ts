/**
 * Backend interface for the `Clock` singleton. Implement to provide a custom time source.
 * Matches `@studnicky/clock`'s `ClockProviderType` shape so Dagonizer's `Clock` can wrap a
 * substrate `Clock` instance directly.
 */
export interface ClockProviderInterface {
  /** Monotonic high-resolution time in nanoseconds since an arbitrary origin. */
  hrtime(): bigint;
  /** Current time in milliseconds since the Unix epoch. */
  now(): number;
}
