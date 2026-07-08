import type { TripleStoreInterface } from '../contracts/TripleStoreInterface.js';

import { DagGraphTerms } from './DagGraphTerms.js';

export class DagGraphQueries {
  private constructor() { /* static-only */ }

  static candidateDagIris(store: TripleStoreInterface): readonly string[] {
    const rows = store.select({
      'predicate': DagGraphTerms.predicate('candidateDag'),
      'object': '?dag',
    });
    return DagGraphQueries.unique(rows.map((row) => row['dag']?.value));
  }

  static candidateDagNames(store: TripleStoreInterface): readonly string[] {
    const rows = store.select({
      'predicate': DagGraphTerms.predicate('candidateName'),
      'object': '?name',
    });
    return DagGraphQueries.unique(rows.map((row) => row['name']?.value));
  }

  static candidateDagRows(store: TripleStoreInterface): readonly {
    readonly placementIri: string;
    readonly referenceIri: string;
    readonly dagIri: string;
    readonly dynamic: boolean;
  }[] {
    const rows: {
      readonly placementIri: string;
      readonly referenceIri: string;
      readonly dagIri: string;
      readonly dynamic: boolean;
    }[] = [];
    const referenceRows = store.select({
      'subject': '?placement',
      'predicate': DagGraphTerms.predicate('dagReference'),
      'object': '?reference',
    });
    for (const row of referenceRows) {
      const placement = row['placement'];
      const reference = row['reference'];
      if (placement === undefined || reference === undefined) continue;
      const candidateRows = store.select({
        'subject': DagGraphTerms.namedNode(reference.value),
        'predicate': DagGraphTerms.predicate('candidateDag'),
        'object': '?dag',
      });
      const dynamic = store.ask({
        'subject': DagGraphTerms.namedNode(reference.value),
        'predicate': DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE),
        'object': DagGraphTerms.class('DagReference'),
      });
      for (const candidateRow of candidateRows) {
        const dag = candidateRow['dag'];
        if (dag === undefined) continue;
        rows.push({
          'placementIri': placement.value,
          'referenceIri': reference.value,
          'dagIri': dag.value,
          dynamic,
        });
      }
    }
    return rows;
  }

  static reachableCandidateDagIris(store: TripleStoreInterface): readonly string[] {
    return DagGraphQueries.candidatesFromReachablePlacements(store, 'candidateDag');
  }

  static reachableCandidateDagNames(store: TripleStoreInterface): readonly string[] {
    return DagGraphQueries.candidatesFromReachablePlacements(store, 'candidateName');
  }

  static reachablePlacementIris(store: TripleStoreInterface): readonly string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    const queue = [...DagGraphQueries.entryTargets(store).values()];
    while (queue.length > 0) {
      const placementIri = queue.shift();
      if (placementIri === undefined || seen.has(placementIri)) continue;
      seen.add(placementIri);
      result.push(placementIri);

      const routeRows = store.select({
        'subject': DagGraphTerms.namedNode(placementIri),
        'predicate': DagGraphTerms.predicate('route'),
        'object': '?route',
      });
      for (const row of routeRows) {
        const route = row['route'];
        if (route === undefined) continue;
        const target = DagGraphQueries.namedObject(store, route.value, 'target');
        if (target !== undefined && !seen.has(target)) {
          queue.push(target);
        }
      }
    }
    return result;
  }

  static selectedDagIris(store: TripleStoreInterface): readonly string[] {
    const rows = store.select({
      'predicate': DagGraphTerms.predicate('selectedDag'),
      'object': '?dag',
    });
    return DagGraphQueries.unique(rows.map((row) => row['dag']?.value));
  }

  static selectedDagRows(store: TripleStoreInterface): readonly {
    readonly ownerIri: string;
    readonly dagIri: string;
  }[] {
    const rows = store.select({
      'subject': '?owner',
      'predicate': DagGraphTerms.predicate('selectedDag'),
      'object': '?dag',
    });
    const result: {
      readonly ownerIri: string;
      readonly dagIri: string;
    }[] = [];
    for (const row of rows) {
      const owner = row['owner'];
      const dag = row['dag'];
      if (owner === undefined || dag === undefined) continue;
      result.push({ 'ownerIri': owner.value, 'dagIri': dag.value });
    }
    return result;
  }

  static entryTargets(store: TripleStoreInterface): ReadonlyMap<string, string> {
    const targets = new Map<string, string>();
    const entrypointRows = store.select({
      'predicate': DagGraphTerms.predicate('entrypoint'),
      'object': '?entrypoint',
    });
    for (const row of entrypointRows) {
      const entrypoint = row['entrypoint'];
      if (entrypoint === undefined) continue;
      const label = DagGraphQueries.literalObject(store, entrypoint.value, 'label');
      const target = DagGraphQueries.namedObject(store, entrypoint.value, 'target');
      if (label !== undefined && target !== undefined) {
        targets.set(label, target);
      }
    }
    return targets;
  }

  static embeddedDagIris(store: TripleStoreInterface): readonly string[] {
    const rows = store.select({
      'predicate': DagGraphTerms.predicate('embedsDag'),
      'object': '?dag',
    });
    return DagGraphQueries.unique(rows.map((row) => row['dag']?.value));
  }

  static placementInputSchemaIri(store: TripleStoreInterface, placementIri: string): string | undefined {
    const inputPort = DagGraphQueries.namedObject(store, placementIri, 'inputPort');
    return inputPort !== undefined ? DagGraphQueries.namedObject(store, inputPort, 'schema') : undefined;
  }

  static placementOutputSchemaIri(
    store: TripleStoreInterface,
    placementIri: string,
    output: string,
  ): string | undefined {
    const outputPorts = store.select({
      'subject': DagGraphTerms.namedNode(placementIri),
      'predicate': DagGraphTerms.predicate('outputPort'),
      'object': '?port',
    });
    for (const row of outputPorts) {
      const port = row['port'];
      if (port === undefined) continue;
      const label = DagGraphQueries.literalObject(store, port.value, 'label');
      if (label === output) return DagGraphQueries.namedObject(store, port.value, 'schema');
    }
    return undefined;
  }

  private static literalObject(store: TripleStoreInterface, subject: string, predicate: string): string | undefined {
    const row = store.select({
      'subject': DagGraphTerms.namedNode(subject),
      'predicate': DagGraphTerms.predicate(predicate),
      'object': '?value',
    })[0];
    const value = row?.['value'];
    return value?.termType === 'Literal' ? value.value : undefined;
  }

  private static namedObject(store: TripleStoreInterface, subject: string, predicate: string): string | undefined {
    const row = store.select({
      'subject': DagGraphTerms.namedNode(subject),
      'predicate': DagGraphTerms.predicate(predicate),
      'object': '?value',
    })[0];
    const value = row?.['value'];
    return value?.termType === 'NamedNode' ? value.value : undefined;
  }

  private static unique(values: Iterable<string | undefined>): readonly string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      if (value === undefined || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
    return result;
  }

  private static candidatesFromReachablePlacements(store: TripleStoreInterface, predicate: 'candidateDag' | 'candidateName'): readonly string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const placementIri of DagGraphQueries.reachablePlacementIris(store)) {
      const referenceRows = store.select({
        'subject': DagGraphTerms.namedNode(placementIri),
        'predicate': DagGraphTerms.predicate('dagReference'),
        'object': '?reference',
      });
      for (const row of referenceRows) {
        const reference = row['reference'];
        if (reference === undefined) continue;
        const candidateRows = store.select({
          'subject': DagGraphTerms.namedNode(reference.value),
          'predicate': DagGraphTerms.predicate(predicate),
          'object': '?candidate',
        });
        for (const candidateRow of candidateRows) {
          const candidate = candidateRow['candidate']?.value;
          if (candidate === undefined || seen.has(candidate)) continue;
          seen.add(candidate);
          result.push(candidate);
        }
      }
    }
    return result;
  }
}
