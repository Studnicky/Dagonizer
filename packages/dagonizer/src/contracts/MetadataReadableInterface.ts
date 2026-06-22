/**
 * MetadataReadableInterface: the minimal read surface `MetadataGetter` needs.
 *
 * `NodeStateInterface` extends this contract; `MetadataGetter` depends only on
 * this narrow surface (interface segregation) so it never couples to the full
 * state class. `getMetadata` returns `unknown` — the metadata store holds
 * arbitrary JSON-serialisable values — and `MetadataGetter` narrows each read.
 */
export interface MetadataReadableInterface {
  /** Read a raw metadata value by key. Returns `unknown`; callers narrow. */
  getMetadata(key: string): unknown;
}
