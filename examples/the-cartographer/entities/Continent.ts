export class Continent {
  private constructor() { /* static-only */ }

  static readonly values = Object.freeze(Continent.define(
    'Africa',
    'Antarctica',
    'Asia',
    'Europe',
    'North America',
    'Oceania',
    'South America',
    'Unmapped',
    'International Waters / Maritime',
  ));

  static is(value: string): value is typeof Continent.values[number] {
    return Continent.values.some((continent) => continent === value);
  }

  static require(value: string): typeof Continent.values[number] {
    if (!Continent.is(value)) throw new TypeError(`Invalid continent: ${value}`);
    return value;
  }

  private static define<const TValues extends readonly string[]>(...values: TValues): TValues {
    return values;
  }
}
