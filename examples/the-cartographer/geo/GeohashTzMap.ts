/**
 * Geohash-4 static map decoder — browser-safe port.
 *
 * Loads pre-generated binary artifacts embedded as base64 JSON and exposes
 * `lookup(lat, lon)` — a fast geohash-encode → table lookup, O(1) per call.
 *
 * File formats:
 *
 *   geohash4.b64.json (GHZ5 magic):
 *     GHZ5 (12-byte header):
 *       [0..3]  magic: 0x47 0x48 0x5A 0x35 ("GHZ5")
 *       [4..5]  uint16LE: tupleCount
 *       [6..7]  uint16LE: bitsPerEntry (informational)
 *       [8..11] uint32LE: cellCount = 1048576
 *       [12..]  RLE body: [uint32LE runLength][uint16LE tupleIndex] pairs
 *               Mixed cells have tupleIndex = 0xFFFF (MIXED_SENTINEL).
 *
 *   overrides.b64.json (OVR3 magic):
 *     Header (12 bytes):
 *       [0..3]  magic: 0x4F 0x56 0x52 0x33 ("OVR3")
 *       [4..7]  uint32LE: tupleCount
 *       [8..11] uint32LE: parentCount
 *     Body: parentCount entries, ascending by parent cell index:
 *       LEB128 unsigned varint: delta from previous parent index (first: absolute)
 *       uint8: runCount (1–32)
 *       runCount × uint32LE packed run:
 *         bits [31..27]: runLength - 1  (5 bits, 0=run of 1 … 31=run of 32)
 *         bits [26.. 0]: tupleIndex     (27 bits, supports up to 134M tuples)
 *
 * @module
 */
import geohash4B64 from './data/geohash4.b64.json' with { type: 'json' };
import overridesB64 from './data/overrides.b64.json' with { type: 'json' };
import tuplesData from './data/tuples.json' with { type: 'json' };

import { GeohashTzMapError } from './GeohashTzMapError.ts';

// ---------------------------------------------------------------------------
// Geohash-4 cell constants and index helper
// ---------------------------------------------------------------------------

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Total number of geohash-4 cells (32^4). */
const GEOHASH4_CELL_COUNT = 1_048_576;

/** Number of bytes in the geohash4 header (GHZ5). */
const GEOHASH4_HEADER_BYTES_V5 = 12;

/** Number of bytes in the geohash4 header (GHZ6). */
const GEOHASH4_HEADER_BYTES_V6 = 16;

/** Minimum bytes remaining to decode one full RLE entry (GHZ5: 4+2=6, so offset+5 < length). */
const RLE_ENTRY_MIN_REMAINING_V5 = 5;

/** Minimum bytes remaining to decode one full RLE entry (GHZ6: 4+4=8, so offset+7 < length). */
const RLE_ENTRY_MIN_REMAINING_V6 = 7;

/** Bit-shift amounts for each geohash character position in a 4-char string. */
const GEOHASH_SHIFT_0 = 15;
const GEOHASH_SHIFT_1 = 10;
const GEOHASH_SHIFT_2 = 5;

/** Expected magic bytes for GHZ5: "GHZ5". */
const MAGIC_GHZ5_BYTE_0 = 0x47;
const MAGIC_GHZ5_BYTE_1 = 0x48;
const MAGIC_GHZ5_BYTE_2 = 0x5a;
const MAGIC_GHZ5_BYTE_3 = 0x35;

/** Last byte distinguishing GHZ6 from GHZ5. */
const MAGIC_GHZ6_BYTE_3 = 0x36;

/** Expected magic bytes for OVR3: "OVR3". */
const OVR3_MAGIC_BYTE_0 = 0x4f;
const OVR3_MAGIC_BYTE_1 = 0x56;
const OVR3_MAGIC_BYTE_2 = 0x52;
const OVR3_MAGIC_BYTE_3 = 0x33;

/** Sentinel value in GHZ5 cells with override children (uint16). */
const MIXED_SENTINEL_V5 = 0xFFFF;

/** Sentinel value in GHZ6 cells with override children (uint32). */
const MIXED_SENTINEL_V6 = 0xFFFFFFFF;

