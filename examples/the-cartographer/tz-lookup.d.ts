/**
 * Type declaration for tz-lookup (CJS package, no bundled types).
 * (lat: number, lng: number) → IANA timezone string (e.g. "America/New_York").
 * Throws for out-of-range coordinates.
 */
declare module 'tz-lookup' {
  function tzlookup(lat: number, lng: number): string;
  export default tzlookup;
}
