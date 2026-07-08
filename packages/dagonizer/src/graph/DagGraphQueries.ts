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