/** Byte size of the uint32LE run-length field. */
const RLE_RUN_SIZE = 4;

/** Byte size of the uint16LE tuple-index field in GHZ5. */
const RLE_TUPLE_SIZE_V5 = 2;

/** Byte size of the uint32LE tuple-index field in GHZ6. */
const RLE_TUPLE_SIZE_V6 = 4;

/** OVR3 header byte count. */
const OVR3_HEADER_BYTES = 12;

/** OVR3 bit-shift for run-length field (bits [31..27]). */
const OVR3_RUN_LEN_SHIFT = 27;

/** OVR3 mask to extract tupleIndex (lower 27 bits). */
const OVR3_TUPLE_MASK = 0x07FFFFFF;

/** OVR3 byte size of each packed run word. */
const OVR3_RUN_WORD_SIZE = 4;

/** Number of depth-5 children per geohash-4 parent. */
const CHILDREN_PER_PARENT = 32;

/** LEB128 data bits per byte. */
const LEB128_DATA_BITS = 7;

/** LEB128 continue-bit mask. */
const LEB128_CONTINUE_BIT = 0x80;

/** LEB128 data-bits mask. */
const LEB128_DATA_MASK = 0x7F;

/** Byte offset of parentCount field in OVR3 header. */
const OVR3_PARENT_COUNT_OFFSET = 8;

/** Geohash precision for base cell lookup. */
const GEOHASH_PRECISION_BASE = 4;

/** Geohash precision for override child lookup. */
const GEOHASH_PRECISION_DEPTH5 = 5;

// ---------------------------------------------------------------------------
// B32 character-to-index lookup
// ---------------------------------------------------------------------------

const B32_CHAR_INDEX = new Map<string, number>();
for (let charPos = 0; charPos < GEOHASH_BASE32.length; charPos++) {
  B32_CHAR_INDEX.set(GEOHASH_BASE32[charPos] ?? '', charPos);
}

// ---------------------------------------------------------------------------
// Inlined geohash encoder (browser-safe: pure bit-interleaving, no external dep)
// ---------------------------------------------------------------------------

/**
 * Pure geohash encoder using standard interleaved lon/lat bit encoding.
 * Only precision 4 and 5 are needed by the decoder.
 */
class Geohash {
  /**
   * Encodes a WGS-84 coordinate to a geohash string of the given precision.
   *
   * @param lat       WGS-84 latitude  (−90 … 90)
   * @param lon       WGS-84 longitude (−180 … 180)
   * @param precision Character precision (4 or 5 for this decoder)
   * @returns Geohash string
   */
  public static encode(lat: number, lon: number, precision: number): string {
    let minLat = -90;
    let maxLat = 90;
    let minLon = -180;
    let maxLon = 180;

    let hash = '';
    let bits = 0;
    let bitsTotal = 0;
    let hashValue = 0;
    let isEven = true;

    while (hash.length < precision) {
      if (isEven) {
        const midLon = (minLon + maxLon) / 2;
        if (lon >= midLon) {
          hashValue = (hashValue << 1) | 1;
          minLon = midLon;
        } else {
          hashValue = hashValue << 1;
          maxLon = midLon;
        }
      } else {
        const midLat = (minLat + maxLat) / 2;
        if (lat >= midLat) {
          hashValue = (hashValue << 1) | 1;
          minLat = midLat;
        } else {
          hashValue = hashValue << 1;
          maxLat = midLat;
        }
      }

      isEven = !isEven;
      bits++;
      bitsTotal++;

      if (bits === 5) {
        hash += GEOHASH_BASE32[hashValue] ?? '0';
        bits = 0;
        hashValue = 0;
      }
    }

    return hash;
  }
}

// ---------------------------------------------------------------------------
// geohash4 cell-index helper
// ---------------------------------------------------------------------------

