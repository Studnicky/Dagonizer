/**
 * Ambient type declaration for tz-lookup.
 *
 * The package ships no TypeScript types. This declaration satisfies the
 * type checker for code that imports it (examples/the-cartographer/services.ts).
 * The single default export is a function that maps (lat, lon) → IANA timezone string.
 */
declare module 'tz-lookup' {
  function tzlookup(lat: number, lon: number): string;
  export = tzlookup;
}
