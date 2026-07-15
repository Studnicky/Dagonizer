declare module 'rdf-canonize' {
  export function _canonizeSync(
    input: string,
    options: { algorithm: 'RDFC-1.0'; inputFormat: 'application/n-quads' },
  ): string;
}