function geohash4ToIndex(geohash: string): number {
  const idx0 = B32_CHAR_INDEX.get(geohash[0] ?? '') ?? 0;
  const idx1 = B32_CHAR_INDEX.get(geohash[1] ?? '') ?? 0;
  const idx2 = B32_CHAR_INDEX.get(geohash[2] ?? '') ?? 0;
  const idx3 = B32_CHAR_INDEX.get(geohash[3] ?? '') ?? 0;
  return (idx0 << GEOHASH_SHIFT_0) | (idx1 << GEOHASH_SHIFT_1) | (idx2 << GEOHASH_SHIFT_2) | idx3;
}

// ---------------------------------------------------------------------------
// Base64 → Uint8Array (browser-safe; atob is available in both browsers + Node18+)
// ---------------------------------------------------------------------------

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => { return c.charCodeAt(0); });
}

// ---------------------------------------------------------------------------
// Tuples table narrowing helpers (no `as` casts)
// ---------------------------------------------------------------------------

/** Type guard narrowing `unknown` to a plain-object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) { return false; }
  return value.every(
    (entry: unknown): entry is string => { return typeof entry === 'string'; },
  );
}

function isQuadEntry(value: unknown): value is readonly [number, number, number, number] {
  if (!Array.isArray(value)) { return false; }
  return (
    value.length >= 4 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'number' &&
    typeof value[3] === 'number'
  );
}

function isQuadArray(
  value: unknown,
): value is readonly (readonly [number, number, number, number])[] {
  if (!Array.isArray(value)) { return false; }
  return value.every(isQuadEntry);
}

/** Extract and validate the locale-extended tuples table from the imported JSON. */
function extractTupleData(parsed: unknown): {
  timezones: readonly string[];
  countries: readonly string[];
  waterBodies: readonly string[];
  locales: readonly string[];
  tuples: readonly (readonly [number, number, number, number])[];
} {
  if (!isRecord(parsed)) {
    throw new GeohashTzMapError('tuples.json root is not an object');
  }

  const rawTimezones = parsed['timezones'];
  const rawCountries = parsed['countries'];
  const rawWaterBodies = parsed['waterBodies'];
  const rawLocales = parsed['locales'];
  const rawTuples = parsed['tuples'];

  if (!isStringArray(rawTimezones)) {
    throw new GeohashTzMapError('tuples.json missing or invalid timezones array');
  }
  if (!isStringArray(rawCountries)) {
    throw new GeohashTzMapError('tuples.json missing or invalid countries array');
  }
  if (!isStringArray(rawWaterBodies)) {
    throw new GeohashTzMapError('tuples.json missing or invalid waterBodies array');
  }
  if (!isStringArray(rawLocales)) {
    throw new GeohashTzMapError('tuples.json missing or invalid locales array');
  }
  if (!isQuadArray(rawTuples)) {
    throw new GeohashTzMapError('tuples.json missing or invalid tuples array');
  }

  return {
    timezones: rawTimezones,
    countries: rawCountries,
    waterBodies: rawWaterBodies,
    locales: rawLocales,
    tuples: rawTuples,
  };
}

// ---------------------------------------------------------------------------
// LEB128 (unsigned) reader — operates on Uint8Array
// ---------------------------------------------------------------------------

/**
 * Read an unsigned LEB128 varint from bytes at offset.
 * Returns the decoded value and the number of bytes consumed.
 */
function readLEB128(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  let byteVal: number;
  do {
    byteVal = bytes[offset + bytesRead] ?? 0;
    bytesRead++;
    value |= (byteVal & LEB128_DATA_MASK) << shift;
    shift += LEB128_DATA_BITS;
  } while ((byteVal & LEB128_CONTINUE_BIT) !== 0);
  return { value: value, bytesRead: bytesRead };
}

// ---------------------------------------------------------------------------
// Public domain object — one exported symbol per file
// ---------------------------------------------------------------------------

/**
 * Fast geohash-4 → timezone + country + waterBody + locale lookup backed by
 * pre-generated binary artifacts embedded as base64. All data is decoded once
 * at construction time into memory.
 *
 * Call `lookup(lat, lon)` for O(1) coordinate resolution.
 */
