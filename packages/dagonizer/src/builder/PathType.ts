/**
 * Dotted-path strings over a state shape, computed recursively.
 *
 *   PathType<{ a: { b: number } }> = 'a' | 'a.b'
 *
 * Falls back to `string` only when the depth cap (8) is reached, which
 * prevents pathological recursion on deeply nested or cyclic types.
 *
 * Behaviour at the edges:
 * - `keyof T & string` skips number and symbol keys.
 * - Array elements contribute `${number}` and `${number}.${PathType<U>}` paths.
 * - Primitive-valued fields contribute only the bare key, not `key.something`.
 * - Types with index signatures (e.g. `Record<string, V>`) produce `string`
 *   keys which TypeScript treats as non-enumerable at the template-literal
 *   level; the result is a broad `string` union rather than diverging.
 */
export type PathType<T, Depth extends ReadonlyArray<unknown> = []> =
  Depth['length'] extends 8       // depth cap; deep nesting resolves to string
    ? string
    : T extends ReadonlyArray<infer U>
      ? `${number}` | `${number}.${PathType<U, [...Depth, 0]>}`
      : T extends object
        ? {
            [K in keyof T & string]:
              T[K] extends object
                ? `${K}` | `${K}.${PathType<T[K], [...Depth, 0]>}`
                : `${K}`;
          }[keyof T & string]
        : never;