export class GeohashTzMap {
  // Instance fields (monomorphic shape — all defined at construction).
  private readonly timezones: readonly string[];
  private readonly countries: readonly string[];
  private readonly waterBodies: readonly string[];
  private readonly locales: readonly string[];
  private readonly tuples: readonly (readonly [number, number, number, number])[];
  private readonly cells: Uint32Array;
  private readonly mixedSentinel: number;
  private readonly overrideParentSlots: ReadonlyMap<number, number>;
  private readonly overrideChildTable: Int32Array;

  public constructor() {
    const tableData = extractTupleData(tuplesData);
    this.timezones = tableData.timezones;
    this.countries = tableData.countries;
    this.waterBodies = tableData.waterBodies;
    this.locales = tableData.locales;
    this.tuples = tableData.tuples;

    const geohash4Bytes = b64ToBytes(geohash4B64.b64);
    const geohash4Result = GeohashTzMap.decodeGeohash4Bin(geohash4Bytes);
    this.cells = geohash4Result.cells;
    this.mixedSentinel = geohash4Result.mixedSentinel;

    const overridesBytes = b64ToBytes(overridesB64.b64);
    const overrides = GeohashTzMap.decodeOverridesBin(overridesBytes);
    this.overrideParentSlots = overrides.parentIndexToSlot;
    this.overrideChildTable = overrides.childTable;
  }

  // ---------------------------------------------------------------------------
  // Private static decoders
  // ---------------------------------------------------------------------------

  private static decodeGeohash4Bin(
    bytes: Uint8Array,
  ): { cells: Uint32Array; mixedSentinel: number } {
    const isGhz5 =
      bytes[0] === MAGIC_GHZ5_BYTE_0 &&
      bytes[1] === MAGIC_GHZ5_BYTE_1 &&
      bytes[2] === MAGIC_GHZ5_BYTE_2 &&
      bytes[3] === MAGIC_GHZ5_BYTE_3;

    const isGhz6 =
      bytes[0] === MAGIC_GHZ5_BYTE_0 &&
      bytes[1] === MAGIC_GHZ5_BYTE_1 &&
      bytes[2] === MAGIC_GHZ5_BYTE_2 &&
      bytes[3] === MAGIC_GHZ6_BYTE_3;

    if (!isGhz5 && !isGhz6) {
      throw new GeohashTzMapError('geohash4.bin: invalid magic bytes');
    }

    const cells = new Uint32Array(GEOHASH4_CELL_COUNT);

    if (isGhz5) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let offset = GEOHASH4_HEADER_BYTES_V5;
      let cellPos = 0;
      while (cellPos < GEOHASH4_CELL_COUNT && offset + RLE_ENTRY_MIN_REMAINING_V5 < bytes.byteLength) {
        const runLen = dv.getUint32(offset, true);
        offset += RLE_RUN_SIZE;
        const tupleIdx = dv.getUint16(offset, true);
        offset += RLE_TUPLE_SIZE_V5;
        const end = Math.min(cellPos + runLen, GEOHASH4_CELL_COUNT);
        cells.fill(tupleIdx, cellPos, end);
        cellPos = end;
      }
      return { cells: cells, mixedSentinel: MIXED_SENTINEL_V5 };
    }

    // GHZ6: uint32 tupleIdx slots
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = GEOHASH4_HEADER_BYTES_V6;
    let cellPos = 0;
    while (cellPos < GEOHASH4_CELL_COUNT && offset + RLE_ENTRY_MIN_REMAINING_V6 < bytes.byteLength) {
      const runLen = dv.getUint32(offset, true);
      offset += RLE_RUN_SIZE;
      const tupleIdx = dv.getUint32(offset, true);
      offset += RLE_TUPLE_SIZE_V6;
      const end = Math.min(cellPos + runLen, GEOHASH4_CELL_COUNT);
      cells.fill(tupleIdx, cellPos, end);
      cellPos = end;
    }
    return { cells: cells, mixedSentinel: MIXED_SENTINEL_V6 };
  }

  private static decodeOverridesBin(
    bytes: Uint8Array,
  ): { parentIndexToSlot: ReadonlyMap<number, number>; childTable: Int32Array } {
    if (
      bytes[0] !== OVR3_MAGIC_BYTE_0 ||
      bytes[1] !== OVR3_MAGIC_BYTE_1 ||
      bytes[2] !== OVR3_MAGIC_BYTE_2 ||
      bytes[3] !== OVR3_MAGIC_BYTE_3
    ) {
      throw new GeohashTzMapError('overrides.bin: invalid magic bytes (expected OVR3)');
    }

    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const parentCount = dv.getUint32(OVR3_PARENT_COUNT_OFFSET, true);

    const childTable = new Int32Array(parentCount * CHILDREN_PER_PARENT);
    const parentIndexToSlot = new Map<number, number>();

    let offset = OVR3_HEADER_BYTES;
    let currentParentIndex = 0;

    for (let slot = 0; slot < parentCount; slot++) {
      const { value: deltaValue, bytesRead } = readLEB128(bytes, offset);
      offset += bytesRead;
      currentParentIndex += deltaValue;
      parentIndexToSlot.set(currentParentIndex, slot);

      const runCount = bytes[offset] ?? 0;
      offset += 1;

      const baseSlot = slot * CHILDREN_PER_PARENT;
      let childPos = 0;
      for (let runIdx = 0; runIdx < runCount; runIdx++) {
        const packed = dv.getUint32(offset, true);
        offset += OVR3_RUN_WORD_SIZE;
        const runLen = (packed >>> OVR3_RUN_LEN_SHIFT) + 1;
        const tupleIdx = packed & OVR3_TUPLE_MASK;
        const runEnd = childPos + runLen;
        for (let childOffset = childPos; childOffset < runEnd; childOffset++) {
          childTable[baseSlot + childOffset] = tupleIdx;
        }
        childPos = runEnd;
      }
    }

    return { parentIndexToSlot: parentIndexToSlot, childTable: childTable };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Resolve the pre-generated IANA timezone, ISO country code, named water body,
   * and BCP-47 locale for the given WGS-84 coordinate.
   *
   * Returns `{ timezone: '', country: '', waterBody: '', locale: '' }` when the
   * coordinate falls outside all mapped cells (e.g. NaN input).
   *
   * @param lat  WGS-84 latitude  (−90 … 90)
   * @param lon  WGS-84 longitude (−180 … 180)
   */
  public lookup(lat: number, lon: number): {
    timezone: string;
    country: string;
    waterBody: string;
    locale: string;
  } {
    const geohash4 = Geohash.encode(lat, lon, GEOHASH_PRECISION_BASE);
    const cellIdx = geohash4ToIndex(geohash4);
    const baseTupleIdx = this.cells[cellIdx] ?? 0;

    if (baseTupleIdx === this.mixedSentinel) {
      const geohash5 = Geohash.encode(lat, lon, GEOHASH_PRECISION_DEPTH5);
      const childTupleIdx = this.lookupOverride(cellIdx, geohash5);
      return this.resolveTuple(childTupleIdx);
    }

    return this.resolveTuple(baseTupleIdx);
  }

  // ---------------------------------------------------------------------------
  // Private instance helpers
  // ---------------------------------------------------------------------------

  private lookupOverride(parentCellIdx: number, geohash5: string): number {
    const slot = this.overrideParentSlots.get(parentCellIdx);
    if (slot === undefined) {
      return 0;
    }
    const childChar = geohash5[4] ?? '0';
    const childCharIdx = B32_CHAR_INDEX.get(childChar) ?? 0;
    return this.overrideChildTable[slot * CHILDREN_PER_PARENT + childCharIdx] ?? 0;
  }

  private resolveTuple(tupleIdx: number): {
    timezone: string;
    country: string;
    waterBody: string;
    locale: string;
  } {
    const tuple = this.tuples[tupleIdx];
    if (tuple === undefined) {
      return { timezone: '', country: '', waterBody: '', locale: '' };
    }
    const timezone = this.timezones[tuple[0]] ?? '';
    const country = this.countries[tuple[1]] ?? '';
    const waterBody = this.waterBodies[tuple[2]] ?? '';
    const locale = this.locales[tuple[3]] ?? '';
    return { timezone: timezone, country: country, waterBody: waterBody, locale: locale };
  }
}
